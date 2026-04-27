# API Features Documentation (Current Implementation)

This document describes the **currently implemented** API features based on source code in this repository.

## Scope and Services

The current API surface is split across these services:

- `auth` (Express + TypeScript): identity, org context, document/web-url metadata, knowledge-base sync
- `auth-gateway` (Express + JavaScript): proxy to auth service + async task submission and task polling
- `task-status` (Express + WebSocket): real-time task updates over WebSocket
- `rag` (FastAPI + gRPC): retrieval service + health
- `chat-service` (FastAPI + gRPC): answer generation service + health

## Environment and Local Base URLs

- Auth Service: `http://localhost:4000`
- Auth Gateway: `http://localhost:3001`
- Task Status (HTTP): `http://localhost:3002`
- Task Status (WS): `ws://localhost:3002/ws/task-status`
- RAG REST health: `http://localhost:8003/health` (via Docker mapping)
- Chat REST health: `http://localhost:8004/health` (via Docker mapping)

## Authentication and Authorization Model

- Most protected endpoints use `Authorization: Bearer <JWT>`.
- JWT claims are expected to include:
  - `sub` (user id)
  - `org_id` (active organization id)
  - `permissions` (string array such as `documents:view`, `agents:run`)
- Permission checks are enforced in code for selected routes, especially document routes and async agent submission.

---

## 1) Auth Service API (`auth`)

Base path in service: `/api`

### 1.1 Authentication and Profile

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | Public | Register a new user |
| POST | `/api/auth/signin` | Public | Sign in with email/password |
| POST | `/api/auth/signout` | Bearer JWT | Sign out current session |
| GET | `/api/auth/me` | Bearer JWT | Get current user |
| POST | `/api/auth/refresh` | Public | Exchange refresh token for access token |
| POST | `/api/auth/forgot-password` | Public | Start password reset |
| POST | `/api/auth/reset-password` | Public | Complete password reset with code |
| POST | `/api/auth/change-password` | Bearer JWT | Change password |
| PUT | `/api/auth/profile` | Bearer JWT | Update profile fields |
| GET | `/api/auth/google` | Public | Start Google OAuth |
| GET | `/api/auth/google/callback` | Public (OAuth callback) | Complete Google OAuth login |

Common validated fields from routes:

- `signup`: `email`, `password(min 8)`, `name`
- `signin`: `email`, `password`
- `refresh`: `refreshToken`
- `reset-password`: `email`, `code(6 chars)`, `newPassword(min 8)`
- `change-password`: `currentPassword`, `newPassword(min 8)`

### 1.2 Organization Context

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/organizations` | Bearer JWT | List organizations for user |
| POST | `/api/organizations/switch` | Bearer JWT | Switch active organization |
| GET | `/api/organizations/current` | Bearer JWT | Get current active organization |

Request shape:

- `switch`: `{ "organizationId": "<uuid>" }`

### 1.3 Document Management

All document routes require Bearer JWT and organization-scoped access.

| Method | Path | Required Permission | Purpose |
|---|---|---|---|
| POST | `/api/documents/presigned-url` | `documents:create` | Generate S3 presigned upload URL |
| POST | `/api/documents` | `documents:create` | Save uploaded document metadata |
| GET | `/api/documents` | `documents:view` | List documents (supports filters) |
| GET | `/api/documents/:id` | `documents:view` | Get one document + presigned download URL |
| PATCH | `/api/documents/:id` | `documents:update` | Update metadata/tags/status |
| DELETE | `/api/documents/:id` | `documents:delete` | Soft-delete in DB + delete object from S3 |

Notable behavior:

- Upload URL generation validates file type and max file size.
- Creating a document triggers non-blocking knowledge-base auto-sync.
- List endpoint supports query params like `tag`, `status`, `limit`, `offset`.

### 1.4 Knowledge Base Sync

All routes require Bearer JWT.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/knowledge-base/sync` | Bearer JWT | Start Bedrock ingestion job |
| GET | `/api/knowledge-base/sync/:jobId` | Bearer JWT | Fetch ingestion status |
| GET | `/api/knowledge-base/sync` | Bearer JWT | List recent sync jobs |

Notable behavior:

- Returns conflict if a sync is already active.
- Requires env vars `BEDROCK_KNOWLEDGE_BASE_ID` and `BEDROCK_DATA_SOURCE_ID`.

### 1.5 Web URL Knowledge Sources

All routes require Bearer JWT.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/web-urls` | Bearer JWT | Create web URL record with metadata/tags |
| GET | `/api/web-urls` | Bearer JWT | List web URLs for current org |
| GET | `/api/web-urls/:id` | Bearer JWT | Get one web URL |
| PUT | `/api/web-urls/:id` | Bearer JWT | Update web URL metadata |
| DELETE | `/api/web-urls/:id` | Bearer JWT | Soft-delete web URL |

### 1.6 Permission Test Endpoints

| Method | Path | Auth | Required Permission | Purpose |
|---|---|---|---|---|
| GET | `/api/test/admin-only` | Bearer JWT | `members:create` | Permission-protected test |
| POST | `/api/test/run-agent` | Bearer JWT | `agents:run` | Permission-protected test |

---

## 2) Auth Gateway API (`auth-gateway`)

Base URL: `http://localhost:3001`

