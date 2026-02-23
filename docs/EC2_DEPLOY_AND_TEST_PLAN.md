# EC2 Deployment and End-to-End Flow Test Plan 

This guide provides the bare minimum steps to deploy the Multi-Tenant SaaS platform to AWS EC2 and verify the full API flow.

## 1. Provision Infrastructure
Run this from the repo root to build the EC2 instance and ECR repositories.

```powershell
# Fix SSH key permissions (Windows only)
icacls infrastructure\multi-tenant-saas-key.pem /inheritance:r
icacls infrastructure\multi-tenant-saas-key.pem /grant:r suhas:R
```

```bash
# In Git Bash / WSL
make terraform-apply
```

## 2. Sync Kubeconfig
Fetch the remote k3s credentials and configure your local `kubectl`.

```bash
# In Git Bash / WSL
make update-kubeconfig
export KUBECONFIG=C:/Users/suhas/.kube/config-multi-tenant-saas

# Verify connection
kubectl --insecure-skip-tls-verify get nodes
```

## 3. Build and Push Images
Build the Docker images locally and push them to AWS ECR.

```bash
# Authenticate and push
make ecr-push
```

## 4. Deploy to Kubernetes
Apply the Kubernetes manifests using the ECR image URLs.

```bash
# Deploys all services to the 'data' namespace
make k8s-deploy-ecr
```

## 5. Verify and Test Flow

### Check Pod Status
Wait for all pods to be `Running`.
```bash
kubectl --insecure-skip-tls-verify -n data get pods
```

### Run End-to-End Test
1. **Get EC2 IP:**
   ```bash
   EC2_IP=$(cd infrastructure/terraform && ../../bin/terraform output -raw ec2_public_ip)
   ```

2. **Generate JWT Token:**
   (Requires `auth-service` to be accessible, use port-forward if internal)
   ```bash
   kubectl --insecure-skip-tls-verify -n data port-forward svc/auth-service 3001:3001 &
   
   TOKEN=$(curl -s -X POST http://localhost:3001/token \
     -H "Content-Type: application/json" \
     -d '{
       "user": { "id": "user_123", "email": "test@example.com" },
       "org_id": "org_456",
       "permissions": ["agents:create", "users:manage"]
     }' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
   ```

3. **Send Authenticated Request:**
   ```bash
   curl -v http://$EC2_IP/api/agents \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name": "test-agent", "type": "counselor"}'
   ```

4. **Verify RabbitMQ Queue:**
   ```bash
   kubectl --insecure-skip-tls-verify -n data exec rabbitmq-0 -- \
     rabbitmqctl list_queues name messages
   ```
   *Expected: `tasks` queue should have 1 message.*

## Port Forwarding (Local Access)
- **Auth Service:** `kubectl --insecure-skip-tls-verify -n data port-forward svc/auth-service 3001:3001`
- **Orchestrator:** `kubectl --insecure-skip-tls-verify -n data port-forward svc/orchestrator-service 3000:3000`
- **RabbitMQ UI:** `kubectl --insecure-skip-tls-verify -n data port-forward svc/rabbitmq 15672:15672` (admin/admin)
