from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.identity import normalize_email
from app.core.db import get_db
from app.core.tenancy import RequestContext, require_super_admin_user
from app.core.rbac import Role
from app.models.audit_log import AuditLog
from app.models.org import Org, OrgMembership
from app.models.master_module import MasterModule
from app.models.org_module import OrgModule
from app.models.rbac import RbacPermission
from app.models.super_admin import SuperAdminAllowlist
from app.models.user import User
from app.core.security import hash_password
from app.services.invite_service import create_invite_record, link_query_role

router = APIRouter(prefix="/api/admin", tags=["admin"])
def _public_app_base(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if host:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
        return f"{proto}://{host}".rstrip("/")
    return settings.PUBLIC_APP_URL.rstrip("/")



class CreateOrgRequest(BaseModel):
    name: str
    slug: str | None = None
    domain: str | None = None
    status: str = "active"
    subscription_tier: str = Field(default="free", alias="subscriptionTier")


class UpdateOrgRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    slug: str | None = None
    domain: str | None = None
    status: str | None = None
    subscription_tier: str | None = Field(default=None, alias="subscriptionTier")


class OrgModuleRow(BaseModel):
    id: str
    name: str
    label: str
    description: str
    permissions: list[str]
    enabled: bool


class OrgModulesListEnvelope(BaseModel):
    data: list[OrgModuleRow]


class UpdateOrgModulesRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    module_ids: list[str] = Field(alias="moduleIds")


class OrgAdminInviteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    email: str
    organization_id: UUID = Field(alias="organizationId")


class OrgListEnvelope(BaseModel):
    data: list[dict[str, Any]]


class UsersListEnvelope(BaseModel):
    data: list[dict[str, Any]]

class SuperAdminCreateRequest(BaseModel):
    name: str
    email: str
    password: str = Field(..., min_length=8)


class SuperAdminUpdateRequest(BaseModel):
    name: str
    status: str = "active"


async def _org_modules_table_exists(session: AsyncSession) -> bool:
    # Avoid triggering undefined-table errors that abort the transaction.
    result = await session.execute(text("SELECT to_regclass('public.org_modules')"))
    return result.scalar_one_or_none() is not None


@router.get("/organizations", response_model=OrgListEnvelope)
async def list_organizations(
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(Org).order_by(Org.created_at.desc()))
    orgs = result.scalars().all()
    return OrgListEnvelope(
        data=[
            {
                "id": str(org.id),
                "slug": org.slug,
                "name": org.name,
                "domain": org.domain,
                "status": org.status,
                "subscription_tier": org.subscription_tier,
                "created_at": org.created_at.isoformat(),
            }
            for org in orgs
        ],
    )


@router.post("/organizations", status_code=201)
async def create_organization(
    body: CreateOrgRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    import re

    slug = body.slug
    if not slug:
        slug = re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "org"

    existing = await session.execute(select(Org).where(Org.slug == slug))
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' already taken")

    org = Org(
        name=body.name,
        slug=slug,
        domain=(body.domain.strip() if body.domain else None),
        status=body.status,
        subscription_tier=body.subscription_tier,
    )
    session.add(org)
    await session.flush()

    return {
        "id": str(org.id),
        "slug": org.slug,
        "name": org.name,
        "domain": org.domain,
        "status": org.status,
        "subscription_tier": org.subscription_tier,
        "created_at": org.created_at.isoformat(),
    }


@router.put("/organizations/{org_id}")
async def update_organization(
    org_id: UUID,
    body: UpdateOrgRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    _ = ctx
    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Organization name is required")

    new_slug = body.slug.strip() if body.slug else org.slug
    if new_slug != org.slug:
        existing = await session.execute(
            select(Org).where(Org.slug == new_slug, Org.id != org_id)
        )
        if existing.scalars().first():
            raise HTTPException(status_code=409, detail=f"Slug '{new_slug}' already taken")
        org.slug = new_slug

    org.name = new_name
    org.domain = body.domain.strip() if body.domain else None
    if body.status is not None:
        org.status = body.status
    if body.subscription_tier is not None:
        org.subscription_tier = body.subscription_tier
    session.add(org)
    await session.flush()

    return {
        "success": True,
        "data": {
            "id": str(org.id),
            "slug": org.slug,
            "name": org.name,
            "domain": org.domain,
            "status": org.status,
            "subscription_tier": org.subscription_tier,
            "created_at": org.created_at.isoformat(),
        },
    }


@router.get("/super-admins")
async def list_super_admins(
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = ctx
    result = await session.execute(
        select(SuperAdminAllowlist, User)
        .join(User, User.id == SuperAdminAllowlist.user_id)
        .order_by(User.created_at.desc())
    )
    rows = result.all()
    return {
        "data": [
            {
                "id": str(user.id),
                "email": user.email,
                "full_name": user.name or "",
                "status": allow.status,
                "user_type": "super_admin",
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "last_login_at": None,
            }
            for allow, user in rows
        ]
    }


@router.post("/super-admins", status_code=201)
async def create_super_admin(
    body: SuperAdminCreateRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = ctx
    email = normalize_email(body.email)
    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(email=email, hashed_password=hash_password(body.password), name=body.name)
    session.add(user)
    await session.flush()
    session.add(SuperAdminAllowlist(user_id=user.id, status="active"))
    await session.flush()
    return {"success": True, "data": {"id": str(user.id)}}


@router.put("/super-admins/{user_id}")
async def update_super_admin(
    user_id: UUID,
    body: SuperAdminUpdateRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = ctx
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    allow = await session.get(SuperAdminAllowlist, user_id)
    if not allow:
        raise HTTPException(status_code=404, detail="Super admin not found")
    user.name = body.name
    allow.status = body.status
    session.add(user)
    session.add(allow)
    await session.flush()
    return {"success": True}


@router.delete("/super-admins/{user_id}", status_code=204)
async def delete_super_admin(
    user_id: UUID,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    _ = ctx
    allow = await session.get(SuperAdminAllowlist, user_id)
    if not allow:
        raise HTTPException(status_code=404, detail="Super admin not found")
    await session.delete(allow)
    await session.flush()


@router.post("/org-admins/invites")
async def create_org_admin_invite(
    body: OrgAdminInviteRequest,
    request: Request,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Generate a signup link for inviting an organization admin (same email flow as Next.js signup page)."""
    org = await session.get(Org, body.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    _, plain_token = await create_invite_record(
        session,
        email=body.email.strip(),
        org_id=body.organization_id,
        invited_by=ctx.user_id,
        role=Role.TENANT_ADMIN,
    )
    role_q = link_query_role(Role.TENANT_ADMIN)
    base = _public_app_base(request)
    signup_link = (
        f"{base}/auth/signup/{body.organization_id}"
        f"?token={quote(plain_token, safe='')}"
        f"&email={quote(normalize_email(body.email), safe='')}"
        f"&role={role_q}"
    )
    await session.flush()
    return {"success": True, "data": {"signup_link": signup_link}}


class OrgAdminRow(BaseModel):
    id: str
    email: str
    full_name: str
    status: str
    created_at: str | None = None
    last_login_at: str | None = None
    orgs: list[dict[str, str]]
    org_name: str | None = None


class OrgAdminsListEnvelope(BaseModel):
    data: list[OrgAdminRow]


class CreateOrgAdminRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    email: str
    organization_id: UUID = Field(alias="organizationId")


@router.get("/org-admins", response_model=OrgAdminsListEnvelope)
async def list_org_admins(
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
    org_id: UUID | None = Query(default=None, alias="orgId"),
) -> Any:
    _ = ctx
    query = (
        select(User, Org, OrgMembership)
        .join(OrgMembership, OrgMembership.user_id == User.id)
        .join(Org, Org.id == OrgMembership.org_id)
        .where(OrgMembership.role == Role.TENANT_ADMIN.value)
        .order_by(User.created_at.desc())
    )
    if org_id:
        query = query.where(Org.id == org_id)

    result = await session.execute(query)
    rows = result.all()

    by_user: dict[str, OrgAdminRow] = {}
    for user, org, mem in rows:
        uid = str(user.id)
        entry = by_user.get(uid)
        if not entry:
            entry = OrgAdminRow(
                id=uid,
                email=user.email,
                full_name=user.name or "",
                status="active",
                created_at=user.created_at.isoformat() if user.created_at else None,
                last_login_at=None,
                orgs=[],
                org_name=None,
            )
            by_user[uid] = entry
        entry.orgs.append({"id": str(org.id), "name": org.name, "slug": org.slug})
        if entry.org_name is None:
            entry.org_name = org.name

    return OrgAdminsListEnvelope(data=list(by_user.values()))


@router.post("/org-admins")
async def create_org_admin(
    body: CreateOrgAdminRequest,
    request: Request,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    _ = ctx
    org = await session.get(Org, body.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    email = normalize_email(body.email)
    existing = await session.execute(select(User).where(User.email == email))
    user = existing.scalars().first()

    if user:
        mr = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id,
                OrgMembership.org_id == body.organization_id,
            )
        )
        membership = mr.scalars().first()
        if membership:
            membership.role = Role.TENANT_ADMIN.value
            session.add(membership)
        else:
            session.add(
                OrgMembership(user_id=user.id, org_id=body.organization_id, role=Role.TENANT_ADMIN.value)
            )
        await session.flush()
        # UI treats status=200 as "existing user added"
        return {"success": True, "data": {}}

    # For new users: generate a signup link (same mechanism as invite page).
    if ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    _, plain_token = await create_invite_record(
        session,
        email=email,
        org_id=body.organization_id,
        invited_by=ctx.user_id,
        role=Role.TENANT_ADMIN,
    )
    role_q = link_query_role(Role.TENANT_ADMIN)
    base = _public_app_base(request)
    set_password_link = (
        f"{base}/auth/signup/{body.organization_id}"
        f"?token={quote(plain_token, safe='')}"
        f"&email={quote(email, safe='')}"
        f"&role={role_q}"
    )
    await session.flush()
    # Use 201 for a new invite link flow.
    return {"success": True, "data": {"set_password_link": set_password_link}}


@router.put("/org-admins/{user_id}")
async def update_org_admin(
    user_id: UUID,
    body: SuperAdminUpdateRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = ctx
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.name = body.name
    session.add(user)
    await session.flush()
    return {"success": True}


@router.delete("/org-admins/{user_id}", status_code=204)
async def delete_org_admin(
    user_id: UUID,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    _ = ctx
    # Remove all tenant_admin memberships for this user.
    result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == user_id,
            OrgMembership.role == Role.TENANT_ADMIN.value,
        )
    )
    memberships = result.scalars().all()
    if not memberships:
        raise HTTPException(status_code=404, detail="Org admin not found")
    for m in memberships:
        await session.delete(m)
    await session.flush()


@router.delete("/org-admins/{user_id}/organizations/{org_id}", status_code=204)
async def delete_org_admin_from_org(
    user_id: UUID,
    org_id: UUID,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    _ = ctx
    result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == user_id,
            OrgMembership.org_id == org_id,
            OrgMembership.role == Role.TENANT_ADMIN.value,
        )
    )
    membership = result.scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="Org admin membership not found")
    await session.delete(membership)
    await session.flush()

@router.get("/users", response_model=UsersListEnvelope)
async def list_all_users(
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return UsersListEnvelope(
        data=[
            {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "created_at": user.created_at.isoformat(),
            }
            for user in users
        ],
    )


@router.get("/organizations/{org_id}/modules", response_model=OrgModulesListEnvelope)
async def get_org_module_flags(
    org_id: UUID,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
):
    _ = ctx
    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = await session.execute(select(MasterModule).order_by(MasterModule.id.asc()))
    modules = result.scalars().all()

    assigned_module_ids: set[str] = set()
    if await _org_modules_table_exists(session):
        try:
            async with session.begin_nested():
                assigned_result = await session.execute(
                    select(OrgModule.module_id).where(OrgModule.org_id == org_id)
                )
                assigned_module_ids = set(assigned_result.scalars().all())
        except Exception:
            raise HTTPException(status_code=500, detail="Unable to load organization module assignments")

    module_ids = [m.id for m in modules]
    permission_result = await session.execute(
        select(RbacPermission.resource, RbacPermission.action).where(
            RbacPermission.resource.in_(module_ids)
        )
    )
    permission_map: dict[str, list[str]] = {module_id: [] for module_id in module_ids}
    for resource, action in permission_result.all():
        permission_map.setdefault(resource, []).append(f"{resource}:{action}")

    default_descriptions: dict[str, str] = {
        "ai_assistant": "AI assistant tools and chat capabilities.",
        "documents": "Document library and document actions.",
        "web_urls": "Manage web URL records and sources.",
    }

    return OrgModulesListEnvelope(
        data=[
            OrgModuleRow(
                id=m.id,
                name=m.name,
                label=m.name,
                description=default_descriptions.get(
                    m.id,
                    f"Manage access to {m.name.lower()} features.",
                ),
                permissions=sorted(permission_map.get(m.id, [])),
                enabled=(m.id in assigned_module_ids),
            )
            for m in modules
        ]
    )


@router.put("/organizations/{org_id}/modules")
async def put_org_module_flags(
    org_id: UUID,
    body: UpdateOrgModulesRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
):
    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = await session.execute(select(MasterModule.id).where(MasterModule.enabled == True))  # noqa: E712
    allowed = set(result.scalars().all())
    normalized = [m for m in dict.fromkeys(body.module_ids) if m in allowed]

    if not await _org_modules_table_exists(session):
        raise HTTPException(status_code=503, detail="Organization module storage is not initialized")

    try:
        async with session.begin_nested():
            await session.execute(OrgModule.__table__.delete().where(OrgModule.org_id == org_id))
            for module_id in normalized:
                session.add(
                    OrgModule(
                        org_id=org_id,
                        module_id=module_id,
                        assigned_by=ctx.user_id,
                    )
                )
            await session.flush()
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to update organization module assignments")
    return {"success": True, "organization_id": str(org_id), "module_ids": normalized}


@router.get("/audit-logs")
async def list_audit_logs(
    ctx: RequestContext = Depends(require_super_admin_user),
    org_id: UUID | None = None,
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_db),
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    if org_id:
        query = query.where(AuditLog.org_id == org_id)

    result = await session.execute(query)
    logs = result.scalars().all()

    return {
        "data": [
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
        ],
    }
