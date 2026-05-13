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
| `invite_tokens` | | Email invite links for org onboarding |
| `super_admin_allowlist` | | Users granted platform-wide super admin access |
| `chat_sessions` | ✓ | Conversation threads |
| `chat_messages` | ✓ | Individual messages within a session |
| `agent_tasks` | ✓ | Background AI job tracking |
| `audit_logs` | ✓ | Append-only event log |
| `documents` | ✓ | Uploaded files and ingested URL content |
| `document_chunks` | ✓ | Text chunks + vector embeddings |
| `web_urls` | ✓ | Web URL resources tracked per org |
| `roles` | | RBAC role catalog (system + per-org custom) |
| `permissions` | | RBAC permission catalog (resource + action pairs) |
| `role_permissions` | | Global permission grants for system roles |
| `role_org_permissions` | | Per-org permission grants for custom roles |
| `master_modules` | | Platform-level feature module catalog |
| `org_modules` | | Per-org module enablement |

---

## Tables

### `orgs`

One row per tenant organisation.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `varchar` | NOT NULL, unique |
| `name` | `varchar` | NOT NULL |
| `domain` | `varchar(255)` | nullable — custom domain for the org |
| `status` | `varchar(50)` | NOT NULL, default `active` |
| `subscription_tier` | `varchar(50)` | NOT NULL, default `free` |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_orgs_slug` (unique)

---

### `users`

Application users. A user is created once and linked to orgs via `org_memberships`. Passwords are optional — accounts may be OAuth-only.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `email` | `varchar` | NOT NULL, unique |
| `hashed_password` | `varchar` | nullable (OAuth-only accounts have no password) |
| `name` | `varchar` | nullable |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_users_email` (unique)

---

### `org_memberships`

Join table assigning a user to an org with a role. A user may belong to multiple orgs — the unique constraint is on `(user_id, org_id)`, not `user_id` alone.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `role` | `varchar` | NOT NULL — matches a `roles.name` value (e.g. `org_admin`, `user`) |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_org_memberships_user_id`; `uq_org_memberships_user_org` (unique on `user_id, org_id`)

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

> `role` is stored as a plain string; there is no DB-level FK to the `roles` table.

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

Long-lived tokens used to issue new access JWTs. The raw token is sent to the client; only its bcrypt hash is stored. Tokens are scoped to a specific org to support multi-org sessions.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `token_hash` | `varchar` | NOT NULL |
| `expires_at` | `timestamptz` | NOT NULL — 30 days from issue |
| `revoked` | `boolean` | NOT NULL, default `false` |
| `org_id` | `uuid` | FK → `orgs.id`, nullable — which org this token is scoped to |
| `no_org_scope` | `boolean` | NOT NULL, default `false` — `true` for super-admin tokens with no org context |

No RLS — auth endpoints bypass the normal `get_db` flow.

---

### `invite_tokens`

One-time tokens sent via email to invite a new user into an org. Consumed on account creation or first login.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `token` | `varchar(64)` | NOT NULL, unique |
| `email` | `varchar` | NOT NULL |
| `org_id` | `uuid` | FK → `orgs.id` ON DELETE CASCADE, NOT NULL |
| `role` | `varchar(50)` | NOT NULL, default `user` — role to assign on acceptance |
| `invited_by` | `uuid` | FK → `users.id` ON DELETE SET NULL, nullable |
| `expires_at` | `timestamptz` | NOT NULL |
| `used_at` | `timestamptz` | nullable — set when the invite is redeemed |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_invite_tokens_token` (unique); `ix_invite_tokens_email`; `ix_invite_tokens_org_id`

No RLS — accessed before an org context is established.

---

### `super_admin_allowlist`

Tracks which users have platform-wide super admin access. Super admins bypass all RBAC permission checks.

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `uuid` | PK, FK → `users.id` |
| `status` | `varchar(50)` | NOT NULL, default `active` |
| `created_at` | `timestamptz` | NOT NULL |
| `updated_at` | `timestamptz` | NOT NULL |

No RLS — managed by platform operators only.

---

### `chat_sessions`

A conversation thread belonging to a user within a tenant.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `user_id` | `uuid` | FK → `users.id`, NOT NULL |
| `title` | `varchar` | nullable — set by the application after first exchange |
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
| `sources` | `json` | nullable — document chunks cited by the assistant |
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
| `input` | `json` | nullable — job input payload |
| `output` | `json` | nullable — job result payload |
| `error` | `varchar` | nullable — error message on failure |
| `created_at` | `timestamptz` | NOT NULL |
| `completed_at` | `timestamptz` | nullable — set on `succeeded` or `failed` |

