# Migrate Lambda + API Gateway to K8s Express Services

## Architecture Change

```mermaid
flowchart LR
  subgraph before [Current - AWS Managed]
    Client --> APIGW["API Gateway"]
    APIGW --> AuthLambda["Authorizer Lambda"]
    APIGW --> OrchLambda["Orchestrator Lambda"]
    APIGW --> StubLambda["Stub Lambda"]
  end

  subgraph after [Target - K8s on K3s]
    Client2[Client] --> Traefik["Traefik Ingress"]
    Traefik -->|"ForwardAuth"| AuthSvc["Auth Service :3001"]
    Traefik --> OrchSvc["Orchestrator Service :3000"]
    OrchSvc --> RMQ["RabbitMQ"]
  end
```

The request flow becomes:

```mermaid
sequenceDiagram
    participant Client
    participant Traefik
    participant AuthSvc as Auth Service
    participant OrchSvc as Orchestrator Service
    participant RMQ as RabbitMQ

    Client->>Traefik: POST /api/agents (Bearer token)
    Traefik->>AuthSvc: GET /verify (ForwardAuth)
    AuthSvc->>AuthSvc: verifyToken(jwt)
    AuthSvc-->>Traefik: 200 + headers (X-Org-Id, X-Permissions, X-Email)
    Traefik->>OrchSvc: Forward request + auth headers
    OrchSvc->>OrchSvc: hasPermission(headers, required)
    OrchSvc->>RMQ: publishMessage("cmd.task.create", payload)
    OrchSvc-->>Client: 200 QUEUED
```

Traefik's ForwardAuth middleware sends each request to the auth service for validation. If auth returns 200, the request proceeds to the orchestrator with the auth context injected as trusted headers. If auth returns 401, Traefik blocks the request.

---

## 1. Auth Service (Express)

### auth/src/index.js

Express server exposing:

- `GET /verify` -- Traefik ForwardAuth endpoint. Reads `Authorization: Bearer <token>` header, validates JWT via `verifyToken()`, returns 200 with response headers `X-User-Id`, `X-Org-Id`, `X-Permissions`, `X-Email` on success, or 401 on failure.
- `POST /token` -- token creation endpoint (calls existing `createEnrichedToken()`).
- `GET /health` -- K8s liveness/readiness probe.

Listens on port 3001.

### auth/src/auth_util.js

The `createEnrichedToken` and `verifyToken` functions are framework-agnostic and unchanged.

### auth/package.json

Dependencies: `express`, `jsonwebtoken`.

### auth/Dockerfile

Node 20 Alpine image, `npm ci`, expose 3001, `CMD ["node", "src/index.js"]`.

---

## 2. Orchestrator Service (Express)

### orchestrator/index.js

Express server reading auth context from trusted headers set by Traefik ForwardAuth:
`req.headers['x-org-id']`, `req.headers['x-permissions']`, `req.headers['x-email']`.

Routes:
- `POST /api/agents` -- requires `agents:create`
- `POST /api/users` -- requires `users:manage`
- `PUT /api/orgs` -- requires `org:manage`
- `POST /api/validate-permissions` -- batch permission check
- `GET /health` -- K8s probe

On success, calls `publishMessage('cmd.task.create', ...)` to RabbitMQ.

Listens on port 3000.

### orchestrator/permissions.js

`buildContextFromHeaders(req)` extracts auth context from trusted headers.
`hasPermission(context, perm)` checks for wildcard (`*`) or exact permission match.
`getOrgId(context)` returns the org_id.

### orchestrator/utils/rabbitmq.js

Unchanged. Connects to `amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672`.

### orchestrator/package.json

Dependencies: `amqplib`, `express`.

### orchestrator/Dockerfile

Node 20 Alpine image, `npm ci`, expose 3000, `CMD ["node", "index.js"]`.

---

## 3. K8s Manifests

### infrastructure/k8s/auth-service.yaml

- **Deployment**: 2 replicas, image `auth-service:latest`, port 3001, env `JWT_KEY` from K8s Secret `jwt-secret`, liveness/readiness probe on `/health`.
- **Service**: ClusterIP on port 3001.

### infrastructure/k8s/orchestrator-service.yaml

- **Deployment**: 2 replicas, image `orchestrator-service:latest`, port 3000, env `RABBITMQ_URL`, liveness/readiness probe on `/health`.
- **Service**: ClusterIP on port 3000.

### infrastructure/k8s/ingress.yaml

Traefik `Middleware` + `IngressRoute` CRDs:

- **Middleware** `forward-auth`: type `forwardAuth`, address `http://auth-service.data.svc.cluster.local:3001/verify`, propagates headers `X-User-Id, X-Org-Id, X-Permissions, X-Email`.
- **IngressRoute**: matches `PathPrefix(/api)`, applies `forward-auth` middleware, routes to `orchestrator-service:3000`.

### infrastructure/k8s/jwt-secret.yaml

K8s Secret containing `JWT_KEY`. For dev: `development-secret`.

---

## 4. Terraform Changes

- **Deleted** `infrastructure/terraform/lambda.tf` -- all Lambda functions, IAM roles, permissions.
- **Deleted** `infrastructure/terraform/api_gateway.tf` -- REST API, WebSocket API, authorizers, routes.
- **Updated** `infrastructure/terraform/main.tf` -- added HTTP (80) and HTTPS (443) ingress rules to security group for Traefik.
- **Updated** `infrastructure/terraform/outputs.tf` -- replaced API Gateway URLs with Traefik-based `api_url`.

---

## 5. Makefile Targets

| Target | Description |
|--------|-------------|
| `make docker-build` | Builds `auth-service` and `orchestrator-service` Docker images |
| `make docker-load` | Exports images to tar, SCPs to EC2, imports into K3s |
| `make k8s-deploy` | Applies all K8s manifests (infra + services + ingress) |
| `make deploy-infra` | End-to-end: terraform -> docker-build -> docker-load -> k8s-deploy |

---

## 6. Summary of File Changes

| Action  | File                                           |
| ------- | ---------------------------------------------- |
| Rewrite | `auth/src/index.js`                            |
| Edit    | `auth/package.json`                            |
| Create  | `auth/Dockerfile`                              |
| Rewrite | `orchestrator/index.js`                        |
| Edit    | `orchestrator/permissions.js`                  |
| Edit    | `orchestrator/package.json`                    |
| Create  | `orchestrator/Dockerfile`                      |
| Delete  | `orchestrator/stub/index.js` (+ directory)     |
| Create  | `infrastructure/k8s/auth-service.yaml`         |
| Create  | `infrastructure/k8s/orchestrator-service.yaml` |
| Create  | `infrastructure/k8s/ingress.yaml`              |
| Create  | `infrastructure/k8s/jwt-secret.yaml`           |
| Delete  | `infrastructure/terraform/lambda.tf`           |
| Delete  | `infrastructure/terraform/api_gateway.tf`      |
| Edit    | `infrastructure/terraform/main.tf` (SG rules)  |
| Edit    | `infrastructure/terraform/outputs.tf`          |
| Edit    | `Makefile`                                     |
