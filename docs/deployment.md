# Deploying to AWS with Terraform

Provisions the full stack on AWS and deploys all three services (server, agents, frontend) to a single EC2 instance via Docker Compose.

**Total time: ~25 minutes** (most of it is RDS spin-up)

Each deployment is isolated in a `clients/<client-id>/` directory — you can manage multiple AWS accounts or environments side-by-side from the same repo.

---

## What gets created

| Resource | Details |
|---|---|
| EC2 `t3.medium` | App server — runs all 3 Docker containers |
| RDS PostgreSQL 16 | `db.t3.micro`, 20 GB gp3, encrypted, private subnet |
| ElastiCache Redis 7 | `cache.t3.micro`, private subnet |
| ECR | 3 private image repos (`backend`, `agents`, `web`) |
| S3 | Uploads bucket (versioned, server-side encrypted) |
| VPC | 2 public + 2 private subnets across 2 AZs |
| IAM | EC2 instance role (ECR pull + S3), GitHub OIDC role for CI |
| S3 (Terraform state) | `multitenant-saas-tfstate-<account-id>` in your region |

RDS and Redis sit in private subnets — only the EC2 instance can reach them via security groups.

---

## Prerequisites

Install the required tools before starting.

### macOS

```bash
brew install terraform awscli
aws configure          # Access Key ID, Secret Key, default region
```
Install [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/).

### Linux (Ubuntu/Debian)

```bash
# Terraform
sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform

# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip /tmp/awscli.zip -d /tmp && sudo /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip
aws configure          # Access Key ID, Secret Key, default region

# Docker
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

### WSL2 (Windows)

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) and enable **Settings → Resources → WSL Integration** for your distro. This makes `docker` and `docker compose` available inside WSL — no separate Docker install needed.

2. Inside your WSL terminal, install Terraform and AWS CLI (same commands as Linux above).

3. After the initial deploy, all future `make redeploy-ecr` runs only need Docker Desktop running — Terraform is never needed again.

> **WSL tip:** If `make redeploy-ecr` hangs detecting your AWS account, pass it manually:
> ```bash
> AWS_ACCOUNT=123456789012 make redeploy-ecr CLIENT=<id>
> ```

---

## First deployment

### Step 1 — Scaffold a client directory

Each client gets its own directory under `clients/` containing all per-deployment config (region, SSH key, Terraform vars, prod env).

```bash
make new-client CLIENT=<client-id> AWS_REGION=<aws-region>
# e.g.  make new-client CLIENT=acme-corp AWS_REGION=ap-south-1
# e.g.  make new-client CLIENT=823954030825 AWS_REGION=us-east-1
```

This creates `clients/<client-id>/` with:

```
clients/<client-id>/
  config.env          # region, account ID, key name
  backend.hcl         # Terraform S3 backend config
  terraform.tfvars    # Terraform input variables (copied from example)
  prod.env            # EC2 environment file (copied from example, gitignored)
  multi-tenant-saas-key.pem   # SSH key (gitignored)
  multi-tenant-saas-key.pub   # Public key
