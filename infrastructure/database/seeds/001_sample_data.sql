-- Sample seed data for testing RLS policies
-- Seed: 001_sample_data.sql

-- =============================================================================
-- SAMPLE ORGANIZATIONS
-- =============================================================================

INSERT INTO organizations (id, name, slug, domain, subscription_tier, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Acme Corporation', 'acme-corp', 'acme.com', 'enterprise', 'active'),
    ('22222222-2222-2222-2222-222222222222', 'Tech Startup Inc', 'tech-startup', 'techstartup.io', 'pro', 'active'),
    ('33333333-3333-3333-3333-333333333333', 'Healthcare Co', 'healthcare-co', 'healthcare.com', 'free', 'active');

-- =============================================================================
-- SAMPLE USERS (Mirror of Cognito)
-- =============================================================================

INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cognito-sub-alice', 'alice@acme.com', true, 'Alice Admin', 'active'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cognito-sub-bob', 'bob@acme.com', true, 'Bob Builder', 'active'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cognito-sub-charlie', 'charlie@techstartup.io', true, 'Charlie Chen', 'active'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cognito-sub-diana', 'diana@healthcare.com', true, 'Diana Doctor', 'active');

-- =============================================================================
-- ORGANIZATION MEMBERSHIPS
-- =============================================================================

-- Alice and Bob are in Acme Corp
INSERT INTO organization_members (organization_id, user_id, role, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin', 'active'),
    ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', 'active');

-- Charlie is in Tech Startup
INSERT INTO organization_members (organization_id, user_id, role, status) VALUES
    ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin', 'active');

-- Diana is in Healthcare Co
INSERT INTO organization_members (organization_id, user_id, role, status) VALUES
    ('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin', 'active');

-- =============================================================================
-- SYSTEM ROLES
-- =============================================================================

INSERT INTO roles (id, name, description, is_system, organization_id) VALUES
    ('r1111111-1111-1111-1111-111111111111', 'super_admin', 'Super administrator with all permissions', true, NULL),
    ('r2222222-2222-2222-2222-222222222222', 'org_admin', 'Organization administrator', true, NULL),
    ('r3333333-3333-3333-3333-333333333333', 'org_member', 'Regular organization member', true, NULL),
    ('r4444444-4444-4444-4444-444444444444', 'agent_user', 'User who can run AI agents', true, NULL);

-- =============================================================================
-- PERMISSIONS
-- =============================================================================

INSERT INTO permissions (id, resource, action, description) VALUES
    -- Organization permissions
    ('p0000001-0000-0000-0000-000000000001', 'organizations', 'create', 'Create new organizations'),
    ('p0000002-0000-0000-0000-000000000002', 'organizations', 'view', 'View organization details'),
    ('p0000003-0000-0000-0000-000000000003', 'organizations', 'update', 'Update organization settings'),
    ('p0000004-0000-0000-0000-000000000004', 'organizations', 'delete', 'Delete organizations'),
    
    -- Member permissions
    ('p0000005-0000-0000-0000-000000000005', 'members', 'create', 'Invite new members'),
    ('p0000006-0000-0000-0000-000000000006', 'members', 'view', 'View organization members'),
    ('p0000007-0000-0000-0000-000000000007', 'members', 'update', 'Update member roles'),
    ('p0000008-0000-0000-0000-000000000008', 'members', 'delete', 'Remove members'),
    
    -- Role permissions
    ('p0000009-0000-0000-0000-000000000009', 'roles', 'create', 'Create custom roles'),
    ('p0000010-0000-0000-0000-000000000010', 'roles', 'view', 'View roles'),
    ('p0000011-0000-0000-0000-000000000011', 'roles', 'update', 'Update roles'),
    ('p0000012-0000-0000-0000-000000000012', 'roles', 'delete', 'Delete roles'),
    ('p0000013-0000-0000-0000-000000000013', 'roles', 'assign', 'Assign roles to users'),
    ('p0000014-0000-0000-0000-000000000014', 'roles', 'revoke', 'Revoke roles from users'),
    
    -- Agent permissions
    ('p0000015-0000-0000-0000-000000000015', 'agents', 'run', 'Execute AI agents'),
    ('p0000016-0000-0000-0000-000000000016', 'agents', 'view_results', 'View agent results'),
    ('p0000017-0000-0000-0000-000000000017', 'agents', 'cancel', 'Cancel running agents'),
    
    -- Audit permissions
    ('p0000018-0000-0000-0000-000000000018', 'audit_logs', 'view_all', 'View all audit logs');

-- =============================================================================
-- ROLE-PERMISSION MAPPINGS
-- =============================================================================

-- Super Admin: All permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r1111111-1111-1111-1111-111111111111', id FROM permissions;

-- Org Admin: Most permissions except creating organizations
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'r2222222-2222-2222-2222-222222222222', id 
FROM permissions 
WHERE resource != 'organizations' OR action != 'create';

-- Org Member: Basic view and agent execution
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('r3333333-3333-3333-3333-333333333333', 'p0000002-0000-0000-0000-000000000002'), -- organizations:view
    ('r3333333-3333-3333-3333-333333333333', 'p0000006-0000-0000-0000-000000000006'), -- members:view
    ('r3333333-3333-3333-3333-333333333333', 'p0000010-0000-0000-0000-000000000010'), -- roles:view
    ('r3333333-3333-3333-3333-333333333333', 'p0000015-0000-0000-0000-000000000015'), -- agents:run
    ('r3333333-3333-3333-3333-333333333333', 'p0000016-0000-0000-0000-000000000016'); -- agents:view_results

-- Agent User: Only agent-related permissions
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('r4444444-4444-4444-4444-444444444444', 'p0000015-0000-0000-0000-000000000015'), -- agents:run
    ('r4444444-4444-4444-4444-444444444444', 'p0000016-0000-0000-0000-000000000016'); -- agents:view_results

-- =============================================================================
-- USER-ROLE ASSIGNMENTS
-- =============================================================================

-- Alice is org_admin in Acme Corp
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'r2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

-- Bob is org_member in Acme Corp
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'r3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

-- Charlie is org_admin in Tech Startup
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'r2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222');

