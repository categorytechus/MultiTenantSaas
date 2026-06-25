.PHONY: help dev dev-detach db-up migrate migrate-docker migrate-new install server agents frontend prod prod-detach prod-frontend clean logs-server logs-agents logs-frontend logs-prod-frontend ecr-login redeploy-ecr upload-env url tf-init tf-plan tf-apply new-client cleanup-orphans

PYTHON := python3
UV := uv
SERVER_DIR  := src/server
AGENTS_DIR  := src/agents
FRONTEND_DIR := src/frontend

# ── Client selection ──────────────────────────────────────────────────────────
# Each client has a directory under clients/ with config.env, backend.hcl,
# terraform.tfvars, prod.env, and an SSH key.
#
# Usage:  make <target> CLIENT=823954030825
#         make <target> CLIENT=acme-corp
#
# Defaults to the first directory found under clients/.
CLIENT     ?= $(firstword $(shell ls clients/ 2>/dev/null | grep -v '^\.' | grep -v '^_'))
CLIENT_DIR  = clients/$(CLIENT)

# Load region / account from client config (KEY=value lines, no spaces around =)
-include $(CLIENT_DIR)/config.env

AWS_REGION   ?= us-east-1
AWS_ACCOUNT  ?= $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
KEY_NAME     ?= multi-tenant-saas-key
ECR_REGISTRY ?= $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
IMAGE_TAG    ?= $(shell git rev-parse --short HEAD)
DOCKER_PLATFORM ?= linux/amd64

# Paths that differ per client — must be absolute so terraform -chdir=infra can resolve them
# SSH_KEY can be overridden: make redeploy-ecr CLIENT=x SSH_KEY=/path/to/other.pem
TF_BACKEND  ?= $(abspath $(CLIENT_DIR)/backend.hcl)
TF_VARS     ?= $(abspath $(CLIENT_DIR)/terraform.tfvars)
PROD_ENV    ?= $(abspath $(CLIENT_DIR)/prod.env)
SSH_KEY     ?= $(abspath $(CLIENT_DIR)/$(KEY_NAME).pem)

help:
	@echo "Multi-Tenant AI SaaS — available targets:"
	@echo ""
	@echo "Client management:"
	@echo "  make new-client CLIENT=<id> REGION=<aws-region>"
	@echo "                       Scaffold a new client under clients/<id>/"
	@echo "  make cleanup-orphans CLIENT=<id>"
	@echo "                       Remove cross-VPC orphaned AWS resources for a client"
	@echo ""
	@echo "Terraform (per-client):"
	@echo "  make tf-init   CLIENT=<id>   terraform init with client backend"
	@echo "  make tf-plan   CLIENT=<id>   terraform plan with client vars"
	@echo "  make tf-apply  CLIENT=<id>   terraform apply with client vars"
	@echo ""
	@echo "Docker Compose (local dev):"
	@echo "  make dev             Start all 4 services (server, agents, frontend, db)"
	@echo "  make dev-detach      Same, detached"
	@echo "  make db-up           Start only Postgres + Redis"
	@echo "  make clean           Remove containers and volumes"
	@echo ""
	@echo "Local dev (requires Postgres + Redis via make db-up):"
	@echo "  make install         Install all dependencies (uv sync + npm install)"
	@echo "  make server          FastAPI server on :8000"
	@echo "  make agents          Arq worker"
	@echo "  make frontend        Next.js dev server on :3000"
	@echo ""
	@echo "Database:"
	@echo "  make migrate              alembic upgrade head"
	@echo "  make migrate-docker       same, inside Docker"
	@echo "  make migrate-new msg='...'  autogenerate migration"
	@echo ""
	@echo "Logs (Docker):"
	@echo "  make logs-server / logs-agents / logs-frontend"
	@echo ""
	@echo "Deploy:"
	@echo "  make redeploy-ecr CLIENT=<id>   Build + push ECR images, SSH deploy to EC2"
	@echo "  make upload-env   CLIENT=<id>   Push clients/<id>/prod.env to EC2"
	@echo "  make url          CLIENT=<id>   Show EC2 URLs for a client"
	@echo ""

# ── Full stack via Docker Compose ──────────────────────────────────────────

dev:
	@printf "Clean entire database? [y/N] "; \
	read answer; \
	case "$$answer" in \
		[Yy]*) echo "Wiping database, uploads, and Redis volumes..."; docker compose down -v --remove-orphans ;; \
	esac; \
	docker compose up --build

dev-detach:
	docker compose up --build -d

db-up:
	docker compose up postgres redis -d

migrate-docker:
	docker compose up postgres -d
	docker compose run --rm db-migrate

# ── Local (no Docker for app) ──────────────────────────────────────────────

install:
	cd $(SERVER_DIR) && $(UV) sync --python 3.12
	cd $(AGENTS_DIR) && $(UV) sync --python 3.12
	cd $(FRONTEND_DIR) && npm install --legacy-peer-deps

server:
	cd $(SERVER_DIR) && $(UV) run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

agents:
	cd $(AGENTS_DIR) && $(UV) run arq app.jobs.WorkerSettings

frontend:
ifeq ($(OS),Windows_NT)
	cd $(FRONTEND_DIR) && set "AUTH_GATEWAY_PROXY_ORIGIN=http://localhost:8000" && npm run dev
else
	cd $(FRONTEND_DIR) && AUTH_GATEWAY_PROXY_ORIGIN=http://localhost:8000 npm run dev
endif

