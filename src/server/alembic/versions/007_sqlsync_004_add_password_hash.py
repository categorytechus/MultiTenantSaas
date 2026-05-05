"""SQL sync from 004_add_password_hash.sql

Revision ID: s004
Revises: s003
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s004"
down_revision: Union[str, None] = "s003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Add password_hash column to users table for self-hosted authentication\n-- Migration: 004_add_password_hash.sql\n\n-- Add password_hash column (nullable for backward compatibility)\nALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);\n\n-- Add index on password_hash for performance\nCREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);\n\n-- Add comment\nCOMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password for local authentication';\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 004_add_password_hash.sql"
    )
