# Learning Plan: MultiTenantSaas Project Mastery

This plan is organized into 6 progressive phases. Each phase builds on the previous one, starting from language/tool fundamentals and ending with the full project architecture. Estimated total: **4-6 weeks** depending on pace.

---

## Phase 1: JavaScript and Node.js Fundamentals (Week 1)

You need this because the auth-gateway microservice and legacy backend scripts are written in JavaScript/TypeScript.

### Core Concepts to Learn

- **JavaScript basics:** variables (`const`, `let`), arrow functions (`=>`), template literals, destructuring, spread operator
- **Async programming:** Promises, `async/await` -- critical for network and database requests
- **Modules:** `require()` / `import` -- used in Node.js files, e.g. `import jwt from 'jsonwebtoken'`
- **Node.js runtime:** What Node.js is (server-side JS), Express routing, and the event loop
- **npm:** `package.json`, `npm install`, `node_modules`, dependency management

### Where to See This in the Project

- [auth-gateway/src/index.ts](auth-gateway/src/index.ts) -- Express server, path parsing, conditionals, destructuring
- [auth-gateway/src/utils/jwt.ts](auth-gateway/src/utils/jwt.ts) -- JWT signing/verification with `jsonwebtoken`

### Recommended YouTube Tutorials

- **JavaScript Fundamentals:**
  - [JavaScript Fundamentals: Building a Strong Foundation](https://www.youtube.com/playlist?list=PLQyfMZ4iIv1vM1VnPr35cnZ6b97TPStjG) -- playlist covering all core JS concepts
  - [JavaScript: Zero to Hero](https://www.youtube.com/playlist?list=PL4CCSwmU04MgN15Z_YN7I5S6W70DZ1csu) -- beginner-friendly full playlist
- **Node.js:**
  - [Node.js Crash Course -- Traversy Media (2h)](https://www.youtube.com/watch?v=fBNz5xF-Kx4) -- 1.6M views, covers core modules, HTTP server, routing (no frameworks)
  - [Node.js Tutorial for Beginners 2025 -- Pure Node (2h)](https://www.youtube.com/watch?v=CMpQAtYuegk) -- modules, file system, HTTP servers, routing with zero external packages
  - [Node.js Crash Course Tutorial -- Net Ninja playlist](https://www.youtube.com/playlist?list=PL4cUxeGkcC9jsz4LDYc6kv3ymONOKxwBU) -- step-by-step series

### Other Resources

- **freeCodeCamp JavaScript course** (free, interactive)
- **Node.js official "Getting Started" guide** at nodejs.org
- Practice: write a small script that reads a JSON file and prints filtered results

---

## Phase 2: AWS Fundamentals (Week 1-2)

You need this because the infrastructure runs on AWS services orchestrated by Terraform.

### Core AWS Concepts

- **AWS Account & IAM:** Users, roles, policies -- the project defines IAM roles in [terraform/main.tf](terraform/main.tf)
- **Traefik Ingress:** HTTP front door that routes requests to our microservices inside Kubernetes.
- **Secrets Manager:** Stores sensitive values (DB password, JWT key, LLM keys) -- see [terraform/secrets.tf](terraform/secrets.tf)
- **CloudWatch:** Logs and metrics -- the project uses it for container logs and EC2 auto-shutdown alarms
- **EC2:** Virtual server -- runs k3s (lightweight Kubernetes) for all services
- **VPC:** Virtual private network -- the project creates one in [terraform/main.tf](terraform/main.tf)

### The API Request Flow

```mermaid
flowchart LR
    Client([Client]) -->|"HTTP + Bearer Token"| Traefik[Traefik Ingress]
    Traefik -->|"Step 1: ForwardAuth"| Auth[Auth Gateway /verify]
    Auth -->|"Allow + Headers"| Traefik
    Traefik -->|"Step 2: Route"| API[Backend Services]
    API -->|"Response"| Client
```

1. **Traefik Ingress** -- Receives external request
2. **Auth Gateway (Verify)** -- Traefik sends request to Auth Gateway's `/verify` endpoint to validate JWT
3. **Backend Route** -- If valid, request is forwarded to the appropriate microservice

### Recommended YouTube Tutorials

- **AWS IAM (roles & policies):**
  - [AWS IAM Users, Roles, and Policies in 5 Minutes](https://www.youtube.com/watch?v=xST_Qfg8i1E) -- quick conceptual overview, watch this first
- **AWS Secrets Manager:**
  - [AWS Secrets Manager Step-by-Step: Store, Rotate & Delete Secrets (5min)](https://youtube.com/watch?v=ItzzgWe7elE) -- quick practical demo

### Other Resources

- **AWS Free Tier** -- sign up and experiment

---

## Phase 3: Terraform and Infrastructure as Code (Week 2-3)

You need this because all AWS infrastructure is defined in the `terraform/` directory.

### Core Terraform Concepts

- **What is IaC:** Defining infrastructure in code files instead of clicking in AWS Console
- **HCL syntax:** Terraform's language -- blocks like `resource`, `variable`, `output`, `data`, `provider`
- **Resources:** Each `resource` block creates one AWS thing (e.g., `aws_lambda_function`, `aws_instance`)
- **Variables:** Inputs defined in [terraform/variables.tf](terraform/variables.tf) -- `aws_region`, `project_name`, `instance_type`
- **Outputs:** Values printed after apply, defined in [terraform/outputs.tf](terraform/outputs.tf) -- EC2 IP, API URLs
- **State:** Terraform tracks what it has created in a state file (`.tfstate`)
- **Commands:** `terraform init` (setup), `terraform plan` (preview), `terraform apply` (deploy), `terraform destroy` (teardown)
- **Provider:** Configures which cloud to talk to -- AWS provider in [terraform/provider.tf](terraform/provider.tf)
- **Data sources:** Read existing resources or generate values (e.g., `data "archive_file"` to zip Lambda code)
- **References:** Resources reference each other, e.g., `aws_ecr_repository.auth_gateway.repository_url`

### Project Terraform File Map

| File                                                 | What It Creates                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| [terraform/provider.tf](terraform/provider.tf)       | AWS provider config (region us-east-1)                                |
| [terraform/variables.tf](terraform/variables.tf)     | Input variables with defaults                                         |
| [terraform/main.tf](terraform/main.tf)               | VPC, subnet, EC2 (k3s server), IAM, security groups, CloudWatch alarm |
| [terraform/secrets.tf](terraform/secrets.tf)         | 3 Secrets Manager secrets + IAM policy for EC2                        |
| [terraform/logging.tf](terraform/logging.tf)         | CloudTrail + S3 bucket + CloudWatch log group                         |
| [terraform/outputs.tf](terraform/outputs.tf)         | Outputs (IPs, URLs, secret names)                                     |

### Recommended YouTube Tutorials

- **Terraform on AWS (start here):**
  - [Terraform on AWS: The Ultimate Beginner's Guide 2025 (16min)](https://www.youtube.com/watch?v=RiBSzAgt2Hw) -- credentials setup, variables, EC2 deployment, init/plan/apply workflow
  - [Terraform Tutorial on AWS -- Getting Started (36min)](https://www.youtube.com/watch?v=Qfg6hRY4Tq0) -- deeper dive into state, creating/modifying/importing EC2, part of a full playlist covering VPC and modules
- **Terraform deep dives:**
  - [Complete Terraform Crash Course -- Beginner to Pro 2025](https://www.youtube.com/watch?v=KVmsx4QeqEU) -- covers iterators, advanced patterns
  - [AWS Terraform Full Course: Modules for Beginners (playlist)](https://www.youtube.com/playlist?list=PL184oVW5ERMCxA4336x_TM7q1Cs8y0x1s) -- dedicated to Terraform modules

### Other Resources

- **HashiCorp Terraform tutorials** at developer.hashicorp.com/terraform/tutorials (start with "Get Started - AWS")
- Practice: write a Terraform file that creates an S3 bucket, then `plan` and `apply` it

---

## Phase 4: Project-Specific Patterns Deep Dive (Week 3-4)

Now that you understand the building blocks, study how they fit together in this project.

### 4a. Multi-Tenancy and RBAC

**Watch first:**

- [Multi-Tenant SaaS Architecture in 3 Simple Steps (39min)](https://www.youtube.com/watch?v=bFLGwVyIotA) -- what multi-tenancy is, entity relationships, RBAC, org switching (33K views)
- [JWT Authentication in Node.js -- Net Ninja playlist (18 lessons)](https://www.youtube.com/playlist?list=PL4cUxeGkcC9iqqESP8335DA5cRFp8loyp) -- JWT theory, signup/login, protected routes, exactly the pattern used in this project
- [Node.js Auth API with JWT, PostgreSQL & Prisma (1h 23min)](https://www.youtube.com/watch?v=urt4U4a6uI4) -- very close to this project's stack: JWT + Prisma + PostgreSQL auth system

Then read [RBAC_WORKFLOW.md](RBAC_WORKFLOW.md) thoroughly. The key idea:

```mermaid
flowchart TD
    Login([User Logs In]) --> Enrich["Auth Enrichment<br/>Queries Prisma for user roles"]
    Enrich --> JWT["Creates Enriched JWT<br/>Contains org_id + permissions"]
    JWT --> Request["Client sends request<br/>with Bearer token"]
    Request --> Traefik["Traefik ForwardAuth"]
    Traefik --> AuthGWVerify["Auth Gateway /verify<br/>Verifies JWT signature"]
    AuthGWVerify --> AuthGW["Auth Gateway Services<br/>Checks hasPermission"]
    AuthGW --> Allow["200 OK / 202 Accepted"]
    AuthGW --> Deny["403 Forbidden"]
```

- **Prisma schema** in [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma) -- defines Organization, User, Role, Permission, UserOrganizationRole
- **Auth enrichment** in [frontend/src/lib/auth-enrichment.ts](frontend/src/lib/auth-enrichment.ts) -- queries DB for a user's roles in an org
- **JWT creation** in [auth-gateway/src/utils/jwt.ts](auth-gateway/src/utils/jwt.ts) -- `createEnrichedToken()`
- **Permission checks** in [auth-gateway/src/middleware/rbac.ts](auth-gateway/src/middleware/rbac.ts) -- `hasPermission()`, `getOrgId()`

### 4b. Traefik Ingress Routing

Study [infrastructure/k8s/ingress.yaml](infrastructure/k8s/ingress.yaml) to understand:

- How REST routes (`/api/*`) are routed
- How the Traefik `ForwardAuth` middleware intercepts requests to validate JWTs
- How WebSocket routes (`/ws`) work differently

### 4c. Infrastructure Architecture

Read [DESIGN_ARCH.md](DESIGN_ARCH.md) and [INFRA_RUNBOOK.md](INFRA_RUNBOOK.md) for the full picture:

```mermaid
flowchart TB
    subgraph aws [AWS Cloud]
        SM[Secrets Manager]
        CT[CloudTrail + S3]
        CW[CloudWatch]
        subgraph vpc [VPC 10.0.0.0/16]
            subgraph ec2 [EC2 t3.medium - k3s]
                Traefik[Traefik Ingress]
                AuthGW[Auth Gateway]
                PG[(PostgreSQL 15)]
                PGB[PgBouncer]
                RMQ[RabbitMQ 3-node]
                FB[Fluent Bit]
                Traefik --> AuthGW
                AuthGW --> PGB
                AuthGW --> RMQ
            end
        end
        FB --> CW
        SM --> ec2
    end
    Client([Client]) --> Traefik
```

---

## Phase 5: Supporting Technologies (Week 4-5)

These are secondary but important for the full picture.

### 5a. Kubernetes Basics (for k3s)

**Watch first:**

- [Kubernetes Crash Course -- KodeKloud (2h 10min, 1M+ views)](https://www.youtube.com/watch?v=XuSQU5Grv1g) -- containers, pods, replicasets, deployments, services + hands-on microservice project with free labs
- [Kubernetes for Absolute Beginners -- Full 2-Hour Crash Course](https://www.youtube.com/watch?v=ljqLf1s5l3w) -- core concepts, kubectl commands, YAML configs
- [Kubernetes Crash Course for Beginners -- Hands-On + First Deployment (19min)](https://www.youtube.com/watch?v=9AKSLbfen6w) -- quick version if you want a fast overview first

- **What k3s is:** Lightweight Kubernetes that runs on a single EC2 instance
- **Key concepts:** Pods, Deployments, StatefulSets, Services, Namespaces, PersistentVolumeClaims
- **Project K8s manifests** in `backend/k8s/`:
  - [backend/k8s/postgresql.yaml](backend/k8s/postgresql.yaml) -- PostgreSQL StatefulSet
  - [backend/k8s/pgbouncer.yaml](backend/k8s/pgbouncer.yaml) -- Connection pooler
  - [backend/k8s/rabbitmq/rabbitmq.yaml](backend/k8s/rabbitmq/rabbitmq.yaml) -- Message queue cluster
  - [backend/k8s/cloudwatch-logging.yaml](backend/k8s/cloudwatch-logging.yaml) -- Fluent Bit log forwarder
- Read [KUBERNETES_GUIDE.md](KUBERNETES_GUIDE.md) -- project-specific K8s guide

### 5b. Prisma ORM

**Watch first:**

- [Prisma Complete Course 2025 -- Modern Database ORM for Node.js & TypeScript (2h 11min)](https://www.youtube.com/watch?v=3AldkDy7TQ4) -- setup, data modeling, CRUD, relations, migrations, seeding, best practices

- **What it is:** Type-safe database toolkit for Node.js/TypeScript
- **Schema file:** [frontend/prisma/schema.prisma](frontend/prisma/schema.prisma) defines all tables and relationships
- **Seed script:** [frontend/prisma/seed.ts](frontend/prisma/seed.ts) populates default roles and permissions
- **Key commands:** `npx prisma generate`, `npx prisma migrate`, `npx prisma db seed`

### 5c. Next.js Frontend (minimal currently)

**Watch first:**

- [Next.js 15 Crash Course: Build a Production-Ready App -- JavaScript Mastery (5.3h, 1.3M views)](https://www.youtube.com/watch?v=Zq5fmkH0T78) -- routing, rendering, full-stack features, auth, deployment
- [Next.js Tutorial 2026 -- Start Your Journey Here (56min)](https://www.youtube.com/watch?v=KAQCHfu_3jw) -- quick intro covering routing, data fetching, Prisma, server actions
- [Next.js Full Tutorial: Beginner to Advanced (6.8h)](https://www.youtube.com/watch?v=k7o9R6eaSes) -- comprehensive deep-dive if you want the full picture

- The frontend is a Next.js 16 app with React 19 and Tailwind CSS 4
- Currently only has the auth enrichment library -- no pages/UI yet
- Located in [frontend/](frontend/) with a Dockerfile for deployment

---

## Phase 6: DevOps and Deployment Workflow (Week 5-6)

### 6a. Makefile Commands

The [Makefile](Makefile) ties everything together:

- `make deploy-infra` -- full deploy (Terraform + K8s + secrets)
- `make terraform-apply` -- just Terraform
- `make k8s-deploy` -- just Kubernetes manifests
- `make sync-secrets` -- sync AWS secrets to K8s
- `make bootstrap-secrets` -- initial secret creation

### 6b. CI/CD Pipeline

- [.github/workflows/infra-ci.yml](.github/workflows/infra-ci.yml) runs on push/PR to `main`, `dev`, `infra/*`
- Validates Terraform syntax and K8s YAML structure
- No auto-deploy yet (validation only)

### 6c. Scripts

- [backend/scripts/bootstrap-aws-secrets.sh](backend/scripts/bootstrap-aws-secrets.sh) -- creates initial secrets in AWS
- [backend/scripts/sync-secrets.sh](backend/scripts/sync-secrets.sh) -- syncs secrets from AWS to K8s

---

## Suggested Reading Order for Project Docs

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) -- start here for the full project map
2. [DESIGN_ARCH.md](DESIGN_ARCH.md) -- high-level architecture
3. [RBAC_WORKFLOW.md](RBAC_WORKFLOW.md) -- the core security model
4. [INFRA_RUNBOOK.md](INFRA_RUNBOOK.md) -- step-by-step deployment guide
5. [KUBERNETES_GUIDE.md](KUBERNETES_GUIDE.md) -- K8s concepts applied to this project

---

## Quick Reference: Key Files to Study

| Priority | File                                          | Why                                    |
| -------- | --------------------------------------------- | -------------------------------------- |
| 1        | `auth-gateway/src/index.ts`       | Main business logic proxy             |
| 2        | `auth-gateway/src/middleware/rbac.ts` | RBAC permission checking               |
| 3        | `frontend/prisma/schema.prisma`               | Data model for multi-tenancy           |
| 4        | `frontend/src/lib/auth-enrichment.ts`         | How user data is loaded from DB        |
| 5        | `infrastructure/k8s/ingress.yaml`             | How Traefik routes and auth work       |
| 6        | `infrastructure/k8s/auth-gateway.yaml`        | How the auth gateway is deployed       |
| 7        | `terraform/main.tf`                           | VPC, EC2, networking infrastructure    |
| 8        | `Makefile`                                    | How to deploy everything               |
