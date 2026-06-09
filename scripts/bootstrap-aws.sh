#!/usr/bin/env bash
# One-time AWS pre-Terraform setup.
# Run this once before your first `terraform apply` for a client.
# Safe to re-run — every step is idempotent.
#
# Usage:
#   bash scripts/bootstrap-aws.sh [CLIENT_DIR]
#
# Examples:
#   bash scripts/bootstrap-aws.sh clients/823954030825
#   bash scripts/bootstrap-aws.sh clients/acme-corp
#   bash scripts/bootstrap-aws.sh          # uses first client in clients/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"

log()  { echo "==> $*"; }
warn() { echo "    (skipped) $*"; }

# ── Resolve client dir ─────────────────────────────────────────────────────────
CLIENT_DIR="${1:-}"
if [ -z "$CLIENT_DIR" ]; then
  CLIENT_DIR="$(ls -d "${REPO_ROOT}/clients"/*/  2>/dev/null | head -1)"
  CLIENT_DIR="${CLIENT_DIR%/}"
fi
if [ -z "$CLIENT_DIR" ] || [ ! -d "$CLIENT_DIR" ]; then
  echo "ERROR: No client directory found. Either:"
  echo "  1. Create one with:  bash scripts/new-client.sh <client-id> [region]"
  echo "  2. Pass it directly: $0 clients/<client-id>"
  exit 1
fi
CLIENT_DIR="$(cd "$CLIENT_DIR" && pwd)"

# ── Load client config ─────────────────────────────────────────────────────────
# shellcheck source=/dev/null
source "${CLIENT_DIR}/config.env"
REGION="${AWS_REGION:-us-east-1}"
KEY_NAME="${KEY_NAME:-multi-tenant-saas-key}"
KEY_PATH="${CLIENT_DIR}/${KEY_NAME}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_BUCKET="multitenant-saas-tfstate-${ACCOUNT_ID}"
OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"

log "Client dir : ${CLIENT_DIR}"
log "AWS region : ${REGION}"
log "Account ID : ${ACCOUNT_ID}"

# ── 1. Terraform state bucket ──────────────────────────────────────────────────
log "S3 state bucket (${STATE_BUCKET})..."
if aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$REGION" 2>/dev/null; then
  warn "Already exists."
else
  LOCATION_ARG=""
  if [ "$REGION" != "us-east-1" ]; then
    LOCATION_ARG="--create-bucket-configuration LocationConstraint=${REGION}"
  fi
  # shellcheck disable=SC2086
  aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" $LOCATION_ARG
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
      --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
      --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  log "Created."
fi

# ── 2. Write backend.hcl ──────────────────────────────────────────────────────
BACKEND_FILE="${CLIENT_DIR}/backend.hcl"
log "Writing ${BACKEND_FILE}..."
cat > "$BACKEND_FILE" <<EOF
bucket = "${STATE_BUCKET}"
key    = "prod/terraform.tfstate"
region = "${REGION}"
EOF
log "Done."

# ── 3. GitHub OIDC provider ────────────────────────────────────────────────────
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

# ── 4. SSH key pair ────────────────────────────────────────────────────────────
log "SSH key pair (${KEY_NAME})..."
if [[ -f "${KEY_PATH}.pem" ]]; then
  warn "Local key ${KEY_PATH}.pem already exists."
else
  ssh-keygen -t ed25519 -f "${KEY_PATH}" -N "" -q
  mv "${KEY_PATH}" "${KEY_PATH}.pem"
  chmod 600 "${KEY_PATH}.pem"
  log "Created ${KEY_PATH}.pem  —  keep this safe, it's your SSH key."
fi

# ── 5. Terraform init ──────────────────────────────────────────────────────────
log "Running terraform init..."
terraform -chdir="$INFRA_DIR" init -reconfigure \
    -backend-config="${BACKEND_FILE}"

# ── 6. Import pre-existing resources ──────────────────────────────────────────
TF_VARS="${CLIENT_DIR}/terraform.tfvars"

log "Checking key pair in Terraform state..."
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" \
     --query "KeyPairs[0].KeyName" --output text 2>/dev/null | grep -q "$KEY_NAME"; then
  if ! terraform -chdir="$INFRA_DIR" state show aws_key_pair.app &>/dev/null; then
    log "Importing existing key pair into Terraform state..."
    terraform -chdir="$INFRA_DIR" import -var-file="$TF_VARS" aws_key_pair.app "$KEY_NAME"
  else
    warn "Key pair already in Terraform state."
  fi
fi

log "Checking github-cts IAM role in Terraform state..."
if aws iam get-role --role-name github-cts --query "Role.RoleName" \
     --output text 2>/dev/null | grep -q "github-cts"; then
  if ! terraform -chdir="$INFRA_DIR" state show aws_iam_role.github_cts &>/dev/null; then
    log "Importing existing github-cts role into Terraform state..."
    terraform -chdir="$INFRA_DIR" import -var-file="$TF_VARS" \
        aws_iam_role.github_cts github-cts
  else
    warn "github-cts role already in Terraform state."
  fi
fi

echo ""
echo "Bootstrap complete. Run next:"
echo "  make tf-apply CLIENT=$(basename "$CLIENT_DIR")"