```

It also creates the S3 state bucket (`multitenant-saas-tfstate-<account-id>`) in your region and runs `terraform init`.

---

### Step 2 — Set your variables

**`clients/<client-id>/terraform.tfvars`** — infrastructure config:

```hcl
db_password       = "StrongPassword123"    # min 8 chars, no: / @ " space
allowed_ssh_cidrs = ["YOUR.IP.ADDRESS/32"] # run: curl ifconfig.me
```

Everything else can stay as the defaults.

**`clients/<client-id>/prod.env`** — fill this after Step 3 once you have Terraform outputs.

---

### Step 3 — Bootstrap (one-time only)

The bootstrap script handles pre-Terraform setup: creates the GitHub OIDC provider, generates the SSH key pair, and imports any already-existing AWS resources into state to prevent conflicts.

```bash
bash scripts/bootstrap-aws.sh clients/<client-id>
```

When it prints `Bootstrap complete`, keep going. Your SSH key is at `clients/<client-id>/multi-tenant-saas-key.pem` — keep it safe.

---

### Step 4 — Provision infrastructure

```bash
make tf-apply CLIENT=<client-id>
```

Review the plan and type `yes`. Takes ~10–15 minutes (RDS is the slow part).

When it finishes, print the values you'll need for the env file:

```bash
terraform -chdir=infra output -raw ec2_public_ip   # server IP
terraform -chdir=infra output -raw database_url    # DATABASE_URL
terraform -chdir=infra output redis_url            # REDIS_URL
terraform -chdir=infra output s3_bucket            # S3_BUCKET
terraform -chdir=infra output ecr_registry         # ECR_REGISTRY
```

---

### Step 5 — Fill in the environment file

Open `clients/<client-id>/prod.env` and fill in the values from the Terraform outputs above:

```bash
# Paste outputs directly
terraform -chdir=infra output -raw database_url   # → DATABASE_URL
terraform -chdir=infra output redis_url           # → REDIS_URL
terraform -chdir=infra output s3_bucket           # → S3_BUCKET + AWS_DEFAULT_REGION
terraform -chdir=infra output ecr_registry        # → ECR_REGISTRY

# Generate a secret key
openssl rand -hex 32                              # → SECRET_KEY
```

`prod.env` is gitignored and never committed. `make redeploy-ecr` automatically uploads it to EC2 before deploying. To push only the env without a full redeploy:

```bash
make upload-env CLIENT=<client-id>
```

---

### Step 6 — Build and deploy

```bash
make redeploy-ecr CLIENT=<client-id>
```

This builds all three Docker images, pushes them to ECR, SSHs to EC2 to pull and restart services, and runs database migrations.

Once it completes, print your live URLs:

```bash
make url CLIENT=<client-id>
```

```
  Frontend : http://1.2.3.4:3000
  API      : http://1.2.3.4:8000
  SSH      : ssh -i clients/<client-id>/multi-tenant-saas-key.pem ec2-user@1.2.3.4
```

---

## Redeploying after code changes

Every future deploy is just:

```bash
make redeploy-ecr CLIENT=<client-id>
```

If `CLIENT` is not passed, it defaults to the first directory found under `clients/`.

---

## Managing multiple clients

Each client directory is independent — different AWS accounts, regions, or environments:

```
clients/
  823954030825/    # production (us-east-1)
  acme-corp/       # client A  (ap-south-1)
  staging/         # staging   (us-east-1)
```

All `make` targets accept a `CLIENT=` argument to target a specific deployment:

```bash
make tf-plan      CLIENT=acme-corp
make tf-apply     CLIENT=acme-corp
make redeploy-ecr CLIENT=acme-corp
make url          CLIENT=acme-corp
```

---

## Recovering from a failed deployment

If a previous Terraform run was interrupted, AWS resources may exist in the wrong VPC or outside Terraform state. The cleanup script detects and removes those orphans:

```bash
make cleanup-orphans CLIENT=<client-id>
```

It checks RDS and ElastiCache for VPC mismatches, prompts before deleting anything, and prints the `make tf-apply` command to recreate the removed resources.

After cleanup:

```bash
make tf-apply CLIENT=<client-id>
make redeploy-ecr CLIENT=<client-id>
```

---

## Useful commands

```bash
# SSH into the server
ssh -i clients/<client-id>/multi-tenant-saas-key.pem \
    ec2-user@$(terraform -chdir=infra output -raw ec2_public_ip)

# View live logs (on EC2)
cd /opt/app
docker compose logs -f server
docker compose logs -f agents
docker compose logs -f frontend

# Run a migration manually (on EC2)
docker compose exec server alembic upgrade head

# Restart all services (on EC2)
docker compose restart
```

---

## Tear down

```bash
make tf-apply CLIENT=<client-id>   # if needed, ensure state is fresh first
terraform -chdir=infra destroy -var-file=clients/<client-id>/terraform.tfvars
```

> RDS takes a final snapshot (`mtsaas-prod-final-snapshot`) before deletion. Remove it in the AWS Console if you don't need it.
