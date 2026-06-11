"""add org_id to cost_seg_rulesets

Revision ID: 051
Revises: 050
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE cost_seg_rulesets
        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE CASCADE
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_cost_seg_rulesets_org_id ON cost_seg_rulesets(org_id)
    """)


def downgrade():
    op.drop_index("ix_cost_seg_rulesets_org_id", table_name="cost_seg_rulesets")
    op.drop_column("cost_seg_rulesets", "org_id")
