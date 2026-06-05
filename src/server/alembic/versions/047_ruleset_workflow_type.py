"""add workflow_type to cost_seg_rulesets

Revision ID: 047
Revises: 046
Create Date: 2026-06-05

"""
from alembic import op
import sqlalchemy as sa

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cost_seg_rulesets",
        sa.Column("workflow_type", sa.Text(), nullable=False, server_default="cost_seg"),
    )
    op.create_index(
        "ix_cost_seg_rulesets_workflow_type",
        "cost_seg_rulesets",
        ["workflow_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_cost_seg_rulesets_workflow_type", "cost_seg_rulesets")
    op.drop_column("cost_seg_rulesets", "workflow_type")
