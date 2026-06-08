"""add image content_hash

Revision ID: 049
Revises: 048
Create Date: 2026-06-05

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '049'
down_revision = '048'
branch_labels = None
depends_on = None


def upgrade():
    # Add content_hash column to document_images
    op.add_column('document_images',
        sa.Column('content_hash', sa.String(length=64), nullable=True, comment='SHA-256 hash of image bytes'))

    # Create index for faster lookups
    op.create_index('ix_document_images_content_hash', 'document_images', ['content_hash'], unique=False)


def downgrade():
    op.drop_index('ix_document_images_content_hash', table_name='document_images')
    op.drop_column('document_images', 'content_hash')
