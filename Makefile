SHELL := bash
.SHELLFLAGS := -c

ifneq (,$(wildcard ./.env))
    include .env
    export
endif

.PHONY: deploy-infra deploy-ecr redeploy-ecr terraform-apply k8s-deploy k8s-deploy-ecr sync-secrets bootstrap-secrets docker-build docker-load ecr-push ecr-login update-kubeconfig help test test-local test-remote

# Get ECR config from Terraform state, EC2 IP from AWS CLI (survives instance stop/start)
TERRAFORM_BIN := $(shell [ -f bin/terraform ] && echo "$$(pwd)/bin/terraform" || echo "terraform")
REGION := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw aws_region 2>/dev/null || echo "us-east-1")
EC2_IP := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip 2>/dev/null || aws ec2 describe-instances --region $(REGION) --filters "Name=tag:Name,Values=multi-tenant-saas-k3s-server" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].PublicIpAddress" --output text 2>/dev/null)
REGISTRY := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ecr_registry_url)
AUTH_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw auth_service_repository_url)
GATEWAY_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw auth_gateway_repository_url)
FRONTEND_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw frontend_repository_url)
AGENT1_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw worker_agent1_repository_url)
ORCHESTRATOR_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw orchestrator_repository_url)
STATUS_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw task_status_service_repository_url)
CHAT_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw chat_service_repository_url)
RAG_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw rag_service_repository_url)
KUBECONFIG_FILE := $(subst \,/,$(HOME))/.kube/config-multi-tenant-saas
SSH_KEY := infrastructure/multi-tenant-saas-key.pem

help:
	@echo "Usage:"
	@echo "  make deploy-infra      - Run end-to-end infra deployment"
	@echo "  make terraform-apply   - Run terraform apply"
	@echo "  make docker-build      - Build auth, auth-gateway, and task-status Docker images"
	@echo "  make docker-load       - Export images and import into K3s"
	@echo "  make k8s-deploy        - Apply all k8s manifests"
	@echo "  make sync-secrets      - Sync AWS secrets to K8s"
	@echo "  make bootstrap-secrets - Initialize AWS secrets from ENV vars"
	@echo "  make ecr-login         - Authenticate Docker to ECR"
	@echo "  make ecr-push          - Build and push all images to ECR"
	@echo "  make k8s-deploy-ecr    - Deploy k8s manifests using ECR images"
	@echo "  make update-kubeconfig - Fetch and update local kubeconfig with EC2 IP"
	@echo "  make db-migrate        - Run database migrations"
	@echo "  make db-seed           - Seed database with sample data"
	@echo "  make deploy-ecr        - End-to-end: terraform + build + push + deploy + migrate + seed"
	@echo "  make redeploy-ecr      - Build + push + deploy + migrate + seed (skip terraform)"

deploy-infra: terraform-apply docker-build docker-load k8s-deploy

deploy-ecr: terraform-apply ecr-push k8s-deploy-ecr db-migrate db-seed

# Same as deploy-ecr but skips terraform (use when infra is already provisioned)
redeploy-ecr: ecr-push k8s-deploy-ecr db-migrate db-seed

terraform-init:
	cd infrastructure/terraform && $(TERRAFORM_BIN) init

terraform-apply:
	cd infrastructure/terraform && $(TERRAFORM_BIN) init && $(TERRAFORM_BIN) apply -auto-approve

docker-build:
	docker build -t auth-service:latest ./auth
	docker build -t auth-gateway:latest ./auth-gateway
	docker build -t worker-agent1:latest -f ./agents/worker_agent1/Dockerfile .
	docker build -t orchestrator:latest -f ./agents/orchestrator/Dockerfile .
	docker build -t frontend:latest ./frontend
	docker build -t chat-service:latest -f ./chat-service/Dockerfile .
	docker build -t rag-service:latest -f ./rag/Dockerfile .

ecr-login:
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(REGISTRY)

