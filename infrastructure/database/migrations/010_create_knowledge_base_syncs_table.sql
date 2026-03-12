-- Migration: Create knowledge_base_syncs table
-- File: 010_create_knowledge_base_syncs_table.sql
-- Created: 2025-03-11

CREATE TABLE IF NOT EXISTS knowledge_base_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Knowledge Base identifiers
  knowledge_base_id VARCHAR(255) NOT NULL,
  data_source_id VARCHAR(255) NOT NULL,
  ingestion_job_id VARCHAR(255) NOT NULL UNIQUE,
  
  -- Status tracking
  status VARCHAR(50) NOT NULL,
  
  -- Who triggered it
  triggered_by UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  auto_triggered BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CONSTRAINT kb_syncs_status_valid CHECK (status IN (
    'STARTING', 'IN_PROGRESS', 'COMPLETE', 'FAILED', 'STOPPED'
  ))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kb_syncs_organization ON knowledge_base_syncs(organization_id);
CREATE INDEX IF NOT EXISTS idx_kb_syncs_triggered_by ON knowledge_base_syncs(triggered_by);
CREATE INDEX IF NOT EXISTS idx_kb_syncs_status ON knowledge_base_syncs(status);
CREATE INDEX IF NOT EXISTS idx_kb_syncs_created_at ON knowledge_base_syncs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_syncs_job_id ON knowledge_base_syncs(ingestion_job_id);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_kb_syncs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_syncs_updated_at_trigger
  BEFORE UPDATE ON knowledge_base_syncs
  FOR EACH ROW
  EXECUTE FUNCTION update_kb_syncs_updated_at();

-- Comments
COMMENT ON TABLE knowledge_base_syncs IS 'Tracks Bedrock Knowledge Base ingestion jobs';
COMMENT ON COLUMN knowledge_base_syncs.knowledge_base_id IS 'Bedrock Knowledge Base ID';
COMMENT ON COLUMN knowledge_base_syncs.data_source_id IS 'Data Source ID within the Knowledge Base';
COMMENT ON COLUMN knowledge_base_syncs.ingestion_job_id IS 'Unique ID of the ingestion job';
COMMENT ON COLUMN knowledge_base_syncs.status IS 'Current status of the ingestion job';
COMMENT ON COLUMN knowledge_base_syncs.auto_triggered IS 'Whether this was triggered automatically after document upload';
