#!/bin/bash

# Sync AWS Secrets Manager secrets to Kubernetes Secrets
# Requirements: aws-cli, kubectl

PROJECT_NAME="multi-tenant-saas"
NAMESPACE="data"

KUBECTL="kubectl --insecure-skip-tls-verify"

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

# Sync JWT key
sync_secret "${PROJECT_NAME}-jwt-key" "jwt-key"

# Sync LLM keys
sync_secret "${PROJECT_NAME}-llm-keys" "llm-keys"

echo "Secrets sync complete."
