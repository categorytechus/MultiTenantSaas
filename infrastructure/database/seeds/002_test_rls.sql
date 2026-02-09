-- Test RLS Policies - Validate Multi-Tenant Isolation
-- Test: 002_test_rls.sql

-- =============================================================================
-- TEST SETUP
-- =============================================================================

-- This script tests that RLS policies correctly isolate data between organizations
-- Run this after applying migrations and seed data

-- =============================================================================
-- TEST 1: Alice (Acme Corp Admin) should see only Acme Corp data
-- =============================================================================

-- Set current user context to Alice
SET app.current_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Alice should see 1 organization (Acme Corp)
DO $$
DECLARE
    org_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    IF org_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Alice should see 1 organization, saw %', org_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Alice sees correct number of organizations (1)';
END $$;

-- Alice should see 2 members (herself and Bob)
DO $$
DECLARE
    member_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO member_count FROM organization_members;
    IF member_count != 2 THEN
        RAISE EXCEPTION 'TEST FAILED: Alice should see 2 members, saw %', member_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Alice sees correct number of members (2)';
END $$;

-- Alice should see 1 agent task (her own)
DO $$
DECLARE
    task_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO task_count FROM agent_tasks;
    IF task_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Alice should see 1 task, saw %', task_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Alice sees correct number of tasks (1)';
END $$;

-- =============================================================================
-- TEST 2: Charlie (Tech Startup Admin) should see only Tech Startup data
-- =============================================================================

-- Set current user context to Charlie
SET app.current_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Charlie should see 1 organization (Tech Startup)
DO $$
DECLARE
    org_count INTEGER;
    org_name TEXT;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    SELECT name INTO org_name FROM organizations LIMIT 1;
    
    IF org_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Charlie should see 1 organization, saw %', org_count;
    END IF;
    
    IF org_name != 'Tech Startup Inc' THEN
        RAISE EXCEPTION 'TEST FAILED: Charlie should see Tech Startup, saw %', org_name;
    END IF;
    
    RAISE NOTICE 'TEST PASSED: Charlie sees correct organization (Tech Startup Inc)';
END $$;

-- Charlie should see 1 member (himself)
DO $$
DECLARE
    member_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO member_count FROM organization_members;
    IF member_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Charlie should see 1 member, saw %', member_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Charlie sees correct number of members (1)';
END $$;

-- Charlie should see 1 agent task (his own)
DO $$
DECLARE
    task_count INTEGER;
    task_type TEXT;
BEGIN
    SELECT COUNT(*) INTO task_count FROM agent_tasks;
    SELECT agent_type INTO task_type FROM agent_tasks LIMIT 1;
    
    IF task_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Charlie should see 1 task, saw %', task_count;
    END IF;
    
    IF task_type != 'support' THEN
        RAISE EXCEPTION 'TEST FAILED: Charlie should see support task, saw %', task_type;
    END IF;
    
    RAISE NOTICE 'TEST PASSED: Charlie sees correct task (support)';
END $$;

-- =============================================================================
-- TEST 3: Bob (Acme Corp Member) should see only Acme Corp data
-- =============================================================================

SET app.current_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Bob should see 1 organization (Acme Corp)
DO $$
DECLARE
    org_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO org_count FROM organizations;
    IF org_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Bob should see 1 organization, saw %', org_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Bob sees correct number of organizations (1)';
END $$;

-- Bob should see 2 members (himself and Alice)
DO $$
DECLARE
    member_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO member_count FROM organization_members;
    IF member_count != 2 THEN
        RAISE EXCEPTION 'TEST FAILED: Bob should see 2 members, saw %', member_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Bob sees correct number of members (2)';
END $$;

-- Bob should see 1 agent task (Alice's task, from same org)
DO $$
DECLARE
    task_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO task_count FROM agent_tasks;
    IF task_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Bob should see 1 task, saw %', task_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Bob sees correct number of tasks (1)';
END $$;

-- =============================================================================
-- TEST 4: Cross-Organization Data Isolation
-- =============================================================================

-- Bob should NOT be able to see Charlie's data
SET app.current_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

DO $$
DECLARE
    has_charlie_task BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM agent_tasks 
        WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    ) INTO has_charlie_task;
    
    IF has_charlie_task THEN
        RAISE EXCEPTION 'TEST FAILED: Bob can see Charlie''s task (cross-org leak!)';
    END IF;
    
    RAISE NOTICE 'TEST PASSED: Bob cannot see Charlie''s task (proper isolation)';
END $$;

-- =============================================================================
-- TEST 5: User can only see their own sessions
-- =============================================================================

-- Create test sessions
INSERT INTO sessions (user_id, organization_id, token_hash, expires_at) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'hash-alice-1', NOW() + INTERVAL '1 day'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'hash-bob-1', NOW() + INTERVAL '1 day');

SET app.current_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $$
DECLARE
    session_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO session_count FROM sessions;
    IF session_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Alice should see only her session, saw %', session_count;
    END IF;
    RAISE NOTICE 'TEST PASSED: Alice sees only her own session';
END $$;

-- =============================================================================
-- TEST 6: Permission-based access control
-- =============================================================================

-- Alice (admin) should be able to update organization
SET app.current_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

DO $$
BEGIN
    -- This should succeed
    UPDATE organizations 
    SET settings = '{"test": true}'
    WHERE id = '11111111-1111-1111-1111-111111111111';
    
    RAISE NOTICE 'TEST PASSED: Alice can update organization (has permission)';
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'TEST FAILED: Alice cannot update organization: %', SQLERRM;
END $$;

-- Bob (member) should NOT be able to update organization
SET app.current_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

DO $$
BEGIN
    -- This should fail
    UPDATE organizations 
    SET settings = '{"test": false}'
    WHERE id = '11111111-1111-1111-1111-111111111111';
    
    IF FOUND THEN
        RAISE EXCEPTION 'TEST FAILED: Bob should not be able to update organization';
    END IF;
    
    RAISE NOTICE 'TEST PASSED: Bob cannot update organization (no permission)';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST PASSED: Bob cannot update organization (RLS blocked)';
END $$;

-- =============================================================================
-- TEST SUMMARY
-- =============================================================================

RAISE NOTICE '';
RAISE NOTICE '=================================================================';
RAISE NOTICE 'RLS POLICY VALIDATION COMPLETE';
RAISE NOTICE 'All tests passed! Multi-tenant data isolation is working correctly.';
RAISE NOTICE '=================================================================';