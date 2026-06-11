"""add org_id to cost_seg_rulesets

Revision ID: 048
Revises: 047
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "cost_seg_rulesets",
        sa.Column(
            "org_id",
            sa.UUID(),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_cost_seg_rulesets_org_id", "cost_seg_rulesets", ["org_id"])


def downgrade():
    op.drop_index("ix_cost_seg_rulesets_org_id", table_name="cost_seg_rulesets")
    op.drop_column("cost_seg_rulesets", "org_id")