prod-frontend:
	@echo "Building production frontend image..."
	docker build -t mtsaas-frontend $(FRONTEND_DIR)
	@docker rm -f mtsaas-frontend-prod 2>/dev/null || true
	docker run -d --restart unless-stopped --name mtsaas-frontend-prod \
		-p 3000:3000 \
		--add-host=host.docker.internal:host-gateway \
		-e API_BACKEND_ORIGIN=http://host.docker.internal:8000 \
		mtsaas-frontend
	@echo "Production frontend running at http://localhost:3000"

prod:
	@printf "Clean entire database? [y/N] "; \
	read answer; \
	case "$$answer" in \
		[Yy]*) echo "Wiping database, uploads, and Redis volumes..."; docker compose -f docker-compose.local-prod.yml down -v --remove-orphans ;; \
	esac; \
	docker compose -f docker-compose.local-prod.yml up --build

prod-detach:
	docker compose -f docker-compose.local-prod.yml up --build -d

migrate:
	@if ! nc -z 127.0.0.1 5432 2>/dev/null; then \
		echo ""; \
		echo "  Nothing is listening on 127.0.0.1:5432 (Postgres)."; \
		echo "  From the repo root, start Postgres (and Redis) with:"; \
		echo "    make db-up"; \
		echo "  If Docker is running but host port 5432 still fails (common with some setups), run:"; \
		echo "    make migrate-docker"; \
		echo "  (Do not use sudo for make migrate on macOS unless you know you need it.)"; \
		echo ""; \
		exit 1; \
	fi
	@ready=0; \
	for i in $$(seq 1 45); do \
		if cd $(SERVER_DIR) && $(UV) run python -c "import psycopg; conn=psycopg.connect('postgresql://postgres:postgres@localhost:5432/multitenant'); conn.close()"; then \
			echo "Database is ready."; \
			ready=1; \
			break; \
		fi; \
		sleep 1; \
	done; \
	if [ $$ready -ne 1 ]; then \
		echo "Database not ready after 45 seconds."; \
		exit 1; \
	fi
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

logs-frontend:
	docker compose logs -f frontend

logs-prod-frontend:
	docker logs -f mtsaas-frontend-prod

# ── Terraform (per-client) ────────────────────────────────────────────────────

tf-init:
	terraform -chdir=infra init -reconfigure -backend-config=$(TF_BACKEND)

tf-plan:
	terraform -chdir=infra plan -var-file=$(TF_VARS) \
	  -var="ssh_public_key_path=$(abspath $(CLIENT_DIR)/$(KEY_NAME).pub)"

tf-apply:
	terraform -chdir=infra apply -var-file=$(TF_VARS) \
	  -var="ssh_public_key_path=$(abspath $(CLIENT_DIR)/$(KEY_NAME).pub)"

# ── Client management ─────────────────────────────────────────────────────────

new-client:
	@test -n "$(CLIENT)" || (echo "Usage: make new-client CLIENT=<id> [AWS_REGION=<region>]" && exit 1)
	bash scripts/new-client.sh $(CLIENT) $(AWS_REGION)

cleanup-orphans:
	bash scripts/cleanup-orphans.sh $(CLIENT_DIR)

# ── ECR / prod deploy ─────────────────────────────────────────────────────────

EC2_USER := ec2-user
EC2_IP   ?= $(shell aws ec2 describe-instances \
               --region $(AWS_REGION) \
               --filters "Name=tag:Project,Values=$(shell grep project_name $(TF_VARS) 2>/dev/null | awk -F'"' '{print $$2}')" \
                         "Name=instance-state-name,Values=running" \
               --query "Reservations[0].Instances[0].PublicIpAddress" --output text 2>/dev/null)

url:
	@IP=$(EC2_IP); \
	if [ -z "$$IP" ] || [ "$$IP" = "None" ]; then \
	  echo "No running EC2 instance found for CLIENT=$(CLIENT). Has terraform apply been run?"; exit 1; \
	fi; \
	echo ""; \
	echo "  Frontend : http://$$IP:3000"; \
	echo "  API      : http://$$IP:8000"; \
	echo "  SSH      : ssh -i $(SSH_KEY) $(EC2_USER)@$$IP"; \
	echo ""

ecr-login:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY)

upload-env:
	@test -f $(PROD_ENV) || (echo "ERROR: $(PROD_ENV) not found. Copy infra/prod.env.example and fill in the values." && exit 1)
	@echo "Uploading $(PROD_ENV) to EC2 ($(EC2_IP))..."
	scp -i $(SSH_KEY) -o StrictHostKeyChecking=no $(PROD_ENV) \
	    $(EC2_USER)@$(EC2_IP):/opt/app/.env
	@echo "Done. .env updated on server."

redeploy-ecr: ecr-login upload-env
	@echo "Building and pushing images (tag: $(IMAGE_TAG))..."
	docker build --platform $(DOCKER_PLATFORM) -t $(ECR_REGISTRY)/multitenant-saas-backend:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-backend:latest \
	             src/server
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-backend:latest
	docker build --platform $(DOCKER_PLATFORM) -t $(ECR_REGISTRY)/multitenant-saas-agents:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-agents:latest \
	             src/agents
	docker push $(ECR_REGISTRY)/multitenant-saas-agents:$(IMAGE_TAG)
	docker push $(ECR_REGISTRY)/multitenant-saas-agents:latest
	docker build --platform $(DOCKER_PLATFORM) -t $(ECR_REGISTRY)/multitenant-saas-web:$(IMAGE_TAG) \
	             -t $(ECR_REGISTRY)/multitenant-saas-web:latest \
	             src/frontend
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
