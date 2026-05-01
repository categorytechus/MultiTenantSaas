from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import get_db
from app.core.rbac import Role, authorize
from app.core.tenancy import RequestContext
from app.models.audit_log import AuditLog
from app.models.org import Org, OrgMembership
from app.models.user import User

router = APIRouter(prefix="/api/admin", tags=["admin"])


class CreateOrgRequest(BaseModel):
    name: str
    slug: str | None = None


def _require_super_admin(ctx: RequestContext) -> RequestContext:
    if ctx.role != Role.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required",
        )
    return ctx


@router.get("/organizations")
async def list_organizations(
    ctx: RequestContext = authorize("*"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List all organizations (super_admin only)."""
    _require_super_admin(ctx)
    result = await session.execute(select(Org).order_by(Org.created_at.desc()))
    orgs = result.scalars().all()
    return [
        {
            "id": str(org.id),
            "slug": org.slug,
            "name": org.name,
            "created_at": org.created_at.isoformat(),
        }
        for org in orgs
    ]


@router.post("/organizations", status_code=201)
async def create_organization(
    body: CreateOrgRequest,
    ctx: RequestContext = authorize("*"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Create a new organization (super_admin only)."""
    _require_super_admin(ctx)

    import re

    slug = body.slug
    if not slug:
        slug = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "org"

    # Check slug uniqueness
    existing = await session.execute(select(Org).where(Org.slug == slug))
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' already taken")

    org = Org(name=body.name, slug=slug)
    session.add(org)
    await session.flush()

    return {
        "id": str(org.id),
        "slug": org.slug,
        "name": org.name,
        "created_at": org.created_at.isoformat(),
    }


@router.get("/users")
async def list_all_users(
    ctx: RequestContext = authorize("*"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List all users across all orgs (super_admin only)."""
    _require_super_admin(ctx)
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "created_at": user.created_at.isoformat(),
        }
        for user in users
    ]


@router.get("/audit-logs")
async def list_audit_logs(
    ctx: RequestContext = authorize("*"),
    org_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List audit logs across all orgs (super_admin only)."""
    _require_super_admin(ctx)

    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    if org_id:
        query = query.where(AuditLog.org_id == org_id)

    result = await session.execute(query)
    logs = result.scalars().all()

    return [
        {
            "id": str(log.id),
            "org_id": str(log.org_id) if log.org_id else None,
            "user_id": str(log.user_id) if log.user_id else None,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "metadata": log.extra,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
