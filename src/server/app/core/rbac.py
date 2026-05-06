from enum import Enum
from typing import Set
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
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
    user_id: UUID | None = None,
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
        granted_perm_ids: set[UUID] = set()
        role_ids_to_check: set[UUID] = set()

        if role_row:
            role_ids_to_check.add(role_row.id)

        if user_id is not None and org_id is not None:
            user_roles_exists = await session.execute(text("SELECT to_regclass('public.user_roles')"))
            if user_roles_exists.scalar_one_or_none() is not None:
                assigned = await session.execute(
                    text(
                        """
                        SELECT role_id
                        FROM user_roles
                        WHERE user_id = :user_id
                          AND organization_id = :org_id
                        """
                    ),
                    {"user_id": user_id, "org_id": org_id},
                )
                for row in assigned:
                    role_ids_to_check.add(row.role_id)

            # Compatibility path: also honor org_memberships.role when set to a custom role name.
            from app.models.org import OrgMembership

            membership_result = await session.execute(
                select(OrgMembership.role).where(
                    OrgMembership.user_id == user_id,
                    OrgMembership.org_id == org_id,
                )
            )
            membership_role_name = membership_result.scalar_one_or_none()
            if membership_role_name:
                membership_role = await session.execute(
                    select(RbacRole).where(
                        RbacRole.name == membership_role_name,
                        (
                            (RbacRole.is_system == True)  # noqa: E712
                            | (RbacRole.organization_id == org_id)
                        ),
                    )
                )
                membership_role_row = membership_role.scalars().first()
                if membership_role_row:
                    role_ids_to_check.add(membership_role_row.id)

        if not role_ids_to_check:
            return set()

        global_grants = await session.execute(
            select(RolePermission.permission_id).where(RolePermission.role_id.in_(list(role_ids_to_check)))
        )
        granted_perm_ids.update(global_grants.scalars().all())

        # Custom per-org grants for non-system roles / overrides.
        if org_id is not None:
            org_grants = await session.execute(
                select(RoleOrgPermission.permission_id).where(
                    RoleOrgPermission.role_id.in_(list(role_ids_to_check)),
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
    user_id: UUID | None,
    permission: str,
) -> bool:
    # Backward-compatible aliases while transitioning from static to DB-backed catalog.
    permission_aliases = {
        "documents:read": "documents:view",
    }
    requested = permission_aliases.get(permission, permission)

    perms = await role_permissions_from_db(session, role=role, org_id=org_id, user_id=user_id)
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
            user_id=ctx.user_id,
            permission=permission,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} required",
            )
        return ctx

    return Depends(dep)
