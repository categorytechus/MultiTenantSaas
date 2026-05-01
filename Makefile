.PHONY: help dev backend worker web migrate install lint clean db-up ecr-login redeploy-ecr

PYTHON := python3
UV := uv
BACKEND_DIR := apps/backend
WEB_DIR := apps/web

AWS_REGION   ?= us-east-1
AWS_ACCOUNT  ?= $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REGISTRY ?= $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
IMAGE_TAG    ?= $(shell git rev-parse --short HEAD)

help:
	@echo "Multi-Tenant AI SaaS — available targets:"
	@echo ""
	@echo "  make install    Install all dependencies (uv sync + npm install)"
	@echo "  make dev        Start all services via Docker Compose"
	@echo "  make backend    Run FastAPI backend locally (requires Postgres + Redis)"
	@echo "  make worker     Run Arq worker locally (requires Postgres + Redis)"
	@echo "  make web        Run Vite dev server locally"
	@echo "  make migrate    Run Alembic migrations"
	@echo "  make db-up      Start only Postgres + Redis via Docker"
	@echo "  make clean      Remove Docker containers and volumes"
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
	cd $(BACKEND_DIR) && $(UV) sync
	cd $(WEB_DIR) && npm install

backend:
	cd $(BACKEND_DIR) && $(UV) run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker:
	cd $(BACKEND_DIR) && $(UV) run arq app.jobs.WorkerSettings

web:
	cd $(WEB_DIR) && npm run dev

migrate:
	cd $(BACKEND_DIR) && $(UV) run alembic upgrade head

migrate-new:
	@test -n "$(msg)" || (echo "Usage: make migrate-new msg='description'" && exit 1)
	cd $(BACKEND_DIR) && $(UV) run alembic revision --autogenerate -m "$(msg)"

# ── Docker helpers ─────────────────────────────────────────────────────────

clean:
	docker compose down -v --remove-orphans

logs-backend:
	docker compose logs -f backend

logs-worker:
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
	             apps/backend
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:latest
	docker build -t $(ECR_REGISTRY)/multitenant-saas-web:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-web:latest \
	             apps/web
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
	     docker compose exec -T backend alembic upgrade head"
	@echo "Deploy complete."