### 2.1 Proxy Routes (Forwarded to Auth Service)

The gateway forwards these path groups to the Auth service:

- `/api/auth/*`
- `/api/organizations/*`
- `/api/orgs/*` (alias intended for organizations)
- `/api/users/*`
- `/api/documents/*`
- `/api/web-urls/*`
- `/api/knowledge-base/*`

### 2.2 Async Agent Task Submission and Polling

| Method | Path | Auth | Required Permission | Purpose |
|---|---|---|---|---|
| POST | `/api/chat` | Bearer JWT | `agents:run` | Submit chat task |
| POST | `/api/agents/start` | Bearer JWT | `agents:create` | Submit agent-creation task |
| POST | `/api/agents/:agentId/run` | Bearer JWT | `agents:run` | Submit run task for specific agent |
| GET | `/api/agents/:taskId` | Bearer JWT | None beyond valid token | Poll task status/result (org-scoped) |

Task submit payload (from code):

```json
{
  "prompt": "user input",
  "sessionId": "optional-session-id"
}
```

Submit response:

```json
{
  "task_id": "uuid",
  "session_id": "uuid",
  "action": "action-name",
  "message": "Task accepted"
}
```

### 2.3 Token Utility Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/verify` | Bearer JWT | Validate token and emit identity headers |
| POST | `/token` | Public | Mint enriched JWT from posted user/org/permissions |
| GET | `/health` | Public | Service health |

`POST /token` expects fields: `user.id`, `user.email`, `org_id`, `permissions[]`.

---

## 3) Task Status Service (`task-status`)

### 3.1 HTTP Endpoint

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Service health |

### 3.2 WebSocket Endpoint

- URL: `ws://<host>/ws/task-status?token=<JWT>`
- JWT query param is required; invalid or missing token closes the connection.

Client messages:

```json
{ "action": "subscribe_session", "session_id": "session-uuid" }
```

```json
{ "action": "ping" }
```

Server messages:

```json
{ "status": "ok", "message": "subscribed to session <id>" }
```

```json
{ "status": "ok", "message": "pong" }
```

```json
{
  "type": "task-status",
  "task_id": "uuid",
  "session_id": "uuid",
  "data": { "...event payload..." }
}
```

Notable behavior:

- Events are consumed from RabbitMQ routing key pattern `events.#`.
- Delivery is gated by matching websocket user `org_id` against event `org_id`.

---

## 4) RAG Service (`rag`)

### 4.1 REST

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | RAG service health |

### 4.2 gRPC (Port 50051)

Service: `RagService`

- `RetrieveDocuments(RetrievalRequest) -> RetrievalResponse`

Core fields:

- `RetrievalRequest.query`
- `RetrievalRequest.user_id`
- `RetrievalRequest.allowed_asset_ids[]`
- `RetrievalRequest.context[]`

---

## 5) Chat Service (`chat-service`)

### 5.1 REST

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Health; returns 503 until internal gRPC server is ready |

### 5.2 gRPC (Port 50052)

Service: `ChatService`

- `GenerateAnswer(ChatRequest) -> ChatResponse`

Core fields:

- `ChatRequest.query`
- `ChatRequest.user_id`
- `ChatRequest.allowed_asset_ids[]`
- `ChatRequest.context[]`

Behavior:

- Chat service calls RAG `RetrieveDocuments` first, then generates answer with retrieved chunks.

---

## 6) Current Feature Map (API-Level)

The platform currently exposes these API-backed features:

1. User registration/login/logout and password lifecycle
2. OAuth login via Google callback flow
3. Organization listing and active-org switching
4. Permission-gated document upload workflow with S3 presigned URLs
5. Document metadata CRUD and organization-scoped listing
6. Knowledge-base ingestion/sync orchestration via Bedrock
7. Web URL source CRUD for organization knowledge assets
8. Async task submission pipeline through gateway + RabbitMQ
9. Task polling API and real-time task updates via WebSocket sessions
10. Internal gRPC retrieval/generation contract for RAG and chat workers

---

## Source Files Used

- `auth/src/index.ts`
- `auth/src/routes/auth.routes.ts`
- `auth/src/routes/organization.routes.ts`
- `auth/src/routes/document.routes.ts`
- `auth/src/routes/knowledgebase.routes.ts`
- `auth/src/routes/weburl.routes.ts`
- `auth/src/routes/test.routes.ts`
- `auth/src/middleware/auth.middleware.ts`
- `auth/src/middleware/permission.middleware.ts`
- `auth/src/controllers/document.controller.ts`
- `auth/src/controllers/knowledgebase.controller.ts`
- `auth/src/controllers/weburl.controller.ts`
- `auth-gateway/src/index.js`
- `task-status/index.js`
- `rag/src/main.py`
- `chat-service/src/main.py`
- `rag/src/proto/rag.proto`
