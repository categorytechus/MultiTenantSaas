.PHONY: deploy-infra deploy-ecr terraform-apply k8s-deploy k8s-deploy-ecr sync-secrets bootstrap-secrets docker-build docker-load ecr-push ecr-login update-kubeconfig help

# Get current EC2 IP from Terraform
EC2_IP := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip)
KUBECONFIG_FILE := $(HOME)/.kube/config-multi-tenant-saas
SSH_KEY := infrastructure/multi-tenant-saas-key.pem

help:
	@echo "Usage:"
	@echo "  make deploy-infra      - Run end-to-end infra deployment"
	@echo "  make terraform-apply   - Run terraform apply"
	@echo "  make docker-build      - Build auth, orchestrator, and task-status Docker images"
	@echo "  make docker-load       - Export images and import into K3s"
	@echo "  make k8s-deploy        - Apply all k8s manifests"
	@echo "  make sync-secrets      - Sync AWS secrets to K8s"
	@echo "  make bootstrap-secrets - Initialize AWS secrets from ENV vars"
	@echo "  make ecr-login         - Authenticate Docker to ECR"
	@echo "  make ecr-push          - Build and push all images to ECR"
	@echo "  make k8s-deploy-ecr    - Deploy k8s manifests using ECR images"
	@echo "  make update-kubeconfig - Fetch and update local kubeconfig with EC2 IP"
	@echo "  make deploy-ecr        - End-to-end: terraform + build + push + deploy from ECR"

deploy-infra: terraform-apply docker-build docker-load k8s-deploy

deploy-ecr: terraform-apply ecr-push k8s-deploy-ecr

terraform-apply:
	cd infrastructure/terraform && ../../bin/terraform init && ../../bin/terraform apply -auto-approve

docker-build:
	docker build -t auth-service:latest ./auth
	docker build -t orchestrator-service:latest ./orchestrator
	docker build -t task-status-service:latest ./task-status

ecr-login:
	@$(eval REGION := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw aws_region))
	@$(eval REGISTRY := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw ecr_registry_url))
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(REGISTRY)

ecr-push: ecr-login
	@$(eval AUTH_REPO := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw auth_service_repository_url))
	@$(eval ORCH_REPO := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw orchestrator_service_repository_url))
	@$(eval TASK_REPO := $(shell cd infrastructure/terraform && ../../bin/terraform output -raw task_status_service_repository_url))
	docker build -t $(AUTH_REPO):latest ./auth
	docker build -t $(ORCH_REPO):latest ./orchestrator
	docker build -t $(TASK_REPO):latest ./task-status
	docker push $(AUTH_REPO):latest
	docker push $(ORCH_REPO):latest
	docker push $(TASK_REPO):latest


docker-load:
	docker save auth-service:latest -o /tmp/auth-service.tar
	docker save orchestrator-service:latest -o /tmp/orchestrator-service.tar
	docker save task-status-service:latest -o /tmp/task-status-service.tar
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/auth-service.tar ubuntu@$$(cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/orchestrator-service.tar ubuntu@$$(cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip):/tmp/
	scp -i infrastructure/multi-tenant-saas-key.pem /tmp/task-status-service.tar ubuntu@$$(cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip):/tmp/
	ssh -i infrastructure/multi-tenant-saas-key.pem ubuntu@$$(cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip) "sudo k3s ctr images import /tmp/auth-service.tar && sudo k3s ctr images import /tmp/orchestrator-service.tar && sudo k3s ctr images import /tmp/task-status-service.tar"

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
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/orchestrator-service.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/task-status-service.yaml
	KUBECONFIG=$(KUBECONFIG_FILE) kubectl --insecure-skip-tls-verify apply -f infrastructure/k8s/ingress.yaml

k8s-deploy-ecr: update-kubeconfig
	KUBECONFIG=$(KUBECONFIG_FILE) ./infrastructure/scripts/k8s-deploy-ecr.sh

sync-secrets:
	./infrastructure/scripts/sync-secrets.sh

bootstrap-secrets:
	./infrastructure/scripts/bootstrap-aws-secrets.sh
