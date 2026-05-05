"""SQL sync from 008_knowledge_asset_rbac.sql

Revision ID: s010
Revises: s009
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s010"
down_revision: Union[str, None] = "s009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration: 008_knowledge_asset_rbac.sql\n-- Implements granular RBAC for knowledge assets/resources\n\n-- Optional: Create a groups table if it doesn't exist for collaborative access\nCREATE TABLE IF NOT EXISTS rbac_groups (\n    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    name VARCHAR(255) NOT NULL,\n    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE IF NOT EXISTS rbac_permissions (\n    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\n    asset_id UUID NOT NULL REFERENCES knowledge_base_resources(id) ON DELETE CASCADE,\n    \n    -- Access control\n    user_id UUID REFERENCES users(id) ON DELETE CASCADE,\n    group_id UUID REFERENCES rbac_groups(id) ON DELETE CASCADE,\n    \n    permission VARCHAR(20) NOT NULL CHECK (permission IN ('read', 'write', 'admin')),\n    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    \n    embedding_id TEXT, -- ARN or link for the embedding associated with the asset_id\n    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n    \n    -- Ensure either user_id or group_id is provided, but they are mutually exclusive per record\n    CONSTRAINT user_or_group CHECK (\n        (user_id IS NOT NULL AND group_id IS NULL) OR\n        (user_id IS NULL AND group_id IS NOT NULL)\n    )\n);\n\nCREATE INDEX idx_rbac_permissions_asset_id ON rbac_permissions(asset_id);\nCREATE INDEX idx_rbac_permissions_user_id ON rbac_permissions(user_id);\nCREATE INDEX idx_rbac_permissions_owner_id ON rbac_permissions(owner_id);\n\n-- Add comment for clarity\nCOMMENT ON COLUMN rbac_permissions.embedding_id IS 'Link to the S3 object or Vector ID for this specific asset chunk set';\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 008_knowledge_asset_rbac.sql"
    )
