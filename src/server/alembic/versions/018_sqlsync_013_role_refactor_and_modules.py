"""SQL sync from 013_role_refactor_and_modules.sql

Revision ID: s015
Revises: s014
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s015"
down_revision: Union[str, None] = "s014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration 013: Role-based org admin refactor + modules/invite tables\n-- Removes org_admin from users.user_type, makes it a system role per org\n\n-- Step 1: Ensure the org_admin system role exists\nINSERT INTO roles (id, name, description, is_system, organization_id)\nVALUES ('e2222222-2222-2222-2222-222222222222', 'org_admin', 'Organization administrator', true, NULL)\nON CONFLICT (id) DO UPDATE\n  SET name = EXCLUDED.name, description = EXCLUDED.description,\n      is_system = true, organization_id = NULL;\n\n-- Step 2: Backfill user_roles for all existing org_admin users\n-- (ensures every org_admin user has the system role assigned per org)\nINSERT INTO user_roles (id, user_id, role_id, organization_id, granted_at, created_at)\nSELECT\n  gen_random_uuid(),\n  u.id,\n  'e2222222-2222-2222-2222-222222222222',\n  om.organization_id,\n  NOW(),\n  NOW()\nFROM users u\nJOIN organization_members om ON u.id = om.user_id\nWHERE u.user_type = 'org_admin'\nON CONFLICT (user_id, role_id, organization_id) DO NOTHING;\n\n-- Step 3: Downgrade org_admin user_type to 'user'\nUPDATE users SET user_type = 'user' WHERE user_type = 'org_admin';\n\n-- Step 4: Update the CHECK constraint to remove 'org_admin'\nALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;\nALTER TABLE users ADD CONSTRAINT users_user_type_check\n  CHECK (user_type IN ('super_admin', 'user'));\n\n-- Step 5: Add setup_token columns for set-password link flow\nALTER TABLE users\n  ADD COLUMN IF NOT EXISTS setup_token VARCHAR(64),\n  ADD COLUMN IF NOT EXISTS setup_token_expiry TIMESTAMPTZ;\n\nCREATE UNIQUE INDEX IF NOT EXISTS users_setup_token_idx ON users (setup_token)\n  WHERE setup_token IS NOT NULL;\n\n-- Step 6: Create invite_tokens table (for invite → signup links)\nCREATE TABLE IF NOT EXISTS invite_tokens (\n  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  token          VARCHAR(64) UNIQUE NOT NULL,\n  email          CITEXT NOT NULL,\n  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  role           VARCHAR(50) NOT NULL DEFAULT 'user',\n  invited_by     UUID REFERENCES users(id) ON DELETE SET NULL,\n  expires_at     TIMESTAMPTZ NOT NULL,\n  used_at        TIMESTAMPTZ,\n  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE INDEX IF NOT EXISTS invite_tokens_email_idx ON invite_tokens (email);\nCREATE INDEX IF NOT EXISTS invite_tokens_org_id_idx ON invite_tokens (org_id);\n\n-- Step 7: Create org_modules table (super admin assigns modules to orgs)\nCREATE TABLE IF NOT EXISTS org_modules (\n  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  module_id    VARCHAR(50) NOT NULL,\n  assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  UNIQUE (org_id, module_id)\n);\n\nCREATE INDEX IF NOT EXISTS org_modules_org_id_idx ON org_modules (org_id);\n\n-- Step 8: Create role_org_permissions table (org admin assigns sub-permissions to roles)\nCREATE TABLE IF NOT EXISTS role_org_permissions (\n  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,\n  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  permission_id  VARCHAR(50) NOT NULL,\n  granted_by     UUID REFERENCES users(id) ON DELETE SET NULL,\n  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  UNIQUE (role_id, org_id, permission_id)\n);\n\nCREATE INDEX IF NOT EXISTS role_org_permissions_role_org_idx\n  ON role_org_permissions (role_id, org_id);"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 013_role_refactor_and_modules.sql"
    )
