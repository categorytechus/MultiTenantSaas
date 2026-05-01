from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import get_db
from app.core.rbac import Role
from app.core.tenancy import RequestContext, get_required_context
from app.models.org import Org, OrgMembership
from app.services.auth import _make_access_token
from app.core.security import create_refresh_token
from app.models.user import RefreshToken, User
from datetime import datetime, timedelta, timezone
from app.core.config import settings

router = APIRouter(prefix="/api/orgs", tags=["orgs"])


class OrgResponse(BaseModel):
    id: str
    slug: str
    name: str
    role: str | None = None

    class Config:
        from_attributes = True


class SwitchOrgRequest(BaseModel):
    org_id: str


@router.get("/", response_model=list[OrgResponse])
async def list_orgs(
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List orgs for the current user."""
    # Get all memberships for this user
    memberships_result = await session.execute(
        select(OrgMembership).where(OrgMembership.user_id == ctx.user_id)
    )
    memberships = list(memberships_result.scalars().all())

    orgs = []
    for membership in memberships:
        org = await session.get(Org, membership.org_id)
        if org:
            orgs.append({
                "id": str(org.id),
                "slug": org.slug,
                "name": org.name,
                "role": membership.role,
            })
    return orgs


@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(
    org_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Get org details. Users can only see orgs they belong to."""
    # Verify user belongs to this org
    membership_result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == ctx.user_id,
            OrgMembership.org_id == org_id,
        )
    )
    membership = membership_result.scalars().first()
    if not membership and ctx.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org not found")

    return {"id": str(org.id), "slug": org.slug, "name": org.name, "role": membership.role if membership else None}


@router.post("/switch")
async def switch_org(
    body: SwitchOrgRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Switch to a different org. Issues new tokens with updated org_id in JWT.
    """
    target_org_id = UUID(body.org_id)

    # Verify user belongs to the target org
    membership_result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == ctx.user_id,
            OrgMembership.org_id == target_org_id,
        )
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this org")

    org = await session.get(Org, target_org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org not found")

    user = await session.get(User, ctx.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    role = Role(membership.role)
    new_access = _make_access_token(user, org, role)
    opaque, new_hash = create_refresh_token()

    refresh_token_obj = RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    session.add(refresh_token_obj)

    return {"access_token": new_access, "refresh_token": opaque, "token_type": "bearer"}
