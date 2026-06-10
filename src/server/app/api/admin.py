from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, File, UploadFile
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
    label: str
    description: str
    parent_id: str | None = None
    sort_order: int = 100
    enabled: bool


class OrgModulesListEnvelope(BaseModel):
    data: list[OrgModuleRow]


class ModuleTreeRow(BaseModel):
    id: str
    label: str
    description: str
    parent_id: str | None = None
    sort_order: int = 100


class ModuleTreeEnvelope(BaseModel):
    data: list[ModuleTreeRow]


# Fallback metadata used before migration 041 has been applied.
# After migration 041 runs, all of this data lives in master_modules columns.
_MODULE_LABELS: dict[str, str] = {
    "ai_assistant":      "AI Assistant",
    "ai_images":         "Images",
    "ai_links":          "Links",
    "report_generation": "Report Generation",
    "cost_seg":          "Cost Segregation",
    "documents":         "Documents",
    "web_urls":          "Web URLs",
    "api_calling":       "API Calling",
}
_MODULE_DESCRIPTIONS: dict[str, str] = {
    "ai_assistant":      "AI assistant tools and chat capabilities.",
    "ai_images":         "Image embedding in chat.",
    "ai_links":          "Link embeddings in chat.",
    "report_generation": "Generate PDF reports in chat.",
    "cost_seg":          "IRS MACRS cost segregation classification.",
    "documents":         "Document library and document actions.",
    "web_urls":          "Manage web URL records and sources.",
    "api_calling":       "Enable outbound API actions and webhook integrations.",
}
_MODULE_PARENT_IDS: dict[str, str] = {
    "ai_images":         "ai_assistant",
    "ai_links":          "ai_assistant",
    "report_generation": "ai_assistant",
}
_MODULE_SORT_ORDER: dict[str, int] = {
    "ai_assistant": 10, "ai_images": 11, "ai_links": 12, "report_generation": 13,
    "cost_seg": 20, "documents": 30, "web_urls": 40, "api_calling": 50,
}


async def _load_modules_safe(session: AsyncSession) -> list[dict]:
    """Load master_modules rows with full metadata.
    Uses a savepoint so a missing column (pre-migration) falls back to raw SQL + hardcoded metadata."""
    try:
        async with session.begin_nested():
            result = await session.execute(
                select(MasterModule)
                .where(MasterModule.enabled == True)  # noqa: E712
                .order_by(MasterModule.sort_order)
            )
            return [
                {
                    "id": m.id,
                    "label": m.display_label(),
                    "description": m.display_description(),
                    "parent_id": m.parent_id,
                    "sort_order": m.sort_order,
                }
                for m in result.scalars().all()
            ]
    except Exception:
        # Migration 041 columns not present yet — fall back to original columns
        result = await session.execute(
            text("SELECT id, name FROM master_modules WHERE enabled = true ORDER BY id")
        )
        return sorted(
            [
                {
                    "id": row[0],
                    "label": _MODULE_LABELS.get(row[0], row[1]),
                    "description": _MODULE_DESCRIPTIONS.get(row[0], f"Manage {row[1].lower()} features."),
                    "parent_id": _MODULE_PARENT_IDS.get(row[0]),
                    "sort_order": _MODULE_SORT_ORDER.get(row[0], 100),
                }
                for row in result.all()
            ],
            key=lambda m: (m["sort_order"], m["id"]),
        )


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


class SuperAdminChangePasswordRequest(BaseModel):
    password: str = Field(..., min_length=8)


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


