# Database Schema

PostgreSQL 16 with the `pgvector` extension. Migrations live in `src/server/alembic/versions/` and are managed with Alembic.

```bash
make migrate                        # alembic upgrade head
make migrate-new msg='description'  # autogenerate new migration
```

> **RLS note:** Alembic autogenerate does not emit Row-Level Security DDL. Any new tenant-scoped table must have its `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and `CREATE POLICY` statements added manually to its migration.

---

## Table Overview

| Table | Tenant-scoped (RLS) | Description |
|---|:---:|---|
| `orgs` | | Tenant organisations |
| `users` | | User accounts (cross-org identity) |
| `org_memberships` | ✓ | Maps a user to an org with a role |
| `oauth_identities` | | OAuth provider links per user |
| `refresh_tokens` | | Long-lived auth tokens (stored hashed) |
| `chat_sessions` | ✓ | Conversation threads |
| `chat_messages` | ✓ | Individual messages within a session |
| `agent_tasks` | ✓ | Background AI job tracking |
| `audit_logs` | | Event log (org_id nullable for system events) |
| `documents` | ✓ | Uploaded files |
| `document_chunks` | ✓ | Text chunks + vector embeddings |

---

## Tables

### `orgs`

One row per tenant organisation.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `varchar` | NOT NULL, unique index |
| `name` | `varchar` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_orgs_slug` (unique)

---

### `users`

Application users. A user is created once and linked to an org via `org_memberships`. Passwords are optional — accounts may be OAuth-only.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `email` | `varchar` | NOT NULL, unique index |
| `hashed_password` | `varchar` | nullable (OAuth-only accounts have no password) |
| `name` | `varchar` | nullable |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_users_email` (unique)

---

### `org_memberships`

Join table that assigns a user to exactly one org with a role. The `user_id` unique constraint enforces that a user belongs to at most one org.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL, **unique** |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `role` | `varchar` | NOT NULL — one of `SUPER_ADMIN`, `TENANT_ADMIN`, `USER`, `VIEWER` |
| `created_at` | `timestamptz` | NOT NULL |

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `oauth_identities`

Links a user to an external OAuth provider identity. One user can have multiple identities (e.g. GitHub + Google).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `provider` | `varchar` | NOT NULL — e.g. `github`, `google` |
| `provider_user_id` | `varchar` | NOT NULL — the ID from the provider |

No RLS — accessed only during auth flows before an org context is established.

---

### `refresh_tokens`

Long-lived tokens used to issue new access JWTs. The raw token is sent to the client; only its bcrypt hash is stored.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `token_hash` | `varchar` | NOT NULL |
| `expires_at` | `timestamptz` | NOT NULL — 30 days from issue |
| `revoked` | `boolean` | NOT NULL, default `false` |

No RLS — auth endpoints bypass the normal `get_db` flow.

---

### `chat_sessions`

A conversation thread belonging to a user within a tenant.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `title` | `varchar` | nullable (set by the application after first exchange) |
| `created_at` | `timestamptz` | NOT NULL |

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `chat_messages`

Individual messages within a chat session. Both user and assistant turns are stored here.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `chat_id` | `uuid` | FK → `chat_sessions.id`, NOT NULL |
| `role` | `varchar` | NOT NULL — `user` or `assistant` |
| `content` | `text` | NOT NULL |
| `sources` | `jsonb` | nullable — document chunks cited by the assistant |
| `created_at` | `timestamptz` | NOT NULL |

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `agent_tasks`

Tracks every background AI job dispatched to the Arq worker. The server creates a task before enqueuing the job; the agent updates it via `/internal/tasks/{id}`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `type` | `varchar` | NOT NULL — `chat` or `text_to_sql` |
| `status` | `varchar` | NOT NULL — see lifecycle below |
| `input` | `jsonb` | nullable — job input payload |
| `output` | `jsonb` | nullable — job result payload |
| `error` | `varchar` | nullable — error message on failure |
| `created_at` | `timestamptz` | NOT NULL |
| `completed_at` | `timestamptz` | nullable — set on `succeeded` or `failed` |

**Status lifecycle:** `pending` → `running` → `succeeded` / `failed`

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `audit_logs`

Append-only event log. `org_id` and `user_id` are nullable to allow system-level events that are not scoped to a tenant or user.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, nullable |
| `user_id` | `uuid` | FK → `users.id`, nullable |
| `action` | `varchar` | NOT NULL — e.g. `document.uploaded`, `user.login` |
| `resource_type` | `varchar` | nullable — e.g. `document`, `chat_session` |
| `resource_id` | `varchar` | nullable — string ID of the affected resource |
| `extra` | `jsonb` | nullable — arbitrary structured metadata |
| `created_at` | `timestamptz` | NOT NULL |

No RLS — filtered at the application layer based on role.

---

### `documents`

Represents an uploaded file. The actual bytes live in S3 (or `LOCAL_UPLOAD_DIR` for local dev); this row tracks metadata and processing status.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `s3_key` | `varchar` | NOT NULL — format: `{org_id}/{doc_id}.{ext}` |
| `filename` | `varchar` | NOT NULL — original upload filename |
| `mime_type` | `varchar` | nullable |
| `size_bytes` | `integer` | nullable |
| `status` | `varchar` | NOT NULL — see lifecycle below |
| `uploaded_by` | `uuid` | FK → `users.id`, nullable |
| `created_at` | `timestamptz` | NOT NULL |
| `extracted_title` | `text` | nullable — extracted by ingest job *(added migration 003)* |
| `summary` | `text` | nullable — generated summary *(added migration 003)* |
| `keywords` | `jsonb` | nullable — extracted keyword list *(added migration 003)* |

**Status lifecycle:** `processing` → `ready` / `failed` / `blocked`

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `document_chunks`

Text chunks produced by the ingest pipeline, each with a vector embedding for semantic search.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `document_id` | `uuid` | FK → `documents.id`, NOT NULL |
| `chunk_index` | `integer` | NOT NULL — zero-based position within the document |
| `content` | `text` | NOT NULL — raw chunk text |
| `embedding` | `vector(384)` | nullable — local embedding model output |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `document_chunks_embedding_idx` — HNSW index on `embedding` using cosine distance (`vector_cosine_ops`)

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

**Chunking parameters (ingest job):** 800-character chunks, 100-character overlap.

---

## Row-Level Security

Every tenant-scoped table has these three statements applied in migration 001:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
    USING (org_id::text = current_setting('app.current_org_id', true));
```

