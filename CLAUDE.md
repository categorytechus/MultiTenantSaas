# CLAUDE.md

This file provides guidance to AI assistants when working with code in this repository.

## Commands

```bash
# Install all dependencies
make install          # uv sync (server + agents) + npm install (frontend)

# Full stack via Docker Compose
make dev              # all services: server, agents, frontend, postgres, redis
make db-up            # postgres + redis only (for local dev without Docker app)

# Local dev (requires postgres + redis running via make db-up)
make server           # FastAPI server on :8000  (src/server)
make agents           # Arq worker on :8001     (src/agents)
make frontend         # Next.js dev server on :3000 (src/frontend)

# Database
make migrate                          # alembic upgrade head
make migrate-new msg='description'    # autogenerate new migration

# Logs (Docker)
make logs-server / logs-agents / logs-frontend

# Deploy (per-client)
make redeploy-ecr CLIENT=<id>   # build + push 3 ECR images, SSH deploy to EC2
make upload-env   CLIENT=<id>   # push clients/<id>/prod.env to EC2
make url          CLIENT=<id>   # show EC2 URLs
```

Both Python packages (`src/server`, `src/agents`) use `uv` for package management. Python 3.12+ required.

## Architecture

Three-service monorepo:
- **`src/server/`** — FastAPI API server (pure HTTP, no background jobs)
- **`src/agents/`** — Arq worker for ALL AI background work: document ingest, LangChain chat agents, cost segregation pipeline, PDF generation
- **`src/frontend/`** — Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS

### src/server package layout

```
app/
  main.py              # FastAPI app, router registration, lifespan, auto-migrate in dev
  core/
    config.py          # Pydantic Settings (reads root .env)
    db.py              # SQLAlchemy async engine, get_db dependency, db_session context manager
    security.py        # JWT encode/decode, bcrypt password hashing
    tenancy.py         # RequestContext dataclass, get_request_context / get_required_context deps
    rbac.py            # Role enum, ROLE_PERMISSIONS map, authorize(permission) dep factory
    redis.py           # publish / subscribe helpers, task_channel()
    identity.py        # Super admin identity helpers (DB allowlist + env IDs)
    logging.py         # Structured logging with structlog
    audit.py           # Audit log decorator
  api/
    auth.py            # /api/auth/* — login, signup, refresh, Google/Microsoft OAuth
    chat.py            # /api/chat/* — enqueues run_chat job, SSE via Redis pub/sub
    agents.py          # /api/agents/tasks/* — task CRUD + SSE stream
    internal.py        # /internal/* — called by agents service (X-Internal-Secret auth)
    admin.py           # /api/admin/* — super admin: orgs, users, modules, prompts, invites
    organizations.py   # /api/organizations/* — org switch, reset, membership
    tenant_org_routes.py  # /api/organizations/:id/* — org-scoped CRUD for members
    users.py           # /api/users/* — user management
    documents.py       # /api/documents/* — upload, list, delete, image extraction
    web_urls.py        # /api/web-urls/* — web URL ingestion for knowledge base
    api_modules.py     # /api/api-modules/* — custom API tool modules CRUD
    api_proposals.py   # /api/api-proposals/* — API action proposals + execution
    cost_seg.py        # /api/cost-seg/* — cost segregation projects, studies, Stripe checkout
    prompts.py         # /api/organizations/:id/prompts — prompt CRUD + reset
    rulesets.py        # /api/rulesets/* — IRS rulesets for cost seg
    dashboard.py       # /api/dashboard/* — stats and activity
    webhooks.py        # /api/webhooks/* — Stripe webhook handler
  models/              # SQLModel table classes (see Models section below)
  services/
    auth.py            # Auth business logic (token generation, OAuth flows)
    chat.py            # Chat session management
    cost_seg.py        # Cost seg business logic + Stripe integration
    documents.py       # Document upload + metadata
    ingestion.py       # Document ingestion orchestration
    image_extraction.py # PDF/image extraction and embedding
    retrieval.py       # RAG context retrieval
    invite_service.py  # Invite token generation and validation
    agent_tasks.py     # Agent task lifecycle
    audit.py           # Audit log writing
  integrations/
    llm.py             # Multi-provider LLM client (Anthropic, Gemini, Bedrock)
    claude_skills.py   # Claude Skills API for cost seg report generation
    s3.py              # S3 / local filesystem fallback
    embeddings.py      # Embedding generation (fastembed)
```

### src/agents package layout

