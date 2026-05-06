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
from app.core.identity import normalize_email
from app.core.rbac import Role, role_permissions_from_db
from app.core.tenancy import RequestContext, get_required_context
from app.models.org import OrgMembership
from app.models.user import User
from app.models.rbac import RbacPermission, RbacRole, RoleOrgPermission, RolePermission
from app.services.invite_service import create_invite_record, link_query_role

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
    if "*" in perms:
        modules = ["ai_assistant", "documents", "web_urls"]
    else:
        modules_set: set[str] = set()

        if any(p.startswith("ai_assistant:") or p.startswith("agents:") for p in perms):
            modules_set.add("ai_assistant")

        has_documents_view = ("documents:view" in perms) or ("documents:read" in perms)
        if has_documents_view:
            modules_set.add("documents")

        has_web_urls_view = "web_urls:view" in perms
        if has_web_urls_view:
            modules_set.add("web_urls")

        modules = sorted(modules_set)

    return ModulesPayload(data={"modules": modules})


class OrgUserRow(BaseModel):
    id: str
    email: str
    full_name: str | None = None


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
        assigned_roles = roles_by_user.get(str(u.id), [])
        if not assigned_roles and m.role not in {Role.USER.value, Role.TENANT_ADMIN.value, Role.SUPER_ADMIN.value}:
            assigned_roles = [{"id": m.role, "name": m.role, "is_system": False}]
        data.append(
            {
                "id": str(u.id),
                "email": u.email,
                "full_name": u.name,
                "status": "active",
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

    _, plain_token = await create_invite_record(
        session,
        email=email,
        org_id=organization_id,
        invited_by=ctx.user_id,
        role=invite_role_value,
    )
    role_q = link_query_role(Role.USER)
    base = _public_app_base(request)
    set_password_link = (
        f"{base}/auth/signup/{organization_id}"
        f"?token={quote(plain_token, safe='')}"
        f"&email={quote(email, safe='')}"
        f"&role={role_q}"
    )
    await session.flush()
    return {"success": True, "data": {"set_password_link": set_password_link}, "warnings": warnings}


@router.delete("/users/{user_id}")
async def delete_org_user_stub(user_id: UUID):
    _not_implemented()


@router.post("/users/{user_id}/reset-password")
async def reset_user_password_stub(user_id: UUID):
    _not_implemented()


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

    # Local query is fine: roles table is small (base system roles + custom roles).
    # Base system roles are seeded with organization_id=NULL.
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
    if role.organization_id != organization_id:
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
    if role.organization_id != organization_id:
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


_MODULES = {
    "ai_assistant": {
        "label": "AI Assistant",
        "description": "AI assistant tools and chat capabilities.",
        "permissions": [("chat",)],
    },
    "documents": {
        "label": "Documents",
        "description": "Document library and document actions.",
        "permissions": [("view",), ("create",), ("upload",), ("update",), ("delete",)],
    },
    "web_urls": {
        "label": "Web URLs",
        "description": "Manage web URL records and sources.",
        "permissions": [("view",), ("create",), ("update",), ("delete",)],
    },
}


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

    if not role.is_system and role.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    is_system_org_admin = bool(role.is_system and role.name == "org_admin")

    # Fetch permission rows for all module actions we expose.
    wanted_keys: set[str] = set()
    for mod_id, mod_spec in _MODULES.items():
        for (action,) in mod_spec["permissions"]:
            wanted_keys.add(f"{mod_id}:{action}")

    # Load permission descriptions.
    resource_actions = [(k.split(":", 1)[0], k.split(":", 1)[1]) for k in wanted_keys]
    perms_result = await session.execute(
        select(RbacPermission).where(
            (RbacPermission.resource.in_([r for r, _ in resource_actions]))
        )
    )
    perms = perms_result.scalars().all()
    perm_by_key: dict[str, RbacPermission] = {f"{p.resource}:{p.action}": p for p in perms}

    permission_keys_all = sorted(wanted_keys)

    granted_keys: set[str] = set()
    if is_system_org_admin:
        granted_keys = set(permission_keys_all)
    else:
        # System roles: use global role_permissions
        # Custom roles: use role_org_permissions for this org
        rp_result = await session.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id == role_id)
        )
        for permission_id in rp_result.scalars().all():
            # Map permission_id back to permission_key
            perm = next((p for p in perm_by_key.values() if p.id == permission_id), None)
            if perm:
                granted_keys.add(f"{perm.resource}:{perm.action}")

        rorg_result = await session.execute(
            select(RoleOrgPermission.permission_id).where(
                RoleOrgPermission.role_id == role_id,
                RoleOrgPermission.org_id == organization_id,
            )
        )
        for permission_id in rorg_result.scalars().all():
            perm = next((p for p in perm_by_key.values() if p.id == permission_id), None)
            if perm:
                granted_keys.add(f"{perm.resource}:{perm.action}")

    modules_out: list[PermissionModuleOut] = []
    for mod_id in ["documents", "web_urls", "ai_assistant"]:
        mod_spec = _MODULES[mod_id]
        permissions_out: list[PermissionItemOut] = []
        for (action,) in mod_spec["permissions"]:
            perm_key = f"{mod_id}:{action}"
            perm_row = perm_by_key.get(perm_key)
            permissions_out.append(
                PermissionItemOut(
                    id=perm_key,
                    label=_action_to_label(action),
                    description=perm_row.description if perm_row else None,
                    granted=True if is_system_org_admin else perm_key in granted_keys,
                )
            )
        modules_out.append(
            PermissionModuleOut(
                id=mod_id,
                label=mod_spec["label"],
                description=mod_spec["description"],
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
    if role.organization_id != organization_id:
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
    else:
        # Compatibility fallback when user_roles table is unavailable.
        membership.role = role.name
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
    else:
        membership_result = await session.execute(
            select(OrgMembership).where(OrgMembership.org_id == organization_id, OrgMembership.user_id == user_id)
        )
        membership = membership_result.scalars().first()
        if membership:
            membership.role = Role.USER.value
            session.add(membership)

    await session.flush()
    return {"success": True}
