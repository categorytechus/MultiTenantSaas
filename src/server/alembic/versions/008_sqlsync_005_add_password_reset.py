"""SQL sync from 005_add_password_reset.sql

Revision ID: s005
Revises: s004
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s005"
down_revision: Union[str, None] = "s004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Add password reset functionality\n-- Migration: 005_add_password_reset.sql\n\n-- Add reset_code and reset_code_expiry columns to users table\nALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(6);\nALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expiry TIMESTAMP WITH TIME ZONE;\n\n-- Add index for faster lookups\nCREATE INDEX IF NOT EXISTS idx_users_reset_code ON users(reset_code, reset_code_expiry);\n\n-- Add comments\nCOMMENT ON COLUMN users.reset_code IS '6-digit password reset code';\nCOMMENT ON COLUMN users.reset_code_expiry IS 'Expiry timestamp for reset code (15 minutes from generation)';"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 005_add_password_reset.sql"
    )