```
app/
  config.py            # Settings: DATABASE_URL, REDIS_URL, SERVER_URL, Anthropic, S3, Langfuse
  prompts.py           # Prompt resolver: file → DB override → SafeFormatter template compilation
  prompts/
    chat.json          # Default prompt templates (workflow → slot → template)
    chat_system.json   # System-level prompt templates (not exposed to users)
  streaming.py         # RedisStreamer — AsyncCallbackHandler → Redis pub/sub
  redis.py             # publish(), task_channel()
  http.py              # httpx helpers: save_assistant_message(), update_task(), fetch org prompts
  s3.py                # S3 / local filesystem download (for ingest)
  embeddings.py        # fastembed batch embedding
  rag.py               # RAG retrieval: pgvector similarity search on document_chunks
  jobs/
    __init__.py        # WorkerSettings + startup/shutdown (injects redis + httpx into ctx)
    chat.py            # run_chat Arq job — orchestrates chat agent
    ingest.py          # ingest_document Arq job — raw psycopg: parse → chunk → embed → insert
    cost_seg.py        # run_cost_seg Arq job — Claude Skills extraction + classification
    pdf_gen.py         # generate_pdf Arq job — cost seg report PDF generation
    api_tool.py        # run_api_tool Arq job — external API action execution
  agents/
    chat.py            # Chat agent: builds system prompt, handles context/images/tools, streams response
  integrations/
    llm.py             # Multi-provider LLM client (mirrors server, used for chat)
    claude_skills.py   # Claude Skills client for cost seg
```

### Models (src/server/app/models/)

| Model | Table | Description |
|-------|-------|-------------|
| `User` | `users` | Email, hashed password, user_type (user/org_admin/super_admin) |
| `Org` | `orgs` | Slug, name, domain, status, subscription_tier, cost_seg_price_overrides (JSON) |
| `OrgMembership` | `org_memberships` | User ↔ Org link with role |
| `ChatSession` / `ChatMessage` | `chat_sessions` / `chat_messages` | Chat history |
| `Document` / `DocumentChunk` | `documents` / `document_chunks` | Uploaded docs + pgvector embeddings |
| `WebUrl` | `web_urls` | Scraped web URLs for knowledge base |
| `AgentTask` | `agent_tasks` | Background task tracking (status, result) |
| `ApiModule` | `api_modules` | Custom API tool definitions (per-org) |
| `ApiTaskProposal` | `api_task_proposals` | AI-proposed API actions awaiting approval |
| `ApiExecutionLog` | `api_execution_logs` | Executed API action audit trail |
| `MasterModule` | `master_modules` | Global module catalog (ai_assistant, documents, etc.) |
| `OrgModule` | `org_modules` | Per-org module enablement (FK to master_modules) |
| `OrgPrompt` | `org_prompts` | Per-org prompt overrides (workflow + slot + template) |
| `RbacRole` / `RbacPermission` | `rbac_roles` / `rbac_permissions` | Role-based access control |
| `SuperAdminAllowlist` | `super_admin_allowlist` | DB-managed super admin user IDs |
| `InviteToken` | `invite_tokens` | Email invitation tokens |
| `IrsRule` / `IrsRuleChunk` | `irs_rules` / `irs_rule_chunks` | IRS depreciation rules for cost seg |
| `AuditLog` | `audit_logs` | Action audit trail |

### Frontend (src/frontend/) — Next.js 15 App Router

```
app/
  layout.tsx           # Root layout (Inter font, globals.css)
  page.tsx             # Landing / marketing page
  globals.css          # Global styles + Tailwind
  auth/                # /auth/signin, /auth/signup, /auth/accept-invite
  dashboard/           # /dashboard — stats overview
  ai_assistant/        # /ai_assistant — AI chat interface
  documents/           # /documents — document upload + management
  web-urls/            # /web-urls — web URL management
  prompts/             # /prompts — system prompt editor (per-org)
  cost_segregation/    # /cost_segregation — study list + /[id] study wizard
  api-modules/         # /api-modules — API tool management
  profile/             # /profile — user profile
  users/               # /users — org member management
  roles/               # /roles — RBAC role management
  admin/               # Super admin pages:
    organizations/     #   /admin/organizations — org CRUD
    org-permissions/   #   /admin/org-permissions/[orgId] — module toggles + cost seg pricing
    org-admins/        #   /admin/org-admins — org admin invites
    super-admins/      #   /admin/super-admins — super admin allowlist
  api/
    [...path]/         # Catch-all API proxy → FastAPI backend (API_BACKEND_ORIGIN)
    calendar/          # ICS calendar download endpoint
    chat/              # SSE chat streaming proxy
components/
  Layout.tsx           # App shell: sidebar nav, org switcher, module-gated nav items
  ChatInterface.tsx    # AI chat UI with streaming
  DocumentUpload.tsx   # Drag-and-drop document uploader
  KnowledgeBaseSync.tsx # Knowledge base sync status
src/lib/
  api.ts               # apiFetch: Bearer token, auto-refresh on 401, envelope normalization
  config.ts            # Runtime config (AUTH_API_URL, CHAT_API_URL, WS_URL)
  module-ids.ts        # Canonical module ID constants (matches master_modules.id in DB)
  permissions.ts       # PERMISSION_MODULE_ENABLED feature flag
  auth-enrichment.ts   # JWT payload enrichment helpers
  clipboard.ts         # Clipboard utilities
  org-member-roles.ts  # Role label helpers
middleware.ts          # Next.js middleware: /api/auth/signup → /auth/signup redirects
```

