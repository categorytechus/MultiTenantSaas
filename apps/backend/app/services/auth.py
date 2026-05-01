import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.rbac import Role
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.org import Org, OrgMembership
from app.models.user import RefreshToken, User
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _slugify(name: str) -> str:
    """Convert a name to a URL-safe slug."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "org"


async def _ensure_unique_slug(session: AsyncSession, base_slug: str) -> str:
    """Ensure the org slug is unique by appending a counter if necessary."""
    slug = base_slug
    counter = 1
    while True:
        result = await session.execute(select(Org).where(Org.slug == slug))
        if result.scalars().first() is None:
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


async def register_user(
    session: AsyncSession,
    email: str,
    password: str,
    name: str,
) -> tuple[User, str, str]:
    """
    Register a new user, create their org, and return (user, access_token, refresh_token).
    One user -> one org for MVP.
    """
    # Check if email already exists
    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    user = User(
        email=email,
        hashed_password=hash_password(password),
        name=name,
    )
    session.add(user)
    await session.flush()  # Get user.id

    # Create org from user's name/email
    org_name = name or email.split("@")[0]
    base_slug = _slugify(org_name)
    slug = await _ensure_unique_slug(session, base_slug)

    org = Org(name=org_name, slug=slug)
    session.add(org)
    await session.flush()  # Get org.id

    # Create membership
    membership = OrgMembership(
        user_id=user.id,
        org_id=org.id,
        role=Role.TENANT_ADMIN.value,
    )
    session.add(membership)
    await session.flush()

    # Create tokens
    access_token = _make_access_token(user, org, Role.TENANT_ADMIN)
    opaque_refresh, refresh_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(refresh_token_obj)

    logger.info("User registered", user_id=str(user.id), org_id=str(org.id))
    return user, access_token, opaque_refresh


async def login_user(
    session: AsyncSession,
    email: str,
    password: str,
) -> tuple[User, str, str]:
    """
    Authenticate a user and return (user, access_token, refresh_token).
    Raises 401 on invalid credentials.
    """
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalars().first()

    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Get membership
    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.user_id == user.id)
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User has no organization",
        )

    org_result = await session.get(Org, membership.org_id)
    if not org_result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Organization not found",
        )

    role = Role(membership.role)
    access_token = _make_access_token(user, org_result, role)
    opaque_refresh, refresh_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(refresh_token_obj)

    return user, access_token, opaque_refresh


async def refresh_tokens(
    session: AsyncSession,
    refresh_token: str,
) -> tuple[str, str]:
    """
    Rotate refresh tokens. Returns (new_access_token, new_refresh_token).
    Raises 401 if token is invalid or expired.
    """
    token_hash = hash_refresh_token(refresh_token)
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    stored = result.scalars().first()

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked refresh token",
        )

    if stored.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Revoke old token
    stored.revoked = True
    session.add(stored)

    # Get user and membership for new token
    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.user_id == user.id)
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No membership")

    org = await session.get(Org, membership.org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Org not found")

    role = Role(membership.role)
    new_access = _make_access_token(user, org, role)
    opaque, new_hash = create_refresh_token()

    new_refresh_obj = RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(new_refresh_obj)

    return new_access, opaque


async def logout_user(session: AsyncSession, refresh_token: str) -> None:
    """Revoke a refresh token."""
    token_hash = hash_refresh_token(refresh_token)
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    stored = result.scalars().first()
    if stored:
        stored.revoked = True
        session.add(stored)


async def get_me(session: AsyncSession, user_id: UUID) -> User:
    """Return the current user."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _make_access_token(user: User, org: Org, role: Role) -> str:
    """Build the JWT access token payload and sign it."""
    return create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(org.id),
        "tenant_slug": org.slug,
        "role": role.value,
    })
