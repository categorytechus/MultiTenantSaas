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
	cd terraform && ../bin/terraform init && ../bin/terraform apply -auto-approve

k8s-deploy:
	kubectl --insecure-skip-tls-verify create namespace data --dry-run=client -o yaml | kubectl --insecure-skip-tls-verify apply -f -
	kubectl --insecure-skip-tls-verify apply -f backend/k8s/postgresql.yaml
	kubectl --insecure-skip-tls-verify apply -f backend/k8s/rabbitmq/rabbitmq.yaml
	kubectl --insecure-skip-tls-verify apply -f backend/k8s/pgbouncer.yaml
	kubectl --insecure-skip-tls-verify apply -f backend/k8s/cloudwatch-logging.yaml

sync-secrets:
	./backend/scripts/sync-secrets.sh

bootstrap-secrets:
	./backend/scripts/bootstrap-aws-secrets.sh
