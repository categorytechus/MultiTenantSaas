# MultiTenant AI SaaS

A multi-tenant SaaS platform with AI chat agents. Each tenant gets full data isolation via Postgres Row-Level Security.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18 + TypeScript |
| Server | FastAPI + SQLModel + Alembic (Python 3.12+) |
| Agents | Arq + LangChain + Anthropic Claude |
| Database | Postgres 16 + pgvector |
| Cache / Queue | Redis 7 |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Storage | S3 (local filesystem fallback in dev) |
| Infra | Terraform → AWS (EC2, RDS, ElastiCache, S3, ECR) |

## Repository Structure

```
src/
├── server/        # FastAPI API server (pure HTTP, no background jobs)
│   ├── app/
│   │   ├── api/           # Route handlers (auth, chat, agents, docs, admin)
│   │   ├── api/internal.py  # Internal endpoints called by agents service
│   │   ├── core/          # DB, auth, tenancy, RBAC, Redis pub/sub
│   │   ├── models/        # SQLModel table definitions
│   │   ├── services/      # Business logic
│   │   └── integrations/  # LLM, S3, embeddings clients
│   └── alembic/           # Database migrations
├── agents/        # Arq worker — ALL AI background work (no ORM, raw psycopg)
│   └── app/
│       ├── agents/        # LangChain agent definitions
│       ├── jobs/          # WorkerSettings, run_chat, ingest_document
│       ├── streaming.py   # RedisStreamer callback (tokens → pub/sub)
│       ├── s3.py          # S3 download helper
│       ├── embeddings.py  # OpenAI embed_batch
│       └── http.py        # httpx calls to server internal API
└── web/           # Vite + React 18 frontend
    └── src/
        ├── routes/        # React Router v6 pages
        ├── components/    # Shared UI components
        ├── hooks/         # TanStack Query data hooks
        └── lib/           # API client, SSE helpers
infra/             # Terraform (VPC, EC2, RDS, ElastiCache, S3, ECR)
docker-compose.yml
docker-compose.prod.yml
Makefile
.env.example
```

## Quick Start

**Prerequisites**: Docker & Docker Compose, Node.js 20+, Python 3.12+, [uv](https://docs.astral.sh/uv/)

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env       # AI/S3 keys are optional — app runs with mocks
make dev
```

| Service | URL |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

### Option B — Local dev (faster iteration)

```bash
make db-up      # Postgres + Redis in Docker
make install    # uv sync (server + agents) + npm install
make migrate         # Alembic via host Python (needs Postgres on localhost:5432)
make migrate-docker  # Same migrations inside Docker (only needs Compose Postgres; skips host :5432)

# In separate terminals:
make server     # FastAPI on :8000
make agents     # Arq worker — document ingest + AI chat agents
make web        # Vite on :3000
```

**Optional: activate the venv (macOS / Linux)** — `make install` runs `uv sync` in `src/server` and `src/agents`, each with its own `.venv`. To use `python` or tools without `uv run`, `cd` into that folder and activate:

```bash
cd src/server
source .venv/bin/activate
```

Do the same under `src/agents` for the worker. The `make server` / `make agents` / `make migrate` targets use `uv run` and do not require activation.

If `make migrate` prints **nothing on 127.0.0.1:5432**, either Postgres is not running (`make db-up` and wait until it is healthy) or your Docker setup does not publish **5432 to the host** (some contexts never bind `localhost:5432`). In that case run **`make migrate-docker`**, which starts the `postgres` service and runs Alembic in a one-off container on the Compose network (`DATABASE_URL` uses host `postgres`, not `localhost`). Use **`make migrate` without `sudo`** on macOS so `uv` uses your project `.venv`.

**Windows (Command Prompt)** — from the directory that contains `.venv`: `call .venv\Scripts\activate.bat`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres async connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `SECRET_KEY` | Yes | JWT signing secret — `openssl rand -hex 32` |
| `SERVER_URL` | Agents only | URL agents use to call server internal API |
| `ANTHROPIC_API_KEY` | No | Claude LLM (mock responses if empty) |
| `OPENAI_API_KEY` | No | Embeddings (mock if empty) |
| `S3_BUCKET` | No | File storage (local `/tmp/uploads` if empty) |

## How Chat Streaming Works

```
Browser  →  GET /api/chat/sessions/{id}/stream?message=...&token=JWT
                │
            FastAPI (server)
              saves user message + creates agent_task
              enqueues run_chat job to Redis/Arq
              subscribes to Redis pub/sub channel
              streams SSE tokens to browser  ←──────────────────┐
                │                                                │
            Arq queue                                            │
                │                                                │
            LangChain agent (agents worker)                      │
              ChatAnthropic streaming                            │
              RedisStreamer.on_llm_new_token() → Redis pub/sub ──┘
              saves assistant reply via POST /internal/chat/...
```

**SSE auth**: `EventSource` doesn't support custom headers — JWT is passed as `?token=` query param.

## Key Concepts

**Multi-tenancy via RLS**: Every tenant table has a Postgres RLS policy on `app.current_org_id`. Set from JWT on every request; Arq jobs use `db_session(org_id)` to set it explicitly.

**Auth**: JWT access tokens (15 min) + opaque refresh tokens (30 days, stored hashed). Frontend auto-refreshes on 401.

**Internal API**: `/internal/*` routes let the agents service write results back to the server (save assistant message, update task status). Protected by `X-Internal-Secret` header.

**Document ingestion**: `POST /api/documents` → S3 upload → `ingest_document` Arq job (agents worker) → extract text (pypdf/python-docx) → chunk → embed (OpenAI) → store in `document_chunks` with pgvector → status `ready`.

## Common Commands

```bash
make migrate-new msg='add column'   # Autogenerate Alembic migration (host DB on :5432)
make migrate-docker                 # Apply migrations when host :5432 is unavailable
make clean                          # Remove Docker containers + volumes (wipes local DB)
make logs-server                    # Tail server logs
make logs-agents                    # Tail agents worker logs
make redeploy-ecr                   # Build + push to ECR, deploy to EC2
```

## Troubleshooting (Docker Postgres)

**`dependency failed to start: container ... postgres ... exited (1)`** — inspect logs: `docker compose logs postgres`.

If you see **“data directory was initialized by PostgreSQL version 15, which is not compatible with … version 16”**, the named volume still holds an old cluster. This project uses **Postgres 16** (`pgvector/pgvector:pg16`). Wipe local volumes and recreate (destroys dev data only):

```bash
docker compose down -v --remove-orphans   # same as: make clean
make db-up
make migrate-docker                      # or: make migrate
```

## Infrastructure

Terraform in `infra/` provisions the full AWS stack:

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# set db_password and allowed_ssh_cidrs
terraform -chdir=infra init && terraform -chdir=infra apply
```

CI deploys automatically to EC2 on push to `dev` via GitHub Actions + OIDC (no stored AWS keys).

## License

Proprietary — All rights reserved.
