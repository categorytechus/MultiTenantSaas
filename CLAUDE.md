# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
make install          # uv sync (backend) + npm install (web)

# Full stack
make dev              # docker compose up --build (all 5 services)
make db-up            # start only postgres + redis (for local dev without Docker app)

# Local dev (requires postgres + redis running)
make backend          # uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
make worker           # arq app.jobs.WorkerSettings
make web              # vite dev server on port 3000

# Database
make migrate          # alembic upgrade head
make migrate-new msg='description'   # autogenerate new migration

# Cleanup
make clean            # docker compose down -v
```

Backend uses `uv` for package management. All backend commands run from `apps/backend/` with `uv run`. Python 3.12+ required.

## Architecture

Monorepo with two apps:
- `apps/backend/` — FastAPI app + Arq worker (one Python package, two entrypoints)
- `apps/web/` — Vite + React 18 + TypeScript

### Backend package layout

```
app/
  main.py          # FastAPI app, router registration, lifespan
  worker.py        # Arq WorkerSettings entrypoint
  core/
    config.py      # Pydantic Settings (reads .env)
    db.py          # SQLAlchemy async engine, get_db dependency, db_session context manager
    security.py    # JWT encode/decode, bcrypt password hashing
    tenancy.py     # RequestContext dataclass, get_request_context / get_required_context deps
    rbac.py        # Role enum, ROLE_PERMISSIONS map, authorize(permission) dep factory
  api/             # FastAPI routers (auth, chat, documents, agents, orgs, users, admin)
  models/          # SQLModel table classes
  services/        # Business logic called by routers
  jobs/            # Arq job functions (ingest_document, run_text_to_sql)
  integrations/
    llm.py         # Anthropic LLMClient (mock when ANTHROPIC_API_KEY empty)
    s3.py          # S3 client (local filesystem fallback when S3_BUCKET empty)
    embeddings.py  # OpenAI embeddings (mock when OPENAI_API_KEY empty)
```

### Key patterns

**Multi-tenancy via RLS**: Every tenant-scoped table (`documents`, `document_chunks`, `chat_sessions`, `chat_messages`, `agent_tasks`, `audit_logs`) has a Postgres RLS policy filtering on `app.current_org_id`. The `get_db` FastAPI dependency extracts `org_id` from the JWT and calls `SET LOCAL app.current_org_id = :org_id` at the start of every transaction. Alembic migrations bypass RLS via a superuser policy.

**RLS in Arq jobs**: Use the `db_session(org_id)` async context manager from `app.core.db` — never `get_db` (which requires a Request object).

**Auth flow**: JWT access tokens (15 min) + opaque refresh tokens (30 days, stored hashed in DB). Access token payload: `{sub: user_id, org_id, role, email}`. Refresh via `POST /api/auth/refresh`.

**RBAC**: `authorize("permission:name")` returns a FastAPI `Depends()`. Use it in route signatures as `ctx: RequestContext = authorize("documents:upload")`. `SUPER_ADMIN` has wildcard `{"*"}`.

**SSE and JWT**: `EventSource` doesn't support custom headers. SSE endpoints (`/api/chat/sessions/{id}/stream`, `/api/agents/tasks/{id}/stream`) accept the JWT via `?token=` query param. `get_db` reads both `Authorization: Bearer` header and the `token` query param.

**RAG chat**: Runs in the FastAPI process (not Arq). Flow: save user message → embed → pgvector cosine search → recent messages → build prompt → stream Anthropic response → save assistant message. Endpoint returns `text/event-stream` with `data: {token}\n\n` frames and `data: [DONE]\n\n` at end.

**Text-to-SQL agent**: Runs in Arq worker as a LangGraph graph. Progress events published to Redis Pub/Sub channel `org:{org_id}:task:{task_id}:events`. The `/api/agents/tasks/{id}/stream` SSE endpoint subscribes to that channel.

**Document ingestion**: `POST /api/documents` uploads file, creates DB record, enqueues `ingest_document` Arq job. Job: extract text (pypdf/python-docx) → chunk → embed → store chunks in `document_chunks` table.

**S3 fallback**: When `S3_BUCKET` is empty, `integrations/s3.py` writes to `LOCAL_UPLOAD_DIR` (`/tmp/uploads`). `presigned_get` returns a `file://` URL. Safe for local dev.

**LLM fallback**: When `ANTHROPIC_API_KEY` is empty, `integrations/llm.py` yields a mock response. Same for OpenAI embeddings.

### Frontend

```
src/
  routes/          # React Router v6 pages
  components/      # Shared components (Layout.tsx has sidebar + topbar)
  hooks/           # TanStack Query hooks (useDocuments, useChat, useAgents, ...)
  lib/
    api.ts         # apiFetch wrapper: adds Bearer token, auto-refreshes on 401
    sse.ts         # createSSE (chat), createAgentSSE (agents progress)
  types/index.ts   # All shared TypeScript interfaces
```

Vite proxies `/api` → `http://localhost:8000`. Frontend runs on port 3000.

Auth state lives in `localStorage` (`access_token`, `refresh_token`, `user`). `apiFetch` silently refreshes the access token on 401 before retrying. On refresh failure it redirects to `/login`.

The `Document` type carries both backend field names (`mime_type`, `size_bytes`) and frontend aliases (`file_type`, `size`, `category`, `updated_at`). The `useDocuments` hook normalizes backend responses into this shape.

## Environment

Copy `.env.example` → `.env` in the repo root (Docker reads it) or `apps/backend/.env` (local dev). All AI/S3 keys are optional — the app runs without them using mocks and local filesystem.

Required for any functionality: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`.

Generate a secret key: `openssl rand -hex 32`

## Database

Postgres 16 + pgvector extension. HNSW index on `document_chunks.embedding` (cosine distance, 1536 dims for OpenAI `text-embedding-3-small`).

Initial migration: `apps/backend/alembic/versions/001_initial.py` — creates the `vector` extension, all tables, RLS policies, and the HNSW index. Always run `make migrate` before first use.

New migrations: `make migrate-new msg='description'` uses Alembic autogenerate. Review the generated file — autogenerate doesn't handle RLS policies or custom SQL.