The application sets the GUC at the start of every transaction:

```python
# src/server/app/core/db.py — set_rls_context()
await session.execute(text(f"SET LOCAL app.current_org_id = '{org_id!s}'"))
```

`SET LOCAL` scopes the value to the current transaction. When the transaction commits or rolls back, the GUC resets automatically — no cross-request leakage via the connection pool.

If the JWT has no `org_id` (unauthenticated or system calls), the session is set to the nil UUID `00000000-0000-0000-0000-000000000000`, which matches no tenant row.

---

## Vector Search

`document_chunks.embedding` is a 384-dimensional vector produced by a local embedding model. The HNSW index enables sub-linear approximate nearest-neighbour search:

```sql
-- Index created in migration 001, recreated in migration 002 after dimension change
CREATE INDEX document_chunks_embedding_idx
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops);
```

Similarity query pattern used by the chat agent:

```sql
SELECT content, 1 - (embedding <=> $1::vector) AS score
FROM document_chunks
WHERE document_id = ANY($2)   -- RLS also applies
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

The `<=>` operator is cosine distance (0 = identical, 2 = opposite). The HNSW index is only used when there is no restrictive `WHERE` filter that forces a sequential scan.

---

## Migration History

| ID | Name | Key changes |
|---|---|---|
| `001` | initial schema | All tables, pgvector extension, RLS policies, HNSW index (Vector(1536)) |
| `002` | local embeddings | `document_chunks.embedding` changed from `vector(1536)` to `vector(384)`; HNSW index recreated |
| `003` | document metadata | `extracted_title`, `summary`, `keywords` columns added to `documents` |

Migrations are in `src/server/alembic/versions/`. The `downgrade()` functions are implemented for all migrations.
