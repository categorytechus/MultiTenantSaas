#!/bin/bash

# Initialize AWS Secrets Manager entries from environment variables
# Usage: DB_PASSWORD=xxx JWT_KEY=xxx LLM_KEYS='{"openai":"..."}' ./bootstrap-aws-secrets.sh

PROJECT_NAME="multi-tenant-saas"

function create_or_update_secret() {
    local secret_name=$1
    local value=$2
    
    if [ -z "$value" ]; then
        echo "Skip $secret_name (no value provided)"
        return
    fi

    if aws secretsmanager describe-secret --secret-id "$secret_name" >/dev/null 2>&1; then
        echo "Updating secret $secret_name..."
        aws secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "$value"
    else
        echo "Creating secret $secret_name..."
        aws secretsmanager create-secret --name "$secret_name" --secret-string "$value"
    fi
}

create_or_update_secret "${PROJECT_NAME}-db-password" "$DB_PASSWORD"
create_or_update_secret "${PROJECT_NAME}-jwt-key" "$JWT_KEY"
create_or_update_secret "${PROJECT_NAME}-llm-keys" "$LLM_KEYS"

echo "AWS Secrets bootstrap complete."