-- Diana is org_admin in Healthcare Co
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'r2222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

-- =============================================================================
-- SAMPLE AGENT TASKS
-- =============================================================================

-- Task from Alice in Acme Corp
INSERT INTO agent_tasks (id, organization_id, user_id, agent_type, status, input_data) VALUES
    ('t1111111-1111-1111-1111-111111111111', 
     '11111111-1111-1111-1111-111111111111', 
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 
     'counselor', 
     'completed',
     '{"query": "I need help with college admissions", "context": "high school senior"}');

-- Task from Charlie in Tech Startup
INSERT INTO agent_tasks (id, organization_id, user_id, agent_type, status, input_data) VALUES
    ('t2222222-2222-2222-2222-222222222222', 
     '22222222-2222-2222-2222-222222222222', 
     'cccccccc-cccc-cccc-cccc-cccccccccccc', 
     'support', 
     'running',
     '{"question": "How do I reset my password?", "urgency": "medium"}');

-- =============================================================================
-- SAMPLE AGENT RESULTS
-- =============================================================================

INSERT INTO agent_results (task_id, organization_id, result_data, execution_time_ms) VALUES
    ('t1111111-1111-1111-1111-111111111111',
     '11111111-1111-1111-1111-111111111111',
     '{"recommendation": "Start with SAT prep and focus on extracurriculars", "confidence": 0.92}',
     2340);

-- =============================================================================
-- SAMPLE AUDIT LOGS
-- =============================================================================

INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'create', 'agent_task', 't1111111-1111-1111-1111-111111111111', 'success'),
    ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'create', 'agent_task', 't2222222-2222-2222-2222-222222222222', 'success');