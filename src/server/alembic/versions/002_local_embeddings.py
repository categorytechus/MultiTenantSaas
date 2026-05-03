"""switch to local 384-dim embeddings

Revision ID: 002
Revises: 001
Create Date: 2026-05-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Clear existing chunks (all were zero-vector placeholders from the OpenAI fallback)
    op.execute("DELETE FROM document_chunks")
    op.drop_column("document_chunks", "embedding")
    op.add_column("document_chunks", sa.Column("embedding", Vector(384), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM document_chunks")
    op.drop_column("document_chunks", "embedding")
    op.add_column("document_chunks", sa.Column("embedding", Vector(1536), nullable=True))
