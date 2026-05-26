"""create irs rules and irs rule chunks tables

Revision ID: s035
Revises: s034
Create Date: 2026-05-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 's035'
down_revision: Union[str, Sequence[str], None] = 's034'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── irs_rules ──────────────────────────────────────────────────────────
    op.create_table(
        "irs_rules",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("s3_key", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'processing'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── irs_rule_chunks ───────────────────────────────────────────────────
    op.create_table(
        "irs_rule_chunks",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("irs_rule_id", sa.UUID(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["irs_rule_id"], ["irs_rules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_irs_rule_chunks_irs_rule", "irs_rule_chunks", ["irs_rule_id"])


def downgrade() -> None:
    op.drop_index("ix_irs_rule_chunks_irs_rule", table_name="irs_rule_chunks")
    op.drop_table("irs_rule_chunks")
    op.drop_table("irs_rules")
