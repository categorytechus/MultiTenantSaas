-- Migration: Create documents table for S3 upload tracking
-- File: infrastructure/database/migrations/006_create_documents_table.sql

-- Documents table to track S3 uploads with metadata and tags
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    s3_key VARCHAR(500) NOT NULL UNIQUE,
    s3_bucket VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL, -- in bytes
    mime_type VARCHAR(100) NOT NULL,
    
    -- Ownership
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Tagging (stored as JSONB for flexibility)
    tags JSONB DEFAULT '{}',
    
    -- Metadata
    description TEXT,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'processing', 'archived', 'deleted')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_organization_id ON documents(organization_id);
CREATE INDEX idx_documents_s3_key ON documents(s3_key);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_tags ON documents USING GIN (tags);
CREATE INDEX idx_documents_status ON documents(status) WHERE deleted_at IS NULL;

-- RLS Policies for multi-tenant isolation
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see documents in their organization
CREATE POLICY documents_org_isolation ON documents
    FOR ALL
    USING (organization_id IN (
        SELECT organization_id 
        FROM user_roles 
        WHERE user_id = current_setting('app.current_user_id')::UUID
    ));

-- Policy: Users with 'documents:view' permission can read
CREATE POLICY documents_view ON documents
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = current_setting('app.current_user_id')::UUID
                AND ur.organization_id = documents.organization_id
                AND p.resource = 'documents'
                AND p.action = 'view'
        )
    );

-- Policy: Users with 'documents:create' permission can insert
CREATE POLICY documents_create ON documents
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = current_setting('app.current_user_id')::UUID
                AND ur.organization_id = documents.organization_id
                AND p.resource = 'documents'
                AND p.action = 'create'
        )
    );

-- Policy: Users can update their own documents or if they have 'documents:update' permission
CREATE POLICY documents_update ON documents
    FOR UPDATE
    USING (
        user_id = current_setting('app.current_user_id')::UUID
        OR EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = current_setting('app.current_user_id')::UUID
                AND ur.organization_id = documents.organization_id
                AND p.resource = 'documents'
                AND p.action = 'update'
        )
    );

-- Policy: Users can delete their own documents or if they have 'documents:delete' permission
CREATE POLICY documents_delete ON documents
    FOR DELETE
    USING (
        user_id = current_setting('app.current_user_id')::UUID
        OR EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = current_setting('app.current_user_id')::UUID
                AND ur.organization_id = documents.organization_id
                AND p.resource = 'documents'
                AND p.action = 'delete'
        )
    );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at_trigger
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_documents_updated_at();

-- Insert new permissions for document management
INSERT INTO permissions (resource, action, description, created_at) VALUES
    ('documents', 'view', 'View documents in the organization', CURRENT_TIMESTAMP),
    ('documents', 'create', 'Upload new documents', CURRENT_TIMESTAMP),
    ('documents', 'update', 'Update document metadata and tags', CURRENT_TIMESTAMP),
    ('documents', 'delete', 'Delete documents', CURRENT_TIMESTAMP)
ON CONFLICT (resource, action) DO NOTHING;

-- Grant document permissions to org_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
    r.id,
    p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'org_admin'
    AND p.resource = 'documents'
    AND p.action IN ('view', 'create', 'update', 'delete')
ON CONFLICT DO NOTHING;

-- Grant view and create permissions to org_member role
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
    r.id,
    p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'org_member'
    AND p.resource = 'documents'
    AND p.action IN ('view', 'create')
ON CONFLICT DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE documents IS 'Stores metadata for documents uploaded to S3 with tagging support';
COMMENT ON COLUMN documents.tags IS 'JSONB field for flexible tagging: {"owner": "admin", "category": "guide", "status": "active", "role": "finance"}';
COMMENT ON COLUMN documents.s3_key IS 'Full S3 object key including path (e.g., org-123/docs/filename.pdf)';