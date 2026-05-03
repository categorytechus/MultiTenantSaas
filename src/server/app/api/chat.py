from typing import Any, AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session, get_db
from app.core.tenancy import RequestContext, get_required_context
from app.integrations.llm import llm
from app.services.chat import (
    delete_session,
    get_or_create_session,
    get_session_messages,
    list_sessions,
    save_message,
    update_session_title,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = (
    "You are a helpful AI assistant for a document knowledge base. "
    "Answer questions clearly and concisely based on the context provided."
)


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
    SSE endpoint: saves user message, streams LLM tokens, saves assistant reply.
    JWT passed via ?token= query param (EventSource limitation).
    """
    if not message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    async with db_session(ctx.org_id) as sess:
        chat_session = await get_or_create_session(sess, ctx.org_id, ctx.user_id, chat_id)
        await save_message(sess, chat_session.id, ctx.org_id, "user", message)
        history = await get_session_messages(sess, chat_session.id, ctx.org_id)
        session_id = chat_session.id
        org_id = ctx.org_id

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})

    async def event_stream() -> AsyncIterator[str]:
        tokens: list[str] = []
        try:
            async for token in llm.stream(messages):
                if await request.is_disconnected():
                    break
                tokens.append(token)
                yield f"data: {token}\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            return

        assistant_content = "".join(tokens)
        if assistant_content:
            try:
                async with db_session(org_id) as sess:
                    await save_message(sess, session_id, org_id, "assistant", assistant_content)
            except Exception:
                pass

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
