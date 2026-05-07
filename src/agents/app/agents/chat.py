"""Bedrock RAG chat agent with Gemini fallback — streams tokens directly to Redis."""
import json

import redis.asyncio as aioredis
from app.config import settings
import openai
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_aws import ChatBedrock
import boto3
from google import genai
from google.genai import types

_SYSTEM_WITH_CONTEXT = """\
You are a helpful AI assistant. Answer the user's question using the context below, \
which was retrieved from their uploaded documents. \
If the answer cannot be found in the context, say so clearly rather than guessing.

## Retrieved context
{context}
"""

_SYSTEM_NO_CONTEXT = "You are a helpful AI assistant."

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
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Primary path: ChatBedrock via langchain-aws."""
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

    full_response = []
    async for chunk in llm.astream(messages):
        content = chunk.content
        if isinstance(content, str) and content:
            full_response.append(content)
            await redis.publish(channel, json.dumps({"type": "token", "data": content}))

    return "".join(full_response)


async def _run_gemini(
    api_key: str,
    conversation: list[dict],
    system_prompt: str,
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Fallback path: existing Gemini code, unchanged."""

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
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(system_instruction=system_prompt),
    ):
        if chunk.text:
            full_response.append(chunk.text)
            await redis.publish(channel, json.dumps({"type": "token", "data": chunk.text}))

    return "".join(full_response)


async def _run_openai(
    api_key: str,
    conversation: list[dict],
    system_prompt: str,
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Fallback path: OpenAI via raw openai sdk."""

    client = openai.AsyncOpenAI(api_key=api_key)

    oai_messages = [{"role": "system", "content": system_prompt}]
    for m in conversation:
        oai_messages.append({"role": m.get("role"), "content": m["content"]})

    full_response = []
    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=oai_messages,
        stream=True,
    )
    
    async for chunk in stream:
        content = chunk.choices[0].delta.content
        if content:
            full_response.append(content)
            await redis.publish(channel, json.dumps({"type": "token", "data": content}))

    return "".join(full_response)


async def run_agent(
    *,
    conversation: list[dict],
    context_chunks: list[dict],
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Stream a Bedrock (or Gemini) response for the full conversation to Redis.

    Args:
        conversation: All chat_messages in the session ordered by created_at.
        context_chunks: Chunks returned by rag.retrieve_chunks.
    """
    if context_chunks:
        context = "\n\n---\n\n".join(
            f"[{c['filename']}]\n{c['content']}" for c in context_chunks
        )
        system_prompt = _SYSTEM_WITH_CONTEXT.format(context=context)
    else:
        system_prompt = _SYSTEM_NO_CONTEXT

    if settings.CHAT_MODEL == "bedrock":
        return await _run_bedrock(conversation, system_prompt, redis, channel)
    elif settings.CHAT_MODEL == "gemini":
        return await _run_gemini(settings.GEMINI_API_KEY, conversation, system_prompt, redis, channel)
    elif settings.CHAT_MODEL == "openai":
        return await _run_openai(settings.OPENAI_API_KEY, conversation, system_prompt, redis, channel)
    else:
        mock = f"[Mock response — unknown CHAT_MODEL {settings.CHAT_MODEL}]"
        await redis.publish(channel, json.dumps({"type": "token", "data": mock}))
        return mock
