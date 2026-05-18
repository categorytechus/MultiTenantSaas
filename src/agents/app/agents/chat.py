"""Bedrock RAG chat agent with Gemini fallback — structured output with API tool proposal support.

The agent may return either:
  {"type": "chat_response", "message": "..."}
or:
  {"type": "api_task_proposal", "api_module_id": "...", "title": "...",
   "description": "...", "input_payload": {...}}

If the LLM output cannot be parsed as JSON it is treated as a plain chat_response.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

import redis.asyncio as aioredis
from app.config import settings

_CORE_INSTRUCTIONS = """

## Capabilities & Constraints
- You can communicate in natural language.
- You do NOT have direct access to execute or trigger external API actions, database operations, or third-party webhooks yourself.
- If the user asks you to perform an action (e.g., creating a ticket, triggering a webhook, changing settings, executing a task):
  * If a matching action is listed under the "Available API Actions" section, you MUST propose that action using the structured JSON format (Format 2).
  * If NO matching action is listed under the "Available API Actions" section (or if the section is missing entirely), you MUST NOT pretend, assume, role-play, or claim that you have executed or completed the action. Instead, politely inform the user that the required API tool is not currently configured or is unavailable.
"""

_SYSTEM_WITH_CONTEXT = """\
You are a helpful AI assistant. Answer the user's question using the context below, \
which was retrieved from their uploaded documents. \
If the answer cannot be found in the context, say so clearly rather than guessing.

## Retrieved context
{context}
""" + _CORE_INSTRUCTIONS

_SYSTEM_NO_CONTEXT = "You are a helpful AI assistant." + _CORE_INSTRUCTIONS

_API_TOOLS_APPENDIX = """

## Available API Actions
You have access to the following API actions that you can propose when the user's \
request clearly requires one. Only propose an action when ALL required fields from \
the schema are present in the conversation. If any field is missing, ask the user \
for it normally instead of proposing.

Available actions:
{modules_json}

## Response format
You MUST respond with a single JSON object in one of two formats:

Format 1 — normal response:
{{"type": "chat_response", "message": "Your response here"}}

Format 2 — propose an API action:
{{"type": "api_task_proposal", "api_module_id": "<uuid>", \
"title": "<short title>", "description": "<what this will do>", \
"input_payload": {{<field: value pairs from the schema>}}}}

Important rules:
- Respond ONLY with the JSON object. No surrounding text.
- For Format 2, input_payload must include every field from the module's request_schema.
- Never guess field values — if information is missing, use Format 1 to ask.
- Never include auth credentials, tokens, or URLs in your response.
"""


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class AgentResult:
    type: str   # "chat_response" | "api_task_proposal"
    message: str | None = None
    proposal: dict | None = None

    @staticmethod
    def chat(message: str) -> "AgentResult":
        return AgentResult(type="chat_response", message=message)

    @staticmethod
    def proposal(data: dict) -> "AgentResult":
        return AgentResult(type="api_task_proposal", proposal=data)


# ── JSON extraction helper ────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    """
    Try to extract a JSON object from LLM output.
    Handles markdown code fences and stray prefix text.
    """
    # Strip markdown code fence if present
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped.strip())

    # Try direct parse first
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # Find first {...} block
    m = re.search(r"\{.*\}", stripped, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass

    return None


# ── Bedrock path ──────────────────────────────────────────────────────────────

import boto3

_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        client_kwargs = {"region_name": settings.AWS_BEDROCK_REGION}
        if settings.AWS_ACCESS_KEY_ID:
            client_kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
        if settings.AWS_SECRET_ACCESS_KEY:
            client_kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
        if settings.AWS_SESSION_TOKEN:
            client_kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
        _bedrock_client = boto3.client("bedrock-runtime", **client_kwargs)
    return _bedrock_client


async def _run_bedrock(
    conversation: list[dict],
    system_prompt: str,
    has_api_modules: bool,
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Primary path: ChatBedrock via langchain-aws."""
    from langchain_aws import ChatBedrock
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    bedrock_client = _get_bedrock_client()
    llm = ChatBedrock(
        client=bedrock_client,
        model_id=settings.BEDROCK_MODEL_ARN,
        region_name=settings.AWS_BEDROCK_REGION,
        provider=settings.BEDROCK_MODEL_PROVIDER,
    )

    messages = [SystemMessage(content=system_prompt)]
    for m in conversation:
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        else:
            messages.append(AIMessage(content=m["content"]))

    full_response: list[str] = []
    token_count = 0
    async for chunk in llm.astream(messages):
        content = chunk.content
        if isinstance(content, str) and content:
            full_response.append(content)
            token_count += 1
            if not has_api_modules:
                # Normal mode: stream each token to the browser
                await redis.publish(channel, json.dumps({"type": "token", "data": content}))
            elif token_count % 10 == 1:
                # API tool mode: no tokens streamed, but send a heartbeat every ~10 chunks
                # so the SSE connection stays alive while the LLM generates.
                await redis.publish(channel, json.dumps({"type": "heartbeat"}))

    return "".join(full_response)


