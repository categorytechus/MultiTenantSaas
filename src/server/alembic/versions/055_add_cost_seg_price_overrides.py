"""add cost_seg_price_overrides to orgs

Revision ID: 055_add_cost_seg_price_overrides
Revises: 054_add_org_prompts_table
Create Date: 2026-06-15 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '055'
down_revision: Union[str, None] = '054'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orgs', sa.Column('cost_seg_price_overrides', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('orgs', 'cost_seg_price_overrides')
