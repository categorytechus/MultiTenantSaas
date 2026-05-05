"""seed default data

Revision ID: s016
Revises: s015
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s016"
down_revision: Union[str, None] = "s015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.orgs') IS NOT NULL THEN
            INSERT INTO orgs (id, slug, name, created_at) VALUES
              ('11111111-1111-1111-1111-111111111111', 'acme', 'Acme Corporation', NOW()),
              ('22222222-2222-2222-2222-222222222222', 'techstart', 'Tech Startup Inc', NOW()),
              ('33333333-3333-3333-3333-333333333333', 'healthco', 'Healthcare Co', NOW())
            ON CONFLICT (id) DO NOTHING;
          ELSIF to_regclass('public.organizations') IS NOT NULL THEN
            INSERT INTO organizations (id, name, slug, domain, status, subscription_tier, settings, created_at, updated_at)
            VALUES
              ('11111111-1111-1111-1111-111111111111', 'Acme Corporation', 'acme', 'acme.com', 'active', 'enterprise', '{}'::jsonb, NOW(), NOW()),
              ('22222222-2222-2222-2222-222222222222', 'Tech Startup Inc', 'techstart', 'techstartup.io', 'active', 'pro', '{}'::jsonb, NOW(), NOW()),
              ('33333333-3333-3333-3333-333333333333', 'Healthcare Co', 'healthco', 'healthcare.com', 'active', 'free', '{}'::jsonb, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.orgs') IS NOT NULL THEN
            INSERT INTO users (id, email, hashed_password, name, created_at) VALUES
              ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@acme.com',
               '$2b$12$bWDBhpPvKSo.2yDPUduI1uwSUhmW/CUJktOCxApbbx5uCxNdGnV8K',
               'Alice Admin', NOW()),
              ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@acme.com',
               '$2b$12$YE8Q53x7On08G8fPW5Ihce9iV9F8A6vQiv7xQzoj9QqZ2h9wzaSRe',
               'Bob Member', NOW()),
              ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'charlie@techstartup.io',
               '$2b$12$wVHyM1r/7iPZ5m2QvS8r9eK5G8hAfzN9bD9tR2Q2u6X7wz8K7x9uG',
               'Charlie Founder', NOW())
            ON CONFLICT (id) DO NOTHING;
          ELSE
            INSERT INTO users (
              id, cognito_sub, email, email_verified, full_name, status,
              created_at, updated_at
            ) VALUES
              ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'local-alice', 'alice@acme.com', true, 'Alice Admin', 'active', NOW(), NOW()),
              ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'local-bob', 'bob@acme.com', true, 'Bob Member', 'active', NOW(), NOW()),
              ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'local-charlie', 'charlie@techstartup.io', true, 'Charlie Founder', 'active', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.org_memberships') IS NOT NULL THEN
            INSERT INTO org_memberships (id, user_id, org_id, role, created_at) VALUES
              ('aaaaaaaa-1111-1111-1111-aaaaaaaa1111',
               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               '11111111-1111-1111-1111-111111111111',
               'tenant_admin', NOW()),
              ('bbbbbbbb-2222-2222-2222-bbbbbbbb2222',
               'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
               '11111111-1111-1111-1111-111111111111',
               'user', NOW()),
              ('cccccccc-3333-3333-3333-cccccccc3333',
               'cccccccc-cccc-cccc-cccc-cccccccccccc',
               '22222222-2222-2222-2222-222222222222',
               'tenant_admin', NOW())
            ON CONFLICT (id) DO NOTHING;
          ELSIF to_regclass('public.organization_members') IS NOT NULL THEN
            INSERT INTO organization_members (
              id, organization_id, user_id, role, status, joined_at, created_at, updated_at
            ) VALUES
              ('aaaaaaaa-1111-1111-1111-aaaaaaaa1111',
               '11111111-1111-1111-1111-111111111111',
               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'tenant_admin', 'active', NOW(), NOW(), NOW()),
              ('bbbbbbbb-2222-2222-2222-bbbbbbbb2222',
               '11111111-1111-1111-1111-111111111111',
               'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
               'user', 'active', NOW(), NOW(), NOW()),
              ('cccccccc-3333-3333-3333-cccccccc3333',
               '22222222-2222-2222-2222-222222222222',
               'cccccccc-cccc-cccc-cccc-cccccccccccc',
               'tenant_admin', 'active', NOW(), NOW(), NOW())
            ON CONFLICT (organization_id, user_id) DO NOTHING;
          END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('public.orgs') IS NOT NULL THEN
            INSERT INTO agent_tasks (id, org_id, user_id, type, status, input, output, error, created_at, completed_at)
            VALUES
              ('d1111111-1111-1111-1111-111111111111',
               '11111111-1111-1111-1111-111111111111',
               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'chat', 'succeeded',
               '{"message":"What were Q4 sales?"}'::json,
               '{"answer":"Q4 sales increased by 18%"}'::json,
               NULL, NOW(), NOW()),
              ('d2222222-2222-2222-2222-222222222222',
               '22222222-2222-2222-2222-222222222222',
               'cccccccc-cccc-cccc-cccc-cccccccccccc',
               'chat', 'failed',
               '{"message":"Summarize churn drivers"}'::json,
               NULL,
               'Insufficient data',
               NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
          ELSE
            INSERT INTO agent_tasks (
              id, organization_id, user_id, agent_type, status, input_data,
              retry_count, max_retries, priority, created_at, updated_at
            ) VALUES
              ('d1111111-1111-1111-1111-111111111111',
               '11111111-1111-1111-1111-111111111111',
               'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'worker_agent1', 'completed',
               '{"message":"What were Q4 sales?"}'::jsonb,
               0, 3, 0, NOW(), NOW()),
              ('d2222222-2222-2222-2222-222222222222',
               '22222222-2222-2222-2222-222222222222',
               'cccccccc-cccc-cccc-cccc-cccccccccccc',
               'worker_agent2', 'failed',
               '{"message":"Summarize churn drivers"}'::jsonb,
               1, 3, 0, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM agent_tasks
        WHERE id IN (
          'd1111111-1111-1111-1111-111111111111',
          'd2222222-2222-2222-2222-222222222222'
        );
        """
    )
    op.execute(
        """
        DELETE FROM org_memberships
        WHERE id IN (
          'aaaaaaaa-1111-1111-1111-aaaaaaaa1111',
          'bbbbbbbb-2222-2222-2222-bbbbbbbb2222',
          'cccccccc-3333-3333-3333-cccccccc3333'
        );
        """
    )
    op.execute(
        """
        DELETE FROM users
        WHERE id IN (
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'cccccccc-cccc-cccc-cccc-cccccccccccc'
        );
        """
    )
    op.execute(
        """
        DELETE FROM orgs
        WHERE id IN (
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333'
        );
        """
    )
