from enum import Enum
from typing import Set

from fastapi import Depends, HTTPException, status


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


def authorize(permission: str) -> Depends:
    """
    FastAPI dependency factory for permission-based authorization.

    Usage:
        @router.get("/")
        async def list_users(ctx: RequestContext = authorize("users:read")):
            ...
    """
    from app.core.tenancy import RequestContext, get_required_context

    async def dep(ctx: RequestContext = Depends(get_required_context)) -> RequestContext:
        if not has_permission(ctx.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} required",
            )
        return ctx

    return Depends(dep)
