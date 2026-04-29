#!/bin/bash
set -euo pipefail

# k8s-deploy-ecr.sh
# Deploys K8s manifests with ECR image URLs substituted from Terraform outputs.
# Usage: ./infrastructure/scripts/k8s-deploy-ecr.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TF_DIR="$PROJECT_ROOT/infrastructure/terraform"
K8S_DIR="$PROJECT_ROOT/infrastructure/k8s"
if [ -x "$PROJECT_ROOT/bin/terraform" ]; then
    TF_BIN="$PROJECT_ROOT/bin/terraform"
else
    TF_BIN="terraform"
fi

echo "==> Reading ECR repository URLs from Terraform outputs..."

AUTH_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw auth_service_repository_url)
GATEWAY_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw auth_gateway_repository_url)
STATUS_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw task_status_service_repository_url)
FRONTEND_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw frontend_repository_url)
AGENT1_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw worker_agent1_repository_url)
ORCH_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw orchestrator_repository_url)
CHAT_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw chat_service_repository_url)
RAG_REPO=$(cd "$TF_DIR" && "$TF_BIN" output -raw rag_service_repository_url)

echo "    auth-service:         $AUTH_REPO:latest"
echo "    auth-gateway:         $GATEWAY_REPO:latest"
echo "    task-status-service:  $STATUS_REPO:latest"
echo "    frontend:             $FRONTEND_REPO:latest"
echo "    worker-agent1:        $AGENT1_REPO:latest"
echo "    orchestrator:         $ORCH_REPO:latest"
echo "    chat-service:         $CHAT_REPO:latest"
echo "    rag-service:          $RAG_REPO:latest"

# Create temp directory for rendered manifests
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo ""
echo "==> Rendering K8s manifests with ECR image URLs..."

# Substitute placeholders and write to temp files
for manifest in auth-service.yaml auth-gateway.yaml task-status-service.yaml frontend.yaml worker-agent1.yaml orchestrator.yaml chat-service.yaml rag-service.yaml; do
    if [ ! -f "$K8S_DIR/$manifest" ]; then
        echo "    Skipping missing manifest: $manifest"
        continue
    fi
    sed \
        -e "s|__ECR_AUTH_IMAGE__|${AUTH_REPO}:latest|g" \
        -e "s|__ECR_GATEWAY_IMAGE__|${GATEWAY_REPO}:latest|g" \
        -e "s|__ECR_TASK_STATUS_IMAGE__|${STATUS_REPO}:latest|g" \
        -e "s|__ECR_FRONTEND_IMAGE__|${FRONTEND_REPO}:latest|g" \
        -e "s|__ECR_AGENT1_IMAGE__|${AGENT1_REPO}:latest|g" \
        -e "s|__ECR_ORCHESTRATOR_IMAGE__|${ORCH_REPO}:latest|g" \
        -e "s|__ECR_CHAT_IMAGE__|${CHAT_REPO}:latest|g" \
        -e "s|__ECR_RAG_IMAGE__|${RAG_REPO}:latest|g" \
        "$K8S_DIR/$manifest" > "$TMPDIR/$manifest"
    echo "    Rendered: $manifest"
done

echo ""
echo "==> Creating namespace (if not exists)..."
kubectl --insecure-skip-tls-verify create namespace data --dry-run=client -o yaml | \
    kubectl --insecure-skip-tls-verify apply -f -

echo ""
echo "==> Applying infrastructure manifests..."
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/postgresql.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/rabbitmq/rabbitmq.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/pgbouncer.yaml"
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/cloudwatch-logging.yaml"

echo ""
echo "==> Applying service manifests (with ECR images)..."
# Clean legacy literal env vars that conflict with secretKeyRef-based env in manifests.
# This happens when older hotfixes used `kubectl set env ... DB_PASSWORD=...`.
for dep in auth-gateway auth-service chat-service rag-service orchestrator worker-agent1; do
    kubectl --insecure-skip-tls-verify -n data set env deployment/"$dep" DB_PASSWORD- DATABASE_URL- >/dev/null 2>&1 || true
done

for rendered in "$TMPDIR"/*.yaml; do
    kubectl --insecure-skip-tls-verify apply -f "$rendered"
done

echo ""
echo "==> Applying ingress..."
kubectl --insecure-skip-tls-verify apply -f "$K8S_DIR/ingress.yaml"

echo ""
echo "==> Waiting for rollouts to complete..."
DEPLOYMENTS=(
    "auth-service"
    "auth-gateway"
    "task-status-service"
    "frontend"
    "worker-agent1"
    "orchestrator"
    "chat-service"
    "rag-service"
    "pgbouncer"
)

FAILED=0
for dep in "${DEPLOYMENTS[@]}"; do
    echo "  Checking rollout: $dep"
    if kubectl --insecure-skip-tls-verify -n data rollout status deployment/"$dep" --timeout=120s 2>/dev/null; then
        echo "    ✅ $dep is healthy"
    else
        echo "    ⚠️  $dep not found or still rolling (may not be deployed yet)"
    fi
done

echo ""
echo "==> ECR-based deployment complete!"
echo ""
echo "==> Pod image digest summary:"
kubectl --insecure-skip-tls-verify -n data get pods -o=custom-columns='NAME:.metadata.name,IMAGE:.spec.containers[0].image,STATUS:.status.phase' 2>/dev/null || true
echo ""
echo "Verify further with:"
echo "  kubectl --insecure-skip-tls-verify -n data get pods"
echo "  kubectl --insecure-skip-tls-verify -n data describe pod <pod-name>"
