"""add link_embed permission

Revision ID: 050_add_link_embed_permission
Revises: 049_add_image_content_hash
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '050'
down_revision = '049'
branch_labels = None
depends_on = None


def upgrade():
    # Insert permission into permissions table
    op.execute("""
        INSERT INTO permissions (id, resource, action, description, created_at)
        VALUES (gen_random_uuid(), 'link_embed', 'view', 'View enriched links in AI assistant', NOW())
        ON CONFLICT DO NOTHING;
    """)

    # Update ai_links module to include this permission
    op.execute("""
        UPDATE master_modules
        SET permission_keys = ARRAY['link_embed:view']::TEXT[]
        WHERE id = 'ai_links';
    """)

    # Grant to system roles (user, tenant_admin, super_admin)
    op.execute("""
        INSERT INTO role_permissions (id, role_id, permission_id, created_at)
        SELECT gen_random_uuid(), r.id, p.id, NOW()
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.name IN ('user', 'tenant_admin', 'super_admin')
          AND r.is_system = true
          AND p.resource = 'link_embed' AND p.action = 'view'
        ON CONFLICT DO NOTHING;
    """)


def downgrade():
    # Remove role permissions
    op.execute("""
        DELETE FROM role_permissions
        WHERE permission_id IN (
            SELECT id FROM permissions WHERE resource = 'link_embed' AND action = 'view'
        );
    """)

    # Clear ai_links module permission_keys
    op.execute("""
        UPDATE master_modules
        SET permission_keys = ARRAY[]::TEXT[]
        WHERE id = 'ai_links';
    """)

    # Delete permission
    op.execute("""
        DELETE FROM permissions WHERE resource = 'link_embed' AND action = 'view';
    """)
