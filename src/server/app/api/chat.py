import json
from typing import Any, AsyncIterator
from uuid import UUID

from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db_session, get_db
from app.core.redis import get_redis, task_channel
from app.core.tenancy import RequestContext, get_required_context
from app.models.agent_task import AgentTaskType
from app.services.agent_tasks import create_task
from app.services.chat import (
    delete_session,
    get_or_create_session,
    get_session_messages,
    list_sessions,
    save_message,
    update_session_title,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class CreateSessionRequest(BaseModel):
    chat_id: str | None = None
    title: str | None = None


class UpdateSessionRequest(BaseModel):
    title: str


class SessionResponse(BaseModel):
    id: str
    title: str | None
    created_at: str


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    sources: Any | None
    created_at: str


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    chat_id = UUID(body.chat_id) if body.chat_id else None
    chat_session = await get_or_create_session(
        session, ctx.org_id, ctx.user_id, chat_id, title=body.title
    )
    return {
        "id": str(chat_session.id),
        "title": chat_session.title,
        "created_at": chat_session.created_at.isoformat(),
    }


@router.get("/sessions", response_model=list[SessionResponse])
async def get_sessions(
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    sessions = await list_sessions(session, ctx.org_id, ctx.user_id)
    return [
        {"id": str(s.id), "title": s.title, "created_at": s.created_at.isoformat()}
        for s in sessions
    ]


@router.patch("/sessions/{chat_id}", response_model=SessionResponse)
async def rename_session(
    chat_id: UUID,
    body: UpdateSessionRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    chat_session = await update_session_title(session, chat_id, ctx.org_id, title)
    if not chat_session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": str(chat_session.id),
        "title": chat_session.title,
        "created_at": chat_session.created_at.isoformat(),
    }


@router.delete("/sessions/{chat_id}", status_code=204)
async def remove_session(
    chat_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> None:
    deleted = await delete_session(session, chat_id, ctx.org_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")


@router.get("/sessions/{chat_id}/messages", response_model=list[MessageResponse])
async def get_messages(
    chat_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    messages = await get_session_messages(session, chat_id, ctx.org_id)
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "sources": m.sources,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


@router.get("/sessions/{chat_id}/stream")
async def stream_chat(
    chat_id: UUID,
    message: str,
    request: Request,
    ctx: RequestContext = Depends(get_required_context),
) -> StreamingResponse:
    """
    SSE endpoint for chat.

    1. Saves the user message and creates an AgentTask record.
    2. Subscribes to the Redis pub/sub channel for that task.
    3. Enqueues `run_chat` on the Arq worker (subscribe-before-enqueue avoids
       missing tokens if the worker is very fast).
    4. Forwards token/done/error events from Redis to the browser as SSE.

    JWT is passed via ?token= query param because EventSource doesn't support
    custom headers.
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Persist user message and create the task record in one transaction.
    async with db_session(ctx.org_id) as sess:
        chat_session = await get_or_create_session(sess, ctx.org_id, ctx.user_id, chat_id)
        await save_message(sess, chat_session.id, ctx.org_id, "user", message)
        task = await create_task(
            sess,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            task_type=AgentTaskType.CHAT,
            input_data={"session_id": str(chat_session.id), "message": message},
        )
        session_id = str(chat_session.id)
        task_id = str(task.id)
        org_id = str(ctx.org_id)

    channel = task_channel(org_id, task_id)

    async def event_stream() -> AsyncIterator[str]:
        redis = await get_redis()
        pubsub = redis.pubsub()

        # Subscribe before enqueueing so no tokens are missed.
        await pubsub.subscribe(channel)

        try:
            arq = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            await arq.enqueue_job(
                "run_chat",
                task_id=task_id,
                org_id=org_id,
                session_id=session_id,
                message=message,
            )
            await arq.aclose()

            async for raw in pubsub.listen():
                if await request.is_disconnected():
                    break
                if raw["type"] != "message":
                    continue
                try:
                    event = json.loads(raw["data"])
                except (json.JSONDecodeError, KeyError):
                    continue

                event_type = event.get("type")
                if event_type == "token":
                    yield f"data: {event['data']}\n\n"
                elif event_type == "done":
                    yield "data: [DONE]\n\n"
                    break
                elif event_type == "error":
                    yield f"data: [ERROR] {event.get('data', 'Unknown error')}\n\n"
                    break

        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
