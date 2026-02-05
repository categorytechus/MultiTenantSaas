.PHONY: deploy-infra terraform-apply k8s-deploy sync-secrets bootstrap-secrets help

help:
	@echo "Usage:"
	@echo "  make deploy-infra      - Run end-to-end infra deployment"
	@echo "  make terraform-apply   - Run terraform apply"
	@echo "  make k8s-deploy        - Apply all k8s manifests"
	@echo "  make sync-secrets      - Sync AWS secrets to K8s"
	@echo "  make bootstrap-secrets - Initialize AWS secrets from ENV vars"

deploy-infra: terraform-apply k8s-deploy

terraform-apply:
	cd terraform && terraform init && terraform apply -auto-approve

k8s-deploy:
	kubectl create namespace data --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f backend/k8s/postgresql.yaml
	kubectl apply -f backend/k8s/rabbitmq/rabbitmq.yaml
	kubectl apply -f backend/k8s/pgbouncer-config.yaml
	kubectl apply -f backend/k8s/pgbouncer.yaml
	kubectl apply -f backend/k8s/cloudwatch-logging.yaml

sync-secrets:
	./scripts/sync-secrets.sh

bootstrap-secrets:
	./scripts/bootstrap-aws-secrets.sh
