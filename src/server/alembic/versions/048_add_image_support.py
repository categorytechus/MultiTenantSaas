"""Add PDF image extraction support.

Creates:
  - document_images table (stores extracted images with captions)
  - documents.image_count column (for "N images" chip in UI)
  - document_chunks.chunk_type column ('text' | 'image')
  - document_chunks.image_id FK column

Revision ID: 048
Revises: 047
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "048"
down_revision: Union[str, Sequence[str], None] = "047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── document_images table ──────────────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS document_images (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id       UUID        NOT NULL REFERENCES orgs(id),
            document_id  UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            s3_key       TEXT        NOT NULL,
            page_number  INT         NOT NULL,
            image_index  INT         NOT NULL,
            width        INT,
            height       INT,
            format       VARCHAR(10),
            pdf_caption  TEXT,
            model_caption TEXT,
            priority_score FLOAT    NOT NULL DEFAULT 0,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

    # RLS on document_images
    op.execute("ALTER TABLE document_images ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY org_isolation ON document_images
            USING (org_id = current_setting('app.current_org_id')::uuid);
        """
    )

    # Index for fast FK lookups
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_images_document_id ON document_images(document_id);"
    )

    # ── New columns on documents ───────────────────────────────────────────────
    op.execute(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS image_count INT NOT NULL DEFAULT 0;"
    )

    # ── New columns on document_chunks ────────────────────────────────────────
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_type VARCHAR(10) NOT NULL DEFAULT 'text';"
    )
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS image_id UUID REFERENCES document_images(id);"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS image_id;")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS chunk_type;")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS image_count;")
    op.execute("DROP TABLE IF EXISTS document_images CASCADE;")