ecr-push: ecr-login
	docker build -t $(AUTH_REPO):latest ./auth
	docker build -t $(GATEWAY_REPO):latest ./auth-gateway
	docker build -t $(FRONTEND_REPO):latest ./frontend
	docker build -t $(STATUS_REPO):latest ./task-status
	docker build -t $(AGENT1_REPO):latest -f ./agents/worker_agent1/Dockerfile .
	docker build -t $(ORCHESTRATOR_REPO):latest -f ./agents/orchestrator/Dockerfile .
	docker build -t $(CHAT_REPO):latest -f ./chat-service/Dockerfile .
	docker build -t $(RAG_REPO):latest -f ./rag/Dockerfile .
	docker push $(AUTH_REPO):latest
	docker push $(GATEWAY_REPO):latest
	docker push $(FRONTEND_REPO):latest
	docker push $(STATUS_REPO):latest
	docker push $(AGENT1_REPO):latest
	docker push $(ORCHESTRATOR_REPO):latest
	docker push $(CHAT_REPO):latest
	docker push $(RAG_REPO):latest

docker-load:
	docker save auth-service:latest -o /tmp/auth-service.tar
	docker save auth-gateway:latest -o /tmp/auth-gateway.tar
	docker save task-status-service:latest -o /tmp/task-status-service.tar
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/auth-service.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/auth-gateway.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/task-status-service.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	ssh -i infrastructure/multi-tenant-saas-key.pem ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip) "sudo k3s ctr images import /tmp/auth-service.tar && sudo k3s ctr images import /tmp/auth-gateway.tar && sudo k3s ctr images import /tmp/task-status-service.tar"

update-kubeconfig:
	@if [ -z "$(EC2_IP)" ]; then echo "ERROR: EC2_IP is empty. Is the instance running?"; exit 1; fi
	@echo "Fetching kubeconfig from $(EC2_IP)..."
	@mkdir -p $(dir $(KUBECONFIG_FILE))
	@echo "Remote kube preflight on $(EC2_IP)..."
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no ubuntu@$(EC2_IP) \
		"set -eu; echo hostname: \$$(hostname); echo user: \$$(whoami); \
		echo k3s_path: \$$(command -v k3s || echo '<none>'); \
		echo kubectl_path: \$$(command -v kubectl || echo '<none>'); \
		echo k3s_yaml: \$$(if sudo test -f /etc/rancher/k3s/k3s.yaml; then echo present; else echo missing; fi); \
		echo admin_conf: \$$(if sudo test -f /etc/kubernetes/admin.conf; then echo present; else echo missing; fi); \
		echo home_kubeconfig: \$$(if test -f ~/.kube/config; then echo present; else echo missing; fi)" || true
	@echo "Ensuring Kubernetes control-plane is installed on remote host..."
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no ubuntu@$(EC2_IP) \
		"set -euo pipefail; \
		if command -v k3s >/dev/null 2>&1 || sudo test -f /etc/rancher/k3s/k3s.yaml; then \
			echo 'k3s already present'; \
		else \
			echo 'k3s missing, installing...'; \
			curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.34.4+k3s1' sh -; \
			sudo chmod 644 /etc/rancher/k3s/k3s.yaml; \
			sudo systemctl enable --now k3s; \
		fi; \
		sudo systemctl is-active k3s >/dev/null 2>&1 || (echo 'ERROR: k3s service is not active after install' >&2; sudo systemctl status k3s --no-pager || true; exit 1)"
	@set -euo pipefail; \
	ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no ubuntu@$(EC2_IP) \
		"if command -v k3s >/dev/null 2>&1; then sudo k3s kubectl config view --raw; \
		elif sudo test -x /usr/local/bin/k3s; then sudo /usr/local/bin/k3s kubectl config view --raw; \
		elif sudo test -f /etc/rancher/k3s/k3s.yaml; then sudo cat /etc/rancher/k3s/k3s.yaml; \
		elif sudo test -f /etc/kubernetes/admin.conf; then sudo cat /etc/kubernetes/admin.conf; \
		elif command -v kubectl >/dev/null 2>&1; then kubectl config view --raw; \
		elif sudo command -v kubectl >/dev/null 2>&1; then sudo kubectl config view --raw; \
		elif test -f ~/.kube/config; then cat ~/.kube/config; \
		else echo 'ERROR: no kubeconfig source found (checked k3s, /etc/rancher/k3s/k3s.yaml, /etc/kubernetes/admin.conf, kubectl, ~/.kube/config)' >&2; \
		echo 'Hint: verify EC2_IP points to the cluster node and k3s install completed.' >&2; exit 1; fi" \
		| sed 's/127.0.0.1/$(EC2_IP)/g' \
		| sed 's/default/multi-tenant-saas/g' \
		> $(KUBECONFIG_FILE)
	@echo "Kubeconfig updated at $(KUBECONFIG_FILE)"