**Status lifecycle:** `pending` → `running` → `succeeded` / `failed`

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `audit_logs`

Append-only event log. `org_id` is included in RLS but nullable to allow system-level events.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, nullable |
| `user_id` | `uuid` | FK → `users.id`, nullable |
| `action` | `varchar` | NOT NULL — e.g. `document.uploaded`, `user.login` |
| `resource_type` | `varchar` | nullable — e.g. `document`, `chat_session` |
| `resource_id` | `varchar` | nullable — string ID of the affected resource |
| `extra` | `json` | nullable — arbitrary structured metadata |
| `created_at` | `timestamptz` | NOT NULL |

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `documents`

Represents an uploaded file or ingested URL. The actual file bytes live in S3 (or `LOCAL_UPLOAD_DIR` for local dev); this row tracks metadata and processing status.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `s3_key` | `varchar` | nullable — set for `document_type = 'file'`; format: `{org_id}/{doc_id}.{ext}` |
| `source_url` | `text` | nullable — set for `document_type = 'url'` |
| `document_type` | `varchar` | NOT NULL, default `file` — `file` or `url` |
| `filename` | `varchar` | NOT NULL — original filename or derived URL title |
| `mime_type` | `varchar` | nullable |
| `size_bytes` | `integer` | nullable |
| `status` | `varchar` | NOT NULL — see lifecycle below |
| `uploaded_by` | `uuid` | FK → `users.id`, nullable |
| `created_at` | `timestamptz` | NOT NULL |
| `updated_at` | `timestamptz` | nullable — updated by ingest job on completion |
| `extracted_title` | `text` | nullable — title extracted by the ingest job |
| `summary` | `text` | nullable — AI-generated summary |
| `keywords` | `json` | nullable — AI-extracted keyword list |
| `tags` | `jsonb` | nullable — user-applied tags; GIN-indexed for filtering |
| `description` | `text` | nullable — user-provided description |

**Status lifecycle:** `processing` → `ready` / `failed` / `blocked`

**Indexes:** `ix_documents_tags_gin` — GIN index on `tags` for `@>` / `?` operator queries

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

### `web_urls`

Web URL resources tracked per org. Separate from `documents` — a `WebUrl` is a link reference, not necessarily ingested into chunks.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id` ON DELETE CASCADE, NOT NULL |
| `uploaded_by` | `uuid` | FK → `users.id` ON DELETE SET NULL, nullable |
| `url` | `text` | NOT NULL |
| `title` | `varchar(500)` | nullable |
| `tags` | `json` | NOT NULL, default `{}` |
| `description` | `text` | nullable |
| `status` | `varchar(50)` | NOT NULL, default `active` |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_web_urls_org_id`

**RLS policy:** `org_id = current_setting('app.current_org_id')::uuid`

---

### `roles`

RBAC role catalog. System roles (`is_system = true`, `organization_id = null`) are seeded by migrations. Per-org custom roles have `organization_id` set and `is_system = false`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `varchar(100)` | NOT NULL |
| `description` | `text` | nullable |
| `is_system` | `boolean` | NOT NULL, default `false` |
| `organization_id` | `uuid` | FK → `orgs.id`, nullable — `null` for system roles |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_roles_name`; `ix_roles_organization_id`; `ix_roles_is_system`

**Seeded system roles:**

| id | name | description |
|---|---|---|
| `e2222222-…` | `org_admin` | Organisation administrator |
| `f3333333-…` | `user` | Standard tenant user |

No RLS — roles are accessed across tenants when building permission sets.

---

### `permissions`

RBAC permission catalog. Each row represents one `resource:action` permission key. IDs are fixed UUIDs for migration idempotency.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `resource` | `varchar(100)` | NOT NULL |
| `action` | `varchar(100)` | NOT NULL |
| `description` | `text` | nullable |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_permissions_resource`; unique on `(resource, action)`

**Seeded permission keys** (`resource:action` computed by the API layer):

`ai_assistant:chat`, `documents:view`, `documents:create`, `documents:update`, `documents:delete`, `documents:upload`, `web_urls:view`, `web_urls:create`, `web_urls:update`, `web_urls:delete`, `users:read`, `users:invite`, `users:update`, `agents:read`, `agents:execute`, `audit_logs:read`, `tenants:update`

No RLS.

---

### `role_permissions`

