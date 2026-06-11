"""
Nested resources under `/api/organizations/{organization_id}/…`.

Many write paths are not implemented in the current schema; they return HTTP 501.
"""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.db import get_db
from app.core.identity import is_super_admin_user, normalize_email
from app.core.rbac import Role, role_permissions_from_db
from app.core.tenancy import RequestContext, get_required_context
from app.models.master_module import MasterModule
from app.models.org import OrgMembership
from app.models.org_module import OrgModule
from app.models.user import User
from app.models.rbac import RbacPermission, RbacRole, RoleOrgPermission, RolePermission
from app.services.invite_service import _assign_custom_role_if_any, create_invite_record, link_query_role

router = APIRouter(
    prefix="/api/organizations/{organization_id}",
    tags=["organization-members"],
)


def _public_app_base(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if host:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
        return f"{proto}://{host}".rstrip("/")
    return settings.PUBLIC_APP_URL.rstrip("/")


def _not_implemented() -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="This operation is not implemented for the current database schema.",
    )


def _require_tenant_admin(ctx: RequestContext) -> None:
    if ctx.role not in (Role.TENANT_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tenant administrator privileges required")


def _ensure_org_context(ctx: RequestContext, organization_id: UUID) -> None:
    if ctx.role == Role.SUPER_ADMIN:
        return
    if ctx.org_id != organization_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Token organization does not match path")


class ModulesPayload(BaseModel):
    data: dict[str, list[str]]


@router.get("/my-permissions", response_model=ModulesPayload)
async def my_modules(
    organization_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _ensure_org_context(ctx, organization_id)
    perms = await role_permissions_from_db(
        session,
        role=ctx.role,
        org_id=organization_id,
        user_id=ctx.user_id,
    )

    # Fetch which sub-modules the org has enabled (ai_images, ai_links, etc.)
    org_enabled_modules: set[str] = set()
    if await _table_exists(session, "org_modules"):
        org_modules_result = await session.execute(
            select(OrgModule.module_id).where(OrgModule.org_id == organization_id)
        )
        org_enabled_modules = {row[0] for row in org_modules_result.all()}

    if "*" in perms:
        modules_set = {"ai_assistant", "documents", "web_urls"}
        # Include org-enabled sub-modules for admins
        if "ai_images" in org_enabled_modules:
            modules_set.add("ai_images")
        if "ai_links" in org_enabled_modules:
            modules_set.add("ai_links")
        modules = sorted(modules_set)
    else:
        modules_set = set()

        if any(p.startswith("ai_assistant:") or p.startswith("agents:") for p in perms):
            modules_set.add("ai_assistant")

        has_documents_view = ("documents:view" in perms) or ("documents:read" in perms)
        if has_documents_view:
            modules_set.add("documents")
            if "ai_images" in org_enabled_modules:
                modules_set.add("ai_images")

        has_web_urls_view = "web_urls:view" in perms
        if has_web_urls_view:
            modules_set.add("web_urls")

        if "link_embed:view" in perms and "ai_links" in org_enabled_modules:
            modules_set.add("ai_links")

        modules = sorted(modules_set)

    return ModulesPayload(data={"modules": modules})


@router.get("/modules", response_model=ModulesPayload)
async def get_org_enabled_modules(
    organization_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> ModulesPayload:
    """Return the list of module IDs enabled for this org. Accessible to all org members."""
    _ensure_org_context(ctx, organization_id)
    result = await session.execute(
        select(OrgModule.module_id).where(OrgModule.org_id == organization_id)
    )
    enabled_ids = [row[0] for row in result.all()]
    return ModulesPayload(data={"modules": enabled_ids})


class OrgUserRow(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    status: str = "active"
    user_type: str = "user"
    org_role: str = "user"
    created_at: str | None = None
    last_login_at: str | None = None
    roles: list[dict] = []


class OrgUsersResponse(BaseModel):
    data: list[OrgUserRow]


async def _table_exists(session: AsyncSession, table_name: str) -> bool:
    result = await session.execute(text("SELECT to_regclass(:table_name)"), {"table_name": f"public.{table_name}"})
    return result.scalar_one_or_none() is not None


@router.get("/users", response_model=OrgUsersResponse)
async def list_org_users(
    organization_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    result = await session.execute(
        select(User, OrgMembership)
        .join(OrgMembership, OrgMembership.user_id == User.id)
        .where(OrgMembership.org_id == organization_id),
    )
    rows = result.all()
    roles_by_user: dict[str, list[dict[str, str | bool]]] = {}
    if await _table_exists(session, "user_roles"):
        role_rows = await session.execute(
            text(
                """
                SELECT ur.user_id, r.id AS role_id, r.name AS role_name, r.is_system
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.organization_id = :org_id
                """
            ),
            {"org_id": organization_id},
        )
        for row in role_rows:
            uid = str(row.user_id)
            roles_by_user.setdefault(uid, []).append(
                {"id": str(row.role_id), "name": row.role_name, "is_system": bool(row.is_system)}
            )

    data: list[dict[str, object]] = []
    for u, m in rows:
        if is_super_admin_user(u.id):
            continue
        assigned_roles = roles_by_user.get(str(u.id), [])
        if not assigned_roles:
            # Fall back to membership.role for display when no user_roles entry exists.
            _display_map = {
                Role.TENANT_ADMIN.value: "org_admin",
                Role.USER.value: "user",
                Role.VIEWER.value: "viewer",
                Role.SUPER_ADMIN.value: "super_admin",
            }
            display_name = _display_map.get(m.role, m.role)
            if display_name:
                assigned_roles = [{"id": m.role, "name": display_name, "is_system": m.role in _display_map}]
        data.append(
            {
                "id": str(u.id),
                "email": u.email,
                "full_name": u.name,
                "status": "active",
                "user_type": "user",
                "org_role": m.role,
                "created_at": u.created_at.isoformat(),
                "last_login_at": None,
                "roles": assigned_roles,
            }
        )
    return OrgUsersResponse(data=data)


@router.post("/users/invites")
async def invite_user_stub():
    _not_implemented()


@router.post("/users")
async def create_org_user(
    organization_id: UUID,
    body: "CreateOrgUserRequest",
    request: Request,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    email = normalize_email(body.email)
    existing = await session.execute(select(User).where(User.email == email))
    user = existing.scalars().first()

    invite_role_value: str = Role.USER.value
    warnings: list[dict[str, str]] = []
    if body.role_id:
        try:
            selected_role_id = UUID(body.role_id)
            role = await session.get(RbacRole, selected_role_id)
            if role and (role.is_system or role.organization_id == organization_id):
                invite_role_value = f"role:{selected_role_id}"
            else:
                warnings.append(
                    {
                        "code": "invalid_role",
                        "message": "Selected role is invalid for this organization.",
                    }
                )
        except ValueError:
            warnings.append(
                {
                    "code": "invalid_role",
                    "message": "roleId must be a valid UUID.",
                }
            )

    if user:
        mem_result = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id,
                OrgMembership.org_id == organization_id,
            )
        )
        membership = mem_result.scalars().first()
        if not membership:
            session.add(OrgMembership(user_id=user.id, org_id=organization_id, role=Role.USER.value))
            await session.flush()
        return {"success": True, "data": {}, "warnings": warnings}

    if ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Create the user immediately (no password yet) so they appear in the users list.
    new_user = User(
        email=email,
        name=body.name.strip() if body.name else None,
        hashed_password=None,
    )
    session.add(new_user)
    await session.flush()

    session.add(OrgMembership(user_id=new_user.id, org_id=organization_id, role=Role.USER.value))
    await session.flush()
    await _assign_custom_role_if_any(
        session, user_id=new_user.id, org_id=organization_id, invite_role=invite_role_value
    )

    # Issue a one-time set-password token (reuses invite_tokens table).
    _, plain_token = await create_invite_record(
        session,
        email=email,
        org_id=organization_id,
        invited_by=ctx.user_id,
        role=invite_role_value,
    )
    base = _public_app_base(request)
    set_password_link = (
        f"{base}/auth/set-password"
        f"?token={quote(plain_token, safe='')}"
        f"&email={quote(email, safe='')}"
    )
    await session.flush()
    return {"success": True, "data": {"set_password_link": set_password_link}, "warnings": warnings}


@router.delete("/users/{user_id}", status_code=200)
async def delete_org_user(
    organization_id: UUID,
    user_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    if user_id == ctx.user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the organization")

    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in this organization")

    # Remove org-scoped RBAC role assignments
    ur_exists = await session.execute(text("SELECT to_regclass('public.user_roles')"))
    if ur_exists.scalar_one_or_none() is not None:
        await session.execute(
            text("DELETE FROM user_roles WHERE user_id = :uid AND organization_id = :oid"),
            {"uid": user_id, "oid": organization_id},
        )

    # Revoke org-scoped refresh tokens
    await session.execute(
        text("DELETE FROM refresh_tokens WHERE user_id = :uid AND org_id = :oid"),
        {"uid": user_id, "oid": organization_id},
    )

    await session.delete(membership)
    await session.flush()

    # If user has no other memberships, delete the user account entirely
    other = await session.execute(
        select(OrgMembership).where(OrgMembership.user_id == user_id)
    )
    if other.scalars().first() is None:
        await session.execute(
            text("DELETE FROM refresh_tokens WHERE user_id = :uid"),
            {"uid": user_id},
        )
        await session.execute(
            text("DELETE FROM oauth_identities WHERE user_id = :uid"),
            {"uid": user_id},
        )
        orphan = await session.get(User, user_id)
        if orphan:
            await session.delete(orphan)
        await session.flush()

    return {"success": True}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    organization_id: UUID,
    user_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
    )
    if not membership_result.scalars().first():
        raise HTTPException(status_code=404, detail="User not found in this organization")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    import secrets
    from app.core.security import hash_password as _hash_password
    temp_password = secrets.token_urlsafe(12)
    user.hashed_password = _hash_password(temp_password)
    session.add(user)
    await session.flush()
    return {"success": True, "data": {"temp_password": temp_password}}


class RolesResponse(BaseModel):
    data: list[dict[str, str | bool | None]]


@router.get("/roles", response_model=RolesResponse)
async def list_roles(
    organization_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    # System roles (is_system=True, organization_id=NULL) are global — org_admin, viewer, etc.
    # Global non-system roles (is_system=False, organization_id=NULL) such as "user" are internal
    # defaults and should not appear as assignable options in the org user creation UI.
    base_roles_result = await session.execute(
        select(RbacRole).where(RbacRole.is_system == True, RbacRole.organization_id == None)  # noqa: E712
    )
    base_roles = base_roles_result.scalars().all()

    custom_roles_result = await session.execute(
        select(RbacRole).where(RbacRole.organization_id == organization_id, RbacRole.is_system == False)  # noqa: E712
    )
    custom_roles = custom_roles_result.scalars().all()

    roles_out: list[dict[str, str | bool | None]] = []
    for r in [*base_roles, *custom_roles]:
        roles_out.append(
            {
                "id": str(r.id),
                "name": r.name,
                "description": r.description,
                "is_system": r.is_system,
                "created_at": r.created_at.isoformat(),
            }
        )
    return RolesResponse(data=roles_out)


class CreateRoleRequest(BaseModel):
    name: str
    description: str | None = None


@router.post("/roles")
async def create_role(
    organization_id: UUID,
    body: CreateRoleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    existing = await session.execute(
        select(RbacRole).where(
            RbacRole.organization_id == organization_id,
            RbacRole.is_system == False,  # noqa: E712
            RbacRole.name == body.name,
        )
    )
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="Role name already exists in this organization")

    role = RbacRole(
        name=body.name.strip(),
        description=(body.description.strip() if body.description else None),
        is_system=False,
        organization_id=organization_id,
    )
    session.add(role)
    await session.flush()
    return {"success": True, "data": {"id": str(role.id)}}


class UpdateRoleRequest(BaseModel):
    name: str
    description: str | None = None


@router.put("/roles/{role_id}")
async def update_role(
    organization_id: UUID,
    role_id: UUID,
    body: UpdateRoleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    role = await session.get(RbacRole, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=403, detail="Cannot modify system roles")
    # Allow editing global default roles (organization_id=None, is_system=False) or org-owned roles.
    if role.organization_id is not None and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    role.name = body.name.strip()
    role.description = body.description.strip() if body.description else None
    session.add(role)
    await session.flush()
    return {"success": True}


@router.delete("/roles/{role_id}")
async def delete_role(
    organization_id: UUID,
    role_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    role = await session.get(RbacRole, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system roles")
    # Allow deleting global default roles (organization_id=None, is_system=False) or org-owned roles.
    if role.organization_id is not None and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    # Remove per-org permission grants.
    grants = await session.execute(
        select(RoleOrgPermission).where(
            RoleOrgPermission.role_id == role_id,
            RoleOrgPermission.org_id == organization_id,
        )
    )
    for g in grants.scalars().all():
        await session.delete(g)

    await session.flush()
    await session.delete(role)
    await session.flush()
    return None


class PermissionItemOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    granted: bool = False


class PermissionModuleOut(BaseModel):
    id: str
    label: str
    description: str
    permissions: list[PermissionItemOut]


class GetRolePermissionsOut(BaseModel):
    data: list[PermissionModuleOut]
    is_system_org_admin: bool = False


def _action_to_label(action: str) -> str:
    return action.replace("_", " ").title()


_LEGACY_MODULES = {
    "ai_assistant": {"label": "AI Assistant",  "description": "AI assistant tools and chat capabilities.", "permissions": ["ai_assistant:chat"]},
    "documents":    {"label": "Documents",     "description": "Document library and document actions.",    "permissions": ["documents:view", "documents:create", "documents:upload", "documents:update", "documents:delete"]},
    "web_urls":     {"label": "Web URLs",      "description": "Manage web URL records and sources.",       "permissions": ["web_urls:view", "web_urls:create", "web_urls:update", "web_urls:delete"]},
    "cost_seg":     {"label": "Cost Segregation", "description": "IRS MACRS cost segregation.",           "permissions": ["cost_seg:read", "cost_seg:create", "cost_seg:delete"]},
    "api_calling":  {"label": "API Calling",   "description": "Outbound API actions and webhooks.",        "permissions": ["api_calling:create", "api_calling:view", "api_calling:update", "api_calling:delete"]},
}


async def _load_perm_modules(
    session: AsyncSession, organization_id: UUID
) -> list[MasterModule]:
    """Return org-enabled modules that have permission_keys, ordered by sort_order.
    Uses a savepoint so missing columns (pre-migration 041) fall back to legacy dicts.
    Falls back to all enabled modules when org_modules table is absent."""
    try:
        async with session.begin_nested():
            if await _table_exists(session, "org_modules"):
                result = await session.execute(
                    select(MasterModule)
                    .join(OrgModule, OrgModule.module_id == MasterModule.id)
                    .where(
                        OrgModule.org_id == organization_id,
                        MasterModule.enabled == True,  # noqa: E712
                    )
                    .order_by(MasterModule.sort_order)
                )
            else:
                result = await session.execute(
                    select(MasterModule)
                    .where(MasterModule.enabled == True)  # noqa: E712
                    .order_by(MasterModule.sort_order)
                )
            return [m for m in result.scalars().all() if m.permission_keys]
    except Exception:
        pass  # Migration 041 columns not present — build synthetic module objects below

    # Pre-migration fallback: query original columns, merge with legacy dicts
    if await _table_exists(session, "org_modules"):
        enabled_result = await session.execute(
            text("SELECT module_id FROM org_modules WHERE org_id = :org_id"),
            {"org_id": organization_id},
        )
        enabled_ids = {row[0] for row in enabled_result.all()}
    else:
        name_result = await session.execute(
            text("SELECT id FROM master_modules WHERE enabled = true")
        )
        enabled_ids = {row[0] for row in name_result.all()}

    modules = []
    for mod_id, spec in _LEGACY_MODULES.items():
        if mod_id not in enabled_ids:
            continue
        m = MasterModule.__new__(MasterModule)
        object.__setattr__(m, "id", mod_id)
        object.__setattr__(m, "name", spec["label"])
        object.__setattr__(m, "label", spec["label"])
        object.__setattr__(m, "description", spec["description"])
        object.__setattr__(m, "parent_id", None)
        object.__setattr__(m, "sort_order", list(_LEGACY_MODULES).index(mod_id) * 10)
        object.__setattr__(m, "permission_keys", spec["permissions"])
        object.__setattr__(m, "enabled", True)
        modules.append(m)
    return modules


@router.get("/roles/{role_id}/permissions")
async def get_role_permissions(
    organization_id: UUID,
    role_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    role = await session.get(RbacRole, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if not role.is_system and role.organization_id is not None and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    is_system_org_admin = bool(role.is_system and role.name in ("org_admin", "tenant_admin"))

    # Load modules enabled for this org that have permission_keys
    perm_modules = await _load_perm_modules(session, organization_id)

    # Collect all wanted permission keys and look up DB rows
    wanted_keys: set[str] = {key for m in perm_modules for key in m.permission_keys}
    perm_by_key: dict[str, RbacPermission] = {}
    if wanted_keys:
        resources = list({k.split(":")[0] for k in wanted_keys})
        perms_result = await session.execute(
            select(RbacPermission).where(RbacPermission.resource.in_(resources))
        )
        perm_by_key = {f"{p.resource}:{p.action}": p for p in perms_result.scalars().all()}

    # Resolve granted keys for non-admin roles
    granted_keys: set[str] = set()
    if not is_system_org_admin:
        rp_result = await session.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id == role_id)
        )
        granted_perm_ids = set(rp_result.scalars().all())

        rorg_result = await session.execute(
            select(RoleOrgPermission.permission_id).where(
                RoleOrgPermission.role_id == role_id,
                RoleOrgPermission.org_id == organization_id,
            )
        )
        granted_perm_ids.update(rorg_result.scalars().all())

        for key, perm in perm_by_key.items():
            if perm.id in granted_perm_ids:
                granted_keys.add(key)

    modules_out: list[PermissionModuleOut] = []
    for mod in perm_modules:
        permissions_out: list[PermissionItemOut] = []
        for key in sorted(mod.permission_keys):
            action = key.split(":", 1)[1]
            perm_row = perm_by_key.get(key)
            permissions_out.append(
                PermissionItemOut(
                    id=key,
                    label=_action_to_label(action),
                    description=perm_row.description if perm_row else None,
                    granted=is_system_org_admin or key in granted_keys,
                )
            )
        modules_out.append(
            PermissionModuleOut(
                id=mod.id,
                label=mod.display_label(),
                description=mod.display_description(),
                permissions=permissions_out,
            )
        )

    return GetRolePermissionsOut(data=modules_out, is_system_org_admin=is_system_org_admin)


class PutRolePermissionsRequest(BaseModel):
    permissionIds: list[str]


class CreateOrgUserRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    email: str
    role_id: str | None = Field(default=None, alias="roleId")


class UpdateOrgUserRequest(BaseModel):
    name: str
    status: str | None = None


class AssignRoleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    role_id: UUID = Field(alias="roleId")


@router.put("/roles/{role_id}/permissions")
async def put_role_permissions(
    organization_id: UUID,
    role_id: UUID,
    body: PutRolePermissionsRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    role = await session.get(RbacRole, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=403, detail="Cannot modify system roles")
    # Allow editing global default roles (organization_id=None, is_system=False) or org-owned roles.
    if role.organization_id is not None and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    # Map permission keys (e.g. documents:view) -> permission IDs
    permission_keys = set(body.permissionIds)
    if not permission_keys:
        # Clear all grants.
        await session.execute(
            RoleOrgPermission.__table__.delete().where(
                RoleOrgPermission.role_id == role_id,
                RoleOrgPermission.org_id == organization_id,
            )
        )
        await session.flush()
        return {"success": True}

    resources = set()
    actions = set()
    key_to_parts: dict[str, tuple[str, str]] = {}
    for key in permission_keys:
        r, a = key.split(":", 1)
        resources.add(r)
        actions.add(a)
        key_to_parts[key] = (r, a)

    perms_result = await session.execute(
        select(RbacPermission).where(
            RbacPermission.resource.in_(list(resources)),
            RbacPermission.action.in_(list(actions)),
        )
    )
    perm_rows = perms_result.scalars().all()
    perm_by_key: dict[str, RbacPermission] = {f"{p.resource}:{p.action}": p for p in perm_rows}

    missing = [k for k in permission_keys if k not in perm_by_key]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {missing[:5]}")

    perm_ids = [perm_by_key[k].id for k in permission_keys]

    # Replace grants.
    await session.execute(
        RoleOrgPermission.__table__.delete().where(
            RoleOrgPermission.role_id == role_id,
            RoleOrgPermission.org_id == organization_id,
        )
    )
    for pid in perm_ids:
        session.add(
            RoleOrgPermission(
                role_id=role_id,
                org_id=organization_id,
                permission_id=pid,
            )
        )

    await session.flush()
    return {"success": True}


@router.put("/users/{user_id}")
async def update_org_user(
    organization_id: UUID,
    user_id: UUID,
    body: UpdateOrgUserRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    membership = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
    )
    if not membership.scalars().first():
        raise HTTPException(status_code=404, detail="User not found in this organization")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.name = body.name.strip() or None
    session.add(user)
    await session.flush()
    return {"success": True}


@router.post("/users/{user_id}/roles")
async def assign_user_role(
    organization_id: UUID,
    user_id: UUID,
    body: AssignRoleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    role = await session.get(RbacRole, body.role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if not role.is_system and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in this organization")

    if await _table_exists(session, "user_roles"):
        await session.execute(
            text(
                """
                INSERT INTO user_roles (id, user_id, role_id, organization_id, granted_at, created_at)
                VALUES (gen_random_uuid(), :user_id, :role_id, :org_id, NOW(), NOW())
                ON CONFLICT (user_id, role_id, organization_id) DO NOTHING
                """
            ),
            {"user_id": user_id, "role_id": body.role_id, "org_id": organization_id},
        )

    # Sync membership.role so the JWT role claim reflects the change at next login.
    _SYSTEM_TO_MEMBERSHIP = {
        "org_admin": Role.TENANT_ADMIN.value,
        "tenant_admin": Role.TENANT_ADMIN.value,
        "user": Role.USER.value,
        "viewer": Role.VIEWER.value,
    }
    # System roles: map to the canonical JWT role value. Custom roles: store the
    # role name directly so list_org_users can display it via the fallback path.
    membership.role = _SYSTEM_TO_MEMBERSHIP.get(role.name, Role.USER.value) if role.is_system else role.name
    session.add(membership)

    await session.flush()
    return {"success": True}


@router.delete("/users/{user_id}/roles/{role_id}")
async def remove_user_role(
    organization_id: UUID,
    user_id: UUID,
    role_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
):
    _require_tenant_admin(ctx)
    _ensure_org_context(ctx, organization_id)

    membership_result = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
    )
    membership = membership_result.scalars().first()

    if await _table_exists(session, "user_roles"):
        await session.execute(
            text(
                """
                DELETE FROM user_roles
                WHERE user_id = :user_id
                  AND role_id = :role_id
                  AND organization_id = :org_id
                """
            ),
            {"user_id": user_id, "role_id": role_id, "org_id": organization_id},
        )

    # Reset membership.role to user when a role is removed.
    if membership:
        membership.role = Role.USER.value
        session.add(membership)

    await session.flush()
    return {"success": True}