k8s-deploy: update-kubeconfig
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify create namespace data --dry-run=client -o yaml | KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f -
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/jwt-secret.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/postgresql.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/rabbitmq/rabbitmq.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/pgbouncer.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/cloudwatch-logging.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/auth-service.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/auth-gateway.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/task-status-service.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/orchestrator.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/worker-agent1.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/ingress.yaml

k8s-deploy-ecr: update-kubeconfig
	@echo "Syncing secrets from AWS (db-credentials, database-url, jwt-secret, llm-keys)..."
	KUBECONFIG=$(KUBECONFIG_FILE) ./infrastructure/scripts/sync-secrets.sh
	KUBECONFIG=$(KUBECONFIG_FILE) ./infrastructure/scripts/k8s-deploy-ecr.sh

sync-secrets: update-kubeconfig
	KUBECONFIG=$(KUBECONFIG_FILE) ./infrastructure/scripts/sync-secrets.sh

bootstrap-secrets:
	./infrastructure/scripts/bootstrap-aws-secrets.sh

db-migrate: update-kubeconfig
	@echo "Waiting for postgres to be ready..."
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify wait --for=condition=ready pod/postgres-0 -n data --timeout=120s
	@echo "Running database migrations..."
	@for file in infrastructure/database/migrations/*.sql; do \
		echo "Applying $$file..."; \
		KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify exec -i pod/postgres-0 -n data -- psql -U postgres -d multitenant_saas < $$file; \
	done
	@echo "Migrations complete."

db-seed: update-kubeconfig
	@echo "Seeding database..."
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify exec -i pod/postgres-0 -n data -- psql -U postgres -d multitenant_saas < infrastructure/database/seeds/001_sample_data.sql
	@echo "Seeding complete."

# ============================================================================
# Testing (Node.js)
# ============================================================================
test-install:
	cd tests && npm install

test-local: test-install
	@echo "Running tests against local services..."
	cd tests && AUTH_GATEWAY_URL=http://localhost:3001 WS_URL=ws://localhost:3002/ws/task-status npm test

test-remote: test-install
	@echo "Running tests against remote cluster ($(EC2_IP))..."
	cd tests && AUTH_GATEWAY_URL=http://$(EC2_IP) WS_URL=ws://$(EC2_IP)/ws/task-status npm test

test: test-local

# ============================================================================
# Testing (Python)
# ============================================================================
test-py-install:
	pip install -r tests/requirements.txt

test-py-local: test-py-install
	@echo "Running Python tests against local services..."
	AUTH_GATEWAY_URL=http://localhost:3001 WS_URL=ws://localhost:3002/ws/task-status python tests/test_agent_api.py

test-py-remote: test-py-install
	@echo "Running Python tests against remote cluster ($(EC2_IP))..."
	AUTH_GATEWAY_URL=http://$(EC2_IP) WS_URL=ws://$(EC2_IP)/ws/task-status python tests/test_agent_api.py

test-py: test-py-remote

test-pytest:
	@echo "Running tests with pytest..."
	AUTH_GATEWAY_URL=http://localhost:3001 WS_URL=ws://localhost:3002/ws/task-status pytest tests/test_agent_api.py -v
