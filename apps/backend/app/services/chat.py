from dataclasses import dataclass
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.agents.prompts.rag import build_rag_prompt
from app.integrations.embeddings import embed
from app.integrations.llm import llm
from app.models.chat import ChatMessage, ChatSession
from app.services.retrieval import vector_search
from app.core.logging import get_logger

logger = get_logger(__name__)

HISTORY_LIMIT = 10
VECTOR_SEARCH_LIMIT = 10


@dataclass
class ChatContext:
    session: AsyncSession
    chat_id: UUID
    org_id: UUID
    user_id: UUID


async def create_chat_session(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    title: str | None = None,
) -> ChatSession:
    """Create a new chat session."""
    chat_session = ChatSession(
        org_id=org_id,
        user_id=user_id,
        title=title or "New Chat",
    )
    session.add(chat_session)
    await session.flush()
    return chat_session


async def get_or_create_session(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    chat_id: UUID | None = None,
) -> ChatSession:
    """
    Get an existing chat session by ID, or create a new one.
    RLS ensures the session belongs to the current org.
    """
    if chat_id is not None:
        existing = await session.get(ChatSession, chat_id)
        if existing and existing.org_id == org_id:
            return existing

    return await create_chat_session(session, org_id, user_id)


async def _save_message(
    session: AsyncSession,
    chat_id: UUID,
    org_id: UUID,
    role: str,
    content: str,
    sources: list[dict] | None = None,
) -> ChatMessage:
    """Save a message to the database."""
    msg = ChatMessage(
        org_id=org_id,
        chat_id=chat_id,
        role=role,
        content=content,
        sources=sources,
    )
    session.add(msg)
    await session.flush()
    return msg


async def _recent_messages(
    session: AsyncSession,
    chat_id: UUID,
    limit: int = HISTORY_LIMIT,
) -> list[dict]:
    """Get recent messages for context building."""
    result = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    messages = list(reversed(result.scalars().all()))
    return [{"role": m.role, "content": m.content} for m in messages]


async def rag_chat(
    ctx: ChatContext,
    user_message: str,
) -> AsyncIterator[str]:
    """
    Full RAG chat flow:
    1. Save user message
    2. Embed query
    3. Vector search (RLS-scoped)
    4. Get recent history
    5. Build prompt
    6. Stream LLM response
    7. Save assistant message
    """
    # Save user message first
    await _save_message(ctx.session, ctx.chat_id, ctx.org_id, "user", user_message)

    # Embed the query
    q_emb = await embed(user_message)

    # Vector search for relevant chunks (RLS handles org scoping)
    chunks = await vector_search(ctx.session, q_emb, limit=VECTOR_SEARCH_LIMIT)

    # Get conversation history
    history = await _recent_messages(ctx.session, ctx.chat_id, limit=HISTORY_LIMIT)
    # Remove the last message (the user message we just saved) from history
    # to avoid duplicating it in the prompt
    if history and history[-1]["role"] == "user" and history[-1]["content"] == user_message:
        history = history[:-1]

    # Build prompt
    prompt = build_rag_prompt(history, chunks, user_message)

    # Stream LLM response and collect for saving
    final_response = ""

    async def _stream_and_collect() -> AsyncIterator[str]:
        nonlocal final_response
        async for token in llm.stream(prompt):
            final_response += token
            yield token

    # Yield tokens to caller
    async for token in _stream_and_collect():
        yield token

    # Save the complete assistant response
    await _save_message(
        ctx.session,
        ctx.chat_id,
        ctx.org_id,
        "assistant",
        final_response,
        sources=[
            {
                "chunk_id": c["id"],
                "document_id": c["document_id"],
                "content": c["content"][:200],
                "score": c["score"],
            }
            for c in chunks
        ],
    )


async def list_sessions(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
) -> list[ChatSession]:
    """List chat sessions for a user in an org."""
    result = await session.execute(
        select(ChatSession)
        .where(ChatSession.org_id == org_id, ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
    )
    return list(result.scalars().all())


async def get_session_messages(
    session: AsyncSession,
    chat_id: UUID,
    org_id: UUID,
) -> list[ChatMessage]:
    """Get all messages for a chat session."""
    result = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat_id, ChatMessage.org_id == org_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(result.scalars().all())
