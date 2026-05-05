"""SQL sync from 011_user_type_and_management.sql

Revision ID: s013
Revises: s012
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s013"
down_revision: Union[str, None] = "s012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration: 011_user_type_and_management.sql\n-- Adds user_type to users table and backfills from existing RBAC roles\n\n-- =============================================================================\n-- ADD user_type COLUMN TO users TABLE\n-- =============================================================================\n\nALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) NOT NULL DEFAULT 'user'\n  CHECK (user_type IN ('super_admin', 'org_admin', 'user'));\n\nCREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);\n\n-- =============================================================================\n-- BACKFILL user_type FROM EXISTING RBAC DATA\n-- =============================================================================\n\n-- Promote users who hold the system super_admin RBAC role\nUPDATE users u\nSET user_type = 'super_admin'\nWHERE EXISTS (\n  SELECT 1 FROM user_roles ur\n  JOIN roles r ON ur.role_id = r.id\n  WHERE ur.user_id = u.id\n    AND r.name = 'super_admin'\n    AND r.is_system = true\n);\n\n-- Promote users who hold the system org_admin RBAC role (skip already-promoted super_admins)\nUPDATE users u\nSET user_type = 'org_admin'\nWHERE u.user_type = 'user'\n  AND EXISTS (\n    SELECT 1 FROM user_roles ur\n    JOIN roles r ON ur.role_id = r.id\n    WHERE ur.user_id = u.id\n      AND r.name = 'org_admin'\n      AND r.is_system = true\n  );\n\n-- Also promote users who are 'admin' in organization_members (catches legacy seed data)\nUPDATE users u\nSET user_type = 'org_admin'\nWHERE u.user_type = 'user'\n  AND EXISTS (\n    SELECT 1 FROM organization_members om\n    WHERE om.user_id = u.id AND om.role IN ('admin', 'org_admin')\n  );\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 011_user_type_and_management.sql"
    )
