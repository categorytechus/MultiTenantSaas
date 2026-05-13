# System Architecture

## Overview

MultiTenant AI SaaS is a three-service monorepo that provides AI-powered document Q&A with strict per-tenant data isolation. Each tenant's data is siloed at the database layer using Postgres Row-Level Security — the application never cross-contaminates tenant data in application code.

---

## Service Map

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser                                │
│                       localhost:3000                            │
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTP / SSE
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   src/server  (FastAPI)                         │
│                      :8000                                      │
│                                                                 │
│  /api/auth/*      /api/chat/*      /api/documents/*             │
│  /api/users/*     /api/agents/*    /api/organizations/*         │
│  /api/web-urls/*  /api/admin/*                                  │
│  /internal/*  ◄── agents only, protected by X-Internal-Secret  │
└────────┬─────────────────────┬───────────────────────────────┬──┘
         │ SQL (async)         │ enqueue job                   │ pub/sub
         ▼                     ▼                               ▼
┌────────────────┐   ┌─────────────────┐           ┌──────────────────┐
│   PostgreSQL   │   │      Redis      │           │      Redis       │
│   (pgvector)   │   │   (Arq queue)   │           │   (pub/sub)      │
│    :5432       │   │     :6379       │           │    :6379         │
└────────┬───────┘   └───────┬─────────┘           └────────▲─────────┘
         │                   │ dequeue job                   │ tokens
         │ SQL (raw psycopg) ▼                               │
         │          ┌─────────────────────────────────────────────────┐
         └─────────►│           src/agents  (Arq worker)             │
                    │                                                 │
                    │   ingest_document      run_chat                 │
                    │   (pypdf/docx →        (LangChain →             │
                    │    chunk → embed        Anthropic →             │
                    │    → pgvector)          stream tokens)          │
                    │                                                 │
                    │   POST /internal/*  ──► src/server              │
                    └─────────────────────────────────────────────────┘
```

---

## Repository Structure

```
MultiTenantSaas/
├── src/
│   ├── server/                    # FastAPI — pure HTTP, no background jobs
│   │   ├── app/
│   │   │   ├── main.py            # App factory, middleware, lifespan
│   │   │   ├── api/               # Route handlers
│   │   │   │   ├── auth.py        # /api/auth/*
│   │   │   │   ├── chat.py        # /api/chat/*
│   │   │   │   ├── documents.py   # /api/documents/*
│   │   │   │   ├── agents.py      # /api/agents/tasks/*
│   │   │   │   ├── internal.py    # /internal/* (agents→server callbacks)
│   │   │   │   ├── organizations.py
│   │   │   │   ├── tenant_org_routes.py  # Role/permission management
│   │   │   │   ├── web_urls.py    # /api/web-urls/*
│   │   │   │   ├── users.py
│   │   │   │   └── admin.py
│   │   │   ├── core/
│   │   │   │   ├── config.py      # Pydantic Settings
│   │   │   │   ├── db.py          # Engine, get_db, db_session, RLS setter
│   │   │   │   ├── security.py    # JWT encode/decode, bcrypt
│   │   │   │   ├── tenancy.py     # RequestContext, subdomain extraction
│   │   │   │   ├── rbac.py        # Role enum, DB-backed authorize(), static fallback
│   │   │   │   ├── redis.py       # publish(), subscribe(), task_channel()
│   │   │   │   ├── logging.py     # structlog setup
│   │   │   │   └── audit.py       # Audit log helpers
│   │   │   ├── models/            # SQLModel ORM classes (= DB tables)
│   │   │   │   ├── user.py        # User, OAuthIdentity, RefreshToken
│   │   │   │   ├── org.py         # Org, OrgMembership
│   │   │   │   ├── chat.py        # ChatSession, ChatMessage
│   │   │   │   ├── document.py    # Document, DocumentChunk
│   │   │   │   ├── agent_task.py  # AgentTask
│   │   │   │   ├── audit_log.py   # AuditLog
│   │   │   │   ├── invite.py      # InviteToken
│   │   │   │   ├── web_url.py     # WebUrl
│   │   │   │   ├── rbac.py        # RbacRole, RbacPermission, RolePermission, RoleOrgPermission
│   │   │   │   ├── master_module.py  # MasterModule
│   │   │   │   ├── org_module.py  # OrgModule
│   │   │   │   └── super_admin.py # SuperAdminAllowlist
│   │   │   ├── services/          # Business logic (no HTTP context)
│   │   │   │   ├── auth.py
│   │   │   │   ├── chat.py
│   │   │   │   ├── documents.py
│   │   │   │   ├── agent_tasks.py
│   │   │   │   └── audit.py
│   │   │   └── integrations/
│   │   │       ├── llm.py         # Anthropic client (mock if key empty)
│   │   │       ├── s3.py          # S3 / local filesystem upload/download
│   │   │       └── embeddings.py  # Local 384-dim embeddings (mock if model absent)
│   │   └── alembic/               # DB migrations
│   │
│   ├── agents/                    # Arq worker — ALL AI background work
│   │   └── app/
│   │       ├── config.py          # Settings (DATABASE_URL, REDIS_URL, …)
│   │       ├── jobs/
│   │       │   ├── __init__.py    # WorkerSettings (both jobs registered here)
│   │       │   ├── chat.py        # run_chat job
│   │       │   └── ingest.py      # ingest_document job
│   │       ├── agents/
│   │       │   └── chat.py        # LangChain ChatAnthropic agent
│   │       ├── streaming.py       # RedisStreamer (LangChain → pub/sub)
│   │       ├── http.py            # httpx calls → /internal/*
│   │       ├── redis.py           # publish(), task_channel()
│   │       ├── s3.py              # S3 / local filesystem download
│   │       └── embeddings.py      # Local 384-dim embed_batch
│   │
│   └── web/                       # Vite + React 18 + TypeScript
│       └── src/
│           ├── App.tsx            # Router setup
│           ├── routes/            # Page components
│           ├── components/        # Layout, ProtectedRoute, UI primitives
│           ├── hooks/             # useAuth, useChat, useDocuments
│           ├── lib/
│           │   ├── api.ts         # apiFetch with auto token refresh
│           │   └── sse.ts         # createSSE, createAgentSSE
│           └── types/index.ts     # Shared TypeScript interfaces
│
├── infra/                         # Terraform (AWS)
├── docker-compose.yml             # Dev: all 4 services + postgres + redis
├── docker-compose.prod.yml        # Prod: ECR images
├── Makefile
└── .env.example
```

---

## Data Model

### Core identity & tenancy

```
┌──────────┐         ┌──────────────────┐
│   User   │────────►│  OAuthIdentity   │
│          │         │  provider        │
│ id (PK)  │         │  provider_user_id│
│ email    │         └──────────────────┘
│ name     │         ┌──────────────────┐
│ hashed_  │────────►│  RefreshToken    │
│ password │         │  token_hash      │
└─────┬────┘         │  expires_at      │
      │              │  revoked         │
      │              │  org_id (FK)     │  ← scoped per-org for multi-org sessions
      │              │  no_org_scope    │
      │              └──────────────────┘
      │              ┌──────────────────────┐
      └─────────────►│  SuperAdminAllowlist │
                     │  user_id (PK, FK)    │
                     │  status              │
                     └──────────────────────┘

┌──────────────────────┐     ┌────────────────────────────────────┐
│     OrgMembership    │────►│                Org                 │
│                      │     │                                    │
│  user_id (FK)        │     │  id, slug, name                    │
│  org_id  (FK)        │     │  domain                            │
│  role (string)       │     │  status (active|suspended)         │
│  UNIQUE(user_id,     │     │  subscription_tier (free|pro|…)    │
│         org_id)      │     └──────────────────────┬─────────────┘
└──────────────────────┘                            │
                     ┌──────────────────────────────┘
                     │ org_id on every tenant table
      ┌──────────────┼─────────────────────────────────────┐
      ▼              ▼              ▼                       ▼
┌──────────────┐ ┌──────────┐ ┌───────────┐         ┌────────────┐
│ ChatSession  │ │ Document │ │  WebUrl   │         │ AgentTask  │
│              │ │          │ │           │         │            │
│ id, org_id   │ │ id       │ │ id        │         │ id         │
│ user_id      │ │ org_id   │ │ org_id    │         │ org_id     │
│ title        │ │ s3_key   │ │ uploaded_by│        │ user_id    │
└──────┬───────┘ │ source_url│ │ url      │         │ type       │
       │         │ doc_type  │ │ title    │         │ status     │
       ▼         │ filename  │ │ tags JSON│         │ input JSON │
┌────────────┐   │ mime_type │ │ descr.   │         │ output JSON│
│ChatMessage │   │ size_bytes│ │ status   │         │ error      │
│            │   │ status    │ └───────────┘         │ completed_at│
│ id         │   │ uploaded_by│                      └────────────┘
│ org_id     │   │ extracted_│
│ chat_id    │   │  title    │
│ role       │   │ summary   │
│ content    │   │ keywords  │  ← AI-extracted (JSON)
│ sources    │   │  (JSON)   │
└────────────┘   │ tags(JSONB│  ← user-applied, GIN-indexed
                 │ description│
                 │ updated_at │
                 └─────┬──────┘
                       │
                       ▼
                ┌───────────────┐
                │ DocumentChunk │
                │               │
                │ id            │
                │ org_id        │
                │ document_id   │
                │ chunk_index   │
                │ content       │
                │ embedding     │  ← pgvector 384-dim (local model)
                └───────────────┘   HNSW cosine index
```

### Invite flow

```
┌──────────────┐
│ InviteToken  │
│              │
│ id           │
│ token        │  ← opaque, 64-char, unique
│ email        │
│ org_id (FK)  │
│ role (string)│
│ invited_by   │
│ expires_at   │
│ used_at      │
└──────────────┘
```

### Module feature flags

```
┌─────────────────┐       ┌─────────────┐
│  MasterModule   │       │  OrgModule  │
│                 │       │             │
│  id (string PK) │◄──────│  module_id  │
│  name           │       │  org_id (FK)│
│  enabled        │       │  assigned_by│
└─────────────────┘       └─────────────┘
  Seeded: ai_assistant,     Per-org enablement
          documents,         by super admin
          web_urls
```

### RBAC

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   RbacRole   │────►│  RolePermission  │────►│ RbacPermission  │
│              │     │  (global grants) │     │                 │
│ id           │     │  role_id (FK)    │     │ id              │
│ name         │     │  permission_id   │     │ resource        │
│ description  │     └──────────────────┘     │ action          │
│ is_system    │                              └─────────────────┘
│ org_id (FK)  │─────────────────────────────────────┐
│  (null =     │     ┌───────────────────────┐        │
│   system)    │────►│ RoleOrgPermission     │────────┘
└──────────────┘     │ (per-org custom grants│
                     │  role_id, org_id,     │
                     │  permission_id)       │
                     └───────────────────────┘

System roles (seeded, is_system=true, org_id=null):
  org_admin  →  full document/web_url/user/agent permissions
  user       →  documents view/create/upload + ai_assistant:chat + agents

Custom roles: org_admin can create per-org roles with scoped permission grants
  via role_org_permissions.
```

**Status values:**

| Model | Statuses |
|---|---|
| `Document` | `processing` → `ready` / `failed` / `blocked` |
| `AgentTask` | `pending` → `running` → `succeeded` / `failed` |
| `WebUrl` | `active` / `inactive` |
| `Org` | `active` / `suspended` |

**RBAC permission catalog** (seeded in migrations s022 + s023):

| Permission | org_admin | user |
|---|:---:|:---:|
| `ai_assistant:chat` | ✓ | ✓ |
| `documents:view` | ✓ | ✓ |
| `documents:create` | ✓ | ✓ |
| `documents:upload` | ✓ | ✓ |
| `documents:update` | ✓ | |
| `documents:delete` | ✓ | |
| `web_urls:view` | ✓ | |
| `web_urls:create` | ✓ | |
| `web_urls:update` | ✓ | |
| `web_urls:delete` | ✓ | |
| `users:read` | ✓ | |
| `users:invite` | ✓ | |
| `users:update` | ✓ | |
| `agents:read` | ✓ | ✓ |
| `agents:execute` | ✓ | ✓ |
| `audit_logs:read` | ✓ | |
| `tenants:update` | ✓ | |

---

## Chat Streaming Flow

```
Browser                  src/server                    Redis          src/agents
  │                          │                           │                │
  │  GET /api/chat/sessions  │                           │                │
  │  /{id}/stream            │                           │                │
  │  ?message=hello          │                           │                │
  │  &token=JWT              │                           │                │
  │─────────────────────────►│                           │                │
  │                          │ 1. Decode JWT → org_id    │                │
  │                          │ 2. SET LOCAL              │                │
  │                          │    app.current_org_id     │                │
  │                          │ 3. Save user ChatMessage  │                │
  │                          │ 4. Create AgentTask       │                │
  │                          │    status=pending         │                │
  │                          │ 5. COMMIT                 │                │
  │                          │──────────────────────────►│                │
  │                          │    enqueue run_chat job   │                │
  │                          │    (task_id, org_id,      │                │
  │                          │     session_id, message)  │                │
  │                          │                           │                │
  │                          │    SUBSCRIBE              │                │
  │                          │    org:{id}:task:{id}:    │                │
  │                          │    events                 │                │
  │                          │◄──────────────────────────│                │
  │                          │                           │                │
  │◄─────────────────────────│  SSE open                 │                │
  │  (stream starts)         │                           │                │
  │                          │                           │   dequeue job  │
  │                          │                           │───────────────►│
  │                          │                           │                │ update task
  │                          │                           │                │ status=running
  │                          │                           │                │ run LangChain
  │                          │                           │                │ agent w/ Claude
  │                          │                           │◄───────────────│
  │                          │                           │ PUBLISH token  │
  │◄─────────────────────────│◄──────────────────────────│ {"type":"token"│
  │  data: Hello             │  forward as SSE           │  "data":"Hello"│
  │                          │                           │                │
  │◄─────────────────────────│◄──────────────────────────│ PUBLISH done   │
  │  data: [DONE]            │                           │ {"type":"done"}│
  │                          │                           │                │
  │                          │                           │                │ POST /internal/
  │                          │◄──────────────────────────│────────────────│ chat/{id}/messages
  │                          │  save assistant reply     │                │
  │                          │                           │                │ PATCH /internal/
  │                          │◄──────────────────────────│────────────────│ tasks/{id}
  │                          │  mark task succeeded      │                │ status=succeeded
```

**SSE auth note:** `EventSource` (browser API) doesn't support custom headers. The JWT is passed as `?token=` query param. Both `get_db` and `get_required_context` accept tokens from either `Authorization: Bearer` or `?token=`.

**Redis channel naming:** `org:{org_id}:task:{task_id}:events`

---

## Document Ingestion Flow

```
Browser           src/server                   Redis           src/agents
  │                   │                          │                  │
  │  POST             │                          │                  │
  │  /api/documents/  │                          │                  │
  │  (multipart)      │                          │                  │
  │──────────────────►│                          │                  │
  │                   │ 1. Read file body         │                  │
  │                   │    (max 50MB)             │                  │
  │                   │ 2. Create Document row    │                  │
  │                   │    status=processing      │                  │
  │                   │ 3. Upload to S3/local     │                  │
  │                   │    key: {org_id}/{doc_id} │                  │
  │                   │    .{ext}                 │                  │
  │                   │──────────────────────────►│                  │
  │                   │   enqueue ingest_document │                  │
  │                   │   (document_id, org_id)   │                  │
  │                   │                           │                  │
  │◄──────────────────│  202 Accepted             │                  │
  │  {document: ...}  │  (immediate return)       │                  │
  │                   │                           │                  │
  │                   │                           │  dequeue job     │
  │                   │                           │─────────────────►│
  │                   │                           │                  │ 1. Connect psycopg
  │                   │                           │                  │    SET LOCAL
  │                   │                           │                  │    app.current_org_id
  │                   │                           │                  │ 2. Fetch doc from DB
  │                   │                           │                  │    (s3_key, mime_type)
  │                   │                           │                  │ 3. Download from S3
  │                   │                           │                  │ 4. Parse text
  │                   │                           │                  │    .pdf → pypdf
  │                   │                           │                  │    .docx → python-docx
  │                   │                           │                  │    other → utf-8
  │                   │                           │                  │ 5. Chunk text
  │                   │                           │                  │    800 chars / 100 overlap
  │                   │                           │                  │ 6. embed_batch (local)
  │                   │                           │                  │    384-dim model
  │                   │                           │                  │    batch 64
  │                   │                           │                  │ 7. INSERT document_chunks
  │                   │                           │                  │    w/ pgvector embedding
  │                   │                           │                  │ 8. UPDATE document
  │                   │                           │                  │    status=ready
```

**Retry policy:** 3 retries with delays `[2s, 8s, 32s]`. On final failure, sets `document.status = 'failed'`.

**S3 key format:** `{org_id}/{doc_id}.{ext}` — org-scoped, collision-free.

---

## Auth Flow

```
Browser                        src/server
  │                                │
  │  POST /api/auth/login          │
  │  {email, password}             │
  │───────────────────────────────►│
  │                                │ 1. Look up user by email (RLS off for auth)
  │                                │ 2. bcrypt.verify(password, hashed_password)
  │                                │ 3. Look up OrgMembership → role
  │                                │ 4. Sign JWT: {sub, org_id, role, email}
  │                                │    exp: 15 minutes
  │                                │ 5. Generate opaque refresh token
  │                                │    store bcrypt(token) in refresh_tokens table
  │                                │    scoped to org_id
  │◄───────────────────────────────│
  │  {access_token, refresh_token} │
  │                                │
  │  [subsequent requests]         │
  │                                │
  │  GET /api/...                  │
  │  Authorization: Bearer {JWT}   │
  │───────────────────────────────►│
  │                                │ 1. Decode JWT (jose RS256)
  │                                │ 2. Extract: user_id, org_id, role, email
  │                                │ 3. Set RLS: app.current_org_id = org_id
  │                                │ 4. All queries auto-filtered by RLS policies
  │◄───────────────────────────────│
  │  200 response                  │
  │                                │
  │  [token expired — 401]         │
  │                                │
  │  POST /api/auth/refresh        │
  │  {refresh_token}               │
  │───────────────────────────────►│
  │                                │ 1. Look up token by hash
  │                                │ 2. Verify not expired / not revoked
  │                                │ 3. Issue new access_token + refresh_token
  │                                │ 4. Revoke old refresh_token
  │◄───────────────────────────────│
  │  {access_token, refresh_token} │
```

**Frontend auto-refresh:** `apiFetch` in [src/web/src/lib/api.ts](../src/web/src/lib/api.ts) intercepts 401 responses, attempts refresh, and retries the original request transparently.

**Multi-org:** A user may belong to multiple orgs. Each `RefreshToken` is scoped to a specific `org_id`. Switching orgs requires re-authenticating (or a separate token-swap flow). The `no_org_scope` flag on `RefreshToken` allows super-admin tokens without an org context.

---

## Multi-Tenancy via Row-Level Security

Every tenant-scoped table has a Postgres RLS policy:

```sql
-- Example policy on documents table
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (org_id = current_setting('app.current_org_id')::uuid);
```

The application sets this variable at the start of every transaction:

```python
# src/server/app/core/db.py
await session.execute(
    text(f"SET LOCAL app.current_org_id = '{org_id!s}'")
)
```

`SET LOCAL` scopes the value to the current transaction — it resets automatically when the transaction ends, so there is no risk of leakage between requests sharing a connection pool connection.

**Tables with RLS:** `documents`, `document_chunks`, `chat_sessions`, `chat_messages`, `agent_tasks`, `audit_logs`, `org_memberships`, `web_urls`

**Tables without RLS:** `users`, `orgs`, `refresh_tokens`, `oauth_identities`, `invite_tokens`, `master_modules`, `org_modules`, `super_admin_allowlist`, `roles`, `permissions`, `role_permissions`, `role_org_permissions`

**Nil-UUID fallback:** If org_id is missing from the token, the DB session is set to `00000000-0000-0000-0000-000000000000` — a UUID that matches no tenant — preventing accidental data leakage rather than allowing broad access.

---

## RBAC — Roles and Permissions

RBAC is **database-driven**. Role and permission records are seeded by migrations. `authorize("permission:name")` queries the DB on every protected request via `role_permissions_from_db()`, with a static `ROLE_PERMISSIONS` map as fallback if tables are unavailable.

**Resolution order for a request:**
1. JWT `role` field → find matching system `RbacRole` (`is_system=true`)
2. `role_permissions` → global grants for that role
3. `org_memberships.role` → find any matching custom role for this org
4. `role_org_permissions` → per-org custom grants
5. Union all permission keys → check against requested permission

**Super admin:** `SuperAdminAllowlist` table gates super-admin access. Super admins bypass all permission checks via the `*` wildcard.

---

## Internal API

The agents service cannot write to the database directly via SQLModel ORM (it uses raw psycopg for ingest only). For structured write-backs — saving an assistant message, updating a task status — it calls the server's `/internal/*` routes over HTTP.

```
src/agents  ──POST /internal/chat/{session_id}/messages──►  src/server
             Header: X-Internal-Secret: {SECRET_KEY}
             Body: {role, content}

src/agents  ──PATCH /internal/tasks/{task_id}────────────►  src/server
             Header: X-Internal-Secret: {SECRET_KEY}
             Body: {status, output}
```

These routes are **not exposed publicly**. In production, nginx/the load balancer should block any external request to `/internal/*`.

The `SERVER_URL` env var on the agents service tells it where to reach the server (e.g., `http://server:8000` in Docker Compose, or the EC2 private IP in production).

---

## Infrastructure (AWS via Terraform)

```
                          ┌──────────── VPC 10.0.0.0/16 ─────────────┐
                          │                                           │
Internet ──► IGW ──► ┌────┴─────────────────────────┐               │
                     │  Public Subnets (10.0.0/1.x)  │               │
                     │                               │               │
                     │  ┌─────────────────────────┐  │               │
                     │  │   EC2  t3.medium         │  │               │
                     │  │   Elastic IP             │  │               │
                     │  │                          │  │               │
                     │  │  docker compose up       │  │               │
                     │  │   server  :8000          │  │               │
                     │  │   agents  (internal)     │  │               │
                     │  │   web     :80            │  │               │
                     │  └──────────┬──────────────┘  │               │
                     └────────────┼────────────────────               │
                                  │                                   │
                     ┌────────────┼───────────────────────────────────┤
                     │  Private Subnets (10.0.10/11.x)               │
                     │           │                                    │
                     │  ┌────────▼────────┐  ┌────────────────────┐  │
                     │  │  RDS PostgreSQL  │  │ ElastiCache Redis  │  │
                     │  │  16, db.t3.micro │  │ 7.1, t3.micro      │  │
                     │  │  port 5432       │  │ port 6379          │  │
                     │  └─────────────────┘  └────────────────────┘  │
                     └────────────────────────────────────────────────┘

     S3: mtsaas-prod-uploads-{account_id}   (versioned, encrypted)
     ECR: multitenant-saas-{backend,agents,web}
     IAM: github-cts role (GitHub OIDC, no stored keys)
```

**CI/CD deploy path:**
1. GitHub Actions builds 3 Docker images
2. Pushes to ECR via OIDC (IAM role `github-cts`, no stored AWS keys)
3. SSHes to EC2, pulls images, runs `docker compose up -d`
4. Runs `docker compose exec -T server alembic upgrade head`

**Local equivalent:** `make redeploy-ecr`

---

## Environment Variables

| Variable | Service | Required | Notes |
|---|---|:---:|---|
| `DATABASE_URL` | server, agents | Yes | `postgresql+psycopg://...` for server; agents strips the `+psycopg` prefix for raw psycopg |
| `REDIS_URL` | server, agents | Yes | `redis://...` |
| `SECRET_KEY` | server, agents | Yes | JWT signing + internal API auth. Generate: `openssl rand -hex 32` |
| `SERVER_URL` | agents | Yes | Where agents call `/internal/*`. `http://server:8000` in Docker |
| `ANTHROPIC_API_KEY` | agents | No | Mock LLM responses if empty |
| `OPENAI_API_KEY` | agents | No | No longer used for embeddings (now local 384-dim model) |
| `S3_BUCKET` | server, agents | No | Falls back to `LOCAL_UPLOAD_DIR` (`/tmp/uploads`) if empty |
| `AWS_ACCESS_KEY_ID` | server, agents | No | Not needed on EC2 with instance profile |
| `AWS_SECRET_ACCESS_KEY` | server, agents | No | Not needed on EC2 with instance profile |
| `S3_REGION` | server, agents | No | Default `us-east-1` |
| `LOCAL_UPLOAD_DIR` | server, agents | No | Default `/tmp/uploads` (dev only) |

---

## Development Commands

```bash
make db-up              # Start Postgres + Redis (Docker)
make migrate            # Run Alembic migrations
make server             # FastAPI on :8000
make agents             # Arq worker (ingest + chat)
make web                # Vite dev server on :3000

make dev                # All 4 services + DB via Docker Compose
make redeploy-ecr       # Build, push to ECR, deploy to EC2
```

See [Makefile](../Makefile) for all targets.

---

## Schema Analysis — Known Issues & Simplification Opportunities

These are areas where the schema has accumulated complexity or inconsistency worth addressing in a future cleanup migration.

### 1. `web_urls` vs `Document(document_type='url')` — overlapping concepts

`web_urls` tracks URL resources with metadata (title, tags, status). `documents` with `document_type='url'` tracks ingested URL content with chunks. The boundary is unclear: it's not obvious whether ingesting a URL creates a `Document` row, a `WebUrl` row, or both. A unified approach would use `documents` for all ingested content and `web_urls` purely as a pre-ingestion staging/metadata table with a `document_id` FK back to the ingested result.

### 2. `documents.keywords` (JSON) vs `documents.tags` (JSONB) — naming confusion

Both fields store JSON on the `documents` table. `keywords` was added early as AI-extracted metadata; `tags` was added later for user-applied labels. The difference in type (JSON vs JSONB) and the `tags` GIN index suggest they serve different purposes, but the naming is confusing. Renaming `keywords` → `extracted_keywords` would clarify intent.

### 3. `OrgMembership.role` string lacks FK to `roles` table

`org_memberships.role` stores a role name string like `"org_admin"` or `"user"`. The `roles` table is the authoritative source, but there is no foreign key or check constraint ensuring the string matches a valid role. Adding a `role_id UUID FK → roles.id` column (and dropping the string `role`) would enforce referential integrity.

### 4. `OrgModule.module_id` lacks FK to `master_modules`

`org_modules.module_id` is a plain `VARCHAR(50)` with no DB-level constraint to `master_modules.id`. A FK `REFERENCES master_modules(id)` would prevent orphaned module assignments.

### 5. Static `ROLE_PERMISSIONS` map vs DB RBAC — divergent role names

`core/rbac.py` defines roles `SUPER_ADMIN`, `TENANT_ADMIN`, `USER`, `VIEWER`. The DB seeds `org_admin` and `user`. `TENANT_ADMIN` and `VIEWER` have no matching DB rows, so the static fallback path handles them but the DB path never matches. Aligning the `Role` enum values with the seeded DB role names (`org_admin`, `user`) would eliminate the divergence.

### 6. `super_admin_allowlist` — table for a boolean flag

Super admin status is a single `status` string per user. This could be an `is_super_admin: bool` column on `users`, which would simplify the query path. The separate table does provide an audit trail and the ability to suspend super admin access without deleting the row — worth keeping if those properties are intentional.
