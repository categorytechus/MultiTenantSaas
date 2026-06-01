"""Remove redundant tenant_admin system role.

The JWT carries role='tenant_admin' for org admins, but the DB system role
that holds all the permission grants is 'org_admin'. Migration 040 added a
second system role called 'tenant_admin' as a workaround; rbac.py now maps
'tenant_admin' → 'org_admin' at the code level so the duplicate is not needed.

This migration:
  1. Moves any role_permissions from tenant_admin to org_admin (idempotent).
  2. Migrates any user_roles assignments to org_admin.
  3. Deletes the tenant_admin system role row.

Revision ID: s040
Revises: s039
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "s040"
down_revision: Union[str, Sequence[str], None] = "s039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_ADMIN_ROLE_ID = "a1111111-1111-1111-1111-111111111111"
_ORG_ADMIN_ROLE_ID    = "e2222222-2222-2222-2222-222222222222"


def upgrade() -> None:
    # 1. Copy any permission grants that org_admin doesn't already have
    op.execute(f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        SELECT gen_random_uuid(), '{_ORG_ADMIN_ROLE_ID}', permission_id, NOW()
        FROM role_permissions
        WHERE role_id = '{_TENANT_ADMIN_ROLE_ID}'
        ON CONFLICT DO NOTHING
    """)

    # 2. Remove tenant_admin permission grants
    op.execute(f"""
        DELETE FROM role_permissions WHERE role_id = '{_TENANT_ADMIN_ROLE_ID}'
    """)

    # 3. Migrate any user_roles entries pointing at tenant_admin → org_admin.
    #    Guard against fresh DBs where user_roles was never created.
    op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user_roles'
            ) THEN
                INSERT INTO user_roles (id, user_id, role_id, organization_id, granted_at, created_at)
                SELECT gen_random_uuid(), user_id, '{_ORG_ADMIN_ROLE_ID}', organization_id, NOW(), NOW()
                FROM user_roles
                WHERE role_id = '{_TENANT_ADMIN_ROLE_ID}'
                ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

                DELETE FROM user_roles WHERE role_id = '{_TENANT_ADMIN_ROLE_ID}';
            END IF;
        END $$;
    """)

    # 4. Remove the tenant_admin system role itself
    op.execute(f"""
        DELETE FROM roles WHERE id = '{_TENANT_ADMIN_ROLE_ID}'
    """)


def downgrade() -> None:
    op.execute(f"""
        INSERT INTO roles (id, name, description, is_system, organization_id, created_at)
        VALUES (
            '{_TENANT_ADMIN_ROLE_ID}',
            'tenant_admin',
            'Organization admin — matched by JWT role claim (restored by downgrade)',
            TRUE,
            NULL,
            NOW()
        )
        ON CONFLICT (id) DO NOTHING
    """)