@router.delete("/organizations/{org_id}", status_code=204)
async def delete_organization(
    org_id: UUID,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> None:
    _ = ctx
    org = await session.get(Org, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    async def _del(table: str, col: str = "org_id") -> None:
        """Delete rows from `table` where `col` = org_id, only if the table exists."""
        exists = await session.execute(text(f"SELECT to_regclass('public.{table}')"))
        if exists.scalar_one_or_none() is not None:
            await session.execute(
                text(f"DELETE FROM {table} WHERE {col} = :oid"),
                {"oid": org_id},
            )

    # Delete in FK dependency order (children before parents).
    # api_execution_logs → api_task_proposals → agent_tasks
    await _del("api_execution_logs")
    await _del("api_task_proposals")
    await _del("agent_tasks")
    # workflow children → workflow_sessions
    await _del("workflow_outputs")
    await _del("workflow_items")
    await _del("workflow_sessions")
    # chat children → chat_sessions
    await _del("chat_messages")
    await _del("chat_sessions")
    # document children → documents
    await _del("document_chunks")
    await _del("documents")
    # other org-scoped tables
    await _del("web_urls")
    # RBAC: role_permissions/role_org_permissions that reference custom org roles, then the roles
    await _del("user_roles", "organization_id")
    await _del("role_org_permissions")
    exists = await session.execute(text("SELECT to_regclass('public.role_permissions')"))
    if exists.scalar_one_or_none() is not None:
        await session.execute(
            text("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = :oid)"),
            {"oid": org_id},
        )
    await session.execute(
        text("DELETE FROM roles WHERE organization_id = :oid"),
        {"oid": org_id},
    )
    # refresh tokens scoped to this org
    await session.execute(
        text("DELETE FROM refresh_tokens WHERE org_id = :oid"),
        {"oid": org_id},
    )
    # membership, invites, modules
    await session.execute(text("DELETE FROM org_memberships WHERE org_id = :oid"), {"oid": org_id})
    await session.execute(text("DELETE FROM invite_tokens WHERE org_id = :oid"), {"oid": org_id})
    await _del("org_modules")

    await session.delete(org)
    await session.flush()


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


@router.post("/super-admins/{user_id}/change-password")
async def change_super_admin_password(
    user_id: UUID,
    body: SuperAdminChangePasswordRequest,
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    import secrets
    _ = ctx
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    allow = await session.get(SuperAdminAllowlist, user_id)
    if not allow:
        raise HTTPException(status_code=404, detail="Super admin not found")

    user.hashed_password = hash_password(body.password)

    recovery_key = secrets.token_hex(32)
    allow.recovery_key_hash = hash_password(recovery_key)

    session.add(user)
    session.add(allow)
    await session.flush()

    return {"success": True, "data": {"recovery_key": recovery_key}}


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

    from app.core.identity import is_super_admin_user as _is_sa

    by_user: dict[str, OrgAdminRow] = {}
    for user, org, mem in rows:
        if _is_sa(user.id):
            continue  # super admins are not org admins
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
        from app.core.identity import is_super_admin_user as _is_sa
        if _is_sa(user.id):
            raise HTTPException(
                status_code=400,
                detail="Super admins cannot be added as org admins",
            )
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
    from app.core.identity import is_super_admin_user
    
    # Get all memberships to extract roles
    memberships_result = await session.execute(select(OrgMembership.user_id, OrgMembership.role))
    user_roles: dict[UUID, set[str]] = {}
    for uid, role in memberships_result.all():
        if uid not in user_roles:
            user_roles[uid] = set()
        user_roles[uid].add(role)

    result = await session.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    
    data = []
    for user in users:
        is_sa = is_super_admin_user(user.id)
        roles_list = []
        if is_sa:
            roles_list.append({"id": "super_admin", "name": "super_admin"})
        else:
            for role in user_roles.get(user.id, []):
                if role == Role.TENANT_ADMIN.value:
                    roles_list.append({"id": "org_admin", "name": "org_admin"})
                elif role == Role.USER.value:
                    roles_list.append({"id": "user", "name": "user"})
                
        # Deduplicate roles
        unique_roles = []
        seen = set()
        for r in roles_list:
            if r["name"] not in seen:
                seen.add(r["name"])
                unique_roles.append(r)
                
        data.append({
            "id": str(user.id),
            "email": user.email,
            "full_name": user.name or "",
            "status": "active",
            "user_type": "super_admin" if is_sa else "user",
            "org_role": "super_admin" if is_sa else "user",
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login_at": None,
            "roles": unique_roles,
        })
        
    return UsersListEnvelope(data=data)


@router.get("/modules", response_model=ModuleTreeEnvelope)
async def list_master_modules(
    ctx: RequestContext = Depends(require_super_admin_user),
    session: AsyncSession = Depends(get_db),
):
    """Return the full module tree — used by org-permissions UI to derive hierarchy."""
    _ = ctx
    modules = await _load_modules_safe(session)
    return ModuleTreeEnvelope(
        data=[ModuleTreeRow(**{k: m[k] for k in ModuleTreeRow.model_fields}) for m in modules]
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

    modules = await _load_modules_safe(session)

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

    return OrgModulesListEnvelope(
        data=[
            OrgModuleRow(
                id=m["id"],
                label=m["label"],
                description=m["description"],
                parent_id=m["parent_id"],
                sort_order=m["sort_order"],
                enabled=(m["id"] in assigned_module_ids),
            )
            for m in modules
        ]
    )


async def _sync_module_permission_grants(session: AsyncSession, module_ids: list[str]) -> None:
    """Ensure tenant_admin and org_admin system roles have grants for all permission_keys
    belonging to the given modules. Called whenever org module assignments change.
    Skips silently if migration 041 columns are not yet available."""
    from app.models.rbac import RbacRole, RolePermission

    if not module_ids:
        return

    # Load permission_keys — skip if migration 041 hasn't added the column yet
    try:
        async with session.begin_nested():
            result = await session.execute(
                select(MasterModule.permission_keys).where(MasterModule.id.in_(module_ids))
            )
            all_keys: list[str] = [key for (keys,) in result.all() for key in (keys or [])]
    except Exception:
        return  # Column not present yet — grants will be seeded by the migration
    if not all_keys:
        return

    # Resolve permission rows
    perm_rows_result = await session.execute(
        select(RbacPermission).where(
            RbacPermission.resource.in_([k.split(":")[0] for k in all_keys]),
            RbacPermission.action.in_([k.split(":")[1] for k in all_keys]),
        )
    )
    perm_by_key = {f"{p.resource}:{p.action}": p for p in perm_rows_result.scalars().all()}

    # Resolve system roles
    system_roles_result = await session.execute(
        select(RbacRole).where(
            RbacRole.name.in_(["tenant_admin", "org_admin"]),
            RbacRole.is_system == True,  # noqa: E712
        )
    )
    system_roles = system_roles_result.scalars().all()

    # Insert missing grants
    for role in system_roles:
        for key in all_keys:
            perm = perm_by_key.get(key)
            if not perm:
                continue
            await session.execute(
                text("""
                    INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                    VALUES (gen_random_uuid(), :role_id, :perm_id, NOW())
                    ON CONFLICT DO NOTHING
                """),
                {"role_id": role.id, "perm_id": perm.id},
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
                session.add(OrgModule(org_id=org_id, module_id=module_id, assigned_by=ctx.user_id))
            await session.flush()
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to update organization module assignments")

    # Ensure system roles have grants for all newly-enabled module permissions.
    await _sync_module_permission_grants(session, normalized)

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



