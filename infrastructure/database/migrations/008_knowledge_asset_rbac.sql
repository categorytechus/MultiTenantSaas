-- Migration: 008_knowledge_asset_rbac.sql
-- Implements granular RBAC for knowledge assets/resources

-- Optional: Create a groups table if it doesn't exist for collaborative access
CREATE TABLE IF NOT EXISTS rbac_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rbac_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES knowledge_base_resources(id) ON DELETE CASCADE,
    
    -- Access control
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES rbac_groups(id) ON DELETE CASCADE,
    
    permission VARCHAR(20) NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    embedding_id TEXT, -- ARN or link for the embedding associated with the asset_id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure either user_id or group_id is provided, but they are mutually exclusive per record
    CONSTRAINT user_or_group CHECK (
        (user_id IS NOT NULL AND group_id IS NULL) OR
        (user_id IS NULL AND group_id IS NOT NULL)
    )
);

CREATE INDEX idx_rbac_permissions_asset_id ON rbac_permissions(asset_id);
CREATE INDEX idx_rbac_permissions_user_id ON rbac_permissions(user_id);
CREATE INDEX idx_rbac_permissions_owner_id ON rbac_permissions(owner_id);

-- Add comment for clarity
COMMENT ON COLUMN rbac_permissions.embedding_id IS 'Link to the S3 object or Vector ID for this specific asset chunk set';
