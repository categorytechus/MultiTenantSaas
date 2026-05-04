"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-05-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TENANT_TABLES = [
    "org_memberships",
    "chat_sessions",
    "chat_messages",
    "agent_tasks",
    "documents",
    "document_chunks",
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "orgs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_orgs_slug", "orgs", ["slug"], unique=True)

    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "org_memberships",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_user_id", sa.String(), nullable=False),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("chat_id", sa.UUID(), sa.ForeignKey("chat_sessions.id"), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("input", sa.JSON(), nullable=True),
        sa.Column("output", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("resource_type", sa.String(), nullable=True),
        sa.Column("resource_id", sa.String(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    # documents — without extracted_title/summary/keywords, which are added in migration 003
    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("uploaded_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    # document_chunks — embedding starts as 1536-dim; migration 002 changes it to 384
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("org_id", sa.UUID(), sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column("document_id", sa.UUID(), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(
        "CREATE INDEX document_chunks_embedding_idx ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (org_id::text = current_setting('app.current_org_id', true))"
        )


def downgrade() -> None:
    for table in reversed(_TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")

    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("audit_logs")
    op.drop_table("agent_tasks")
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    op.drop_table("refresh_tokens")
    op.drop_table("oauth_identities")
    op.drop_table("org_memberships")
    op.drop_table("users")
    op.drop_table("orgs")
