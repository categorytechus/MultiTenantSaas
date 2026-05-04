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


def _table_exists(table: str) -> bool:
    conn = op.get_bind()
    return conn.execute(
        sa.text(
            "SELECT to_regclass('public.' || :t) IS NOT NULL"
        ),
        {"t": table},
    ).scalar()


def upgrade() -> None:
    if not _table_exists("document_chunks"):
        # Migration 001 ran as a no-op on this DB — skip; 001 will be re-applied
        # by the caller after a downgrade base + upgrade head cycle.
        raise RuntimeError(
            "Table 'document_chunks' does not exist. "
            "Migration 001 was previously empty. "
            "Reset the migration state and retry:\n\n"
            "  cd src/server && uv run alembic downgrade base\n"
            "  make migrate"
        )

    op.execute("DELETE FROM document_chunks")
    op.execute("DROP INDEX IF EXISTS document_chunks_embedding_idx")
    op.drop_column("document_chunks", "embedding")
    op.add_column("document_chunks", sa.Column("embedding", Vector(384), nullable=True))
    op.execute(
        "CREATE INDEX document_chunks_embedding_idx ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DELETE FROM document_chunks")
    op.execute("DROP INDEX IF EXISTS document_chunks_embedding_idx")
    op.drop_column("document_chunks", "embedding")
    op.add_column("document_chunks", sa.Column("embedding", Vector(1536), nullable=True))
    op.execute(
        "CREATE INDEX document_chunks_embedding_idx ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )
