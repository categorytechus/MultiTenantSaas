"""seed_data

Revision ID: 002
Revises: 001
Create Date: 2026-06-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, Sequence[str], None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- SEED DATA ---
    op.execute("""
        INSERT INTO orgs (id, name, slug, domain, status, subscription_tier, cost_seg_price_overrides, created_at)
        VALUES
          ('11111111-1111-1111-1111-111111111111', 'Acme Corporation', 'acme', 'acme.com', 'active', 'enterprise', '{}'::json, NOW()),
          ('22222222-2222-2222-2222-222222222222', 'Tech Startup Inc', 'techstart', 'techstartup.io', 'active', 'pro', '{}'::json, NOW()),
          ('33333333-3333-3333-3333-333333333333', 'Healthcare Co', 'healthco', 'healthcare.com', 'active', 'free', '{}'::json, NOW())
        ON CONFLICT (id) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO users (id, email, hashed_password, name, created_at) VALUES
          ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@acme.com', '$2b$12$TYB2rz/Qu8rOShtBMG3/I.XbxkYAZxTpIHLYV5RAXbaq08Dq8rTk2', 'Alice Admin', NOW()),
          ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'charlie@techstartup.io', '$2b$12$TYB2rz/Qu8rOShtBMG3/I.XbxkYAZxTpIHLYV5RAXbaq08Dq8rTk2', 'Charlie Founder', NOW())
        ON CONFLICT (id) DO UPDATE SET hashed_password = EXCLUDED.hashed_password;
    """)

    op.execute("""
        INSERT INTO org_memberships (id, org_id, user_id, role, created_at)
        VALUES
          ('aaaaaaaa-1111-1111-1111-aaaaaaaa1111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org_admin', NOW()),
          ('cccccccc-3333-3333-3333-cccccccc3333', '22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'org_admin', NOW())
        ON CONFLICT (id) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO agent_tasks (id, org_id, user_id, type, status, input, created_at)
        VALUES
          ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'worker_agent1', 'completed', '{"message":"What were Q4 sales?"}'::json, NOW()),
          ('d2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'worker_agent2', 'failed', '{"message":"Summarize churn drivers"}'::json, NOW())
        ON CONFLICT (id) DO NOTHING;
    """)

    op.execute("""
        INSERT INTO users (id, email, hashed_password, name, created_at)
        VALUES (
          '99999999-9999-9999-9999-999999999999',
          'superadmin@multitenant.com',
          '$2b$12$TYB2rz/Qu8rOShtBMG3/I.XbxkYAZxTpIHLYV5RAXbaq08Dq8rTk2',
          'Super Admin',
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET hashed_password = EXCLUDED.hashed_password;
    """)

    op.execute("""
        INSERT INTO org_memberships (id, user_id, org_id, role, created_at)
        VALUES (
          '99999999-1111-1111-1111-999999999999',
          '99999999-9999-9999-9999-999999999999',
          '11111111-1111-1111-1111-111111111111',
          'org_admin',
          NOW()
        )
        ON CONFLICT (id) DO NOTHING;
    """)

    op.execute("""
    INSERT INTO master_modules (id, name, enabled, created_at, label, description, parent_id, sort_order, permission_keys)
    VALUES
      ('ai_assistant', 'AI Assistant', true, NOW(), 'AI Assistant', 'AI assistant tools and chat capabilities.', NULL, 10, ARRAY['ai_assistant:chat']),
      ('ai_images', 'Images', true, NOW(), 'Images', 'Image embedding in chat.', 'ai_assistant', 11, '{}'),
      ('ai_links', 'Links', true, NOW(), 'Links', 'Link embeddings in chat.', 'ai_assistant', 12, '{}'),
      ('report_generation', 'Report Generation', true, NOW(), 'Report Generation', 'Generate PDF reports in chat.', 'ai_assistant', 13, '{}'),
      ('cost_seg', 'Cost Segregation', true, NOW(), 'Cost Segregation', 'IRS MACRS cost segregation classification.', NULL, 20, ARRAY['cost_seg:read','cost_seg:create','cost_seg:delete']),
      ('documents', 'Documents', true, NOW(), 'Documents', 'Document library and document actions.', NULL, 30, ARRAY['documents:view','documents:create','documents:upload','documents:update','documents:delete']),
      ('web_urls', 'Web URLs', true, NOW(), 'Web URLs', 'Manage web URL records and sources.', NULL, 40, ARRAY['web_urls:view','web_urls:create','web_urls:update','web_urls:delete']),
      ('api_calling', 'API Calling', true, NOW(), 'API Calling', 'Enable outbound API actions and webhook integrations.', NULL, 50, ARRAY['api_calling:execute'])
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          enabled = EXCLUDED.enabled,
          label = EXCLUDED.label,
          description = EXCLUDED.description,
          parent_id = EXCLUDED.parent_id,
          sort_order = EXCLUDED.sort_order,
          permission_keys = EXCLUDED.permission_keys;
    """)

    op.execute("""
    INSERT INTO roles (id, name, description, is_system, organization_id, created_at)
    VALUES
      ('e2222222-2222-2222-2222-222222222222', 'org_admin', 'Organization administrator (system role)', TRUE, NULL, NOW())
    ON CONFLICT (id) DO NOTHING;
    """)

    op.execute("""
    INSERT INTO permissions (id, resource, action, description, created_at)
    VALUES
      ('a0000000-0000-0000-0000-000000000001', 'ai_assistant', 'chat',   'AI Assistant Chat permission',      NOW()),
      ('b0000000-0000-0000-0000-000000000001', 'documents',    'view',   'Documents View permission',         NOW()),
      ('b0000000-0000-0000-0000-000000000002', 'documents',    'create', 'Documents Create permission',       NOW()),
      ('b0000000-0000-0000-0000-000000000003', 'documents',    'update', 'Documents Update permission',       NOW()),
      ('b0000000-0000-0000-0000-000000000004', 'documents',    'delete', 'Documents Delete permission',       NOW()),
      ('b0000000-0000-0000-0000-000000000005', 'documents',    'upload', 'Documents Upload permission',       NOW()),
      ('c0000000-0000-0000-0000-000000000001', 'web_urls',     'view',   'Web URLs View permission',          NOW()),
      ('c0000000-0000-0000-0000-000000000002', 'web_urls',     'create', 'Web URLs Create permission',        NOW()),
      ('c0000000-0000-0000-0000-000000000003', 'web_urls',     'update', 'Web URLs Update permission',        NOW()),
      ('c0000000-0000-0000-0000-000000000004', 'web_urls',     'delete', 'Web URLs Delete permission',        NOW()),
      ('d0000000-0000-0000-0000-000000000001', 'cost_seg',     'read',   'Cost Segregation Read permission',  NOW()),
      ('d0000000-0000-0000-0000-000000000002', 'cost_seg',     'create', 'Cost Segregation Create permission',NOW()),
      ('d0000000-0000-0000-0000-000000000003', 'cost_seg',     'delete', 'Cost Segregation Delete permission',NOW()),
      ('e0000000-0000-0000-0000-000000000001', 'api_calling',  'execute','API Calling Execute permission',    NOW())
    ON CONFLICT (id) DO NOTHING;
    """)


    op.execute("""
    INSERT INTO role_permissions (id, role_id, permission_id, created_at)
    SELECT gen_random_uuid(), 'e2222222-2222-2222-2222-222222222222', id, NOW()
    FROM permissions
    ON CONFLICT DO NOTHING;
    """)

def downgrade() -> None:
    pass
