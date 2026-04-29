-- Knowledge Base Resources table for Multi-Tenant SaaS Platform
-- Migration: 006_knowledge_base.sql

CREATE TABLE knowledge_base_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('document', 'url', 'api', 'database')),
    content_path TEXT, -- URL or internal path
    text_context TEXT, -- Raw text for context
    tags JSONB DEFAULT '[]',
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL, -- Role that can access this resource
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kb_resources_org_id ON knowledge_base_resources(organization_id);
CREATE INDEX idx_kb_resources_role_id ON knowledge_base_resources(role_id);
CREATE INDEX idx_kb_resources_type ON knowledge_base_resources(type);

-- Apply updated_at trigger
CREATE TRIGGER update_kb_resources_updated_at BEFORE UPDATE ON knowledge_base_resources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE knowledge_base_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_resources FORCE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can select resources if:
-- 1. They belong to the organization AND
-- 2. The resource has no specific role_id (public to org) OR they have the specified role
CREATE POLICY kb_resources_select_policy ON knowledge_base_resources
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id', true)::UUID))
        AND (
            role_id IS NULL OR 
            role_id IN (
                SELECT ur.role_id 
                FROM user_roles ur 
                WHERE ur.user_id = current_setting('app.current_user_id', true)::UUID 
                AND ur.organization_id = knowledge_base_resources.organization_id
            )
        )
    );

-- Users can insert/update/delete if they have 'knowledge_base' permissions
CREATE POLICY kb_resources_modify_policy ON knowledge_base_resources
    FOR ALL
    USING (
        user_has_permission(
            current_setting('app.current_user_id', true)::UUID,
            organization_id,
            'knowledge_base',
            'manage'
        )
    );

-- Grant access to service role
GRANT ALL ON knowledge_base_resources TO service_role;
