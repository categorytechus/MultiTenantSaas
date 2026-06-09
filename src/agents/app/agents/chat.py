"""RAG chat agent — Anthropic / Bedrock / Gemini — structured output with API tool proposal support.

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
from app.prompts import get_prompt, trace_generation



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
    Extract JSON object from LLM response. Strips markdown fences and handles
    nested braces by finding the balanced closing brace while respecting strings.
    """
    # Strip markdown code fences (```json ... ```)
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped.strip())

    # Try parsing the entire stripped text first (common case)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # Find first '{' and extract balanced JSON object
    start_idx = stripped.find('{')
    if start_idx == -1:
        return None

    brace_depth = 0
    in_string = False
    escape = False

    for i in range(start_idx, len(stripped)):
        char = stripped[i]

        # Handle escape sequences inside strings
        if escape:
            escape = False
            continue
        if char == '\\':
            escape = True
            continue

        # Track string boundaries (don't count braces inside strings)
        if char == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        # Count brace depth outside strings
        if char == '{':
            brace_depth += 1
        elif char == '}':
            brace_depth -= 1
            if brace_depth == 0:
                # Found complete balanced JSON object
                json_str = stripped[start_idx:i+1]
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    return None

    return None


# ── Image reference replacement ───────────────────────────────────────────────

# Matches ![any alt text](anything IMAGE_N anything) — the placeholder can appear
# anywhere inside the URL parentheses (e.g. the LLM may include the filename label).
_IMAGE_MD_RE = re.compile(r'!\[[^\]]*\]\([^)]*IMAGE_(\d+)[^)]*\)')


def _replace_image_refs(text: str, ref_map: dict[str, str]) -> str:
    """
    Replace full markdown image tokens that contain IMAGE_N with resolved URLs.
    The entire (...) URL portion is replaced so filenames/labels included by the
    LLM don't pollute the final URL.
    """
    def _sub(m: re.Match) -> str:
        n = m.group(1)            # the digit(s) from IMAGE_N
        ref = f"IMAGE_{n}"
        real_url = ref_map.get(ref)
        if not real_url:
            return ""             # drop images with no mapping
        # Reconstruct with original alt text and real URL
        alt = m.group(0)[2:m.group(0).index("](")] # everything between ![ and ](
        return f"![{alt}]({real_url})"

    return _IMAGE_MD_RE.sub(_sub, text)



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
    image_ref_map: dict[str, str] | None = None,
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
                await redis.publish(channel, json.dumps({"type": "token", "data": content}))
            elif token_count % 10 == 1:
                await redis.publish(channel, json.dumps({"type": "heartbeat"}))

    assembled = "".join(full_response)

    # Resolve image placeholders if present
    if not has_api_modules and image_ref_map:
        resolved = _replace_image_refs(assembled, image_ref_map)
        if resolved != assembled:
            # Tell frontend to replace IMAGE_N placeholders with real URLs
            await redis.publish(channel, json.dumps({"type": "replace_content", "data": resolved}))
        assembled = resolved

    return assembled


# ── Anthropic path ────────────────────────────────────────────────────────────

