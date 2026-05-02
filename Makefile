.PHONY: help dev server agents web migrate install lint clean db-up ecr-login redeploy-ecr

PYTHON := python3
UV := uv
SERVER_DIR := src/server
AGENTS_DIR := src/agents
WEB_DIR := src/web

AWS_REGION   ?= us-east-1
AWS_ACCOUNT  ?= $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REGISTRY ?= $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
IMAGE_TAG    ?= $(shell git rev-parse --short HEAD)

help:
	@echo "Multi-Tenant AI SaaS — available targets:"
	@echo ""
	@echo "Docker Compose (recommended):"
	@echo "  make dev             Start all 4 services (server, agents, web, db)"
	@echo "  make dev-detach      Same, detached"
	@echo "  make db-up           Start only Postgres + Redis"
	@echo "  make clean           Remove containers and volumes"
	@echo ""
	@echo "Local dev (requires Postgres + Redis via make db-up):"
	@echo "  make install         Install all dependencies (uv sync + npm install)"
	@echo "  make server          FastAPI server on :8000"
	@echo "  make agents          Arq worker — document ingest + AI chat agents (src/agents)"
	@echo "  make web             Vite dev server on :3000"
	@echo ""
	@echo "Database:"
	@echo "  make migrate         alembic upgrade head"
	@echo "  make migrate-new msg='...'  autogenerate migration"
	@echo ""
	@echo "Logs (Docker):"
	@echo "  make logs-server     FastAPI server logs"
	@echo "  make logs-agents     Agents worker logs (ingest + chat)"
	@echo "  make logs-web        Web dev server logs"
	@echo ""
	@echo "Deploy:"
	@echo "  make redeploy-ecr    Build + push 3 images to ECR, SSH deploy to EC2"
	@echo ""

# ── Full stack via Docker Compose ──────────────────────────────────────────

dev:
	docker compose up --build

dev-detach:
	docker compose up --build -d

db-up:
	docker compose up postgres redis -d

# ── Local (no Docker for app) ──────────────────────────────────────────────

install:
	cd $(SERVER_DIR) && $(UV) sync
	cd $(AGENTS_DIR) && $(UV) sync
	cd $(WEB_DIR) && npm install

server:
	cd $(SERVER_DIR) && $(UV) run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

agents:
	cd $(AGENTS_DIR) && $(UV) run arq app.jobs.WorkerSettings

web:
	cd $(WEB_DIR) && npm run dev

migrate:
	cd $(SERVER_DIR) && $(UV) run alembic upgrade head

migrate-new:
	@test -n "$(msg)" || (echo "Usage: make migrate-new msg='description'" && exit 1)
	cd $(SERVER_DIR) && $(UV) run alembic revision --autogenerate -m "$(msg)"

# ── Docker helpers ─────────────────────────────────────────────────────────

clean:
	docker compose down -v --remove-orphans

logs-server:
	docker compose logs -f server

logs-agents:
	docker compose logs -f agents

logs-web:
	docker compose logs -f web

# ── ECR / prod deploy ─────────────────────────────────────────────────────────

EC2_USER := ec2-user
EC2_IP   ?= $(shell aws ec2 describe-instances \
               --filters "Name=tag:Name,Values=mtsaas-prod-app" "Name=instance-state-name,Values=running" \
               --query "Reservations[0].Instances[0].PublicIpAddress" --output text 2>/dev/null)
SSH_KEY  ?= infra/multi-tenant-saas-key.pem

ecr-login:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY)

redeploy-ecr: ecr-login
	@echo "Building and pushing images (tag: $(IMAGE_TAG))..."
	docker build -t $(ECR_REGISTRY)/multitenant-saas-backend:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-backend:latest \
	             src/server
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:latest
	docker build -t $(ECR_REGISTRY)/multitenant-saas-agents:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-agents:latest \
	             src/agents
	docker push $(ECR_REGISTRY)/multitenant-saas-agents:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-agents:latest
	docker build -t $(ECR_REGISTRY)/multitenant-saas-web:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-web:latest \
	             src/web
	docker push $(ECR_REGISTRY)/multitenant-saas-web:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-web:latest
	@echo "Deploying to EC2 ($(EC2_IP))..."
	scp -i $(SSH_KEY) -o StrictHostKeyChecking=no docker-compose.prod.yml \
	    $(EC2_USER)@$(EC2_IP):/opt/app/docker-compose.yml
	ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(EC2_USER)@$(EC2_IP) \
	    "cd /opt/app && \
	     aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY) && \
	     ECR_REGISTRY=$(ECR_REGISTRY) IMAGE_TAG=$(IMAGE_TAG) docker compose pull && \
	     ECR_REGISTRY=$(ECR_REGISTRY) IMAGE_TAG=$(IMAGE_TAG) docker compose up -d --remove-orphans && \
	     docker compose exec -T server alembic upgrade head"
	@echo "Deploy complete."
