# MultiTenant SaaS Platform

A comprehensive multi-tenant SaaS platform with AI-powered agents for counseling, enrollment, and support services.

## Architecture Overview

This platform consists of:
- **Frontend**: Next.js 16 with TypeScript, Tailwind CSS, and Shadcn UI
- **Authentication**: AWS Cognito with federated identity (Google, username/password)
- **API Gateway**: AWS API Gateway (REST + WebSocket)
- **Auth Gateway**: Request validation, RBAC, and RabbitMQ-based task routing
- **AI Agents**:
  - Counselor (LangGraph)
  - Enrollment (CrewAI)
  - Support (Strands)
- **Infrastructure**: AWS EKS, PostgreSQL, RabbitMQ, Supabase
- **Observability**: Prometheus, Grafana, CloudWatch

## Repository Structure

```
MultiTenantSaas/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI/CD pipeline
├── frontend/                   # Next.js application
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── Dockerfile
├── auth/                       # Auth service
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── agents/
│   ├── counselor/             # LangGraph agent
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── enrollment/            # CrewAI agent
│   │   ├── main.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── support/               # Strands agent
│       ├── main.py
│       ├── requirements.txt
│       └── Dockerfile
├── auth-gateway/              # Auth Gateway proxy
│   ├── src/                   # Node.js source files
│   ├── package.json
│   └── Dockerfile
├── infrastructure/
│   ├── terraform/             # IaaC configurations
│   └── k8s/                   # Kubernetes manifests
├── docs/                      # Documentation
│   ├── architecture.md
│   ├── api.md
│   └── runbooks/
├── CONTRIBUTING.md
└── README.md
```

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- Docker & Docker Compose
- AWS CLI configured
- Terraform 1.5+

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/categorytechus/MultiTenantSaas.git
   cd MultiTenantSaas
   ```

2. **Start infrastructure services**
   ```bash
   docker-compose up -d postgres rabbitmq
   ```

3. **Run frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. **Run agents** (in separate terminals)
   ```bash
   cd agents/counselor
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

### Building Docker Images

```bash
# Build all images
docker-compose build

# Build specific service
docker build -f frontend.Dockerfile -t multitenant-saas-frontend:latest ./frontend
```

## Development Timeline

- **Weeks 1-2**: Foundation & Infrastructure, Auth, Agents
- **Weeks 3-4**: Frontend & Observability
- **Weeks 5-6**: Security Hardening & Testing
- **Weeks 7-8**: Optimization, Documentation & Buffer

See detailed [Sprint Plan](./docs/sprint-plan.md) for daily tasks.

## Technology Stack

### Frontend
- Next.js 16
- TypeScript
- Tailwind CSS
- Shadcn UI
- Prisma ORM

### Backend
- FastAPI (Python agents)
- Express.js (Auth service)
- PostgreSQL (with pgvector)
- RabbitMQ
- AWS Cognito

### AI/ML
- LangGraph (Counselor agent)
- CrewAI (Enrollment agent)
- Strands (Support agent)
- OpenAI/Anthropic APIs

### Infrastructure
- AWS EKS
- Terraform
- Docker
- Prometheus & Grafana
- CloudWatch

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our development process and how to submit pull requests.

## Security

- All secrets stored in AWS Secrets Manager
- Row-Level Security (RLS) enabled on PostgreSQL
- mTLS between services
- Pod Security Policies enforced
- Regular security audits

## Documentation

- [Architecture Documentation](./docs/architecture.md)
- [API Documentation](./docs/api.md)
- [Operations Runbook](./docs/runbooks/operations.md)
- [Security Runbook](./docs/runbooks/security.md)

## Team

- **Developer A** (Texas, USA)
- **Developer B** (India)
- **Project Manager**: Gokhul (EST)

## License

Proprietary - All rights reserved

## Support

For questions or issues, contact the development team or create an issue in GitHub.

---

Last updated: January 28, 2026
