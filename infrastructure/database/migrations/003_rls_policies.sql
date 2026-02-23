-- Row Level Security (RLS) Policies for Multi-Tenant Isolation
-- Migration: 003_rls_policies.sql

-- =============================================================================
-- ENABLE RLS ON ORG-SCOPED TABLES
-- =============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- HELPER FUNCTION: Get Current User's Organization IDs
-- =============================================================================

CREATE OR REPLACE FUNCTION get_user_organization_ids(user_uuid UUID)
RETURNS TABLE(organization_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT om.organization_id
    FROM organization_members om
    WHERE om.user_id = user_uuid
    AND om.status = 'active';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- HELPER FUNCTION: Check if user has permission
-- =============================================================================

CREATE OR REPLACE FUNCTION user_has_permission(
    user_uuid UUID,
    org_uuid UUID,
    resource_name VARCHAR,
    action_name VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    has_perm BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = user_uuid
        AND ur.organization_id = org_uuid
        AND p.resource = resource_name
        AND p.action = action_name
    ) INTO has_perm;
    
    RETURN has_perm;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =============================================================================
-- RLS POLICIES: ORGANIZATIONS
-- =============================================================================

-- Users can only see organizations they are members of
CREATE POLICY organizations_select_policy ON organizations
    FOR SELECT
    USING (
        id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

-- Users can only update organizations where they have admin role
CREATE POLICY organizations_update_policy ON organizations
    FOR UPDATE
    USING (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            id,
            'organizations',
            'update'
        )
    );

-- Only super admins can create organizations (handled via application layer)
CREATE POLICY organizations_insert_policy ON organizations
    FOR INSERT
    WITH CHECK (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            id,
            'organizations',
            'create'
        )
    );

-- =============================================================================
-- RLS POLICIES: ORGANIZATION_MEMBERS
-- =============================================================================

CREATE POLICY org_members_select_policy ON organization_members
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

CREATE POLICY org_members_insert_policy ON organization_members
    FOR INSERT
    WITH CHECK (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'members',
            'create'
        )
    );

CREATE POLICY org_members_update_policy ON organization_members
    FOR UPDATE
    USING (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'members',
            'update'
        )
    );

CREATE POLICY org_members_delete_policy ON organization_members
    FOR DELETE
    USING (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'members',
            'delete'
        )
    );

-- =============================================================================
-- RLS POLICIES: ROLES
-- =============================================================================

CREATE POLICY roles_select_policy ON roles
    FOR SELECT
    USING (
        is_system = true OR
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

CREATE POLICY roles_insert_policy ON roles
    FOR INSERT
    WITH CHECK (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'roles',
            'create'
        )
    );

CREATE POLICY roles_update_policy ON roles
    FOR UPDATE
    USING (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'roles',
            'update'
        )
    );

-- =============================================================================
-- RLS POLICIES: USER_ROLES
-- =============================================================================

CREATE POLICY user_roles_select_policy ON user_roles
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

CREATE POLICY user_roles_insert_policy ON user_roles
    FOR INSERT
    WITH CHECK (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'roles',
            'assign'
        )
    );

CREATE POLICY user_roles_delete_policy ON user_roles
    FOR DELETE
    USING (
        user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'roles',
            'revoke'
        )
    );

-- =============================================================================
-- RLS POLICIES: SESSIONS
-- =============================================================================

-- Users can only see their own sessions
CREATE POLICY sessions_select_policy ON sessions
    FOR SELECT
    USING (
        user_id = current_setting('app.current_user_id')::UUID
    );

-- Users can only delete their own sessions
CREATE POLICY sessions_delete_policy ON sessions
    FOR DELETE
    USING (
        user_id = current_setting('app.current_user_id')::UUID
    );

-- =============================================================================
-- RLS POLICIES: AGENT_TASKS
-- =============================================================================

CREATE POLICY agent_tasks_select_policy ON agent_tasks
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

CREATE POLICY agent_tasks_insert_policy ON agent_tasks
    FOR INSERT
    WITH CHECK (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
        AND user_id = current_setting('app.current_user_id')::UUID
    );

CREATE POLICY agent_tasks_update_policy ON agent_tasks
    FOR UPDATE
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

-- =============================================================================
-- RLS POLICIES: AGENT_RESULTS
-- =============================================================================

CREATE POLICY agent_results_select_policy ON agent_results
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

CREATE POLICY agent_results_insert_policy ON agent_results
    FOR INSERT
    WITH CHECK (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
    );

-- =============================================================================
-- RLS POLICIES: AUDIT_LOGS
-- =============================================================================

-- Users can only see audit logs from their organizations
CREATE POLICY audit_logs_select_policy ON audit_logs
    FOR SELECT
    USING (
        organization_id IN (SELECT get_user_organization_ids(current_setting('app.current_user_id')::UUID))
        OR user_has_permission(
            current_setting('app.current_user_id')::UUID,
            organization_id,
            'audit_logs',
            'view_all'
        )
    );

-- Only system can insert audit logs (via triggers or application)
CREATE POLICY audit_logs_insert_policy ON audit_logs
    FOR INSERT
    WITH CHECK (true); -- Application layer controls this

-- =============================================================================
-- BYPASS RLS FOR SERVICE ROLE
-- =============================================================================

-- Create a service role that can bypass RLS for system operations
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
    END IF;
END
$$;

-- Grant service role ability to bypass RLS
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_results FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;