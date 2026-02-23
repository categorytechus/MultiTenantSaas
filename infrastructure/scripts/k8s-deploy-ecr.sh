#!/bin/bash
set -euo pipefail

# k8s-deploy-ecr.sh
# Deploys K8s manifests with ECR image URLs substituted from Terraform outputs.
# Usage: ./infrastructure/scripts/k8s-deploy-ecr.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TF_DIR="$PROJECT_ROOT/infrastructure/terraform"
K8S_DIR="$PROJECT_ROOT/infrastructure/k8s"
TF_BIN="$PROJECT_ROOT/bin/terraform"

echo "==> Reading ECR repository URLs from Terraform outputs..."

AUTH_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw auth_service_repository_url)
ORCH_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw orchestrator_service_repository_url)
TASK_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw task_status_service_repository_url)

echo "    auth-service:         $AUTH_REPO:latest"
echo "    orchestrator-service: $ORCH_REPO:latest"
echo "    task-status-service:  $TASK_REPO:latest"

# Create temp directory for rendered manifests
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo ""
echo "==> Rendering K8s manifests with ECR image URLs..."

# Substitute placeholders and write to temp files
for manifest in auth-service.yaml orchestrator-service.yaml task-status-service.yaml; do
    sed \
        -e "s|__ECR_AUTH_IMAGE__|${AUTH_REPO}:latest|g" \
        -e "s|__ECR_ORCHESTRATOR_IMAGE__|${ORCH_REPO}:latest|g" \
        -e "s|__ECR_TASK_STATUS_IMAGE__|${TASK_REPO}:latest|g" \
        "$K8S_DIR/$manifest" > "$TMPDIR/$manifest"
    echo "    Rendered: $manifest"
done

echo ""
echo "==> Creating namespace (if not exists)..."
kubectl --insecure-skip-tls-verify create namespace data --dry-run=client -o yaml | \
    kubectl --insecure-skip-tls-verify apply -f -

echo ""
echo "==> Applying infrastructure manifests..."
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/jwt-secret.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/postgresql.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/rabbitmq/rabbitmq.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/pgbouncer.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/cloudwatch-logging.yaml"

echo ""
echo "==> Applying service manifests (with ECR images)..."
kubectl --insecure-skip-tls-verify apply -f "$TMPDIR/auth-service.yaml"
kubectl --insecure-skip-tls-verify apply -f "$TMPDIR/orchestrator-service.yaml"
kubectl --insecure-skip-tls-verify apply -f "$TMPDIR/task-status-service.yaml"

echo ""
echo "==> Applying ingress..."
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/ingress.yaml"

echo ""
echo "==> ECR-based deployment complete!"
echo ""
echo "Verify with:"
echo "  kubectl --insecure-skip-tls-verify -n data get pods"
echo "  kubectl --insecure-skip-tls-verify -n data describe pod <pod-name>"
