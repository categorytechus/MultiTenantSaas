from typing import Any, AsyncIterator
from uuid import UUID

from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db_session, get_db
from app.core.redis import subscribe, task_channel
from app.core.tenancy import RequestContext, get_required_context
from app.models.agent_task import AgentTaskType
from app.services.agent_tasks import create_task
from app.services.chat import (
    get_or_create_session,
    get_session_messages,
    list_sessions,
    save_message,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class CreateSessionRequest(BaseModel):
    chat_id: str | None = None
    title: str | None = None


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
    chat_session = await get_or_create_session(session, ctx.org_id, ctx.user_id, chat_id)
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
    SSE endpoint: saves user message, enqueues chat agent job, streams tokens
    from Redis pub/sub. JWT passed via ?token= query param.

    Emits:  data: {token}\\n\\n
    Ends:   data: [DONE]\\n\\n
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Complete DB writes in a committed transaction before starting SSE
    async with db_session(ctx.org_id) as session:
        chat_session = await get_or_create_session(session, ctx.org_id, ctx.user_id, chat_id)
        await save_message(session, chat_session.id, ctx.org_id, "user", message)
        task = await create_task(
            session,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            task_type=AgentTaskType.CHAT,
            input_data={"message": message, "session_id": str(chat_session.id)},
        )
        session_id = str(chat_session.id)
        task_id = str(task.id)

    # Enqueue to agents worker — shares the same Redis instance
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    await arq_pool.enqueue_job(
        "run_chat",
        task_id=task_id,
        org_id=str(ctx.org_id),
        session_id=session_id,
        message=message,
    )
    await arq_pool.aclose()

    channel = task_channel(str(ctx.org_id), task_id)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in subscribe(channel):
                if await request.is_disconnected():
                    break
                if event.get("type") == "token":
                    yield f"data: {event['data']}\n\n"
                elif event.get("type") == "done":
                    yield "data: [DONE]\n\n"
                    break
                elif event.get("type") == "error":
                    yield f"data: [ERROR] {event.get('data', 'Unknown error')}\n\n"
                    break
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
