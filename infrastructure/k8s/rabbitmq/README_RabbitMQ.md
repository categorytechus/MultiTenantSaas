# RabbitMQ Kubernetes Cluster

3-node RabbitMQ cluster setup using StatefulSet, Secret, ConfigMap, and RBAC for peer discovery.

## Usage

### 1. Deploy
```bash
kubectl apply -f backend/k8s/rabbitmq/rabbitmq.yaml
```

### 2. Verify Pods
```bash
kubectl -n data get pods -l app=rabbitmq
```

### 3. Verify Cluster Status
Check if all 3 nodes have joined the cluster:
```bash
kubectl -n data exec -it rabbitmq-0 -- rabbitmqctl cluster_status
```

### 4. Access Management UI
1. Port-forward the management port:
   ```bash
   kubectl -n data port-forward svc/rabbitmq 15672:15672
   ```
2. Open http://localhost:15672
3. Login with `admin` / `admin`

## Troubleshooting

### Check Logs
```bash
kubectl -n data logs rabbitmq-0
```

### Force Restart (if config changed)
```bash
kubectl -n data rollout restart statefulset/rabbitmq
```

### Manual Cluster Status Check (per node)
```bash
kubectl -n data exec -it rabbitmq-1 -- rabbitmqctl cluster_status
kubectl -n data exec -it rabbitmq-2 -- rabbitmqctl cluster_status
```
