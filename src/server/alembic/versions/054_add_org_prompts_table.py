"""add org_prompts table

Revision ID: 054
Revises: 053
Create Date: 2026-06-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json
import os

# revision identifiers, used by Alembic.
revision = '054'
down_revision = '053'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create table if not exists
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'org_prompts' not in inspector.get_table_names():
        op.create_table(
            'org_prompts',
            sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
            sa.Column('org_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('workflow', sa.String(), nullable=False),
            sa.Column('slot', sa.String(), nullable=False),
            sa.Column('template', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['org_id'], ['orgs.id'], ),
        )
        op.create_index(op.f('ix_org_prompts_org_id'), 'org_prompts', ['org_id'], unique=False)

    current_dir = os.path.dirname(os.path.abspath(__file__))
    chat_json_path = os.path.join(current_dir, '..', '..', 'app', 'prompts', 'chat.json')
    chat_json_path = os.path.abspath(chat_json_path)
    
    import json
    with open(chat_json_path, 'r', encoding='utf-8') as f:
        chat_prompts = json.load(f)

    bind = op.get_bind()
    orgs = bind.execute(sa.text("SELECT id FROM orgs")).fetchall()
    
    if 'org_prompts' not in inspector.get_table_names():
        if orgs:
            for org in orgs:
                org_id = org[0]
                for workflow, slots in chat_prompts.items():
                    for slot, template in slots.items():
                        bind.execute(
                            sa.text("""
                                INSERT INTO org_prompts (id, org_id, workflow, slot, template, created_at, updated_at)
                                VALUES (gen_random_uuid(), :org_id, :workflow, :slot, :template, NOW(), NOW())
                            """),
                            {"org_id": org_id, "workflow": workflow, "slot": slot, "template": template}
                        )


def downgrade():
    op.drop_index(op.f('ix_org_prompts_org_id'), table_name='org_prompts')
    op.drop_table('org_prompts')