## Key Patterns

### Multi-tenancy via RLS
Every tenant-scoped table has a Postgres RLS policy on `app.current_org_id`. `get_db` sets it from the JWT on every request. `db_session(org_id)` sets it in Arq jobs and internal endpoints.

### Chat Streaming Pipeline
1. `GET /api/chat/sessions/{id}/stream?message=...` — server saves user message, creates `agent_task`, enqueues `run_chat` to Arq, subscribes to Redis channel, forwards events as SSE
2. `run_chat` (agents worker) — builds system prompt from DB overrides → file fallback, runs RAG retrieval, streams response via `RedisStreamer`
3. Server SSE translates: `token` events → `data: {text}\n\n`, `done` → `data: [DONE]\n\n`

### Prompt Management
- **Default prompts** live in `src/agents/app/prompts/chat.json` (workflow → slot → template)
- **System prompts** live in `src/agents/app/prompts/chat_system.json` (not exposed to users)
- **Per-org overrides** stored in `org_prompts` table (managed via `/prompts` UI)
- **Resolution order**: DB override → file default → KeyError
- **Template variables**: `{context}`, `{modules_json}`, `{n}`, `{s}` — uses `SafeFormatter` (missing vars kept as-is)
- **Slots**: `no-context` (base, hidden from UI), `with-context`, `api-tools`, `link-instructions`, `with-images`, `caption-images`
- **Workflows**: `default`, `cost-seg`

### Module Permission System
- `master_modules` table defines the global catalog of features
- `org_modules` table enables/disables modules per org
- Frontend checks via `hasModule(MODULE.XXX)` in `Layout.tsx` to show/hide nav items
- Module IDs: `ai_assistant`, `ai_images`, `ai_links`, `report_generation`, `cost_seg`, `documents`, `web_urls`, `api_calling`
- System Prompts tab is hidden if no modules are enabled; individual prompt slots are filtered by their related module(s)
- `PERMISSION_MODULE_ENABLED` flag in `src/lib/permissions.ts` can disable all module gating

### Cost Segregation
- **Projects**: Created via UI, each has property details (type, cost, address, etc.)
- **Studies**: Triggered pipeline: document extraction → Claude Skills classification → PDF report
- **Stripe integration**: Per-property-type pricing via `STRIPE_COST_SEG_PRICE_MAPPING` env var; per-org price overrides via `orgs.cost_seg_price_overrides` JSON column
- **Claude Skills**: Uses Anthropic Skills API (NOT Bedrock) for extraction + classification
- **IRS Rules**: `irs_rules` + `irs_rule_chunks` tables for depreciation lookup during classification

### Internal API
`/internal/*` routes are called by the agents service to write results back (save assistant message, update task status). Protected by `X-Internal-Secret: {SECRET_KEY}` header. Not exposed publicly.

### Auth Flow
JWT access tokens (15 min) + opaque refresh tokens (30 days, stored hashed in DB). Access token payload: `{sub: user_id, org_id, role, email}`. Refresh via `POST /api/auth/refresh`. Google OAuth and Microsoft OAuth supported.

### RBAC
`authorize("permission:name")` returns a FastAPI `Depends()`. `SUPER_ADMIN` has wildcard `{"*"}`. Roles and permissions are defined in `rbac_roles` and `rbac_permissions` tables with grants in `role_permissions` and `role_org_permissions`.

### SSE and JWT
`EventSource` doesn't support custom headers. SSE endpoints accept JWT via `?token=` query param. `get_db` reads both `Authorization: Bearer` and `?token=`.

