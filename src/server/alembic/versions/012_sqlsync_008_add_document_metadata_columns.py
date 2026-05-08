"""SQL sync from 008_add_document_metadata_columns.sql

Revision ID: s009
Revises: s008
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "s009"
down_revision: Union[str, None] = "s008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = "-- Migration: Add metadata columns to documents table\n-- File: 008_add_document_metadata_columns.sql\n-- Created: 2025-03-11\n\nALTER TABLE documents\n  ADD COLUMN IF NOT EXISTS user_id_tag VARCHAR(255),\n  ADD COLUMN IF NOT EXISTS doc_type VARCHAR(100),\n  ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN DEFAULT FALSE,\n  ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(50),\n  ADD COLUMN IF NOT EXISTS assigned_user VARCHAR(255),\n  ADD COLUMN IF NOT EXISTS description TEXT;\n\n-- Add indexes for common queries\nCREATE INDEX IF NOT EXISTS idx_documents_user_id_tag ON documents(user_id_tag);\nCREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);\nCREATE INDEX IF NOT EXISTS idx_documents_confidential ON documents(is_confidential);\nCREATE INDEX IF NOT EXISTS idx_documents_assigned_role ON documents(assigned_role);\n\n-- Add comments\nCOMMENT ON COLUMN documents.user_id_tag IS 'S3 tag: user-id - identifier for the user who uploaded';\nCOMMENT ON COLUMN documents.doc_type IS 'S3 tag: doc-type - type/category of document';\nCOMMENT ON COLUMN documents.is_confidential IS 'S3 tag: confidential - whether document is confidential';\nCOMMENT ON COLUMN documents.assigned_role IS 'S3 tag: role - role assigned to access document';\nCOMMENT ON COLUMN documents.assigned_user IS 'S3 tag: specific-user - specific user assigned to access document';\nCOMMENT ON COLUMN documents.description IS 'User-provided description of the document';\n"


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: 008_add_document_metadata_columns.sql"
    )
