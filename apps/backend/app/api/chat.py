import asyncio
from typing import Any, AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.tenancy import RequestContext, get_required_context
from app.services.chat import (
    ChatContext,
    create_chat_session,
    get_or_create_session,
    get_session_messages,
    list_sessions,
    rag_chat,
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


class ChatStreamRequest(BaseModel):
    message: str


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Create or retrieve a chat session."""
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
    """List chat sessions for the current user."""
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
    """Get message history for a chat session."""
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
    session: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    SSE endpoint for streaming RAG chat responses.
    Query param: ?message=<user_message>
    Streams tokens as: data: <token>\n\n
    Ends with: data: [DONE]\n\n
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Verify the session exists and belongs to this org
    from app.services.chat import get_or_create_session as _get_session
    chat_session = await _get_session(session, ctx.org_id, ctx.user_id, chat_id)

    chat_ctx = ChatContext(
        session=session,
        chat_id=chat_session.id,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
    )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for token in rag_chat(chat_ctx, message):
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                yield f"data: {token}\n\n"
            yield "data: [DONE]\n\n"
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
