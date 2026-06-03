# Deploying to AWS with Terraform

Provisions the full stack on AWS and deploys all three services (server, agents, frontend) to a single EC2 instance via Docker Compose.

**Total time: ~25 minutes** (most of it is RDS spin-up)

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

RDS and Redis sit in private subnets — only the EC2 instance can reach them via security groups.

---

## Prerequisites

Install the required tools for your OS before starting.

### macOS

```bash
brew install terraform awscli
aws configure          # Access Key ID, Secret Key, region: us-east-1
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
aws configure          # Access Key ID, Secret Key, region: us-east-1

# Docker
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

### WSL2 (Windows)

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) and enable **Settings → Resources → WSL Integration** for your distro. This makes `docker` and `docker compose` available inside WSL — no separate Docker install needed.

2. Inside your WSL terminal, install Terraform and AWS CLI (same commands as Linux above — `docker` is already available via Docker Desktop).

3. After the initial deploy, all future `make redeploy-ecr` runs only need Docker Desktop to be running — Terraform is never needed again.

> **WSL tip:** If `make redeploy-ecr` hangs detecting your AWS account, pass it manually:
> ```bash
> AWS_ACCOUNT=123456789012 make redeploy-ecr
> ```

---

## Deployment steps

### Step 1 — Configure variables

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars` and set these two values:

```hcl
db_password       = "StrongPassword123"   # min 8 chars, no: / @ " space
allowed_ssh_cidrs = ["YOUR.IP.ADDRESS/32"] # run: curl ifconfig.me
```

Everything else can stay as the defaults.

---

### Step 2 — Bootstrap (one-time only)

Run the bootstrap script from the repo root. It handles everything that must exist before Terraform runs — creates the S3 state bucket, registers the GitHub OIDC provider, generates the SSH key pair, initialises Terraform, and imports any already-existing AWS resources into state so there are no conflicts.

```bash
bash scripts/bootstrap-aws.sh
```

When it prints `Bootstrap complete`, keep going. The file `infra/multi-tenant-saas-key.pem` is your SSH key — keep it safe.

---

### Step 3 — Provision infrastructure

```bash
terraform -chdir=infra apply
```

Review the plan and type `yes`. Takes ~10–15 minutes (RDS is the slow part).

When it finishes, print the values you'll need for the next step:

```bash
terraform -chdir=infra output -raw ec2_public_ip   # your server's IP
terraform -chdir=infra output -raw database_url    # full DATABASE_URL
terraform -chdir=infra output redis_url            # full REDIS_URL
terraform -chdir=infra output s3_bucket            # uploads bucket name
```

---

### Step 4 — Fill in the environment file

Copy the example file and fill in your values — everything stays local, no SSH needed:

```bash
cp infra/prod.env.example infra/prod.env
```

Open `infra/prod.env` and fill in the values using the Terraform outputs from Step 3:

```bash
# Paste these outputs in directly
terraform -chdir=infra output -raw database_url   # → DATABASE_URL
terraform -chdir=infra output redis_url           # → REDIS_URL
terraform -chdir=infra output s3_bucket           # → S3_BUCKET

# Generate a secret key
openssl rand -hex 32                              # → SECRET_KEY
```

`infra/prod.env` is gitignored and never committed. `make redeploy-ecr` automatically uploads it to EC2 before deploying. If you only change the env and don't want a full redeploy, you can push it on its own:

```bash
make upload-env
```

---

### Step 5 — Build and deploy

```bash
make redeploy-ecr
```

This single command builds all three Docker images, pushes them to ECR, SSHs to EC2 to pull and restart the services, and runs database migrations.

Once it completes, run this to print your live URLs:

```bash
make url
```

```
  Frontend : http://1.2.3.4:3000
  API      : http://1.2.3.4:8000
  SSH      : ssh -i infra/multi-tenant-saas-key.pem ec2-user@1.2.3.4
```

---

## Redeploying after code changes

Every future deploy is just:

```bash
make redeploy-ecr
```

Builds, pushes, deploys, and migrates in one step.

---

## Useful commands

```bash
# SSH into the server
ssh -i infra/multi-tenant-saas-key.pem \
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
terraform -chdir=infra destroy
```

> RDS takes a final snapshot (`mtsaas-prod-final-snapshot`) before deletion. Remove it in the AWS Console if you don't need it.
