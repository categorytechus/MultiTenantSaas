from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.ENVIRONMENT == "development",
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def set_rls_context(session: AsyncSession, org_id: UUID | str | None) -> None:
    """Set the RLS context for the current session."""
    if org_id is not None:
        await session.execute(
            text("SET LOCAL app.current_org_id = :org_id"),
            {"org_id": str(org_id)},
        )
    else:
        # Set a nil UUID to prevent data leakage if org_id is accidentally unset
        await session.execute(
            text("SET LOCAL app.current_org_id = '00000000-0000-0000-0000-000000000000'"),
        )


def _extract_org_id_from_request(request: Request) -> UUID | None:
    """Extract org_id from JWT in Authorization header or ?token= query param."""
    from app.core.security import decode_access_token

    token: str | None = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        token = request.query_params.get("token")

    if not token:
        return None

    try:
        payload = decode_access_token(token)
        org_id_str = payload.get("org_id")
        if org_id_str:
            return UUID(org_id_str)
    except Exception:
        pass
    return None


@asynccontextmanager
async def db_session(org_id: UUID | str | None = None) -> AsyncIterator[AsyncSession]:
    """Async context manager for use in background jobs. Sets RLS context before yielding."""
    async with async_session_factory() as session:
        async with session.begin():
            await set_rls_context(session, org_id)
            try:
                yield session
            except Exception:
                await session.rollback()
                raise


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """
    FastAPI dependency that yields an RLS-aware async session.
    Automatically sets app.current_org_id from the JWT on every request.
    Works for both Bearer-token calls and SSE ?token= query param calls.
    """
    org_id = _extract_org_id_from_request(request)
    async with async_session_factory() as session:
        async with session.begin():
            await set_rls_context(session, org_id)
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
