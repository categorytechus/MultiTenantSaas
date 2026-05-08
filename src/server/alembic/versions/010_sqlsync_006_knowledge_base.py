"""SQL sync from 006_knowledge_base.sql

Revision ID: s007
Revises: s006
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s007"
down_revision: Union[str, None] = "s006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Knowledge Base Resources table for Multi-Tenant SaaS Platform\n-- Migration: 006_knowledge_base.sql\n\nCREATE TABLE knowledge_base_resources (\n    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    name VARCHAR(255) NOT NULL,\n    type VARCHAR(50) NOT NULL CHECK (type IN ('document', 'url', 'api', 'database')),\n    content_path TEXT, -- URL or internal path\n    text_context TEXT, -- Raw text for context\n    tags JSONB DEFAULT '[]',\n    role_id UUID REFERENCES roles(id) ON DELETE SET NULL, -- Role that can access this resource\n    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE INDEX idx_kb_resources_org_id ON knowledge_base_resources(organization_id);\nCREATE INDEX idx_kb_resources_role_id ON knowledge_base_resources(role_id);\nCREATE INDEX idx_kb_resources_type ON knowledge_base_resources(type);\n\n-- Apply updated_at trigger\nCREATE TRIGGER update_kb_resources_updated_at BEFORE UPDATE ON knowledge_base_resources\n    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();\n\n-- Enable RLS\nALTER TABLE knowledge_base_resources ENABLE ROW LEVEL SECURITY;\nALTER TABLE knowledge_base_resources FORCE ROW LEVEL SECURITY;\n\n-- RLS Policies\n\n-- Users can select resources if:\n-- 1. They belong to the organization AND\n-- 2. The resource has no specific role_id (public to org) OR they have the specified role\nCREATE POLICY kb_resources_select_policy ON knowledge_base_resources\n    FOR SELECT\n    USING (\n        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id', true)::UUID))\n        AND (\n            role_id IS NULL OR \n            role_id IN (\n                SELECT ur.role_id \n                FROM user_roles ur \n                WHERE ur.user_id = current_setting('app.current_user_id', true)::UUID \n                AND ur.organization_id = knowledge_base_resources.organization_id\n            )\n        )\n    );\n\n-- Users can insert/update/delete if they have 'knowledge_base' permissions\nCREATE POLICY kb_resources_modify_policy ON knowledge_base_resources\n    FOR ALL\n    USING (\n        user_has_permission(\n            current_setting('app.current_user_id', true)::UUID,\n            organization_id,\n            'knowledge_base',\n            'manage'\n        )\n    );\n\n-- Grant access to service role\nGRANT ALL ON knowledge_base_resources TO service_role;\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 006_knowledge_base.sql"
    )
