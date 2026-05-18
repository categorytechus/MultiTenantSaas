"""
Unified workflow tables (workflow_sessions, workflow_items, workflow_outputs)
+ session_id column on documents + cost_seg master module.

Replaces the earlier 5-table cost_seg-specific design with 3 generic tables
that serve cost_seg, future document review flows, and any other multi-step
workflow without requiring new migrations per feature.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s031"
down_revision: Union[str, None] = "s030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── workflow_sessions ──────────────────────────────────────────────────────
    op.create_table(
        "workflow_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="draft"),
        sa.Column("step", sa.Integer(), nullable=True),
        sa.Column("meta", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("ix_workflow_sessions_org_id", "workflow_sessions", ["org_id"])
    op.create_index("ix_workflow_sessions_type", "workflow_sessions", ["type"])

    # ── workflow_items ─────────────────────────────────────────────────────────
    op.create_table(
        "workflow_items",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("workflow_sessions.id"), nullable=False),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("role", sa.String(50), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("data", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_workflow_items_session_id", "workflow_items", ["session_id"])
    op.create_index("ix_workflow_items_type", "workflow_items", ["type"])

    # ── workflow_outputs ───────────────────────────────────────────────────────
    op.create_table(
        "workflow_outputs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("workflow_sessions.id"), nullable=False),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("data", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("generated_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.UniqueConstraint("session_id", "type", name="uq_workflow_outputs_session_type"),
    )
    op.create_index("ix_workflow_outputs_session_id", "workflow_outputs", ["session_id"])

    # ── documents.session_id ───────────────────────────────────────────────────
    # Nullable FK so existing documents (RAG, knowledge base) are unaffected.
    # Cost-seg uploaded docs get session_id = the workflow_session id.
    op.add_column(
        "documents",
        sa.Column(
            "session_id",
            sa.UUID(),
            sa.ForeignKey("workflow_sessions.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_documents_session_id", "documents", ["session_id"])

    # ── RLS policies ───────────────────────────────────────────────────────────
    for table in ("workflow_sessions", "workflow_items", "workflow_outputs"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (org_id = current_setting('app.current_org_id', true)::uuid)"
        )

    # ── cost_seg master module ─────────────────────────────────────────────────
    op.execute(
        "INSERT INTO master_modules (id, name, enabled, created_at) "
        "VALUES ('cost_seg', 'Cost Segregation', true, now()) "
        "ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM master_modules WHERE id = 'cost_seg'")
    op.drop_index("ix_documents_session_id", table_name="documents")
    op.drop_column("documents", "session_id")
    op.drop_table("workflow_outputs")
    op.drop_table("workflow_items")
    op.drop_table("workflow_sessions")
