"""add source_url and document_type to documents

Revision ID: 004
Revises: 003
Create Date: 2026-05-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Allow s3_key to be NULL for URL-sourced documents
    op.alter_column("documents", "s3_key", existing_type=sa.Text(), nullable=True)
    # New columns for web URL ingestion
    op.add_column("documents", sa.Column("source_url", sa.Text(), nullable=True))
    op.add_column(
        "documents",
        sa.Column("document_type", sa.String(16), nullable=False, server_default="file"),
    )


def downgrade() -> None:
    op.drop_column("documents", "document_type")
    op.drop_column("documents", "source_url")
    op.alter_column("documents", "s3_key", existing_type=sa.Text(), nullable=False)
