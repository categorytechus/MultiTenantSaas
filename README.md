# MultiTenant AI SaaS

A multi-tenant SaaS platform with RAG chat and text-to-SQL AI agents. Each tenant gets full data isolation via Postgres Row-Level Security.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS |
| Backend | FastAPI + SQLModel + Alembic (Python 3.12+) |
| Worker | Arq (async job queue backed by Redis) |
| Database | Postgres 16 + pgvector |
| Cache / Queue | Redis 7 |
| LLM | Anthropic Claude (`claude-3-5-sonnet-20241022`) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Storage | S3 (local filesystem fallback in dev) |

## Repository Structure

```
MultiTenantSaas/
├── apps/
│   ├── backend/               # FastAPI app + Arq worker (one Python package)
│   │   ├── app/
│   │   │   ├── main.py        # FastAPI entrypoint
│   │   │   ├── worker.py      # Arq WorkerSettings entrypoint
│   │   │   ├── api/           # Route handlers
│   │   │   ├── core/          # DB, auth, tenancy, RBAC
│   │   │   ├── models/        # SQLModel table definitions
│   │   │   ├── services/      # Business logic
│   │   │   ├── jobs/          # Arq background jobs
│   │   │   └── integrations/  # LLM, S3, embeddings clients
│   │   ├── alembic/           # Database migrations
│   │   └── pyproject.toml
│   └── web/                   # Vite + React frontend
│       └── src/
│           ├── routes/        # React Router v6 pages
│           ├── components/    # Shared UI components
│           ├── hooks/         # TanStack Query data hooks
│           └── lib/           # API client, SSE helpers
├── infrastructure/            # Terraform + Kubernetes manifests
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local frontend dev)
- Python 3.12+ and [uv](https://docs.astral.sh/uv/) (for local backend dev)

### Option A — Full stack with Docker (recommended)

```bash
# 1. Copy and fill in env vars (AI/S3 keys are optional — app runs with mocks)
cp .env.example .env

# 2. Start everything
make dev
```

Services:
- Frontend → http://localhost:3000
- Backend API → http://localhost:8000
- API docs → http://localhost:8000/docs

### Option B — Local dev (faster iteration)

```bash
# Start only Postgres + Redis in Docker
make db-up

# Install dependencies
make install

# Run migrations
make migrate

# In separate terminals:
make backend    # FastAPI on :8000
make worker     # Arq job worker
make web        # Vite on :3000
```

## Environment Variables

Copy `.env.example` → `.env`. AI and S3 keys are all optional — the app runs fully without them using mock responses and local file storage.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `SECRET_KEY` | Yes | JWT signing secret (`openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | No | Claude LLM (mock if empty) |
| `OPENAI_API_KEY` | No | Embeddings (mock if empty) |
| `S3_BUCKET` | No | File storage (local `/tmp/uploads` if empty) |

## Key Concepts

**Multi-tenancy**: Every tenant-scoped table has a Postgres RLS policy on `app.current_org_id`. The `get_db` dependency sets this from the JWT on every request — queries are automatically scoped to the caller's org.

**Auth**: JWT access tokens (15 min) + opaque refresh tokens (30 days). The frontend auto-refreshes on 401.

**RAG chat**: Runs in the FastAPI process. User message → embed → pgvector search → build prompt → stream Claude response via SSE.

**Text-to-SQL agent**: Runs in the Arq worker as a LangGraph graph. Progress streams to the frontend via Redis Pub/Sub → SSE.

**SSE auth**: `EventSource` doesn't support custom headers, so SSE endpoints accept the JWT via `?token=` query param.

## Other Commands

```bash
make migrate-new msg='add column'   # Autogenerate Alembic migration
make clean                          # Remove Docker containers + volumes
make logs-backend                   # Tail backend logs
make logs-worker                    # Tail Arq worker logs
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Proprietary — All rights reserved.