# ── Gemini path ───────────────────────────────────────────────────────────────

async def _run_gemini(
    api_key: str,
    conversation: list[dict],
    system_prompt: str,
    has_api_modules: bool,
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Fallback path: Gemini."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    contents = [
        {
            "role": "model" if m["role"] == "assistant" else "user",
            "parts": [{"text": m["content"]}],
        }
        for m in conversation
    ]

    full_response: list[str] = []
    token_count = 0
    async for chunk in await client.aio.models.generate_content_stream(
        model=settings.GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(system_instruction=system_prompt),
    ):
        if chunk.text:
            full_response.append(chunk.text)
            token_count += 1
            if not has_api_modules:
                # Normal mode: stream each token to the browser
                await redis.publish(channel, json.dumps({"type": "token", "data": chunk.text}))
            elif token_count % 10 == 1:
                # API tool mode: no tokens streamed, but send a heartbeat every ~10 chunks
                # so the SSE connection stays alive while the LLM generates.
                await redis.publish(channel, json.dumps({"type": "heartbeat"}))

    return "".join(full_response)


# ── Public entry point ────────────────────────────────────────────────────────

async def run_agent(
    *,
    conversation: list[dict],
    context_chunks: list[dict],
    api_modules: list[dict],
    redis: aioredis.Redis,
    channel: str,
) -> AgentResult:
    """
    Stream a Bedrock (or Gemini) response and return an AgentResult.

    When api_modules is non-empty, the system prompt instructs the LLM to
    respond with structured JSON.  In that mode tokens are NOT streamed to
    Redis because the full text must be parsed before any SSE event is emitted.
    """
    # Build system prompt
    if context_chunks:
        context = "\n\n---\n\n".join(
            f"[{c['filename']}]\n{c['content']}" for c in context_chunks
        )
        system_prompt = _SYSTEM_WITH_CONTEXT.format(context=context)
    else:
        system_prompt = _SYSTEM_NO_CONTEXT

    has_api_modules = bool(api_modules)
    if has_api_modules:
        system_prompt += _API_TOOLS_APPENDIX.format(
            modules_json=json.dumps(api_modules, indent=2)
        )

    # Run the LLM
    if settings.CHAT_MODEL == "bedrock":
        if not settings.BEDROCK_MODEL_ARN:
            raise ValueError("BEDROCK_MODEL_ARN must be set when CHAT_MODEL='bedrock'")
        raw = await _run_bedrock(conversation, system_prompt, has_api_modules, redis, channel)
    elif settings.CHAT_MODEL == "gemini":
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY must be set when CHAT_MODEL='gemini'")
        raw = await _run_gemini(settings.GEMINI_API_KEY, conversation, system_prompt,
                                has_api_modules, redis, channel)
    else:
        raw = f"[Mock response — CHAT_MODEL '{settings.CHAT_MODEL}' unknown]"
        if not has_api_modules:
            await redis.publish(channel, json.dumps({"type": "token", "data": raw}))

    # If no API modules were available, raw is already streamed — return plain result
    if not has_api_modules:
        return AgentResult.chat(raw)

    # Parse structured JSON response
    parsed = _extract_json(raw)
    if parsed is None:
        # LLM returned non-JSON despite instructions; treat as plain text
        return AgentResult.chat(raw)

    response_type = parsed.get("type", "chat_response")

    if response_type == "api_task_proposal":
        # Validate the minimum required keys
        required = {"api_module_id", "title", "input_payload"}
        if not required.issubset(parsed.keys()):
            # Malformed proposal — fall back to chat
            return AgentResult.chat(parsed.get("message") or raw)

        # Confirm the referenced module_id is in the allowed list
        allowed_ids = {m["id"] for m in api_modules}
        if parsed["api_module_id"] not in allowed_ids:
            return AgentResult.chat("I tried to propose an API action but the referenced module is not available.")

        # Attach the human-readable module name for SSE event
        module_name = next(
            (m["name"] for m in api_modules if m["id"] == parsed["api_module_id"]),
            "Unknown",
        )
        parsed["api_module_name"] = module_name
        return AgentResult.proposal(parsed)

    # Default: chat_response
    message = parsed.get("message") or raw
    # Stream the message token by token (so the typewriter still works)
    chunk_size = 4
    for i in range(0, len(message), chunk_size):
        chunk = message[i:i + chunk_size]
        await redis.publish(channel, json.dumps({"type": "token", "data": chunk}))
    return AgentResult.chat(message)
