"""Email invite flow: info, signup via token, accept while logged in."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.identity import normalize_email
from app.core.rbac import Role
from app.core.security import create_refresh_token, hash_password
from app.models.invite import InviteToken
from app.models.org import Org, OrgMembership
from app.models.user import RefreshToken, User
from app.services.auth import _make_access_token


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def invite_role_to_membership_role(role_str: str) -> Role:
    if role_str in (Role.TENANT_ADMIN.value, "org_admin"):
        return Role.TENANT_ADMIN
    return Role.USER


def _custom_role_id_from_invite(role_str: str) -> UUID | None:
    if not role_str.startswith("role:"):
        return None
    try:
        return UUID(role_str.split(":", 1)[1])
    except Exception:
        return None


async def _assign_custom_role_if_any(
    session: AsyncSession,
    *,
    user_id: UUID,
    org_id: UUID,
    invite_role: str,
) -> None:
    role_id = _custom_role_id_from_invite(invite_role)
    if role_id is None:
        return

    table_exists = await session.execute(text("SELECT to_regclass('public.user_roles')"))
    if table_exists.scalar_one_or_none() is not None:
        await session.execute(
            text(
                """
                INSERT INTO user_roles (id, user_id, role_id, organization_id, granted_at, created_at)
                VALUES (gen_random_uuid(), :user_id, :role_id, :org_id, NOW(), NOW())
                ON CONFLICT (user_id, role_id, organization_id) DO NOTHING
                """
            ),
            {"user_id": user_id, "role_id": role_id, "org_id": org_id},
        )
        return

    # Compatibility fallback for schemas without user_roles table.
    from app.models.org import OrgMembership
    from app.models.rbac import RbacRole

    role = await session.get(RbacRole, role_id)
    if role and (role.is_system or role.organization_id == org_id):
        m = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user_id,
                OrgMembership.org_id == org_id,
            )
        )
        membership = m.scalars().first()
        if membership:
            membership.role = role.name
            session.add(membership)


def link_query_role(membership_role: Role) -> str:
    """Query param for Next.js signup UI (`org_admin` vs `user`)."""
    return "org_admin" if membership_role == Role.TENANT_ADMIN else "user"


def generate_invite_plain_token() -> str:
    return secrets.token_hex(32)


async def create_invite_record(
    session: AsyncSession,
    *,
    email: str,
    org_id: UUID,
    invited_by: UUID | None,
    role: Role | str = Role.TENANT_ADMIN,
) -> tuple[InviteToken, str]:
    """Insert invite row and return (row, plaintext token)."""
    email_norm = normalize_email(email)
    plain = generate_invite_plain_token()
    role_value = role.value if isinstance(role, Role) else str(role)
    row = InviteToken(
        token=plain,
        email=email_norm,
        org_id=org_id,
        role=role_value,
        invited_by=invited_by,
        expires_at=_utcnow() + timedelta(days=settings.INVITE_TOKEN_EXPIRE_DAYS),
    )
    session.add(row)
    await session.flush()
    return row, plain


async def get_invite_by_token_org(
    session: AsyncSession, *, token: str, org_id: UUID
) -> InviteToken | None:
    result = await session.execute(
        select(InviteToken).where(InviteToken.token == token, InviteToken.org_id == org_id),
    )
    return result.scalars().first()


async def invite_info_payload(session: AsyncSession, *, token: str, org_id: UUID) -> dict:
    row = await get_invite_by_token_org(session, token=token, org_id=org_id)
    if not row:
        return {"success": False, "message": "Invalid or expired invite link."}

    now = _utcnow()
    if row.expires_at.replace(tzinfo=timezone.utc) < now:
        return {"success": False, "message": "This invite link has expired."}

    org = await session.get(Org, org_id)
    if not org:
        return {"success": False, "message": "Organization not found."}

    invite_email_norm = normalize_email(row.email)
    user_result = await session.execute(select(User).where(User.email == invite_email_norm))
    existing_user = user_result.scalars().first()

    return {
        "success": True,
        "data": {"org_name": org.name, "user_exists": existing_user is not None},
    }


def _persist_scoped_refresh(session: AsyncSession, user_id: UUID, org_id: UUID) -> str:
    opaque, rh = create_refresh_token()
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=rh,
            expires_at=_utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            org_id=org_id,
            no_org_scope=False,
        ),
    )
    return opaque


async def complete_signup_with_invite(
    session: AsyncSession,
    *,
    org_id: UUID,
    token: str,
    email: str,
    name: str,
    password: str,
) -> dict:
    row = await get_invite_by_token_org(session, token=token, org_id=org_id)
    if not row:
        return {"success": False, "message": "Invalid or expired invite link."}

    now = _utcnow()
    if row.expires_at.replace(tzinfo=timezone.utc) < now:
        return {"success": False, "message": "This invite link has expired."}
    if row.used_at:
        return {"success": False, "message": "This invite link has already been used."}

    invite_email_norm = normalize_email(row.email)
    supplied = normalize_email(email)
    if supplied != invite_email_norm:
        return {"success": False, "message": "Email does not match the invite."}

    existing_result = await session.execute(select(User).where(User.email == invite_email_norm))
    if existing_result.scalars().first():
        return {"success": False, "message": "An account already exists for this email. Sign in and join instead."}

    org = await session.get(Org, org_id)
    if not org:
        return {"success": False, "message": "Organization not found."}

    user = User(
        email=invite_email_norm,
        hashed_password=hash_password(password),
        name=name.strip() or None,
    )
    session.add(user)
    await session.flush()

    mem_role = invite_role_to_membership_role(row.role)
    session.add(
        OrgMembership(user_id=user.id, org_id=org_id, role=mem_role.value),
    )
    await _assign_custom_role_if_any(session, user_id=user.id, org_id=org_id, invite_role=row.role)

    row.used_at = now
    session.add(row)

    access_token = _make_access_token(user, org, mem_role)
    opaque_refresh = _persist_scoped_refresh(session, user.id, org_id)

    await session.flush()
    return {"success": True, "data": {"access_token": access_token, "refresh_token": opaque_refresh}}


async def accept_invite_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    token: str,
    org_id: UUID,
) -> dict:
    user = await session.get(User, user_id)
    if not user:
        return {"success": False, "message": "User not found."}

    row = await get_invite_by_token_org(session, token=token, org_id=org_id)
    if not row:
        return {"success": False, "message": "Invalid or expired invite link."}

    invite_email_norm = normalize_email(row.email)
    if normalize_email(user.email or "") != invite_email_norm:
        return {"success": False, "message": "This invite was sent to a different email address."}

    org = await session.get(Org, org_id)
    if not org:
        return {"success": False, "message": "Organization not found."}

    now = _utcnow()
    mem_result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == user.id,
            OrgMembership.org_id == org_id,
        ),
    )
    existing = mem_result.scalars().first()
    mem_role = invite_role_to_membership_role(row.role)

    if existing:
        try:
            existing_role = Role(existing.role)
        except ValueError:
            existing_role = Role.USER
        access_token = _make_access_token(user, org, existing_role)
        opaque_refresh = _persist_scoped_refresh(session, user.id, org_id)
        await session.flush()
        return {"success": True, "data": {"access_token": access_token, "refresh_token": opaque_refresh}}

    if row.used_at:
        return {"success": False, "message": "This invite link has already been used."}

    if row.expires_at.replace(tzinfo=timezone.utc) < now:
        return {"success": False, "message": "This invite link has expired."}

    session.add(OrgMembership(user_id=user.id, org_id=org_id, role=mem_role.value))
    await _assign_custom_role_if_any(session, user_id=user.id, org_id=org_id, invite_role=row.role)
    row.used_at = now
    session.add(row)

    access_token = _make_access_token(user, org, mem_role)
    opaque_refresh = _persist_scoped_refresh(session, user.id, org_id)

    await session.flush()
    return {"success": True, "data": {"access_token": access_token, "refresh_token": opaque_refresh}}
