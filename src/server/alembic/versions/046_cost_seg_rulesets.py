"""replace irs_rules/irs_rule_chunks with cost_seg_rulesets

Revision ID: 046
Revises: 045
Create Date: 2026-06-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "046"
down_revision = "s043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create new JSON-based ruleset table (no embeddings, no chunking)
    op.create_table(
        "cost_seg_rulesets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("s3_key", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="ready"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )

    # Drop old embedding-based IRS rule tables (replaced by cost_seg_rulesets)
    op.drop_table("irs_rule_chunks")
    op.drop_table("irs_rules")


def downgrade() -> None:
    op.drop_table("cost_seg_rulesets")

    # Recreate irs_rules (schema only — no data migration needed for downgrade)
    op.create_table(
        "irs_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("s3_key", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="processing"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        "irs_rule_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("irs_rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("irs_rules.id"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
