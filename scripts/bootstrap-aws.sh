#!/usr/bin/env bash
# One-time AWS pre-Terraform setup.
# Run this once before your first `terraform apply`.
# Safe to re-run — every step is idempotent.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_BUCKET="multitenant-saas-tfstate-${ACCOUNT_ID}"
KEY_NAME="multi-tenant-saas-key"
KEY_PATH="infra/${KEY_NAME}"
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

# Resolve repo root so the script works from any working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"

log()  { echo "==> $*"; }
warn() { echo "    (skipped) $*"; }

# ── 1. Terraform state bucket ──────────────────────────────────────────────────
log "S3 state bucket ($STATE_BUCKET)..."
if aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$REGION" 2>/dev/null; then
  warn "Already exists."
else
  aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
    $( [[ "$REGION" != "us-east-1" ]] && echo "--create-bucket-configuration LocationConstraint=$REGION" || true )
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
    --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  log "Created."
fi

# ── 2. GitHub OIDC provider ────────────────────────────────────────────────────
log "GitHub Actions OIDC provider..."
if aws iam list-open-id-connect-providers --output text \
     --query "OpenIDConnectProviderList[].Arn" 2>/dev/null \
   | grep -q "token.actions.githubusercontent.com"; then
  warn "Already exists."
else
  aws iam create-open-id-connect-provider \
    --url "$OIDC_URL" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list "$OIDC_THUMBPRINT"
  log "Created."
fi

# ── 3. SSH key pair ────────────────────────────────────────────────────────────
log "SSH key pair ($KEY_NAME)..."
if [[ -f "${KEY_PATH}.pem" ]]; then
  warn "Local key ${KEY_PATH}.pem already exists."
else
  ssh-keygen -t ed25519 -f "${KEY_PATH}" -N "" -q
  mv "${KEY_PATH}" "${KEY_PATH}.pem"
  chmod 600 "${KEY_PATH}.pem"
  log "Created ${KEY_PATH}.pem  —  keep this safe, it's your SSH key."
fi

# ── 4. Terraform init + import pre-existing AWS resources ─────────────────────
log "Running terraform init..."
terraform -chdir="$INFRA_DIR" init -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}"

# Import SSH key pair if it already exists in AWS but not in Terraform state
log "Checking key pair in Terraform state..."
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" \
     --query "KeyPairs[0].KeyName" --output text 2>/dev/null | grep -q "$KEY_NAME"; then
  if ! terraform -chdir="$INFRA_DIR" state show aws_key_pair.app &>/dev/null; then
    log "Importing existing key pair into Terraform state..."
    terraform -chdir="$INFRA_DIR" import aws_key_pair.app "$KEY_NAME"
  else
    warn "Key pair already in Terraform state."
  fi
fi

# Import github-cts IAM role if it already exists in AWS but not in Terraform state
log "Checking github-cts IAM role in Terraform state..."
if aws iam get-role --role-name github-cts --query "Role.RoleName" \
     --output text 2>/dev/null | grep -q "github-cts"; then
  if ! terraform -chdir="$INFRA_DIR" state show aws_iam_role.github_cts &>/dev/null; then
    log "Importing existing github-cts role into Terraform state..."
    terraform -chdir="$INFRA_DIR" import aws_iam_role.github_cts github-cts
  else
    warn "github-cts role already in Terraform state."
  fi
fi

echo ""
echo "Bootstrap complete. Run next:"
echo "  terraform -chdir=infra apply"
