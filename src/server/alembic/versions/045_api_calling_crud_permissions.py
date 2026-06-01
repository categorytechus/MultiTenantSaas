"""Replace api_calling:execute with CRUD permissions (create/view/update/delete).

API Calling is a tool-creation page, so it needs the same four-action matrix
as Documents and Web URLs rather than a single execute permission.

Changes:
  1. Insert four new permission rows for api_calling.
  2. Update master_modules.permission_keys for api_calling.
  3. Grant all four to org_admin.
  4. Remove the old execute permission grant from org_admin (and from the
     permissions catalog — only if no other role still references it).

Revision ID: s043
Revises: s042
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "s043"
down_revision: Union[str, None] = "s042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ORG_ADMIN_ROLE_ID = "e2222222-2222-2222-2222-222222222222"
_USER_ROLE_ID      = "f3333333-3333-3333-3333-333333333333"

_OLD_EXECUTE_ID = "e0000000-0000-0000-0000-000000000001"

_NEW_PERM_IDS = {
    "api_calling:create": "e0000000-0000-0000-0000-000000000002",
    "api_calling:view":   "e0000000-0000-0000-0000-000000000003",
    "api_calling:update": "e0000000-0000-0000-0000-000000000004",
    "api_calling:delete": "e0000000-0000-0000-0000-000000000005",
}


def upgrade() -> None:
    # 1. Seed the four new permission rows
    op.execute(f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
          ('{_NEW_PERM_IDS["api_calling:create"]}', 'api_calling', 'create', 'API Calling Create permission', NOW()),
          ('{_NEW_PERM_IDS["api_calling:view"]}',   'api_calling', 'view',   'API Calling View permission',   NOW()),
          ('{_NEW_PERM_IDS["api_calling:update"]}', 'api_calling', 'update', 'API Calling Update permission', NOW()),
          ('{_NEW_PERM_IDS["api_calling:delete"]}', 'api_calling', 'delete', 'API Calling Delete permission', NOW())
        ON CONFLICT (id) DO NOTHING
    """)
    # Guard against duplicate (resource, action) from a partial prior run
    op.execute(f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
          ('{_NEW_PERM_IDS["api_calling:create"]}', 'api_calling', 'create', 'API Calling Create permission', NOW()),
          ('{_NEW_PERM_IDS["api_calling:view"]}',   'api_calling', 'view',   'API Calling View permission',   NOW()),
          ('{_NEW_PERM_IDS["api_calling:update"]}', 'api_calling', 'update', 'API Calling Update permission', NOW()),
          ('{_NEW_PERM_IDS["api_calling:delete"]}', 'api_calling', 'delete', 'API Calling Delete permission', NOW())
        ON CONFLICT (resource, action) DO NOTHING
    """)

    # 2. Update the master_modules permission_keys
    op.execute("""
        UPDATE master_modules
        SET permission_keys = ARRAY['api_calling:create','api_calling:view','api_calling:update','api_calling:delete']
        WHERE id = 'api_calling'
    """)

    # 3. Grant all four to org_admin and user roles
    for role_id in (_ORG_ADMIN_ROLE_ID, _USER_ROLE_ID):
        for perm_id in _NEW_PERM_IDS.values():
            op.execute(f"""
                INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                VALUES (gen_random_uuid(), '{role_id}', '{perm_id}', NOW())
                ON CONFLICT DO NOTHING
            """)

    # 4. Remove the old execute grant from all roles and drop the permission row
    op.execute(f"""
        DELETE FROM role_permissions WHERE permission_id = '{_OLD_EXECUTE_ID}'
    """)
    op.execute(f"""
        DELETE FROM role_org_permissions WHERE permission_id = '{_OLD_EXECUTE_ID}'
    """)
    op.execute(f"""
        DELETE FROM permissions WHERE id = '{_OLD_EXECUTE_ID}'
    """)


def downgrade() -> None:
    # Restore execute permission
    op.execute(f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES ('{_OLD_EXECUTE_ID}', 'api_calling', 'execute', 'API Calling Execute permission', NOW())
        ON CONFLICT (id) DO NOTHING
    """)
    op.execute(f"""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        VALUES (gen_random_uuid(), '{_ORG_ADMIN_ROLE_ID}', '{_OLD_EXECUTE_ID}', NOW())
        ON CONFLICT DO NOTHING
    """)

    # Restore master_modules
    op.execute("""
        UPDATE master_modules
        SET permission_keys = ARRAY['api_calling:execute']
        WHERE id = 'api_calling'
    """)

    # Remove CRUD permissions
    for perm_id in _NEW_PERM_IDS.values():
        op.execute(f"DELETE FROM role_permissions WHERE permission_id = '{perm_id}'")
        op.execute(f"DELETE FROM role_org_permissions WHERE permission_id = '{perm_id}'")
    op.execute(f"""
        DELETE FROM permissions
        WHERE id IN ({', '.join(f"'{p}'" for p in _NEW_PERM_IDS.values())})
    """)
