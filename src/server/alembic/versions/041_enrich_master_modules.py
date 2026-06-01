"""Enrich master_modules with label, description, parent_id, sort_order, permission_keys.

Backfills all existing module rows and seeds missing permission rows + tenant_admin grants
for modules that previously had no entries in the permissions table.

Revision ID: s039
Revises: s038
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "s039"
down_revision: Union[str, Sequence[str], None] = "s038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_ADMIN_ROLE_ID = "a1111111-1111-1111-1111-111111111111"
_ORG_ADMIN_ROLE_ID    = "e2222222-2222-2222-2222-222222222222"

# Deterministic permission IDs (prefix-based, fixed for all envs)
_PERM_IDS = {
    "cost_seg:read":      "d0000000-0000-0000-0000-000000000001",
    "cost_seg:create":    "d0000000-0000-0000-0000-000000000002",
    "cost_seg:delete":    "d0000000-0000-0000-0000-000000000003",
    "api_calling:execute":"e0000000-0000-0000-0000-000000000001",
}


def upgrade() -> None:
    # ── 1. Add new columns to master_modules ──────────────────────────────────
    op.execute("""
        ALTER TABLE master_modules
          ADD COLUMN IF NOT EXISTS label           VARCHAR(120),
          ADD COLUMN IF NOT EXISTS description     TEXT,
          ADD COLUMN IF NOT EXISTS parent_id       VARCHAR(50) REFERENCES master_modules(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS sort_order      INTEGER NOT NULL DEFAULT 100,
          ADD COLUMN IF NOT EXISTS permission_keys TEXT[]  NOT NULL DEFAULT '{}'
    """)

    # ── 2. Backfill module metadata ───────────────────────────────────────────
    op.execute("""
        UPDATE master_modules SET
          label           = 'AI Assistant',
          description     = 'AI assistant tools and chat capabilities.',
          parent_id       = NULL,
          sort_order      = 10,
          permission_keys = ARRAY['ai_assistant:chat']
        WHERE id = 'ai_assistant'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Images',
          description     = 'Image embedding in chat.',
          parent_id       = 'ai_assistant',
          sort_order      = 11,
          permission_keys = '{}'
        WHERE id = 'ai_images'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Links',
          description     = 'Link embeddings in chat.',
          parent_id       = 'ai_assistant',
          sort_order      = 12,
          permission_keys = '{}'
        WHERE id = 'ai_links'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Report Generation',
          description     = 'Generate PDF reports in chat.',
          parent_id       = 'ai_assistant',
          sort_order      = 13,
          permission_keys = '{}'
        WHERE id = 'report_generation'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Cost Segregation',
          description     = 'IRS MACRS cost segregation classification.',
          parent_id       = NULL,
          sort_order      = 20,
          permission_keys = ARRAY['cost_seg:read','cost_seg:create','cost_seg:delete']
        WHERE id = 'cost_seg'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Documents',
          description     = 'Document library and document actions.',
          parent_id       = NULL,
          sort_order      = 30,
          permission_keys = ARRAY['documents:view','documents:create','documents:upload','documents:update','documents:delete']
        WHERE id = 'documents'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'Web URLs',
          description     = 'Manage web URL records and sources.',
          parent_id       = NULL,
          sort_order      = 40,
          permission_keys = ARRAY['web_urls:view','web_urls:create','web_urls:update','web_urls:delete']
        WHERE id = 'web_urls'
    """)
    op.execute("""
        UPDATE master_modules SET
          label           = 'API Calling',
          description     = 'Enable outbound API actions and webhook integrations.',
          parent_id       = NULL,
          sort_order      = 50,
          permission_keys = ARRAY['api_calling:execute']
        WHERE id = 'api_calling'
    """)

    # ── 3. Seed missing permission rows (idempotent) ──────────────────────────
    op.execute(f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
          ('{_PERM_IDS["cost_seg:read"]}',      'cost_seg',    'read',    'Cost Segregation Read permission',    NOW()),
          ('{_PERM_IDS["cost_seg:create"]}',    'cost_seg',    'create',  'Cost Segregation Create permission',  NOW()),
          ('{_PERM_IDS["cost_seg:delete"]}',    'cost_seg',    'delete',  'Cost Segregation Delete permission',  NOW()),
          ('{_PERM_IDS["api_calling:execute"]}','api_calling',  'execute', 'API Calling Execute permission',      NOW())
        ON CONFLICT (id) DO NOTHING
    """)

    # Ensure no duplicate (resource, action) rows exist under different IDs
    op.execute(f"""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES
          ('{_PERM_IDS["cost_seg:read"]}',      'cost_seg',   'read',    'Cost Segregation Read permission',    NOW()),
          ('{_PERM_IDS["cost_seg:create"]}',    'cost_seg',   'create',  'Cost Segregation Create permission',  NOW()),
          ('{_PERM_IDS["cost_seg:delete"]}',    'cost_seg',   'delete',  'Cost Segregation Delete permission',  NOW()),
          ('{_PERM_IDS["api_calling:execute"]}','api_calling', 'execute', 'API Calling Execute permission',      NOW())
        ON CONFLICT (resource, action) DO NOTHING
    """)

    # ── 4. Grant new permissions to tenant_admin + org_admin ─────────────────
    for role_id in (_TENANT_ADMIN_ROLE_ID, _ORG_ADMIN_ROLE_ID):
        for perm_id in _PERM_IDS.values():
            op.execute(f"""
                INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                VALUES (gen_random_uuid(), '{role_id}', '{perm_id}', NOW())
                ON CONFLICT DO NOTHING
            """)


def downgrade() -> None:
    op.execute("ALTER TABLE master_modules DROP COLUMN IF EXISTS permission_keys")
    op.execute("ALTER TABLE master_modules DROP COLUMN IF EXISTS sort_order")
    op.execute("ALTER TABLE master_modules DROP COLUMN IF EXISTS parent_id")
    op.execute("ALTER TABLE master_modules DROP COLUMN IF EXISTS description")
    op.execute("ALTER TABLE master_modules DROP COLUMN IF EXISTS label")
