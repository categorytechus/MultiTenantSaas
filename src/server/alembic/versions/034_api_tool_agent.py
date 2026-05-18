"""Add api_modules, api_task_proposals, api_execution_logs tables with RLS."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s032"
down_revision: Union[str, None] = "s031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── api_modules ──────────────────────────────────────────────────────────
    op.create_table(
        "api_modules",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("endpoint_path", sa.Text(), nullable=False),
        sa.Column("auth_type", sa.String(length=20), nullable=False, server_default=sa.text("'none'")),
        sa.Column("auth_config", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("headers", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("request_schema", sa.dialects.postgresql.JSONB(), nullable=False),
        sa.Column("response_schema", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_modules_org_id", "api_modules", ["org_id"])
    op.create_index("ix_api_modules_org_enabled", "api_modules", ["org_id", "enabled"])

    # ── api_task_proposals ───────────────────────────────────────────────────
    op.create_table(
        "api_task_proposals",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("chat_session_id", sa.UUID(), nullable=False),
        sa.Column("agent_task_id", sa.UUID(), nullable=True),
        sa.Column("api_module_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("input_payload", sa.dialects.postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'pending_confirmation'")),
        sa.Column("proposed_by", sa.UUID(), nullable=True),
        sa.Column("accepted_by", sa.UUID(), nullable=True),
        sa.Column("declined_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_task_id"], ["agent_tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["api_module_id"], ["api_modules.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["proposed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["declined_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_task_proposals_org_id", "api_task_proposals", ["org_id"])
    op.create_index("ix_api_task_proposals_session", "api_task_proposals", ["chat_session_id"])
    op.create_index("ix_api_task_proposals_status", "api_task_proposals", ["status"])

    # ── api_execution_logs ───────────────────────────────────────────────────
    op.create_table(
        "api_execution_logs",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("proposal_id", sa.UUID(), nullable=False),
        sa.Column("api_module_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'running'")),
        sa.Column("request_payload", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("response_payload", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_id"], ["api_task_proposals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["api_module_id"], ["api_modules.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_execution_logs_org_id", "api_execution_logs", ["org_id"])
    op.create_index("ix_api_execution_logs_proposal", "api_execution_logs", ["proposal_id"])

    # ── Row Level Security ────────────────────────────────────────────────────
    op.execute("ALTER TABLE api_modules ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY api_modules_org_isolation ON api_modules
            USING (org_id = current_setting('app.current_org_id', true)::uuid);
    """)

    op.execute("ALTER TABLE api_task_proposals ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY api_proposals_org_isolation ON api_task_proposals
            USING (org_id = current_setting('app.current_org_id', true)::uuid);
    """)

    op.execute("ALTER TABLE api_execution_logs ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY api_exec_logs_org_isolation ON api_execution_logs
            USING (org_id = current_setting('app.current_org_id', true)::uuid);
    """)


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for s032.")
