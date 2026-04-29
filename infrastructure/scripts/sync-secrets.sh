#!/bin/bash

# Sync AWS Secrets Manager secrets to Kubernetes Secrets
# Requirements: aws-cli, kubectl

PROJECT_NAME="multi-tenant-saas"
NAMESPACE="data"

KUBECTL="kubectl --insecure-skip-tls-verify"

# Detect Python 3 command (python3 on Linux/macOS, python on Windows/Git Bash)
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "Error: Python 3 is required but neither 'python3' nor 'python' was found in PATH."
    exit 1
fi

function sync_secret() {
    local secret_name=$1
    local k8s_secret_name=$2
    local key_name=${3:-value}
    
    echo "Syncing $secret_name to Kubernetes $k8s_secret_name (key: $key_name)..."
    
    VALUE=$(aws secretsmanager get-secret-value --secret-id "$secret_name" --query SecretString --output text)
    
    if [ $? -ne 0 ]; then
        echo "Error: Could not retrieve secret $secret_name from AWS"
        return 1
    fi
    
    # Check if value is JSON
    if echo "$VALUE" | jq -e . >/dev/null 2>&1; then
        # It's a JSON secret (multiple keys)
        $KUBECTL create secret generic "$k8s_secret_name" \
            --namespace "$NAMESPACE" \
            --from-literal=config="$VALUE" \
            --dry-run=client -o yaml | $KUBECTL apply -f -
    else
        # It's a plain string
        $KUBECTL create secret generic "$k8s_secret_name" \
            --namespace "$NAMESPACE" \
            --from-literal="$key_name"="$VALUE" \
            --dry-run=client -o yaml | $KUBECTL apply -f -
    fi
}

# Ensure namespace exists
$KUBECTL create namespace "$NAMESPACE" --dry-run=client -o yaml | $KUBECTL apply -f -

# Sync DB password
sync_secret "${PROJECT_NAME}-db-password" "db-credentials" "password"

# Create database-url secret (full connection string from AWS db password)
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "${PROJECT_NAME}-db-password" --query SecretString --output text | tr -d '\n\r')
if [ -n "$DB_PASSWORD" ]; then
    echo "Syncing database-url (from AWS db-password)..."
    DB_PASSWORD_ESCAPED=$(printf '%s' "$DB_PASSWORD" | $PYTHON -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=''))")
    if [ -z "$DB_PASSWORD_ESCAPED" ]; then
        echo "Error: Failed to URL-encode DB_PASSWORD. Check that Python 3 is installed and working."
        echo "  Tried command: $PYTHON"
        exit 1
    fi
    DATABASE_URL="postgresql://postgres:${DB_PASSWORD_ESCAPED}@pgbouncer.data.svc.cluster.local:6432/multitenant_saas"
    $KUBECTL create secret generic "database-url" \
        --namespace "$NAMESPACE" \
        --from-literal=url="$DATABASE_URL" \
        --dry-run=client -o yaml | $KUBECTL apply -f -
    # Create pgbouncer userlist with PLAINTEXT password
    # (required for PgBouncer to complete SCRAM-SHA-256 auth with PostgreSQL 15+)
    # MD5 hash only works for client verification, not for backend SCRAM handshake
    USERLIST_CONTENT="\"postgres\" \"$DB_PASSWORD\""
    $KUBECTL create secret generic "pgbouncer-userlist" \
        --namespace "$NAMESPACE" \
        --from-literal=userlist.txt="$USERLIST_CONTENT" \
        --dry-run=client -o yaml | $KUBECTL apply -f -
else
    echo "Error: AWS secret ${PROJECT_NAME}-db-password is empty or missing."
    echo "Run: Set DB_PASSWORD in .env, then make bootstrap-secrets"
    exit 1
fi

# Sync JWT key (must match K8s secret name "jwt-secret" with key "JWT_KEY" used by auth-gateway, auth-service, task-status-service)
sync_secret "${PROJECT_NAME}-jwt-key" "jwt-secret" "JWT_KEY"

# Sync LLM keys
sync_secret "${PROJECT_NAME}-llm-keys" "llm-keys"

echo "Secrets sync complete."
