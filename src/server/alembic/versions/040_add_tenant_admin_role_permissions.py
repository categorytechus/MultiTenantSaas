"""Seed tenant_admin system role with full permissions.

The JWT role claim for org admins is 'tenant_admin', but only 'org_admin'
existed as a system role in the DB, causing role_permissions_from_db to find
nothing and return an empty permission set (→ 403 on all protected routes).

Revision ID: s038
Revises: s037
Create Date: 2026-05-28

"""
from typing import Sequence, Union

import uuid as uuid_lib
from alembic import op

revision: str = "s038"
down_revision: Union[str, Sequence[str], None] = "s037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_ADMIN_ROLE_ID = "a1111111-1111-1111-1111-111111111111"

# Must match the IDs already seeded in migration s022 (025_rbac_roles_permissions_and_grants.py)
_ALL_PERM_IDS = [
    "a0000000-0000-0000-0000-000000000001",  # ai_assistant:chat
    "b0000000-0000-0000-0000-000000000001",  # documents:view
    "b0000000-0000-0000-0000-000000000002",  # documents:create
    "b0000000-0000-0000-0000-000000000003",  # documents:update
    "b0000000-0000-0000-0000-000000000004",  # documents:delete
    "b0000000-0000-0000-0000-000000000005",  # documents:upload
    "c0000000-0000-0000-0000-000000000001",  # web_urls:view
    "c0000000-0000-0000-0000-000000000002",  # web_urls:create
    "c0000000-0000-0000-0000-000000000003",  # web_urls:update
    "c0000000-0000-0000-0000-000000000004",  # web_urls:delete
]


def upgrade() -> None:
    # Insert tenant_admin system role (idempotent)
    op.execute(
        f"""
        INSERT INTO roles (id, name, description, is_system, organization_id, created_at)
        VALUES (
            '{_TENANT_ADMIN_ROLE_ID}',
            'tenant_admin',
            'Organization admin — matched by JWT role claim',
            TRUE,
            NULL,
            NOW()
        )
        ON CONFLICT (id) DO NOTHING;
        """
    )

    # Ensure permissions exist (they should from s022, but guard against fresh DBs)
    op.execute(
        """
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
          ('a0000000-0000-0000-0000-000000000001', 'ai_assistant', 'chat',   'AI Assistant Chat permission',      NOW()),
          ('b0000000-0000-0000-0000-000000000001', 'documents',    'view',   'Documents View permission',         NOW()),
          ('b0000000-0000-0000-0000-000000000002', 'documents',    'create', 'Documents Create permission',       NOW()),
          ('b0000000-0000-0000-0000-000000000003', 'documents',    'update', 'Documents Update permission',       NOW()),
          ('b0000000-0000-0000-0000-000000000004', 'documents',    'delete', 'Documents Delete permission',       NOW()),
          ('b0000000-0000-0000-0000-000000000005', 'documents',    'upload', 'Documents Upload permission',       NOW()),
          ('c0000000-0000-0000-0000-000000000001', 'web_urls',     'view',   'Web URLs View permission',          NOW()),
          ('c0000000-0000-0000-0000-000000000002', 'web_urls',     'create', 'Web URLs Create permission',        NOW()),
          ('c0000000-0000-0000-0000-000000000003', 'web_urls',     'update', 'Web URLs Update permission',        NOW()),
          ('c0000000-0000-0000-0000-000000000004', 'web_urls',     'delete', 'Web URLs Delete permission',        NOW())
        ON CONFLICT (id) DO NOTHING;
        """
    )

    # Grant all permissions to tenant_admin
    values = ",\n        ".join(
        f"('{uuid_lib.uuid4()}'::uuid, '{_TENANT_ADMIN_ROLE_ID}'::uuid, '{pid}'::uuid, NOW())"
        for pid in _ALL_PERM_IDS
    )
    op.execute(
        f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        VALUES
        {values}
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM role_permissions WHERE role_id = '{_TENANT_ADMIN_ROLE_ID}'")
    op.execute(f"DELETE FROM roles WHERE id = '{_TENANT_ADMIN_ROLE_ID}'")
