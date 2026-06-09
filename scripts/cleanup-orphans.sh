#!/usr/bin/env bash
# Detect and remove AWS resources that are stranded from a previous failed
# Terraform deployment (e.g. RDS/Redis created in a different VPC).
#
# Usage:
#   bash scripts/cleanup-orphans.sh [CLIENT_DIR]
#
# Examples:
#   bash scripts/cleanup-orphans.sh clients/823954030825
#   bash scripts/cleanup-orphans.sh            # uses first client found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"

# ── Resolve client dir ─────────────────────────────────────────────────────────
CLIENT_DIR="${1:-}"
if [ -z "$CLIENT_DIR" ]; then
  CLIENT_DIR="$(ls -d "${REPO_ROOT}/clients"/*/  2>/dev/null | head -1)"
  CLIENT_DIR="${CLIENT_DIR%/}"
fi
if [ -z "$CLIENT_DIR" ] || [ ! -d "$CLIENT_DIR" ]; then
  echo "ERROR: No client directory found. Pass it as an argument:"
  echo "  $0 clients/<client-id>"
  exit 1
fi
CLIENT_DIR="$(cd "$CLIENT_DIR" && pwd)"

# shellcheck source=/dev/null
source "${CLIENT_DIR}/config.env"
REGION="${AWS_REGION:-us-east-1}"

log()  { echo "==> $*"; }
warn() { echo "    [warn] $*"; }
ok()   { echo "    [ok] $*"; }

TF_ARGS="-var-file=${CLIENT_DIR}/terraform.tfvars"
TF="terraform -chdir=${INFRA_DIR}"

