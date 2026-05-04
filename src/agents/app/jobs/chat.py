"""
Arq job: fetch history, retrieve RAG context, stream Gemini response via Redis.

Flow:
  1. Mark task running
  2. Open DB connection with RLS set to org_id
  3. Fetch full conversation history from chat_messages
  4. Embed the user message and retrieve the top-k document chunks (RAG)
  5. Call Gemini — tokens streamed token-by-token to Redis pub/sub
  6. Save the completed assistant message + sources via /internal/*
  7. Mark task succeeded and publish [done]
"""
from typing import Any

import httpx
import psycopg
import redis.asyncio as aioredis
from pgvector.psycopg import register_vector_async

from app.agents.chat import run_agent
from app.config import settings
from app.embeddings import embed_query
from app.http import save_assistant_message, update_task
from app.rag import retrieve_chunks
from app.redis import publish, task_channel


async def run_chat(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    session_id: str,
    message: str,
) -> None:
    redis: aioredis.Redis = ctx["redis"]
    http: httpx.AsyncClient = ctx["http"]
    channel = task_channel(org_id, task_id)

    await update_task(http, task_id, org_id, "running")

    try:
        db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            await register_vector_async(conn)

            async with conn.transaction():
                await conn.execute(f"SET LOCAL app.current_org_id = '{org_id}'")

                # Fetch full conversation (server saves the user message before enqueueing)
                cur = await conn.execute(
                    "SELECT role, content FROM chat_messages "
                    "WHERE chat_id = %s ORDER BY created_at ASC",
                    [session_id],
                )
                conversation = [{"role": r, "content": c} for r, c in await cur.fetchall()]

                # RAG: embed the current user message and retrieve relevant chunks
                query_vector = await embed_query(message)
                chunks = await retrieve_chunks(conn, query_vector)

        response = await run_agent(
            api_key=settings.GEMINI_API_KEY,
            conversation=conversation,
            context_chunks=chunks,
            redis=redis,
            channel=channel,
        )

        sources = [{"filename": c["filename"], "score": round(c["score"], 4)} for c in chunks]
        await save_assistant_message(http, session_id, org_id, response, sources)
        await update_task(http, task_id, org_id, "succeeded", output={"content": response})
        await publish(redis, channel, {"type": "done"})

    except Exception as exc:
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise
