from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class RbacRole(SQLModel, table=True):
    """
    RBAC role catalog (system roles + per-org custom roles).

    Note: table name is `roles` to match the older Express migrations/schema.
    """

    __tablename__ = "roles"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    name: str = Field(nullable=False, index=True)
    description: str | None = Field(default=None)
    is_system: bool = Field(default=False)
    organization_id: UUID | None = Field(default=None, foreign_key="orgs.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RbacPermission(SQLModel, table=True):
    """
    Permission catalog (resource + action).

    Permission IDs returned to the UI are computed as `${resource}:${action}`.
    """

    __tablename__ = "permissions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    resource: str = Field(nullable=False, index=True)
    action: str = Field(nullable=False, index=True)
    description: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RolePermission(SQLModel, table=True):
    """Global (org-independent) permission grants for system roles."""

    __tablename__ = "role_permissions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    role_id: UUID = Field(foreign_key="roles.id", nullable=False, index=True)
    permission_id: UUID = Field(foreign_key="permissions.id", nullable=False, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RoleOrgPermission(SQLModel, table=True):
    """Per-org permission grants for custom roles."""

    __tablename__ = "role_org_permissions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    role_id: UUID = Field(foreign_key="roles.id", nullable=False, index=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    permission_id: UUID = Field(foreign_key="permissions.id", nullable=False, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

