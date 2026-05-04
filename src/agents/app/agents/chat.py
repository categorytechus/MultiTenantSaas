"""Gemini RAG chat agent — streams tokens directly to Redis."""
import json

import redis.asyncio as aioredis

_SYSTEM_WITH_CONTEXT = """\
You are a helpful AI assistant. Answer the user's question using the context below, \
which was retrieved from their uploaded documents. \
If the answer cannot be found in the context, say so clearly rather than guessing.

## Retrieved context
{context}
"""

_SYSTEM_NO_CONTEXT = "You are a helpful AI assistant."


async def run_agent(
    *,
    api_key: str,
    conversation: list[dict],
    context_chunks: list[dict],
    redis: aioredis.Redis,
    channel: str,
) -> str:
    """Stream a Gemini response for the full conversation to Redis and return the full text.

    Args:
        conversation: All chat_messages in the session ordered by created_at,
                      including the current user message as the final item.
        context_chunks: Chunks returned by rag.retrieve_chunks (may be empty).
    """
    if not api_key:
        mock = "[Mock response — GEMINI_API_KEY not set]"
        await redis.publish(channel, json.dumps({"type": "token", "data": mock}))
        return mock

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    if context_chunks:
        context = "\n\n---\n\n".join(
            f"[{c['filename']}]\n{c['content']}" for c in context_chunks
        )
        system_prompt = _SYSTEM_WITH_CONTEXT.format(context=context)
    else:
        system_prompt = _SYSTEM_NO_CONTEXT

    # Gemini uses "model" for the assistant role
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
