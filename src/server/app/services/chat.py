from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.chat import ChatMessage, ChatSession


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


async def save_message(
    session: AsyncSession,
    chat_id: UUID,
    org_id: UUID,
    role: str,
    content: str,
    sources: list[dict] | None = None,
) -> ChatMessage:
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
