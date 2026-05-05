"""SQL sync from 007_add_session_id.sql

Revision ID: s008
Revises: s007
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s008"
down_revision: Union[str, None] = "s007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = '-- Migration: 007_add_session_id.sql\n-- Adds session_id to agent_tasks to group tasks belonging to the same chat conversation.\n\nALTER TABLE agent_tasks\n    ADD COLUMN session_id UUID;\n\nCREATE INDEX idx_agent_tasks_session_id ON agent_tasks(session_id);\n'


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 007_add_session_id.sql"
    )
