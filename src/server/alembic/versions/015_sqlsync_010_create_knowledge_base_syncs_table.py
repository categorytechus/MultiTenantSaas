"""SQL sync from 010_create_knowledge_base_syncs_table.sql

Revision ID: s012
Revises: s011
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s012"
down_revision: Union[str, None] = "s011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration: Create knowledge_base_syncs table\n-- File: 010_create_knowledge_base_syncs_table.sql\n-- Created: 2025-03-11\n\nCREATE TABLE IF NOT EXISTS knowledge_base_syncs (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  \n  -- Knowledge Base identifiers\n  knowledge_base_id VARCHAR(255) NOT NULL,\n  data_source_id VARCHAR(255) NOT NULL,\n  ingestion_job_id VARCHAR(255) NOT NULL UNIQUE,\n  \n  -- Status tracking\n  status VARCHAR(50) NOT NULL,\n  \n  -- Who triggered it\n  triggered_by UUID NOT NULL REFERENCES users(id),\n  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n  auto_triggered BOOLEAN DEFAULT FALSE,\n  \n  -- Timestamps\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,\n  \n  -- Constraints\n  CONSTRAINT kb_syncs_status_valid CHECK (status IN (\n    'STARTING', 'IN_PROGRESS', 'COMPLETE', 'FAILED', 'STOPPED'\n  ))\n);\n\n-- Indexes\nCREATE INDEX IF NOT EXISTS idx_kb_syncs_organization ON knowledge_base_syncs(organization_id);\nCREATE INDEX IF NOT EXISTS idx_kb_syncs_triggered_by ON knowledge_base_syncs(triggered_by);\nCREATE INDEX IF NOT EXISTS idx_kb_syncs_status ON knowledge_base_syncs(status);\nCREATE INDEX IF NOT EXISTS idx_kb_syncs_created_at ON knowledge_base_syncs(created_at DESC);\nCREATE INDEX IF NOT EXISTS idx_kb_syncs_job_id ON knowledge_base_syncs(ingestion_job_id);\n\n-- Updated timestamp trigger\nCREATE OR REPLACE FUNCTION update_kb_syncs_updated_at()\nRETURNS TRIGGER AS $$\nBEGIN\n  NEW.updated_at = CURRENT_TIMESTAMP;\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER kb_syncs_updated_at_trigger\n  BEFORE UPDATE ON knowledge_base_syncs\n  FOR EACH ROW\n  EXECUTE FUNCTION update_kb_syncs_updated_at();\n\n-- Comments\nCOMMENT ON TABLE knowledge_base_syncs IS 'Tracks Bedrock Knowledge Base ingestion jobs';\nCOMMENT ON COLUMN knowledge_base_syncs.knowledge_base_id IS 'Bedrock Knowledge Base ID';\nCOMMENT ON COLUMN knowledge_base_syncs.data_source_id IS 'Data Source ID within the Knowledge Base';\nCOMMENT ON COLUMN knowledge_base_syncs.ingestion_job_id IS 'Unique ID of the ingestion job';\nCOMMENT ON COLUMN knowledge_base_syncs.status IS 'Current status of the ingestion job';\nCOMMENT ON COLUMN knowledge_base_syncs.auto_triggered IS 'Whether this was triggered automatically after document upload';\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 010_create_knowledge_base_syncs_table.sql"
    )
