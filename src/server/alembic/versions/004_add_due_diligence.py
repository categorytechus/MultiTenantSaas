"""add due diligence tables and org columns

Revision ID: 004_add_due_diligence
Revises: 003_add_org_email
Create Date: 2026-06-26 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg

# revision identifiers, used by Alembic.
revision: str = '004_add_due_diligence'
down_revision: Union[str, None] = '003_add_org_email'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create due_diligence_studies table ─────────────────────────────────
    op.create_table(
        'due_diligence_studies',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('org_id', pg.UUID(as_uuid=True), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', pg.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('offering_category', sa.String(), nullable=False),
        sa.Column('offering_type', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='draft'),
        sa.Column('meta', pg.JSONB(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_due_diligence_studies_org_id', 'due_diligence_studies', ['org_id'])

    # ── 2. Create due_diligence_rules table ───────────────────────────────────
    op.create_table(
        'due_diligence_rules',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('org_id', pg.UUID(as_uuid=True), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('offering_category', sa.String(), nullable=False),
        sa.Column('offering_type', sa.String(), nullable=False),
        sa.Column('rule_key', sa.String(), nullable=False),
        sa.Column('rule_label', sa.String(), nullable=False),
        sa.Column('operator', sa.String(), nullable=False),
        sa.Column('threshold', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_due_diligence_rules_org_id', 'due_diligence_rules', ['org_id'])

    # ── 3. Add new columns to orgs ────────────────────────────────────────────
    op.add_column('orgs', sa.Column(
        'due_diligence_price_overrides',
        sa.JSON(),
        nullable=True,
        server_default='{}',
    ))
    op.add_column('orgs', sa.Column(
        'due_diligence_report_config',
        sa.JSON(),
        nullable=True,
        server_default='{}',
    ))

    # ── 4. Add unique constraint for workflow_outputs (session_id, type) ──────
    op.create_unique_constraint(
        'uq_workflow_outputs_session_type',
        'workflow_outputs',
        ['session_id', 'type']
    )

    # ── 5. Add due_diligence to master_modules ────────────────────────────────
    from sqlalchemy.dialects.postgresql import insert
    from sqlalchemy import table, column, String, Boolean, Integer, ARRAY

    master_modules = table('master_modules',
        column('id', String),
        column('name', String),
        column('enabled', Boolean),
        column('created_at', sa.TIMESTAMP(timezone=True)),
        column('label', String),
        column('description', String),
        column('parent_id', String),
        column('sort_order', Integer),
        column('permission_keys', ARRAY(String))
    )

    stmt = insert(master_modules).values(
        id='due_diligence',
        name='Due Diligence',
        enabled=True,
        created_at=sa.func.now(),
        label='Due Diligence',
        description='AI-powered investment due diligence analysis and report generation.',
        parent_id=None,
        sort_order=60,
        permission_keys=['due_diligence:read', 'due_diligence:create', 'due_diligence:delete']
    )
    op.execute(stmt.on_conflict_do_update(
        index_elements=['id'],
        set_={
            'name': stmt.excluded.name,
            'enabled': stmt.excluded.enabled,
            'label': stmt.excluded.label,
            'description': stmt.excluded.description,
            'sort_order': stmt.excluded.sort_order,
            'permission_keys': stmt.excluded.permission_keys
        }
    ))

    # ── 6. Add permissions ────────────────────────────────────────────────────
    permissions = table('permissions',
        column('id', sa.UUID),
        column('resource', String),
        column('action', String),
        column('description', String),
        column('created_at', sa.TIMESTAMP(timezone=True))
    )

    stmt_perms = insert(permissions).values([
        {'id': 'f0000000-0000-0000-0000-000000000001', 'resource': 'due_diligence', 'action': 'read', 'description': 'Due Diligence Read permission', 'created_at': sa.func.now()},
        {'id': 'f0000000-0000-0000-0000-000000000002', 'resource': 'due_diligence', 'action': 'create', 'description': 'Due Diligence Create permission', 'created_at': sa.func.now()},
        {'id': 'f0000000-0000-0000-0000-000000000003', 'resource': 'due_diligence', 'action': 'delete', 'description': 'Due Diligence Delete permission', 'created_at': sa.func.now()}
    ])
    op.execute(stmt_perms.on_conflict_do_nothing(index_elements=['id']))

    # ── 7. Grant new permissions to org_admin role ────────────────────────────
    # For insert ... select, we can use raw text since there's no native insert-select-on-conflict shorthand in standard SQLAlchemy without more boilerplate,
    # but we can do a simple select and insert if we want. Let's just use sa.text to execute the insert-select because it is fundamentally simpler than building an insert().from_select() with on_conflict_do_nothing().
    # Actually, we can use insert().from_select with on conflict:
    role_permissions = table('role_permissions',
        column('id', sa.UUID),
        column('role_id', sa.UUID),
        column('permission_id', sa.UUID),
        column('created_at', sa.TIMESTAMP(timezone=True))
    )
    
    select_stmt = sa.select(
        sa.func.gen_random_uuid(),
        sa.cast(sa.literal('e2222222-2222-2222-2222-222222222222'), sa.UUID),
        permissions.c.id,
        sa.func.now()
    ).where(permissions.c.resource == 'due_diligence')

    insert_roles = insert(role_permissions).from_select(
        ['id', 'role_id', 'permission_id', 'created_at'],
        select_stmt
    ).on_conflict_do_nothing()
    
    op.execute(insert_roles)


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM permissions WHERE resource = 'due_diligence'"))
    op.execute(sa.text("DELETE FROM master_modules WHERE id = 'due_diligence'"))
    op.drop_constraint('uq_workflow_outputs_session_type', 'workflow_outputs', type_='unique')
    op.drop_column('orgs', 'due_diligence_report_config')
    op.drop_column('orgs', 'due_diligence_price_overrides')
    op.drop_index('ix_due_diligence_rules_org_id', table_name='due_diligence_rules')
    op.drop_table('due_diligence_rules')
    op.drop_index('ix_due_diligence_studies_org_id', table_name='due_diligence_studies')
    op.drop_table('due_diligence_studies')
