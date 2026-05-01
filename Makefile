.PHONY: help dev backend worker web migrate install lint clean db-up

PYTHON := python3
UV := uv
BACKEND_DIR := apps/backend
WEB_DIR := apps/web

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

# ── ECR / prod deploy (update when prod infra is ready) ───────────────────

ecr-login:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY)
