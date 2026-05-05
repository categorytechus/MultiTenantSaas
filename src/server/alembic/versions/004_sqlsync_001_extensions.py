"""SQL sync from 001_extensions.sql

Revision ID: s001
Revises: 003
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s001"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = '-- Enable required PostgreSQL extensions\n-- Migration: 001_extensions.sql\n\n-- UUID generation\nCREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n\n-- Vector similarity search for AI features\nCREATE EXTENSION IF NOT EXISTS "vector";\n\n-- Cryptographic functions\nCREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n-- Case-insensitive text\nCREATE EXTENSION IF NOT EXISTS "citext";\n\n-- Additional timestamp functions\nCREATE EXTENSION IF NOT EXISTS "btree_gist";\n\n-- Verify extensions are enabled\nSELECT extname, extversion FROM pg_extension \nWHERE extname IN (\'uuid-ossp\', \'vector\', \'pgcrypto\', \'citext\', \'btree_gist\');'


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 001_extensions.sql"
    )
