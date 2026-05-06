"""Organization membership, switching, and context for authenticated users."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.db import get_db
from app.core.identity import is_super_admin_user, jwt_roles_claim
from app.core.rbac import Role
from app.core.security import create_refresh_token
from app.core.tenancy import (
    RequestContext,
    get_optional_tenant_context,
    get_required_context,
)
from app.models.org import Org, OrgMembership
from app.models.user import RefreshToken, User
from app.services.auth import (
    _make_access_token,
    jwt_effective_role,
    make_super_admin_reset_access_token,
    parse_membership_role,
)

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


class OrgMembershipOut(BaseModel):
    id: str
    name: str
    slug: str
    status: str = "active"
    role: str
    membership_status: str = "active"


class OrganizationsListResponse(BaseModel):
    data: list[OrgMembershipOut]


class OrgDetailResponse(BaseModel):
    id: str
    slug: str
    name: str
    role: str | None = None


class SwitchOrganizationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    organization_id: UUID = Field(alias="organizationId")


class OrganizationContextOut(BaseModel):
    id: str
    name: str
    slug: str
    role: str


class SwitchOrganizationResponse(BaseModel):
    access_token: str
    refresh_token: str
    organization: OrganizationContextOut
    roles: list[str]
    token_type: str = "bearer"


class SwitchEnvelope(BaseModel):
    data: SwitchOrganizationResponse


class ResetContextResponse(BaseModel):
    access_token: str
    refresh_token: str


class ResetEnvelope(BaseModel):
    data: ResetContextResponse


class CurrentOrgOut(BaseModel):
    id: str
    name: str
    slug: str
    domain: str | None = None
    status: str = "active"
    subscription_tier: str = "free"
    role: str


class CurrentEnvelope(BaseModel):
    data: CurrentOrgOut


@router.get("/", response_model=OrganizationsListResponse)
async def list_my_organizations(
    ctx: Annotated[RequestContext, Depends(get_optional_tenant_context)],
    session: AsyncSession = Depends(get_db),
):
    """Organizations the current user belongs to (sorted by name)."""
    result = await session.execute(
        select(OrgMembership, Org)
        .join(Org, Org.id == OrgMembership.org_id)
        .where(OrgMembership.user_id == ctx.user_id)
        .order_by(asc(Org.name)),
    )
    payload: list[OrgMembershipOut] = []
    for mem, org in result.all():
        payload.append(
            OrgMembershipOut(
                id=str(org.id),
                name=org.name,
                slug=org.slug,
                role=mem.role,
            ),
        )
    return OrganizationsListResponse(data=payload)


@router.post("/switch", response_model=SwitchEnvelope)
async def switch_organization(
    body: SwitchOrganizationRequest,
    ctx: Annotated[RequestContext, Depends(get_optional_tenant_context)],
    session: AsyncSession = Depends(get_db),
):
    """Issue new tokens scoped to `organization_id`. Super admins may select any organization."""
    user = await session.get(User, ctx.user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")

    org = await session.get(Org, body.organization_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")

    is_sa = is_super_admin_user(user.id)

    mr = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == ctx.user_id,
            OrgMembership.org_id == body.organization_id,
        ),
    )
    membership = mr.scalars().first()

    if not membership and not is_sa:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not a member of this organization")

    if is_sa:
        jwt_role = Role.SUPER_ADMIN
        membership_role_display = Role.SUPER_ADMIN
        org_role = "super_admin"
    else:
        assert membership is not None
        jwt_role = parse_membership_role(membership.role)
        membership_role_display = jwt_role
        org_role = membership.role

    access = _make_access_token(user, org, jwt_role)
    opaque, new_hash = create_refresh_token()

    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=new_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            org_id=org.id,
            no_org_scope=False,
        ),
    )

    roles = jwt_roles_claim(jwt_effective_role(user, membership_role_display))
    payload = SwitchOrganizationResponse(
        access_token=access,
        refresh_token=opaque,
        organization=OrganizationContextOut(
            id=str(org.id),
            name=org.name,
            slug=org.slug,
            role=org_role,
        ),
        roles=roles,
    )
    return SwitchEnvelope(data=payload)


@router.post("/reset", response_model=ResetEnvelope)
async def reset_tenant_context(
    ctx: Annotated[RequestContext, Depends(get_optional_tenant_context)],
    session: AsyncSession = Depends(get_db),
):
    """Clear org scope on the JWT (super admins only)."""
    if ctx.user_id is None or not is_super_admin_user(ctx.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Super admin privileges required")

    user = await session.get(User, ctx.user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")

    access = make_super_admin_reset_access_token(user)
    opaque, new_hash = create_refresh_token()

    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=new_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            org_id=None,
            no_org_scope=True,
        ),
    )

    return ResetEnvelope(
        data=ResetContextResponse(
            access_token=access,
            refresh_token=opaque,
        ),
    )


@router.get("/current", response_model=CurrentEnvelope)
async def current_organization(
    ctx: Annotated[RequestContext, Depends(get_optional_tenant_context)],
    session: AsyncSession = Depends(get_db),
):
    if ctx.org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No organization selected in token")

    result = await session.execute(
        select(Org, OrgMembership)
        .join(OrgMembership, OrgMembership.org_id == Org.id)
        .where(
            OrgMembership.user_id == ctx.user_id,
            Org.id == ctx.org_id,
        ),
    )
    row = result.first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")

    org, mem = row
    return CurrentEnvelope(
        data=CurrentOrgOut(
            id=str(org.id),
            name=org.name,
            slug=org.slug,
            role=mem.role,
        ),
    )


@router.get("/by-id/{org_id}", response_model=OrgDetailResponse)
async def get_organization(
    org_id: UUID,
    ctx: Annotated[RequestContext, Depends(get_required_context)],
    session: AsyncSession = Depends(get_db),
):
    """Fetch one organization visible to the caller."""
    mr = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == ctx.user_id,
            OrgMembership.org_id == org_id,
        ),
    )
    membership = mr.scalars().first()
    if not membership and ctx.role != Role.SUPER_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Access denied")

    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Organization not found")

    return OrgDetailResponse(
        id=str(org.id),
        slug=org.slug,
        name=org.name,
        role=membership.role if membership else None,
    )
