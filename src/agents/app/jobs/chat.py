"""
Arq job: fetch history, retrieve RAG context, stream Gemini/Bedrock response via Redis.

Flow:
  1. Mark task running
  2. Open DB connection with RLS set to org_id
  3. Fetch full conversation history from chat_messages
  4. Embed the user message and retrieve the top-k document chunks (RAG)
  5. Load enabled API modules for the org (safe metadata only)
  6. Call the LLM agent — may return a chat_response or an api_task_proposal
  7a. chat_response: stream tokens (already done), save message, mark succeeded
  7b. api_task_proposal: save proposal via /internal, publish SSE event, mark succeeded
"""
from typing import Any

import httpx
import psycopg
import redis.asyncio as aioredis
from pgvector.psycopg import register_vector_async

from app.agents.chat import run_agent
from app.config import settings
from app.embeddings import embed_query
from app.http import (
    create_api_proposal,
    load_api_modules,
    save_assistant_message,
    update_task,
)
from app.rag import retrieve_chunks
from app.redis import publish, task_channel


async def run_chat(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    user_id: str,
    session_id: str,
    message: str,
    user_role: str = "",
) -> None:
    redis: aioredis.Redis = ctx["redis"]
    http: httpx.AsyncClient = ctx["http"]
    channel = task_channel(org_id, task_id)

    await update_task(http, task_id, org_id, "running")

    try:
        db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
        permission_exists = False

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
                chunks = await retrieve_chunks(conn, query_vector, user_role=user_role)

        # Load enabled API modules — safe metadata only, no auth secrets
        api_modules = await load_api_modules(http, org_id)

        result = await run_agent(
            conversation=conversation,
            context_chunks=chunks,
            api_modules=api_modules,
            redis=redis,
            channel=channel,
        )

        if result.type == "api_task_proposal" and result.proposal:
            proposal = result.proposal
            
            # Find the api_module in our loaded list to check its ask_permission status
            module_id_str = str(proposal["api_module_id"])
            matching_module = next((m for m in api_modules if str(m["id"]) == module_id_str), None)
            ask_permission = True
            if matching_module is not None:
                ask_permission = matching_module.get("ask_permission", True)
            
            auto_accept = not ask_permission

            # Persist the proposal through the internal API
            proposal_id = await create_api_proposal(
                http,
                session_id=session_id,
                org_id=org_id,
                task_id=task_id,
                proposal=proposal,
                auto_accept=auto_accept,
            )

            if not auto_accept:
                # Emit a structured SSE event so the frontend can show the confirm buttons in chat
                await publish(redis, channel, {
                    "type": "api_task_proposal",
                    "proposal_id": proposal_id,
                    "title": proposal["title"],
                    "description": proposal.get("description"),
                    "api_module_name": proposal.get("api_module_name", ""),
                    "input_payload": proposal.get("input_payload", {}),
                })

                # Save the confirmation request as a message from the assistant
                prompt_msg = f"I need your permission to proceed: {proposal.get('description') or proposal['title']}"
                await save_assistant_message(http, session_id, org_id, prompt_msg)
            else:
                # Emit a structured SSE event to let the frontend know execution has started
                await publish(redis, channel, {
                    "type": "api_execution_started",
                    "proposal_id": proposal_id,
                    "title": proposal["title"],
                })
        else:
            # Normal chat response — tokens already streamed to Redis by run_agent
            sources = [{"filename": c["filename"], "score": round(c["score"], 4)} for c in chunks]
            await save_assistant_message(
                http, session_id, org_id, result.message or "", sources
            )

        await update_task(http, task_id, org_id, "succeeded",
                          output={"content": result.message or ""})
        await publish(redis, channel, {"type": "done"})

    except Exception as exc:
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise
