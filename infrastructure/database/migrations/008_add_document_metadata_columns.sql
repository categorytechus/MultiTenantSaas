-- Migration: Add metadata columns to documents table
-- File: 008_add_document_metadata_columns.sql
-- Created: 2025-03-11

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id_tag VARCHAR(255),
  ADD COLUMN IF NOT EXISTS doc_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS assigned_user VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_documents_user_id_tag ON documents(user_id_tag);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_confidential ON documents(is_confidential);
CREATE INDEX IF NOT EXISTS idx_documents_assigned_role ON documents(assigned_role);

-- Add comments
COMMENT ON COLUMN documents.user_id_tag IS 'S3 tag: user-id - identifier for the user who uploaded';
COMMENT ON COLUMN documents.doc_type IS 'S3 tag: doc-type - type/category of document';
COMMENT ON COLUMN documents.is_confidential IS 'S3 tag: confidential - whether document is confidential';
COMMENT ON COLUMN documents.assigned_role IS 'S3 tag: role - role assigned to access document';
COMMENT ON COLUMN documents.assigned_user IS 'S3 tag: specific-user - specific user assigned to access document';
COMMENT ON COLUMN documents.description IS 'User-provided description of the document';
