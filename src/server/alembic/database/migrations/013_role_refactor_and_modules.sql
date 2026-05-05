-- Migration 013: Role-based org admin refactor + modules/invite tables
-- Removes org_admin from users.user_type, makes it a system role per org

-- Step 1: Ensure the org_admin system role exists
INSERT INTO roles (id, name, description, is_system, organization_id)
VALUES ('e2222222-2222-2222-2222-222222222222', 'org_admin', 'Organization administrator', true, NULL)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      is_system = true, organization_id = NULL;

-- Step 2: Backfill user_roles for all existing org_admin users
-- (ensures every org_admin user has the system role assigned per org)
INSERT INTO user_roles (id, user_id, role_id, organization_id, granted_at, created_at)
SELECT
  gen_random_uuid(),
  u.id,
  'e2222222-2222-2222-2222-222222222222',
  om.organization_id,
  NOW(),
  NOW()
FROM users u
JOIN organization_members om ON u.id = om.user_id
WHERE u.user_type = 'org_admin'
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;

-- Step 3: Downgrade org_admin user_type to 'user'
UPDATE users SET user_type = 'user' WHERE user_type = 'org_admin';

-- Step 4: Update the CHECK constraint to remove 'org_admin'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('super_admin', 'user'));

-- Step 5: Add setup_token columns for set-password link flow
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS setup_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS setup_token_expiry TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_setup_token_idx ON users (setup_token)
  WHERE setup_token IS NOT NULL;

-- Step 6: Create invite_tokens table (for invite → signup links)
CREATE TABLE IF NOT EXISTS invite_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token          VARCHAR(64) UNIQUE NOT NULL,
  email          CITEXT NOT NULL,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role           VARCHAR(50) NOT NULL DEFAULT 'user',
  invited_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invite_tokens_email_idx ON invite_tokens (email);
CREATE INDEX IF NOT EXISTS invite_tokens_org_id_idx ON invite_tokens (org_id);

-- Step 7: Create org_modules table (super admin assigns modules to orgs)
CREATE TABLE IF NOT EXISTS org_modules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id    VARCHAR(50) NOT NULL,
  assigned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, module_id)
);

CREATE INDEX IF NOT EXISTS org_modules_org_id_idx ON org_modules (org_id);

-- Step 8: Create role_org_permissions table (org admin assigns sub-permissions to roles)
CREATE TABLE IF NOT EXISTS role_org_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permission_id  VARCHAR(50) NOT NULL,
  granted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, org_id, permission_id)
);

CREATE INDEX IF NOT EXISTS role_org_permissions_role_org_idx
  ON role_org_permissions (role_id, org_id);