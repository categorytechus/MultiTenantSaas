"""SQL sync from 009_create_web_urls_table.sql

Revision ID: s011
Revises: s010
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s011"
down_revision: Union[str, None] = "s010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration: Create web_urls table\n-- File: 009_create_web_urls_table.sql\n-- Created: 2025-03-11\n\nCREATE TABLE IF NOT EXISTS web_urls (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  uploaded_by UUID NOT NULL REFERENCES users(id),\n  \n  -- URL Information\n  url TEXT NOT NULL,\n  title VARCHAR(500),\n  \n  -- Metadata (same as documents)\n  user_id_tag VARCHAR(255),\n  doc_type VARCHAR(100),\n  is_confidential BOOLEAN DEFAULT FALSE,\n  assigned_role VARCHAR(50),\n  assigned_user VARCHAR(255),\n  description TEXT,\n  \n  -- Additional fields\n  tags JSONB DEFAULT '{}',\n  status VARCHAR(50) DEFAULT 'active',\n  \n  -- Timestamps\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n  deleted_at TIMESTAMP WITH TIME ZONE,\n  \n  -- Constraints\n  CONSTRAINT web_urls_url_not_empty CHECK (url <> ''),\n  CONSTRAINT web_urls_status_valid CHECK (status IN ('active', 'inactive', 'processing', 'failed'))\n);\n\n-- Indexes\nCREATE INDEX IF NOT EXISTS idx_web_urls_organization ON web_urls(organization_id);\nCREATE INDEX IF NOT EXISTS idx_web_urls_uploaded_by ON web_urls(uploaded_by);\nCREATE INDEX IF NOT EXISTS idx_web_urls_user_id_tag ON web_urls(user_id_tag);\nCREATE INDEX IF NOT EXISTS idx_web_urls_doc_type ON web_urls(doc_type);\nCREATE INDEX IF NOT EXISTS idx_web_urls_confidential ON web_urls(is_confidential);\nCREATE INDEX IF NOT EXISTS idx_web_urls_assigned_role ON web_urls(assigned_role);\nCREATE INDEX IF NOT EXISTS idx_web_urls_status ON web_urls(status);\nCREATE INDEX IF NOT EXISTS idx_web_urls_deleted ON web_urls(deleted_at) WHERE deleted_at IS NULL;\n\n-- Updated timestamp trigger\nCREATE OR REPLACE FUNCTION update_web_urls_updated_at()\nRETURNS TRIGGER AS $$\nBEGIN\n  NEW.updated_at = CURRENT_TIMESTAMP;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER web_urls_updated_at_trigger\n  BEFORE UPDATE ON web_urls\n  FOR EACH ROW\n  EXECUTE FUNCTION update_web_urls_updated_at();\n\n-- Comments\nCOMMENT ON TABLE web_urls IS 'Stores web URLs with metadata for knowledge base';\nCOMMENT ON COLUMN web_urls.url IS 'The web URL';\nCOMMENT ON COLUMN web_urls.title IS 'Optional title/name for the URL';\nCOMMENT ON COLUMN web_urls.user_id_tag IS 'Tag: user-id - identifier for the user who added';\nCOMMENT ON COLUMN web_urls.doc_type IS 'Tag: doc-type - type/category of URL content';\nCOMMENT ON COLUMN web_urls.is_confidential IS 'Tag: confidential - whether URL is confidential';\nCOMMENT ON COLUMN web_urls.assigned_role IS 'Tag: role - role assigned to access URL';\nCOMMENT ON COLUMN web_urls.assigned_user IS 'Tag: specific-user - specific user assigned to access URL';\nCOMMENT ON COLUMN web_urls.description IS 'User-provided description of the URL';\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 009_create_web_urls_table.sql"
    )
