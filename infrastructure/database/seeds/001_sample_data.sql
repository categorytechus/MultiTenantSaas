-- Sample seed data for local development & testing
-- Seed: 001_sample_data.sql
-- Idempotent: safe to run multiple times (uses ON CONFLICT DO NOTHING)
--
-- Credentials:
--   superadmin@multitenant.com  password: Admin@1234  (user_type: super_admin)
--   alice@acme.com              password: Test@1234   (user_type: org_admin,  Acme Corp)
--   bob@acme.com                password: Test@1234   (user_type: user,       Acme Corp)
--   charlie@techstartup.io      password: Test@1234   (user_type: org_admin,  Tech Startup)
--   diana@healthcare.com        password: Test@1234   (user_type: org_admin,  Healthcare Co)

-- =============================================================================
-- ORGANIZATIONS
-- =============================================================================

INSERT INTO organizations (id, name, slug, domain, subscription_tier, status) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Acme Corporation', 'acme-corp',     'acme.com',       'enterprise', 'active'),
    ('22222222-2222-2222-2222-222222222222', 'Tech Startup Inc', 'tech-startup',  'techstartup.io', 'pro',        'active'),
    ('33333333-3333-3333-3333-333333333333', 'Healthcare Co',    'healthcare-co', 'healthcare.com', 'free',       'active')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- USERS
-- =============================================================================

-- Super Admin — global access, no org membership needed
-- Password: Admin@1234
INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type) VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        'local-super-admin',
        'superadmin@multitenant.com',
        true,
        'Super Admin',
        'active',
        '$2b$12$AQqW43OLmsrH1bpGv5v6AOn0bhCOysCEm8c7mpYVAjV/F.XhgdxSK',
        'super_admin'
    )
ON CONFLICT DO NOTHING;

-- Org admins and regular users — Password: Test@1234
INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'local-alice',   'alice@acme.com',         true, 'Alice Admin',  'active', '$2b$12$bWDBhpPvKSo.2yDPUduI1uwSUhmW/CUJktOCxApbbx5uCxNdGnV8K', 'org_admin'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'local-bob',     'bob@acme.com',           true, 'Bob Builder',  'active', '$2b$12$bWDBhpPvKSo.2yDPUduI1uwSUhmW/CUJktOCxApbbx5uCxNdGnV8K', 'user'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'local-charlie', 'charlie@techstartup.io', true, 'Charlie Chen', 'active', '$2b$12$bWDBhpPvKSo.2yDPUduI1uwSUhmW/CUJktOCxApbbx5uCxNdGnV8K', 'org_admin'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'local-diana',   'diana@healthcare.com',   true, 'Diana Doctor', 'active', '$2b$12$bWDBhpPvKSo.2yDPUduI1uwSUhmW/CUJktOCxApbbx5uCxNdGnV8K', 'org_admin')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- ORGANIZATION MEMBERSHIPS
-- =============================================================================