Global (org-independent) permission grants for system roles.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `role_id` | `uuid` | FK → `roles.id`, NOT NULL |
| `permission_id` | `uuid` | FK → `permissions.id`, NOT NULL |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_role_permissions_role_id`; unique on `(role_id, permission_id)`

No RLS.

---

### `role_org_permissions`

Per-org permission grants, used for custom org-scoped roles created by org admins.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `role_id` | `uuid` | FK → `roles.id`, NOT NULL |
| `org_id` | `uuid` | FK → `orgs.id`, NOT NULL |
| `permission_id` | `uuid` | FK → `permissions.id`, NOT NULL |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_role_org_permissions_role_id`; `ix_role_org_permissions_org_id`; unique on `(role_id, org_id, permission_id)`

No RLS.

---

### `master_modules`

Platform-level catalog of feature modules. Super admins assign modules to orgs via `org_modules`. The `id` is a human-readable slug (e.g. `ai_assistant`).

| Column | Type | Constraints |
|---|---|---|
| `id` | `varchar(50)` | PK (string slug) |
| `name` | `varchar(120)` | NOT NULL |
| `enabled` | `boolean` | NOT NULL, default `true` — global kill switch |
| `created_at` | `timestamptz` | NOT NULL |

**Seeded modules:** `ai_assistant`, `documents`, `web_urls`

No RLS — read by super admin routes only.

---

### `org_modules`

Assigns a feature module to an org. An org only has access to features whose module appears in this table.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `org_id` | `uuid` | FK → `orgs.id` ON DELETE CASCADE, NOT NULL |
| `module_id` | `varchar(50)` | NOT NULL — should match a `master_modules.id` value |
| `assigned_by` | `uuid` | FK → `users.id` ON DELETE SET NULL, nullable |
| `created_at` | `timestamptz` | NOT NULL |

**Indexes:** `ix_org_modules_org_id`; unique on `(org_id, module_id)`

No RLS — managed by super admin routes only.

> There is no FK constraint from `module_id` to `master_modules.id` at the DB level.

---

## Row-Level Security

Every tenant-scoped table has these statements applied in its migration:

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

`document_chunks.embedding` is a 384-dimensional vector produced by a local embedding model (switched from OpenAI 1536-dim in migration `002`). The HNSW index enables sub-linear approximate nearest-neighbour search:

```sql
-- Index created in migration 001, recreated after dimension change in migration 002
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

| File | Revision | Key changes |
|---|---|---|
| `001_initial_schema` | `001` | All base tables, pgvector, RLS policies, HNSW index (vector 1536) |
| `002_local_embeddings` | `002` | `document_chunks.embedding` vector(1536) → vector(384); HNSW index recreated |
| `003_document_metadata` | `003` | `extracted_title`, `summary`, `keywords` added to `documents` |
| `004_document_source_url` | `004` | `source_url`, `document_type` added to `documents` |
| `004–018_sqlsync_*` | `s001–s015` | No-op legacy SQL audit trail (ported from old Express schema) |
| `019–022_seed_*` | `s016–s019` | Seed data: default org, admin user, roles |
| `023_invites_multi_org_and_refresh_scope` | `s020` | `invite_tokens` table; `uq_org_memberships_user_org` replaces single-user unique; `org_id` + `no_org_scope` on `refresh_tokens` |
| `024_super_admin_allowlist` | `s021` | `super_admin_allowlist` table |
| `025_rbac_roles_permissions_and_grants` | `s022` | `roles`, `permissions`, `role_permissions`, `role_org_permissions` tables; seed `org_admin` + `user` system roles and core permission set |
| `026_rbac_add_api_permissions` | `s023` | Seed additional API-gate permissions (`users:*`, `agents:*`, `audit_logs:read`, `tenants:update`) |
| `027_master_modules_catalog` | `s024` | `master_modules` table; seed `ai_assistant`, `documents`, `web_urls` |
| `028_create_org_modules_table` | `s025` | `org_modules` table |
| `029_add_org_fields_for_admin_edit` | `s026` | `domain`, `status`, `subscription_tier` added to `orgs` |
| `030_create_web_urls_table_current_schema` | `s027` | `web_urls` table |
| `031_add_document_tags_description` | `s028` | `tags` (json), `description`, `updated_at` added to `documents` |
| `032_merge_heads` | `s029` | Merge heads (no schema change) |
| `033_tags_jsonb_and_roles_array` | `s030` | `documents.tags` cast from `json` → `jsonb`; GIN index `ix_documents_tags_gin` added |

Migrations are in `src/server/alembic/versions/`. Most migrations from `s020` onwards intentionally omit `downgrade()` where a safe reversal is not possible.
