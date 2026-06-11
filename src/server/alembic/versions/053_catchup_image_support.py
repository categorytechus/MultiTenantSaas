"""catch up image support DDL missed due to migration renumbering

Revision ID: 053
Revises: 052
Create Date: 2026-06-11

The real 048_add_image_support and 049_add_image_content_hash migrations were
never applied to this DB because the old 048_ruleset_org_id / 049_cleanup_orphaned_users
had already consumed those revision IDs. This migration applies the missing DDL.
"""
from alembic import op
import sqlalchemy as sa

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade():
    # ── document_images table (from 048_add_image_support) ────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS document_images (
            id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id        UUID        NOT NULL REFERENCES orgs(id),
            document_id   UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            s3_key        TEXT        NOT NULL,
            page_number   INT         NOT NULL,
            image_index   INT         NOT NULL,
            width         INT,
            height        INT,
            format        VARCHAR(10),
            pdf_caption   TEXT,
            model_caption TEXT,
            priority_score FLOAT     NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("ALTER TABLE document_images ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'document_images' AND policyname = 'org_isolation'
            ) THEN
                CREATE POLICY org_isolation ON document_images
                    USING (org_id = current_setting('app.current_org_id')::uuid);
            END IF;
        END $$
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_images_document_id ON document_images(document_id)"
    )

    # ── documents.image_count (from 048_add_image_support) ────────────────────
    op.execute(
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS image_count INT NOT NULL DEFAULT 0"
    )

    # ── document_chunks new columns (from 048_add_image_support) ──────────────
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_type VARCHAR(10) NOT NULL DEFAULT 'text'"
    )
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS image_id UUID REFERENCES document_images(id)"
    )

    # ── document_images.content_hash (from 049_add_image_content_hash) ────────
    op.execute(
        "ALTER TABLE document_images ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_images_content_hash ON document_images(content_hash)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_document_images_content_hash")
    op.execute("ALTER TABLE document_images DROP COLUMN IF EXISTS content_hash")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS image_id")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS chunk_type")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS image_count")
    op.execute("DROP TABLE IF EXISTS document_images CASCADE")
