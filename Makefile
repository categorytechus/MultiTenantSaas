ifneq (,$(wildcard ./.env))
    include .env
    export
endif

.PHONY: deploy-infra deploy-ecr terraform-apply k8s-deploy k8s-deploy-ecr sync-secrets bootstrap-secrets docker-build docker-load ecr-push ecr-login update-kubeconfig help

# Get current EC2 IP from Terraform
TERRAFORM_BIN := $(abspath bin/terraform)
EC2_IP := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip)
REGION := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw aws_region)
REGISTRY := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ecr_registry_url)
AUTH_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw auth_service_repository_url)
GATEWAY_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw auth_gateway_repository_url)
FRONTEND_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw frontend_repository_url)
AGENT1_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw worker_agent1_repository_url)
AGENT2_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw worker_agent2_repository_url)
AGENT3_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw worker_agent3_repository_url)
ORCHESTRATOR_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw orchestrator_repository_url)
STATUS_REPO := $(shell cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw task_status_service_repository_url)
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
	@echo "  make deploy-ecr        - End-to-end: terraform + build + push + deploy + migrate"

deploy-infra: terraform-apply docker-build docker-load k8s-deploy

deploy-ecr: terraform-apply ecr-push k8s-deploy-ecr db-migrate

terraform-init:
	cd infrastructure/terraform && $(TERRAFORM_BIN) init

terraform-apply:
	cd infrastructure/terraform && $(TERRAFORM_BIN) init && $(TERRAFORM_BIN) apply -auto-approve

docker-build:
	docker build -t auth-service:latest ./auth
	docker build -t auth-gateway:latest ./auth-gateway
	docker build -t worker-agent1:latest -f ./agents/worker_agent1/Dockerfile ./agents
	docker build -t worker-agent2:latest -f ./agents/worker_agent2/Dockerfile ./agents
	docker build -t worker-agent3:latest -f ./agents/worker_agent3/Dockerfile ./agents
	docker build -t orchestrator:latest -f ./agents/orchestrator/Dockerfile ./agents
	docker build -t frontend:latest ./frontend

ecr-login:
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(REGISTRY)

ecr-push: ecr-login
	docker build -t $(AUTH_REPO):latest ./auth
	docker build -t $(GATEWAY_REPO):latest ./auth-gateway
	docker build -t $(FRONTEND_REPO):latest ./frontend
	docker build -t $(STATUS_REPO):latest ./task-status
	docker build -t $(AGENT1_REPO):latest -f ./agents/worker_agent1/Dockerfile ./agents
	docker build -t $(AGENT2_REPO):latest -f ./agents/worker_agent2/Dockerfile ./agents
	docker build -t $(AGENT3_REPO):latest -f ./agents/worker_agent3/Dockerfile ./agents
	docker build -t $(ORCHESTRATOR_REPO):latest -f ./agents/orchestrator/Dockerfile ./agents
	docker push $(AUTH_REPO):latest
	docker push $(GATEWAY_REPO):latest
	docker push $(FRONTEND_REPO):latest
	docker push $(STATUS_REPO):latest
	docker push $(AGENT1_REPO):latest
	docker push $(AGENT2_REPO):latest
	docker push $(AGENT3_REPO):latest
	docker push $(ORCHESTRATOR_REPO):latest


docker-load:
	docker save auth-service:latest -o /tmp/auth-service.tar
	docker save auth-gateway:latest -o /tmp/auth-gateway.tar
	docker save task-status-service:latest -o /tmp/task-status-service.tar
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/auth-service.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/auth-gateway.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/task-status-service.tar ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip):/tmp/
	ssh -i infrastructure/multi-tenant-saas-key.pem ubuntu@$$(cd infrastructure/terraform && $(TERRAFORM_BIN) output -raw ec2_public_ip) "sudo k3s ctr images import /tmp/auth-service.tar && sudo k3s ctr images import /tmp/auth-gateway.tar && sudo k3s ctr images import /tmp/task-status-service.tar"

update-kubeconfig:
	@echo "Fetching kubeconfig from $(EC2_IP)..."
	@mkdir -p $(dir $(KUBECONFIG_FILE))
	ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no ubuntu@$(EC2_IP) \
		"sudo k3s kubectl config view --raw" \
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
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/worker-agent2.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/worker-agent3.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/ingress.yaml

k8s-deploy-ecr: update-kubeconfig
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
		KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify exec -i pod/postgres-0 -n data -- psql -U saas_admin -d saas_db < $$file; \
	done
	@echo "Migrations complete."

db-seed: update-kubeconfig
	@echo "Seeding database..."
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify exec -i pod/postgres-0 -n data -- psql -U saas_admin -d saas_db < infrastructure/database/seeds/001_sample_data.sql
	@echo "Seeding complete."