async def _run_anthropic(
    conversation: list[dict],
    system_prompt: str,
    has_api_modules: bool,
    redis: aioredis.Redis,
    channel: str,
    image_ref_map: dict[str, str] | None = None,
) -> str:
    import anthropic

    headers = {}
    if settings.ANTHROPIC_WORKSPACE_ID:
        headers["anthropic-workspace-id"] = settings.ANTHROPIC_WORKSPACE_ID

    client = anthropic.AsyncAnthropic(
        api_key=settings.ANTHROPIC_API_KEY,
        base_url=settings.ANTHROPIC_BASE_URL,
        default_headers=headers if headers else None,
    )

    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in conversation
    ]

    full_response: list[str] = []
    token_count = 0
    async with client.messages.stream(
        model=settings.CLAUDE_SKILLS_MODEL,
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            if text:
                full_response.append(text)
                token_count += 1
                if not has_api_modules:
                    await redis.publish(channel, json.dumps({"type": "token", "data": text}))
                elif token_count % 10 == 1:
                    await redis.publish(channel, json.dumps({"type": "heartbeat"}))

    assembled = "".join(full_response)

    # Resolve image placeholders if present
    if not has_api_modules and image_ref_map:
        resolved = _replace_image_refs(assembled, image_ref_map)
        if resolved != assembled:
            # Tell frontend to replace IMAGE_N placeholders with real URLs
            await redis.publish(channel, json.dumps({"type": "replace_content", "data": resolved}))
        assembled = resolved

    return assembled


# ── Gemini path ───────────────────────────────────────────────────────────────

async def _run_gemini(
    api_key: str,
    conversation: list[dict],
    system_prompt: str,
    has_api_modules: bool,
    redis: aioredis.Redis,
    channel: str,
    image_ref_map: dict[str, str] | None = None,
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

    async for chunk in await client.aio.models.generate_content_stream(
        model=settings.GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(system_instruction=system_prompt),
    ):
        if chunk.text:
            full_response.append(chunk.text)
            if not has_api_modules:
                await redis.publish(channel, json.dumps({"type": "token", "data": chunk.text}))
            elif len(full_response) % 10 == 1:
                await redis.publish(channel, json.dumps({"type": "heartbeat"}))

    assembled = "".join(full_response)

    # Resolve image placeholders if present
    if not has_api_modules and image_ref_map:
        resolved = _replace_image_refs(assembled, image_ref_map)
        if resolved != assembled:
            # Tell frontend to replace IMAGE_N placeholders with real URLs
            await redis.publish(channel, json.dumps({"type": "replace_content", "data": resolved}))
        assembled = resolved

    return assembled



# ── Public entry point ────────────────────────────────────────────────────────

async def run_agent(
    *,
    conversation: list[dict],
    context_chunks: list[dict],
    api_modules: list[dict],
    redis: aioredis.Redis,
    channel: str,
    workflow: str | None = None,
    trace_id: str | None = None,
    image_rendering_enabled: bool = False,
) -> AgentResult:
    """
    Stream a Bedrock (or Gemini) response and return an AgentResult.

    When api_modules is non-empty, the system prompt instructs the LLM to
    respond with structured JSON.  In that mode tokens are NOT streamed to
    Redis because the full text must be parsed before any SSE event is emitted.

    When image_rendering_enabled=True, image chunks are formatted with opaque
    IMAGE_N labels (same pattern as [filename] for text chunks). After the LLM
    produces its response, IMAGE_N labels are replaced with real API URLs before
    streaming to the client — the LLM never sees real document/image IDs.
    """
    # ── Split text vs image chunks ─────────────────────────────────────────────
    text_chunks = [c for c in context_chunks if c.get("chunk_type", "text") != "image"]
    image_chunks = (
        [c for c in context_chunks if c.get("chunk_type") == "image"]
        if image_rendering_enabled
        else []
    )

    # ── Build image placeholder mapping ───────────────────────────────────────
    # LLM sees: [report.pdf — IMAGE_1]\nCaption text...
    # After generation, IMAGE_1 → /api/documents/{doc_id}/images/{img_id}
    image_ref_map: dict[str, str] = {}
    image_context_parts: list[str] = []
    for i, chunk in enumerate(image_chunks, 1):
        ref = f"IMAGE_{i}"
        doc_id = chunk.get("document_id") or ""
        img_id = chunk.get("image_id") or ""
        if not doc_id or not img_id:
            # Skip images with incomplete metadata (NULL in database)
            continue
        image_ref_map[ref] = f"/api/documents/{doc_id}/images/{img_id}"
        image_context_parts.append(
            f"[{chunk['filename']} \u2014 {ref}]\n{chunk['content']}"
        )

    # ── Build system prompt ────────────────────────────────────────────────────
    all_context_parts: list[str] = []

    # Text chunks (existing format: [filename]\ncontent)
    for c in text_chunks:
        all_context_parts.append(f"[{c['filename']}]\n{c['content']}")

    # Image chunks (appended after text)
    all_context_parts.extend(image_context_parts)

    if all_context_parts:
        context = "\n\n---\n\n".join(all_context_parts)
        system_prompt = get_prompt("chat", "with-context", workflow, context=context)
    else:
        system_prompt = get_prompt("chat", "no-context", workflow)

    has_api_modules = bool(api_modules)
    if has_api_modules:
        system_prompt += get_prompt(
            "chat", "api-tools", workflow,
            modules_json=json.dumps(api_modules, indent=2),
        )

    # Append image instructions when image chunks are present
    if image_ref_map:
        system_prompt += get_prompt("chat", "with-images", workflow)
    # Run the LLM
    if settings.CHAT_MODEL == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY must be set when CHAT_MODEL='anthropic'")
        raw = await _run_anthropic(conversation, system_prompt, has_api_modules, redis, channel,
                                   image_ref_map=image_ref_map)
    elif settings.CHAT_MODEL == "bedrock":
        if not settings.BEDROCK_MODEL_ARN:
            raise ValueError("BEDROCK_MODEL_ARN must be set when CHAT_MODEL='bedrock'")
        raw = await _run_bedrock(conversation, system_prompt, has_api_modules, redis, channel,
                                 image_ref_map=image_ref_map)
    elif settings.CHAT_MODEL == "gemini":
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY must be set when CHAT_MODEL='gemini'")
        raw = await _run_gemini(settings.GEMINI_API_KEY, conversation, system_prompt,
                                has_api_modules, redis, channel,
                                image_ref_map=image_ref_map)
    else:
        raw = f"[Mock response \u2014 CHAT_MODEL '{settings.CHAT_MODEL}' unknown]"
        if not has_api_modules:
            if image_ref_map:
                resolved = _replace_image_refs(raw, image_ref_map or {})
                if resolved != raw:
                    await redis.publish(channel, json.dumps({"type": "replace_content", "data": resolved}))
                raw = resolved
            await redis.publish(channel, json.dumps({"type": "token", "data": raw}))

    # Trace to Langfuse if a trace_id was provided
    if trace_id:
        trace_generation(trace_id, f"chat/{workflow or 'default'}", conversation, raw)

    # If no API modules were available, raw is already streamed and resolved
    if not has_api_modules:
        return AgentResult.chat(raw)

    async def _stream_chat_response(text: str) -> str:
        # Text is already resolved by LLM function
        chunk_size = 4
        for i in range(0, len(text), chunk_size):
            chunk = text[i:i + chunk_size]
            await redis.publish(channel, json.dumps({"type": "token", "data": chunk}))
        return text

    # Parse structured JSON response
    parsed = _extract_json(raw)
    if parsed is None:
        # LLM returned non-JSON despite instructions; treat as plain text with resolved images
        resolved = await _stream_chat_response(raw)
        return AgentResult.chat(resolved)

    response_type = parsed.get("type", "chat_response")

    if response_type == "api_task_proposal":
        # Validate the minimum required keys
        required = {"api_module_id", "title", "input_payload"}
        if not required.issubset(parsed.keys()):
            # Malformed proposal — fall back to chat with resolved images
            fallback_message = parsed.get("message") or raw
            resolved = await _stream_chat_response(fallback_message)
            return AgentResult.chat(resolved)

        # Confirm the referenced module_id is in the allowed list
        allowed_ids = {m["id"] for m in api_modules}
        if parsed["api_module_id"] not in allowed_ids:
            resolved = await _stream_chat_response("I tried to propose an API action but the referenced module is not available.")
            return AgentResult.chat(resolved)

        # Attach the human-readable module name for SSE event
        module_name = next(
            (m["name"] for m in api_modules if m["id"] == parsed["api_module_id"]),
            "Unknown",
        )
        parsed["api_module_name"] = module_name
        return AgentResult.proposal(parsed)

    # Default: chat_response - resolve images before streaming and returning
    message = parsed.get("message")

    # Validate message field exists and is non-empty
    if not message or not isinstance(message, str) or not message.strip():
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"LLM returned chat_response with empty/missing message field. Parsed: {parsed}")
        # Fall back to raw response
        message = raw

    resolved_message = await _stream_chat_response(message)
    return AgentResult.chat(resolved_message)
