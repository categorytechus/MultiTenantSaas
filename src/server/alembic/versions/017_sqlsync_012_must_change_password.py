"""SQL sync from 012_must_change_password.sql

Revision ID: s014
Revises: s013
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s014"
down_revision: Union[str, None] = "s013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = '-- Migration: 012_must_change_password.sql\n-- Adds must_change_password flag and token_version for session invalidation\n\nALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;\n\n-- token_version is included in JWT payload; bumping it invalidates all existing tokens\n-- without requiring Redis or a token blacklist\nALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;\n\nCREATE INDEX IF NOT EXISTS idx_users_must_change_password ON users(must_change_password) WHERE must_change_password = true;'


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 012_must_change_password.sql"
    )
