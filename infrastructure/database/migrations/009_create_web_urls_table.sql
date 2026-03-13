-- Migration: Create web_urls table
-- File: 009_create_web_urls_table.sql
-- Created: 2025-03-11

CREATE TABLE IF NOT EXISTS web_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  
  -- URL Information
  url TEXT NOT NULL,
  title VARCHAR(500),
  
  -- Metadata (same as documents)
  user_id_tag VARCHAR(255),
  doc_type VARCHAR(100),
  is_confidential BOOLEAN DEFAULT FALSE,
  assigned_role VARCHAR(50),
  assigned_user VARCHAR(255),
  description TEXT,
  
  -- Additional fields
  tags JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT web_urls_url_not_empty CHECK (url <> ''),
  CONSTRAINT web_urls_status_valid CHECK (status IN ('active', 'inactive', 'processing', 'failed'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_web_urls_organization ON web_urls(organization_id);
CREATE INDEX IF NOT EXISTS idx_web_urls_uploaded_by ON web_urls(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_web_urls_user_id_tag ON web_urls(user_id_tag);
CREATE INDEX IF NOT EXISTS idx_web_urls_doc_type ON web_urls(doc_type);
CREATE INDEX IF NOT EXISTS idx_web_urls_confidential ON web_urls(is_confidential);
CREATE INDEX IF NOT EXISTS idx_web_urls_assigned_role ON web_urls(assigned_role);
CREATE INDEX IF NOT EXISTS idx_web_urls_status ON web_urls(status);
CREATE INDEX IF NOT EXISTS idx_web_urls_deleted ON web_urls(deleted_at) WHERE deleted_at IS NULL;

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_web_urls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER web_urls_updated_at_trigger
  BEFORE UPDATE ON web_urls
  FOR EACH ROW
  EXECUTE FUNCTION update_web_urls_updated_at();

-- Comments
COMMENT ON TABLE web_urls IS 'Stores web URLs with metadata for knowledge base';
COMMENT ON COLUMN web_urls.url IS 'The web URL';
COMMENT ON COLUMN web_urls.title IS 'Optional title/name for the URL';
COMMENT ON COLUMN web_urls.user_id_tag IS 'Tag: user-id - identifier for the user who added';
COMMENT ON COLUMN web_urls.doc_type IS 'Tag: doc-type - type/category of URL content';
COMMENT ON COLUMN web_urls.is_confidential IS 'Tag: confidential - whether URL is confidential';
COMMENT ON COLUMN web_urls.assigned_role IS 'Tag: role - role assigned to access URL';
COMMENT ON COLUMN web_urls.assigned_user IS 'Tag: specific-user - specific user assigned to access URL';
COMMENT ON COLUMN web_urls.description IS 'User-provided description of the URL';
