#!/usr/bin/env bash
# Scaffold a new client deployment directory.
#
# Usage:
#   bash scripts/new-client.sh <client-id> [aws-region]
#
# Examples:
#   bash scripts/new-client.sh acme-corp ap-south-1
#   bash scripts/new-client.sh 123456789012        # uses us-east-1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CLIENT_ID="${1:-}"
REGION="${2:-us-east-1}"

if [ -z "$CLIENT_ID" ]; then
  echo "Usage: $0 <client-id> [aws-region]"
  echo "  client-id  : AWS account ID or a short slug (e.g. acme-corp)"
  echo "  aws-region : defaults to us-east-1"
  exit 1
fi

CLIENT_DIR="${REPO_ROOT}/clients/${CLIENT_ID}"

if [ -d "$CLIENT_DIR" ]; then
  echo "ERROR: client directory already exists: $CLIENT_DIR"
  exit 1
fi

# ── Detect AWS account ID ──────────────────────────────────────────────────────
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_BUCKET="multitenant-saas-tfstate-${ACCOUNT_ID}"
KEY_NAME="multi-tenant-saas-key"

mkdir -p "$CLIENT_DIR"

# ── config.env ────────────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/config.env" <<EOF
AWS_REGION=${REGION}
AWS_ACCOUNT=${ACCOUNT_ID}
CLIENT_ID=${CLIENT_ID}
KEY_NAME=${KEY_NAME}
EOF

# ── backend.hcl ───────────────────────────────────────────────────────────────
cat > "${CLIENT_DIR}/backend.hcl" <<EOF
bucket = "${STATE_BUCKET}"
key    = "prod/terraform.tfstate"
region = "${REGION}"
EOF

# ── terraform.tfvars from example ─────────────────────────────────────────────
sed "s/aws_region.*=.*/aws_region = \"${REGION}\"/" \
    "${REPO_ROOT}/infra/terraform.tfvars.example" \
    > "${CLIENT_DIR}/terraform.tfvars"
echo ""
echo "  Edit ${CLIENT_DIR}/terraform.tfvars and set:"
echo "    db_password       — strong random password"
echo "    allowed_ssh_cidrs — restrict to your office IP"
echo "    github_org / github_repo — your GitHub org and repo"

# ── prod.env from example ─────────────────────────────────────────────────────
sed "s|us-east-1|${REGION}|g; s|<account-id>|${ACCOUNT_ID}|g" \
    "${REPO_ROOT}/infra/prod.env.example" \
    > "${CLIENT_DIR}/prod.env"
echo ""
echo "  Edit ${CLIENT_DIR}/prod.env and fill in all secret values."

# ── SSH key ───────────────────────────────────────────────────────────────────
KEY_PATH="${CLIENT_DIR}/${KEY_NAME}"
if [ ! -f "${KEY_PATH}.pem" ]; then
  ssh-keygen -t ed25519 -f "${KEY_PATH}" -N "" -q
  mv "${KEY_PATH}" "${KEY_PATH}.pem"
  chmod 600 "${KEY_PATH}.pem"
  echo ""
  echo "  Generated SSH key: ${KEY_PATH}.pem"
  echo "  Back this file up securely — it is the only way to SSH into EC2."
fi

# ── Bootstrap state bucket ────────────────────────────────────────────────────
echo ""
echo "Creating Terraform state bucket (${STATE_BUCKET}) in ${REGION}..."
if aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  State bucket already exists."
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
  echo "  Created."
fi

# ── Terraform init ────────────────────────────────────────────────────────────
echo ""
echo "Running terraform init..."
terraform -chdir="${REPO_ROOT}/infra" init -reconfigure \
    -backend-config="${CLIENT_DIR}/backend.hcl"

echo ""
echo "Client '${CLIENT_ID}' scaffolded at: ${CLIENT_DIR}"
echo ""
echo "Next steps:"
echo "  1. Edit ${CLIENT_DIR}/terraform.tfvars  (set db_password, allowed_ssh_cidrs)"
echo "  2. Edit ${CLIENT_DIR}/prod.env           (set SECRET_KEY, API keys)"
echo "  3. make tf-apply CLIENT=${CLIENT_ID}"
echo "  4. make redeploy-ecr CLIENT=${CLIENT_ID}"
