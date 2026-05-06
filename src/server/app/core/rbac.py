from enum import Enum
from typing import Set
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select


class Role(str, Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    USER = "user"
    VIEWER = "viewer"


ROLE_PERMISSIONS: dict[Role, Set[str]] = {
    Role.SUPER_ADMIN: {"*"},
    Role.TENANT_ADMIN: {
        "users:read",
        "users:invite",
        "users:update",
        "documents:upload",
        "documents:read",
        "documents:delete",
        "agents:execute",
        "agents:read",
        "audit_logs:read",
        "tenants:update",
    },
    Role.USER: {
        "documents:upload",
        "documents:read",
        "agents:execute",
        "agents:read",
    },
    Role.VIEWER: {"documents:read", "agents:read"},
}


def has_permission(role: Role | str | None, permission: str) -> bool:
    """
    Check if a role has a given permission.
    Handles the '*' wildcard for SUPER_ADMIN.
    """
    if role is None:
        return False
    try:
        role_enum = Role(role) if not isinstance(role, Role) else role
    except ValueError:
        return False

    perms = ROLE_PERMISSIONS.get(role_enum, set())
    if "*" in perms:
        return True
    return permission in perms


async def role_permissions_from_db(
    session: AsyncSession,
    *,
    role: Role | str | None,
    org_id: UUID | None,
) -> set[str]:
    """
    Resolve effective permission keys (`resource:action`) for a role.

    Source of truth is DB tables seeded/migrated from RBAC schema.
    Falls back to static ROLE_PERMISSIONS if tables are unavailable.
    """
    if role is None:
        return set()

    # Preserve super admin wildcard behavior globally.
    if role == Role.SUPER_ADMIN or role == Role.SUPER_ADMIN.value:
        return {"*"}

    role_name = role.value if isinstance(role, Role) else str(role)

    try:
        from app.models.rbac import RbacPermission, RbacRole, RoleOrgPermission, RolePermission

        # Current architecture stores role in JWT as a system role string.
        rr = await session.execute(
            select(RbacRole).where(
                RbacRole.name == role_name,
                RbacRole.is_system == True,  # noqa: E712
                RbacRole.organization_id == None,  # noqa: E711
            )
        )
        role_row = rr.scalars().first()
        if not role_row:
            return set()

        granted_perm_ids: set[UUID] = set()

        global_grants = await session.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id == role_row.id)
        )
        granted_perm_ids.update(global_grants.scalars().all())

        # Custom per-org grants for non-system roles / overrides.
        if org_id is not None:
            org_grants = await session.execute(
                select(RoleOrgPermission.permission_id).where(
                    RoleOrgPermission.role_id == role_row.id,
                    RoleOrgPermission.org_id == org_id,
                )
            )
            granted_perm_ids.update(org_grants.scalars().all())

        if not granted_perm_ids:
            return set()

        perms = await session.execute(
            select(RbacPermission).where(RbacPermission.id.in_(list(granted_perm_ids)))
        )
        return {f"{p.resource}:{p.action}" for p in perms.scalars().all()}
    except Exception:
        # Compatibility fallback: keeps API usable if RBAC tables are not present.
        return {
            p.replace("documents:read", "documents:view").replace("agents:execute", "ai_assistant:chat")
            for p in ROLE_PERMISSIONS.get(Role(role_name), set())
        } if role_name in {r.value for r in Role} else set()


async def has_permission_db(
    session: AsyncSession,
    *,
    role: Role | str | None,
    org_id: UUID | None,
    permission: str,
) -> bool:
    # Backward-compatible aliases while transitioning from static to DB-backed catalog.
    permission_aliases = {
        "documents:read": "documents:view",
    }
    requested = permission_aliases.get(permission, permission)

    perms = await role_permissions_from_db(session, role=role, org_id=org_id)
    if "*" in perms:
        return True
    return requested in perms


def authorize(permission: str) -> Depends:
    """
    FastAPI dependency factory for permission-based authorization.

    Usage:
        @router.get("/")
        async def list_users(ctx: RequestContext = authorize("users:read")):
            ...
    """
    from app.core.db import get_db
    from app.core.tenancy import RequestContext, get_required_context

    async def dep(
        ctx: RequestContext = Depends(get_required_context),
        session: AsyncSession = Depends(get_db),
    ) -> RequestContext:
        if not await has_permission_db(
            session,
            role=ctx.role,
            org_id=ctx.org_id,
            permission=permission,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} required",
            )
        return ctx

    return Depends(dep)
