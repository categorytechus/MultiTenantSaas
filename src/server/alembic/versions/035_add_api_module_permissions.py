"""add_api_module_permissions

Revision ID: s032
Revises: s031
Create Date: 2026-05-17

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 's033'
down_revision: Union[str, Sequence[str], None] = 's032'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old permissions table if it exists
    op.execute("DROP TABLE IF EXISTS api_module_permissions CASCADE")
    
    # Add ask_permission boolean to api_modules table
    op.add_column('api_modules', sa.Column('ask_permission', sa.Boolean(), nullable=False, server_default=sa.text('true')))


def downgrade() -> None:
    op.drop_column('api_modules', 'ask_permission')