### Document Ingestion
`POST /api/documents` → uploads to S3 → enqueues `ingest_document` to Arq (agents worker). Job uses raw psycopg (no ORM): download S3 → parse (pypdf/python-docx) → chunk → embed (fastembed) → insert into `document_chunks` with pgvector → set `documents.status = 'ready'`.

### S3 Fallback
When `S3_BUCKET` is empty, writes to `LOCAL_UPLOAD_DIR` (`/tmp/uploads`). Safe for local dev.

### LLM Multi-Provider
`CHAT_MODEL` setting routes to: `anthropic` (direct API), `gemini` (Google AI), or `bedrock` (AWS). The LLM client in both `src/server/app/integrations/llm.py` and `src/agents/app/integrations/llm.py` handles provider switching.

### Frontend API Proxy
Next.js `app/api/[...path]/route.ts` catches all `/api/*` requests and proxies them to `API_BACKEND_ORIGIN` (default `http://localhost:8000`). This keeps browser requests same-origin. The `apiFetch` helper in `src/lib/api.ts` adds Bearer tokens and handles 401 refresh.

## Environment

Copy `.env.example` → `.env` in the repo root. All AI/S3 keys are optional — app runs with mocks.

Required: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`.
Generate: `openssl rand -hex 32`

Both `src/server` and `src/agents` read the same root `.env` file (resolved via `Path(__file__).parents`).

Key env vars by category:
- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_URL`
- **Auth**: `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`
- **LLM**: `CHAT_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `GEMINI_API_KEY`, `OPENAI_API_KEY`
- **Claude Skills**: `ANTHROPIC_WORKSPACE_ID`, `CLAUDE_SKILLS_COST_SEG_ID`, `CLAUDE_SKILLS_COST_SEG_VERSION`, `CLAUDE_SKILLS_MODEL`
- **S3**: `S3_BUCKET`, `S3_REGION` (empty = local filesystem)
- **OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- **Stripe**: `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_COST_SEG_PRODUCT_ID`, `STRIPE_COST_SEG_PRICE_MAPPING`
- **Langfuse** (optional tracing): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`
- **App**: `ENVIRONMENT`, `CORS_ORIGINS`, `PUBLIC_APP_URL`, `SERVER_URL`, `API_BACKEND_ORIGIN`

## Database

Postgres 16 + pgvector. HNSW index on `document_chunks.embedding` (cosine, 1536 dims).

Migrations live in `src/server/alembic/versions/` (currently 55 migrations). Always run `make migrate` before first use. Alembic autogenerate doesn't handle RLS policies — add those manually.

In development mode (`ENVIRONMENT=development`), the server auto-runs migrations on startup.

## Infrastructure (`infra/`)

Terraform provisions: VPC, EC2 (t3.medium), RDS PostgreSQL 16, ElastiCache Redis 7, S3 uploads bucket, three ECR repos (`multitenant-saas-backend`, `multitenant-saas-agents`, `multitenant-saas-web`), GitHub OIDC role.

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# edit db_password, allowed_ssh_cidrs
terraform -chdir=infra init
terraform -chdir=infra apply
```

### Multi-Client Deployments
Each client has a directory under `clients/` with `config.env`, `backend.hcl`, `terraform.tfvars`, `prod.env`, and SSH key. Use `CLIENT=<id>` with make targets:
```bash
make new-client CLIENT=acme REGION=us-east-1
make tf-init CLIENT=acme
make tf-apply CLIENT=acme
make redeploy-ecr CLIENT=acme
```

## Skills (`skills/`)

Claude Skills definitions for Anthropic's Skills API. Currently contains `costseg_report_v2/SKILL.md` which defines the cost segregation extraction and classification skill.

## Important Conventions

- **No `settings` column on `org_modules`** — it was removed. Module configuration goes elsewhere (e.g., `orgs.cost_seg_price_overrides`).
- **`no-context` prompt slot is hidden from the UI** — it contains base system instructions that should not be user-editable.
- **Module IDs are centralized** in `src/frontend/src/lib/module-ids.ts` (frontend) and `master_modules` table (backend). Never use inline string literals.
- **Super admin detection** uses both JWT claims AND `super_admin_allowlist` DB table. Check `isSuperAdminUserType()` in Layout.tsx or `is_super_admin()` in the server.
- **Org switching** re-mints JWT tokens via `POST /api/organizations/switch`. After switching, `sessionStorage.userModules` is cleared and refetched.
