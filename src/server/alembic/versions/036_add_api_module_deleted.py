"""add api module deleted boolean

Revision ID: s033
Revises: s032
Create Date: 2026-05-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 's034'
down_revision: Union[str, Sequence[str], None] = 's033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add deleted boolean to api_modules table
    op.add_column('api_modules', sa.Column('deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('api_modules', 'deleted')