# ── Helper: confirm destructive action ────────────────────────────────────────
confirm() {
  local msg="$1"
  printf "%s [y/N] " "$msg"
  read -r answer
  case "$answer" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# ── Get the VPC Terraform currently manages ────────────────────────────────────
log "Resolving current Terraform-managed VPC..."
CURRENT_VPC=$($TF state show aws_vpc.main 2>/dev/null \
  | grep '^\s*id\s*=' | awk '{print $3}' | tr -d '"') || true

if [ -z "$CURRENT_VPC" ]; then
  warn "aws_vpc.main not in Terraform state — run 'terraform apply' first."
  exit 0
fi
ok "Current VPC: $CURRENT_VPC"

CHANGES=0

# ── Check: RDS instance ────────────────────────────────────────────────────────
log "Checking RDS instance..."
DB_ID=$($TF output -raw rds_endpoint 2>/dev/null | cut -d: -f1 | cut -d. -f1 || true)
# derive from state instead if output unavailable
if [ -z "$DB_ID" ]; then
  DB_ID=$($TF state show aws_db_instance.postgres 2>/dev/null \
    | grep '^\s*identifier\s*=' | awk '{print $3}' | tr -d '"') || true
fi

if [ -n "$DB_ID" ]; then
  RDS_VPC=$(aws rds describe-db-instances \
    --db-instance-identifier "$DB_ID" \
    --query "DBInstances[0].DBSubnetGroup.VpcId" \
    --output text --region "$REGION" 2>/dev/null || echo "")

  if [ -n "$RDS_VPC" ] && [ "$RDS_VPC" != "$CURRENT_VPC" ] && [ "$RDS_VPC" != "None" ]; then
    warn "RDS '$DB_ID' is in VPC $RDS_VPC but Terraform manages $CURRENT_VPC."
    if confirm "  Remove RDS from state and delete from AWS?"; then
      $TF state rm aws_db_instance.postgres 2>/dev/null || true
      $TF state rm aws_db_subnet_group.postgres 2>/dev/null || true
      log "Deleting RDS instance (this takes ~5 min)..."
      aws rds delete-db-instance \
        --db-instance-identifier "$DB_ID" \
        --skip-final-snapshot \
        --region "$REGION"
      log "Waiting for RDS to delete..."
      until aws rds describe-db-instances \
              --db-instance-identifier "$DB_ID" \
              --region "$REGION" 2>&1 | grep -q "DBInstanceNotFound"; do
        sleep 15
        printf "."
      done
      echo ""
      # Delete subnet group (safe now that instance is gone)
      aws rds delete-db-subnet-group \
        --db-subnet-group-name "$(grep 'project_name' "${CLIENT_DIR}/terraform.tfvars" \
          | awk -F'"' '{print $2}')-$(grep 'environment' "${CLIENT_DIR}/terraform.tfvars" \
          | awk -F'"' '{print $2}')-rds-subnet-group" \
        --region "$REGION" 2>/dev/null || true
      ok "RDS removed."
      CHANGES=$((CHANGES + 1))
    fi
  else
    ok "RDS is in the correct VPC."
  fi
else
  ok "RDS not in Terraform state — skipping."
fi

# ── Check: ElastiCache cluster ─────────────────────────────────────────────────
log "Checking ElastiCache cluster..."
REDIS_ID=$($TF state show aws_elasticache_cluster.redis 2>/dev/null \
  | grep '^\s*cluster_id\s*=' | awk '{print $3}' | tr -d '"') || true

if [ -n "$REDIS_ID" ]; then
  # ElastiCache doesn't expose VPC directly; derive via subnet group
  REDIS_SUBNET_GROUP=$(aws elasticache describe-cache-clusters \
    --cache-cluster-id "$REDIS_ID" \
    --query "CacheClusters[0].CacheSubnetGroupName" \
    --output text --region "$REGION" 2>/dev/null || echo "")

  REDIS_VPC=""
  if [ -n "$REDIS_SUBNET_GROUP" ] && [ "$REDIS_SUBNET_GROUP" != "None" ]; then
    REDIS_VPC=$(aws elasticache describe-cache-subnet-groups \
      --cache-subnet-group-name "$REDIS_SUBNET_GROUP" \
      --query "CacheSubnetGroups[0].VpcId" \
      --output text --region "$REGION" 2>/dev/null || echo "")
  fi

  if [ -n "$REDIS_VPC" ] && [ "$REDIS_VPC" != "$CURRENT_VPC" ] && [ "$REDIS_VPC" != "None" ]; then
    warn "Redis '$REDIS_ID' is in VPC $REDIS_VPC but Terraform manages $CURRENT_VPC."
    if confirm "  Remove Redis from state and delete from AWS?"; then
      $TF state rm aws_elasticache_cluster.redis 2>/dev/null || true
      $TF state rm aws_elasticache_subnet_group.redis 2>/dev/null || true
      log "Deleting Redis cluster..."
      aws elasticache delete-cache-cluster \
        --cache-cluster-id "$REDIS_ID" \
        --region "$REGION"
      log "Waiting for Redis to delete..."
      until aws elasticache describe-cache-clusters \
              --cache-cluster-id "$REDIS_ID" \
              --region "$REGION" 2>&1 | grep -q "CacheClusterNotFound"; do
        sleep 10
        printf "."
      done
      echo ""
      aws elasticache delete-cache-subnet-group \
        --cache-subnet-group-name "$REDIS_SUBNET_GROUP" \
        --region "$REGION" 2>/dev/null || true
      ok "Redis removed."
      CHANGES=$((CHANGES + 1))
    fi
  else
    ok "Redis is in the correct VPC."
  fi
else
  ok "Redis not in Terraform state — skipping."
fi

# ── Check: orphaned VPCs from previous deployments ────────────────────────────
log "Checking for orphaned VPCs (not managed by Terraform)..."
ALL_VPCS=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Project,Values=mtsaas" \
  --query "Vpcs[*].VpcId" \
  --output text --region "$REGION" 2>/dev/null || echo "")

for VPC_ID in $ALL_VPCS; do
  if [ "$VPC_ID" != "$CURRENT_VPC" ]; then
    warn "Found orphaned VPC: $VPC_ID (not managed by Terraform)"
    warn "  It may contain lingering resources — inspect and delete manually via:"
    warn "  aws ec2 describe-vpcs --vpc-ids $VPC_ID --region $REGION"
  fi
done

# ── Check: EC2 instance in wrong subnet ───────────────────────────────────────
log "Checking EC2 instance..."
INSTANCE_ID=$($TF state show aws_instance.app 2>/dev/null \
  | grep '^\s*id\s*=' | head -1 | awk '{print $3}' | tr -d '"') || true

if [ -n "$INSTANCE_ID" ]; then
  INSTANCE_VPC=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --query "Reservations[0].Instances[0].VpcId" \
    --output text --region "$REGION" 2>/dev/null || echo "")

  if [ -n "$INSTANCE_VPC" ] && [ "$INSTANCE_VPC" != "$CURRENT_VPC" ] && [ "$INSTANCE_VPC" != "None" ]; then
    warn "EC2 instance '$INSTANCE_ID' is in VPC $INSTANCE_VPC but Terraform manages $CURRENT_VPC."
    warn "  Terraform will replace it automatically on next 'terraform apply'."
    warn "  Run: make tf-apply CLIENT=$(basename "$CLIENT_DIR")"
  else
    ok "EC2 is in the correct VPC."
  fi
else
  ok "EC2 not in Terraform state — skipping."
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
if [ "$CHANGES" -gt 0 ]; then
  log "$CHANGES resource(s) removed. Run the following to recreate them:"
  echo "  make tf-apply CLIENT=$(basename "$CLIENT_DIR")"
else
  log "No orphaned resources found."
fi
