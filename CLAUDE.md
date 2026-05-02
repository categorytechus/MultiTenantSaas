# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
make install          # uv sync (server + agents) + npm install (web)

# Full stack via Docker Compose
make dev              # all 4 services: server, agents, web, postgres, redis
make db-up            # postgres + redis only (for local dev without Docker app)

# Local dev (requires postgres + redis running via make db-up)
make server           # FastAPI server on :8000  (src/server)
make agents           # Arq worker — document ingest + AI chat agents  (src/agents)
make web              # Vite dev server on :3000  (src/web)

# Database
make migrate                          # alembic upgrade head
make migrate-new msg='description'    # autogenerate new migration

# Logs (Docker)
make logs-server / logs-agents / logs-web

# Deploy
make redeploy-ecr     # build + push 3 ECR images, SSH deploy to EC2
```

Both Python packages (`src/server`, `src/agents`) use `uv` for package management. Python 3.12+ required.

## Architecture

Three-service monorepo:
- `src/server/` — FastAPI API server (pure HTTP, no background jobs)
- `src/agents/` — Arq worker for ALL AI background work: document ingest + LangChain chat agents
- `src/web/` — Vite + React 18 + TypeScript

### src/server package layout

```
app/
  main.py          # FastAPI app, router registration, lifespan
  core/
    config.py      # Pydantic Settings (reads .env)
    db.py          # SQLAlchemy async engine, get_db dependency, db_session context manager
    security.py    # JWT encode/decode, bcrypt password hashing
    tenancy.py     # RequestContext dataclass, get_request_context / get_required_context deps
    rbac.py        # Role enum, ROLE_PERMISSIONS map, authorize(permission) dep factory
    redis.py       # publish / subscribe helpers, task_channel()
  api/
    auth.py        # /api/auth/*
    chat.py        # /api/chat/* — enqueues run_chat job, SSE via Redis pub/sub
    agents.py      # /api/agents/tasks/* — task CRUD + SSE stream
    internal.py    # /internal/* — called by agents service (X-Internal-Secret auth)
    documents.py / orgs.py / users.py / admin.py
  models/          # SQLModel table classes
  services/        # Business logic
  integrations/
    llm.py         # Anthropic client (mock when key empty)
    s3.py          # S3 / local filesystem fallback
    embeddings.py  # OpenAI embeddings (mock when key empty)
```

### src/agents package layout

```
app/
  config.py        # Settings: DATABASE_URL, REDIS_URL, SERVER_URL, SECRET_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, S3_*
  streaming.py     # RedisStreamer — LangChain AsyncCallbackHandler → Redis pub/sub
  redis.py         # publish(), task_channel()
  http.py          # httpx helpers: save_assistant_message(), update_task()
  s3.py            # S3 / local filesystem download (for ingest)
  embeddings.py    # OpenAI embed_batch (for ingest)
  jobs/
    __init__.py    # WorkerSettings + startup/shutdown (injects redis + httpx into ctx)
    chat.py        # run_chat Arq job
    ingest.py      # ingest_document Arq job — raw psycopg, no ORM
  agents/
    chat.py        # LangChain ChatAnthropic agent (dummy, no tools yet)
```

### Key patterns

**Multi-tenancy via RLS**: Every tenant-scoped table has a Postgres RLS policy on `app.current_org_id`. `get_db` sets it from the JWT on every request. `db_session(org_id)` sets it in Arq jobs and internal endpoints.

**Chat streaming pipeline**:
1. `GET /api/chat/sessions/{id}/stream?message=...` — server saves user message, creates `agent_task`, enqueues `run_chat` to Arq, subscribes to Redis channel `org:{org_id}:task:{task_id}:events`, forwards events as SSE
2. `run_chat` (agents worker) — runs LangChain agent; `RedisStreamer` callback publishes `{"type":"token","data":"..."}` per token, then `{"type":"done"}`
3. Server SSE translates: `token` events → `data: {text}\n\n`, `done` → `data: [DONE]\n\n`

**Internal API**: `/internal/*` routes are called by the agents service to write results back (save assistant message, update task status). Protected by `X-Internal-Secret: {SECRET_KEY}` header. Not exposed publicly.

**Auth flow**: JWT access tokens (15 min) + opaque refresh tokens (30 days, stored hashed in DB). Access token payload: `{sub: user_id, org_id, role, email}`. Refresh via `POST /api/auth/refresh`.

**RBAC**: `authorize("permission:name")` returns a FastAPI `Depends()`. `SUPER_ADMIN` has wildcard `{"*"}`.

**SSE and JWT**: `EventSource` doesn't support custom headers. SSE endpoints accept JWT via `?token=` query param. `get_db` reads both `Authorization: Bearer` and `?token=`.

**Document ingestion**: `POST /api/documents` → uploads to S3 → enqueues `ingest_document` to Arq (agents worker). Job uses raw psycopg (no ORM): download S3 → parse (pypdf/python-docx) → chunk → embed (OpenAI) → insert into `document_chunks` with pgvector → set `documents.status = 'ready'`.

**S3 fallback**: When `S3_BUCKET` is empty, writes to `LOCAL_UPLOAD_DIR` (`/tmp/uploads`). Safe for local dev.

**LLM / embeddings fallback**: Mock responses when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are empty.

### Frontend (`src/web`)

```
src/
  routes/          # React Router v6 pages
  components/      # Shared UI (Layout.tsx has sidebar + topbar)
  hooks/           # TanStack Query hooks
  lib/
    api.ts         # apiFetch: adds Bearer token, auto-refreshes on 401
    sse.ts         # createSSE (chat tokens), createAgentSSE (agent step events)
  types/index.ts   # Shared TypeScript interfaces
```

Vite proxies `/api` → `process.env.VITE_API_URL || http://localhost:8000`. In Docker Compose, `VITE_API_URL=http://server:8000` is injected. Frontend dev server runs on :3000.

## Environment

Copy `.env.example` → `.env` in the repo root. All AI/S3 keys are optional — app runs with mocks.

Required: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`.  
Generate: `openssl rand -hex 32`

For local dev without Docker, also set `SERVER_URL=http://localhost:8000` in `src/agents/.env`.

## Database

Postgres 16 + pgvector. HNSW index on `document_chunks.embedding` (cosine, 1536 dims).

Migrations live in `src/server/alembic/`. Always run `make migrate` before first use. Alembic autogenerate doesn't handle RLS policies — add those manually.

## Infrastructure (`infra/`)

Terraform provisions: VPC, EC2 (t3.medium), RDS PostgreSQL 16, ElastiCache Redis 7, S3 uploads bucket, three ECR repos (`multitenant-saas-backend`, `multitenant-saas-agents`, `multitenant-saas-web`), GitHub OIDC role `github-cts`.

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# edit db_password, allowed_ssh_cidrs
terraform -chdir=infra init
terraform -chdir=infra apply
```