INSERT INTO organization_members (organization_id, user_id, role, status) VALUES
    -- Acme Corp: Alice is admin, Bob is member
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org_admin', 'active'),
    ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member',    'active'),
    -- Tech Startup: Charlie is admin
    ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'org_admin', 'active'),
    -- Healthcare Co: Diana is admin
    ('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'org_admin', 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- =============================================================================
-- SYSTEM ROLES
-- =============================================================================
INSERT INTO roles (id, name, description, is_system, organization_id) VALUES
    ('e2222222-2222-2222-2222-222222222222', 'org_admin', 'Organization administrator', true, NULL)
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_system = true,
    organization_id = NULL;
    
/*
-- Note: super_admin is NOT a role — it is a user_type on the users table.
--       It is intentionally excluded here so it never appears in the roles UI.
INSERT INTO roles (id, name, description, is_system, organization_id) VALUES
    ('e2222222-2222-2222-2222-222222222222', 'org_admin',  'Organization administrator',   true, NULL),
    ('e3333333-3333-3333-3333-333333333333', 'org_member', 'Regular organization member',  true, NULL),
    ('e4444444-4444-4444-4444-444444444444', 'agent_user', 'User who can run AI agents',   true, NULL)
ON CONFLICT (id) DO NOTHING;
*/

-- =============================================================================
-- PERMISSIONS
-- =============================================================================

INSERT INTO permissions (id, resource, action, description) VALUES
    -- Organization permissions
    ('f0000001-0000-0000-0000-000000000001', 'organizations', 'create',      'Create new organizations'),
    ('f0000002-0000-0000-0000-000000000002', 'organizations', 'view',        'View organization details'),
    ('f0000003-0000-0000-0000-000000000003', 'organizations', 'update',      'Update organization settings'),
    ('f0000004-0000-0000-0000-000000000004', 'organizations', 'delete',      'Delete organizations'),

    -- Member permissions
    ('f0000005-0000-0000-0000-000000000005', 'members',       'create',      'Invite new members'),
    ('f0000006-0000-0000-0000-000000000006', 'members',       'view',        'View organization members'),
    ('f0000007-0000-0000-0000-000000000007', 'members',       'update',      'Update member roles'),
    ('f0000008-0000-0000-0000-000000000008', 'members',       'delete',      'Remove members'),

    -- Role permissions
    ('f0000009-0000-0000-0000-000000000009', 'roles',         'create',      'Create custom roles'),
    ('f0000010-0000-0000-0000-000000000010', 'roles',         'view',        'View roles'),
    ('f0000011-0000-0000-0000-000000000011', 'roles',         'update',      'Update roles'),
    ('f0000012-0000-0000-0000-000000000012', 'roles',         'delete',      'Delete roles'),
    ('f0000013-0000-0000-0000-000000000013', 'roles',         'assign',      'Assign roles to users'),
    ('f0000014-0000-0000-0000-000000000014', 'roles',         'revoke',      'Revoke roles from users'),

    -- Agent permissions
    ('f0000015-0000-0000-0000-000000000015', 'agents',        'run',         'Execute AI agents'),
    ('f0000016-0000-0000-0000-000000000016', 'agents',        'view_results','View agent results'),
    ('f0000017-0000-0000-0000-000000000017', 'agents',        'cancel',      'Cancel running agents'),
    ('f0000019-0000-0000-0000-000000000019', 'agents',        'create',      'Create new agents via REST'),

    -- User management permissions
    ('f0000020-0000-0000-0000-000000000020', 'users',         'manage',      'Manage users via REST'),

    -- Audit permissions
    ('f0000018-0000-0000-0000-000000000018', 'audit_logs',    'view_all',    'View all audit logs')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- ROLE-PERMISSION MAPPINGS
-- =============================================================================

/*
-- Org Admin: all permissions except organizations:create
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'e2222222-2222-2222-2222-222222222222', id
FROM permissions
WHERE NOT (resource = 'organizations' AND action = 'create')
ON CONFLICT DO NOTHING;

-- Org Member: basic view + agent execution
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('e3333333-3333-3333-3333-333333333333', 'f0000002-0000-0000-0000-000000000002'),  -- organizations:view
    ('e3333333-3333-3333-3333-333333333333', 'f0000006-0000-0000-0000-000000000006'),  -- members:view
    ('e3333333-3333-3333-3333-333333333333', 'f0000010-0000-0000-0000-000000000010'),  -- roles:view
    ('e3333333-3333-3333-3333-333333333333', 'f0000015-0000-0000-0000-000000000015'),  -- agents:run
    ('e3333333-3333-3333-3333-333333333333', 'f0000016-0000-0000-0000-000000000016')   -- agents:view_results
ON CONFLICT DO NOTHING;

-- Agent User: agent permissions only
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('e4444444-4444-4444-4444-444444444444', 'f0000015-0000-0000-0000-000000000015'),  -- agents:run
    ('e4444444-4444-4444-4444-444444444444', 'f0000016-0000-0000-0000-000000000016')   -- agents:view_results
ON CONFLICT DO NOTHING;
*/

-- =============================================================================
-- USER-ROLE ASSIGNMENTS
-- Note: super_admin's access is governed by user_type='super_admin' on the
--       users table, so no user_roles row is needed for them.
--       Org-scoped roles require a non-null organization_id.
-- =============================================================================

/*
-- Alice: org_admin in Acme Corp
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

-- Bob: org_member in Acme Corp
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

-- Charlie: org_admin in Tech Startup
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'e2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

-- Diana: org_admin in Healthcare Co
INSERT INTO user_roles (user_id, role_id, organization_id) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e2222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
*/

-- =============================================================================
-- SAMPLE AGENT TASKS
-- =============================================================================

INSERT INTO agent_tasks (id, organization_id, user_id, agent_type, status, input_data) VALUES
    (
        'd1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'worker_agent1',
        'completed',
        '{"query": "I need help with college admissions", "context": "high school senior"}'
    ),
    (
        'd2222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'worker_agent3',
        'running',
        '{"question": "How do I reset my password?", "urgency": "medium"}'
    )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SAMPLE AGENT RESULTS
-- =============================================================================

INSERT INTO agent_results (id, task_id, organization_id, result_data, execution_time_ms) VALUES
    (
        'e5555555-5555-5555-5555-555555555551',
        'd1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        '{"recommendation": "Start with SAT prep and focus on extracurriculars", "confidence": 0.92}',
        2340
    )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SAMPLE AUDIT LOGS
-- =============================================================================

INSERT INTO audit_logs (id, organization_id, user_id, action, resource_type, resource_id, status) VALUES
    (
        'e6666666-6666-6666-6666-666666666661',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'create', 'agent_task', 'd1111111-1111-1111-1111-111111111111', 'success'
    ),
    (
        'e6666666-6666-6666-6666-666666666662',
        '22222222-2222-2222-2222-222222222222',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'create', 'agent_task', 'd2222222-2222-2222-2222-222222222222', 'success'
    )
ON CONFLICT (id) DO NOTHING;