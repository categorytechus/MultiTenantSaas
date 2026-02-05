# Infrastructure Runbook - Day 1 & 2

This guide covers provisioning the multi-tenant SaaS infrastructure on AWS end-to-end.

## Architecture Overview
- **Compute:** EC2 (t3.medium) running k3s (Kubernetes).
- **Database:** PostgreSQL StatefulSet (v15) with PersistentVolumes.
- **Messaging:** RabbitMQ StatefulSet (3-node cluster) with k3s peer discovery.
- **Proxy:** PgBouncer for database connection pooling.
- **Security:** AWS Secrets Manager for sensitive data.
- **Observability:** CloudWatch (via Fluent Bit) for logs, CloudTrail for audit.

---

## 1. Prerequisites
- AWS CLI configured with appropriate credentials.
- Terraform installed.
- `kubectl` installed.

## 2. Infrastructure Provisioning (Terraform)
```bash
cd terraform
terraform init
terraform apply
```
**Required Variables:**
- `aws_region`: (default: us-east-1)
- `project_name`: (default: multi-tenant-saas)

**Outputs:**
- `ec2_public_ip`: Use this to connect to the cluster.
- `db_password_secret_name`: Name of the DB secret in AWS.

## 3. Kubernetes Setup
Connect to the EC2 instance (using SSM is preferred):
```bash
aws ssm start-session --target <INSTANCE_ID>
```
The EC2 instance is bootstrapped with k3s. Fetch the kubeconfig if you want to manage locally:
```bash
# On EC2
sudo cat /etc/rancher/k3s/k3s.yaml
```

## 4. Secrets Management
Bootstrap secrets in AWS Secrets Manager:
```bash
export DB_PASSWORD="your-strong-password"
export JWT_KEY="your-jwt-secret"
export LLM_KEYS='{"openai": "sk-...", "anthropic": "..."}'
./scripts/bootstrap-aws-secrets.sh
```

Sync secrets to Kubernetes:
```bash
./scripts/sync-secrets.sh
```

## 5. Deployment (Day 1 & 2)
```bash
# Create namespace
kubectl create namespace data

# Deploy Postgres
kubectl apply -f backend/k8s/postgresql.yaml

# Deploy RabbitMQ
kubectl apply -f backend/k8s/rabbitmq/rabbitmq.yaml

# Deploy PgBouncer
kubectl apply -f backend/k8s/pgbouncer-config.yaml
kubectl apply -f backend/k8s/pgbouncer.yaml

# Deploy Logging
kubectl apply -f backend/k8s/cloudwatch-logging.yaml
```

## 6. Verification

### PostgreSQL
```bash
kubectl get pods -n data -l app=postgres
# Test connection
kubectl exec -it postgres-0 -n data -- psql -U saas_admin -d saas_db -c "SELECT 1;"
```

### RabbitMQ
```bash
kubectl get pods -n data -l app=rabbitmq
# Check cluster status
kubectl exec -it rabbitmq-0 -n data -- rabbitmq-diagnostics cluster_status
```

### PgBouncer
```bash
# Test connection through PgBouncer
kubectl run psql-client --rm -it --image=postgres:15 --restart=Never -n data -- \
  psql "postgresql://saas_admin:supersecretpassword@pgbouncer:6432/saas_db" -c "SELECT 1;"
```

### Logging & Trail
- **CloudWatch:** Check log group `/${PROJECT_NAME}/k3s-logs` in AWS Console.
- **CloudTrail:** Verify trail `${PROJECT_NAME}-trail` is logging to S3.

## 7. Environment Variables
Required for application pods:
- `DATABASE_URL`: `postgresql://saas_admin:secret@pgbouncer:6432/saas_db`
- `RABBITMQ_URL`: `amqp://admin:admin@rabbitmq:5672`
