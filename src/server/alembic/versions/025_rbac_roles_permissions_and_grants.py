"""RBAC roles/permissions catalog for FastAPI admin UIs.

Creates:
- roles
- permissions
- role_permissions (global grants for system roles)
- role_org_permissions (per-org grants for custom roles)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
import uuid as uuid_lib

revision: str = "s022"
down_revision: Union[str, None] = "s021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ORG_ADMIN_ROLE_ID = "e2222222-2222-2222-2222-222222222222"
_USER_ROLE_ID = "f3333333-3333-3333-3333-333333333333"

_PERM_IDS = {
    # AI assistant
    "ai_assistant:chat": "a0000000-0000-0000-0000-000000000001",
    # Documents
    "documents:view": "b0000000-0000-0000-0000-000000000001",
    "documents:create": "b0000000-0000-0000-0000-000000000002",
    "documents:update": "b0000000-0000-0000-0000-000000000003",
    "documents:delete": "b0000000-0000-0000-0000-000000000004",
    "documents:upload": "b0000000-0000-0000-0000-000000000005",
    # Web URLs
    "web_urls:view": "c0000000-0000-0000-0000-000000000001",
    "web_urls:create": "c0000000-0000-0000-0000-000000000002",
    "web_urls:update": "c0000000-0000-0000-0000-000000000003",
    "web_urls:delete": "c0000000-0000-0000-0000-000000000004",
}


def _split_key(key: str) -> tuple[str, str]:
    resource, action = key.split(":", 1)
    return resource, action


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("organization_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["organization_id"], ["orgs.id"], name="fk_roles_organization_id_orgs"),
    )
    op.create_index("ix_roles_organization_id", "roles", ["organization_id"])
    op.create_index("ix_roles_is_system", "roles", ["is_system"])

    op.create_table(
        "permissions",
        sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
        sa.Column("resource", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("resource", "action", name="uq_permissions_resource_action"),
    )
    op.create_index("ix_permissions_resource", "permissions", ["resource"])

    op.create_table(
        "role_permissions",
        sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
        sa.Column("role_id", sa.UUID(), nullable=False),
        sa.Column("permission_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], name="fk_role_permissions_role_id_roles"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], name="fk_role_permissions_permission_id_permissions"),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_permission"),
    )
    op.create_index("ix_role_permissions_role_id", "role_permissions", ["role_id"])

    op.create_table(
        "role_org_permissions",
        sa.Column("id", sa.UUID(), nullable=False, primary_key=True),
        sa.Column("role_id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("permission_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], name="fk_role_org_permissions_role_id_roles"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], name="fk_role_org_permissions_org_id_orgs"),
        sa.ForeignKeyConstraint(
            ["permission_id"], ["permissions.id"], name="fk_role_org_permissions_permission_id_permissions"
        ),
        sa.UniqueConstraint("role_id", "org_id", "permission_id", name="uq_role_org_permissions_role_org_permission"),
    )
    op.create_index("ix_role_org_permissions_role_id", "role_org_permissions", ["role_id"])
    op.create_index("ix_role_org_permissions_org_id", "role_org_permissions", ["org_id"])

    # Seed system roles
    op.execute(
        f"""
        INSERT INTO roles (id, name, description, is_system, organization_id, created_at)
        VALUES
          ('{_ORG_ADMIN_ROLE_ID}', 'org_admin', 'Organization administrator (system role)', TRUE, NULL, NOW()),
          ('{_USER_ROLE_ID}', 'user', 'Tenant user (system role)', TRUE, NULL, NOW())
        ON CONFLICT (id) DO NOTHING;
        """
    )

    # Seed permission catalog (permission IDs are fixed for UI compatibility)
    # Note: UI expects ids like `${resource}:${action}`; the API will compute that from resource/action.
    permission_inserts: list[str] = []
    for key, pid in _PERM_IDS.items():
        resource, action = _split_key(key)
        label = action.replace("_", " ").title()
        if key.startswith("ai_assistant:"):
            label = "Chat"
        if key.startswith("documents:") and action == "create":
            label = "Create"
        if key.startswith("documents:") and action == "upload":
            label = "Upload"
        description = f"{resource.replace('_', ' ').title()} {label} permission"
        permission_inserts.append(f"('{pid}', '{resource}', '{action}', '{description}', NOW())")

    op.execute(
        """
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
        """
        + ",\n".join(permission_inserts)
        + """
        ON CONFLICT (id) DO NOTHING;
        """
    )

    # Grant document + chat basics for system roles.
    # org_admin: full access (all seeded permissions)
    org_admin_permission_ids = list(_PERM_IDS.values())
    org_admin_values: list[str] = []
    for perm_id in org_admin_permission_ids:
        rp_id = str(uuid_lib.uuid4())
        org_admin_values.append(
            f"('{rp_id}'::uuid, '{_ORG_ADMIN_ROLE_ID}'::uuid, '{perm_id}'::uuid, NOW())"
        )

    op.execute(
        f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        VALUES
        {',\n        '.join(org_admin_values)}
        ON CONFLICT DO NOTHING;
        """
    )

    # user: subset (documents view/create/upload + ai_assistant chat)
    user_perm_keys = ["documents:view", "documents:create", "documents:upload", "ai_assistant:chat"]
    user_perm_ids = [_PERM_IDS[k] for k in user_perm_keys]
    user_values: list[str] = []
    for perm_id in user_perm_ids:
        rp_id = str(uuid_lib.uuid4())
        user_values.append(
            f"('{rp_id}'::uuid, '{_USER_ROLE_ID}'::uuid, '{perm_id}'::uuid, NOW())"
        )

    op.execute(
        f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        VALUES
        {',\n        '.join(user_values)}
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s022.")

