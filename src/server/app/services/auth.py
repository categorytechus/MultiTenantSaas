import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import asc
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
from app.core.identity import jwt_roles_claim, jwt_user_type_claim, normalize_email, is_super_admin_user

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


def jwt_effective_role(user: User, membership_role: Role) -> Role:
    """Elevate configured super admins to SUPER_ADMIN regardless of membership row."""
    if is_super_admin_user(user.id):
        return Role.SUPER_ADMIN
    return membership_role


def parse_membership_role(role_str: str) -> Role:
    """Map DB membership role string to JWT/base role; unknown custom roles fallback to USER."""
    try:
        return Role(role_str)
    except ValueError:
        return Role.USER


async def register_user(
    session: AsyncSession,
    email: str,
    password: str,
    name: str,
    organization_name: str | None = None,
) -> tuple[User, str, str]:
    """
    Register a new user, create their org, and return (user, access_token, refresh_token).
    One user -> one org for MVP.
    """
    # Check if email already exists
    email_norm = normalize_email(email)
    existing = await session.execute(select(User).where(User.email == email_norm))
    if existing.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    user = User(
        email=email_norm,
        hashed_password=hash_password(password),
        name=name,
    )
    session.add(user)
    await session.flush()  # Get user.id

    # Create org from user's name/email
    org_name = (organization_name or "").strip() or name or email_norm.split("@")[0]
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
        org_id=org.id,
        no_org_scope=False,
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
    result = await session.execute(select(User).where(User.email == normalize_email(email)))
    user = result.scalars().first()

    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Get membership (deterministic: oldest membership first by created_at)
    membership_result = await session.execute(
        select(OrgMembership)
        .where(OrgMembership.user_id == user.id)
        .order_by(asc(OrgMembership.created_at))
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

    role = parse_membership_role(membership.role)
    access_token = _make_access_token(user, org_result, role)
    opaque_refresh, refresh_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        org_id=org_result.id,
        no_org_scope=False,
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

    user = await session.get(User, stored.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    persist_org_id: UUID | None = None
    persist_no_org = False

    if stored.no_org_scope:
        if not is_super_admin_user(user.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )
        new_access = make_super_admin_reset_access_token(user)
        persist_org_id = None
        persist_no_org = True
    elif stored.org_id is not None:
        org = await session.get(Org, stored.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Org not found")
        is_sa = is_super_admin_user(user.id)
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id,
                OrgMembership.org_id == stored.org_id,
            ),
        )
        membership = mr.scalars().first()
        if not membership and not is_sa:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No membership")
        jwt_role = Role.SUPER_ADMIN if is_sa else parse_membership_role(membership.role)
        new_access = _make_access_token(user, org, jwt_role)
        persist_org_id = stored.org_id
        persist_no_org = False
    else:
        membership_result = await session.execute(
            select(OrgMembership)
            .where(OrgMembership.user_id == user.id)
            .order_by(asc(OrgMembership.created_at))
        )
        membership = membership_result.scalars().first()
        if not membership:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No membership")

        org = await session.get(Org, membership.org_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Org not found")

        role = parse_membership_role(membership.role)
        new_access = _make_access_token(user, org, role)
        persist_org_id = org.id
        persist_no_org = False

    opaque, new_hash = create_refresh_token()

    new_refresh_obj = RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        org_id=persist_org_id,
        no_org_scope=persist_no_org,
    )
    session.add(new_refresh_obj)

    return new_access, opaque


async def revoke_all_refresh_tokens(session: AsyncSession, user_id: UUID) -> None:
    """Revoke every refresh token belonging to ``user_id``."""
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked == False)  # noqa: E712
    )
    for row in result.scalars().all():
        row.revoked = True
        session.add(row)


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


def _make_access_token(user: User, org: Org, membership_role: Role) -> str:
    """Build access JWT including auxiliary claims for authenticated UIs."""
    eff = jwt_effective_role(user, membership_role)
    return create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "org_id": str(org.id),
        "tenant_slug": org.slug,
        "role": eff.value,
        "roles": jwt_roles_claim(eff),
        "user_type": jwt_user_type_claim(user.id),
    })


def make_super_admin_reset_access_token(user: User) -> str:
    """JWT without ``org_id`` for super admins clearing tenant scope."""
    eff = Role.SUPER_ADMIN
    return create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": eff.value,
        "roles": jwt_roles_claim(eff),
        "user_type": jwt_user_type_claim(user.id),
    })
