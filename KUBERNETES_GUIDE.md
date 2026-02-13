# Kubernetes Beginner's Guide — For This Project

> A hands-on introduction to Kubernetes, explained through the actual manifests and architecture of the **Multi-Tenant SaaS** project.

---

## Table of Contents

1. [What is Kubernetes?](#1-what-is-kubernetes)
2. [What is k3s? (And Why We Use It)](#2-what-is-k3s-and-why-we-use-it)
3. [Core Concepts (The Building Blocks)](#3-core-concepts-the-building-blocks)
4. [Our Kubernetes Architecture](#4-our-kubernetes-architecture)
5. [Walking Through Our YAML Files](#5-walking-through-our-yaml-files)
6. [Essential kubectl Commands](#6-essential-kubectl-commands)
7. [How It All Connects](#7-how-it-all-connects)
8. [Common Troubleshooting](#8-common-troubleshooting)

---

## 1. What is Kubernetes?

Imagine you have an application made of multiple pieces — a database, a message queue, a web server. You need them all running, healthy, and talking to each other. **Kubernetes** (often abbreviated **K8s**) is a system that:

- **Deploys** your application containers automatically
- **Scales** them up or down based on demand
- **Heals** them — restarts crashed containers, replaces failed nodes
- **Networks** them — gives each piece a stable address so they can find each other

### The Analogy

Think of Kubernetes as a **hotel manager**:

| Hotel Concept | Kubernetes Equivalent |
|---|---|
| The hotel building | **Cluster** — the overall system |
| Floors in the hotel | **Nodes** — physical/virtual machines |
| Individual rooms | **Pods** — where your apps actually run |
| Room service rules | **Services** — networking and access rules |
| Guest reservations | **Deployments/StatefulSets** — specs for what should be running |
| Housekeeping schedule | **Controllers** — keep everything in the desired state |

---

## 2. What is k3s? (And Why We Use It)

Standard Kubernetes is powerful but heavy — it requires a lot of resources and setup. **k3s** is a **lightweight Kubernetes distribution** made by Rancher Labs that:

- Ships as a **single binary** (under 100 MB vs. hundreds of MB for standard K8s)
- Runs on machines with as little as **512 MB RAM**
- Installs in **under a minute**
- Is fully **CNCF certified** — meaning it's real Kubernetes, just trimmed down
- Uses **SQLite** by default instead of etcd (simpler for single-node setups)
- Comes with essentials pre-installed: container runtime, DNS, networking, ingress

### Why we chose k3s for this project

In our `terraform/main.tf`, the EC2 instance is bootstrapped with:

```bash
curl -sfL https://get.k3s.io | sh -
```

This single command installs a full Kubernetes cluster on our `t3.medium` EC2 instance. Since we're running a dev/staging environment on a single server, k3s gives us all the power of Kubernetes without the overhead of a multi-node production setup.

---

## 3. Core Concepts (The Building Blocks)

### 3.1 Pod — The Smallest Unit

A **Pod** is the smallest thing Kubernetes manages. It wraps one or more containers that share:
- The same network (they can talk via `localhost`)
- The same storage volumes
- The same lifecycle (created and destroyed together)

**In our project:** Each PostgreSQL instance, each RabbitMQ node, PgBouncer, and Fluent Bit each runs inside its own Pod.

```
┌─────────── Pod ───────────┐
│  ┌─────────────────────┐  │
│  │  postgres:15         │  │  ← Container
│  │  (port 5432)         │  │
│  └─────────────────────┘  │
│  📁 /var/lib/postgresql    │  ← Volume mount (persistent data)
└───────────────────────────┘
```

### 3.2 Service — Stable Networking

Pods can crash and restart with different IP addresses. A **Service** gives a group of Pods a **stable address** that never changes.

There are different types:

| Service Type | What It Does | Used In Our Project |
|---|---|---|
| **ClusterIP** (default) | Internal address, reachable only inside the cluster | PgBouncer service (port 6432) |
| **Headless** (`clusterIP: None`) | No load balancing — returns individual Pod IPs directly. Used for StatefulSets that need direct Pod addressing | PostgreSQL, RabbitMQ headless services |
| **NodePort** | Exposes a port on every node's IP | Allowed by our security group (30000-32767) |

**Example from our project** (`postgresql.yaml`):

```yaml
# Headless Service — for StatefulSet direct Pod DNS
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless      # ← Other pods use this name to find postgres
  namespace: data
spec:
  clusterIP: None              # ← "Headless" — no single IP, returns all Pod IPs
  selector:
    app: postgres              # ← Routes to Pods with label "app: postgres"
  ports:
    - port: 5432
```

With this, the PostgreSQL Pod gets a stable DNS name: `postgres-0.postgres-headless.data.svc.cluster.local`

### 3.3 Namespace — Logical Isolation

A **Namespace** is like a folder for Kubernetes resources. It keeps things organized and separated.

**In our project**, we use two namespaces:

| Namespace | What's In It |
|---|---|
| `data` | PostgreSQL, PgBouncer, RabbitMQ — all our data/messaging services |
| `kube-system` | Fluent Bit logging (system-level infrastructure) |

You can think of it like departments in a company — the "data department" handles databases and messaging, the "system department" handles platform-level services.

### 3.4 Deployment — For Stateless Apps

A **Deployment** creates and manages identical, interchangeable Pods. If one dies, it gets replaced with a brand new one — no data to worry about.

**In our project:** PgBouncer uses a Deployment because it's **stateless** — it's just a connection proxy with no persistent data.

```yaml
# From pgbouncer.yaml
kind: Deployment          # ← Stateless — any Pod can replace any other
spec:
  replicas: 1             # ← Run exactly 1 PgBouncer Pod
  template:
    spec:
      containers:
        - name: pgbouncer
          image: edoburu/pgbouncer:latest
          ports:
            - containerPort: 6432
```

### 3.5 StatefulSet — For Apps That Need Memory

A **StatefulSet** is like a Deployment, but for apps that need to **remember data** and have a **stable identity**. Each Pod gets:
- A **persistent name** (e.g., `postgres-0`, `rabbitmq-0`, `rabbitmq-1`, `rabbitmq-2`)
- Its **own storage** that survives restarts
- **Ordered startup** (`-0` starts before `-1`, `-1` before `-2`)

**In our project:** PostgreSQL and RabbitMQ both use StatefulSets.

```yaml
# From postgresql.yaml
kind: StatefulSet         # ← Stateful — Pod keeps its identity and data
spec:
  serviceName: "postgres-headless"
  replicas: 1
  template:
    spec:
      containers:
        - name: postgres
          image: postgres:15
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data   # ← Database files live here
  volumeClaimTemplates:                              # ← Request persistent storage
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi                            # ← 5 GB of persistent disk
```

**Why StatefulSet matters here:** If the PostgreSQL Pod crashes and restarts, it comes back as `postgres-0` with the **same 5 GB disk** attached — your data is safe.

### 3.6 DaemonSet — One Per Node

A **DaemonSet** ensures exactly **one copy of a Pod runs on every node** in the cluster. When a new node joins, it automatically gets a copy. When a node leaves, the Pod is cleaned up.

**In our project:** Fluent Bit (log collector) uses a DaemonSet because we want to collect logs from **every node**.

```yaml
# From cloudwatch-logging.yaml
kind: DaemonSet           # ← Runs on EVERY node automatically
spec:
  template:
    spec:
      containers:
      - name: fluent-bit
        image: fluent/fluent-bit:latest
        volumeMounts:
        - name: varlog
          mountPath: /var/log               # ← Reads all log files from the node
        - name: varlibdockercontainers
          mountPath: /var/lib/docker/containers
```

### 3.7 PersistentVolume (PV) & PersistentVolumeClaim (PVC)

- **PersistentVolume (PV)** = a piece of actual disk storage (like a hard drive)
- **PersistentVolumeClaim (PVC)** = a request for storage ("I need 5 GB")

Think of it like renting a storage unit:
- The **PV** is the physical locker
- The **PVC** is your rental agreement saying "I need a medium-sized locker"
- Kubernetes matches your request to an available locker

**In our project**, the StatefulSets use `volumeClaimTemplates` to automatically create PVCs:

```yaml
# PostgreSQL requests 5 GB
volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]    # ← Only one Pod can write at a time
      resources:
        requests:
          storage: 5Gi                  # ← 5 GB of persistent storage
```

### 3.8 ConfigMap & Secret — Configuration

| Resource | Purpose | Example in Our Project |
|---|---|---|
| **ConfigMap** | Non-sensitive configuration data | Fluent Bit config (`fluent-bit.conf`), PgBouncer settings (`pgbouncer.ini`), RabbitMQ config |
| **Secret** | Sensitive data (passwords, keys) | Database credentials (`db-credentials`), RabbitMQ credentials |

**Example:** PgBouncer reads its config from a ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pgbouncer-config
data:
  pgbouncer.ini: |
    [pgbouncer]
    listen_port = 6432
    max_client_conn = 100
    default_pool_size = 20
    [databases]
    saas_db = host=postgres-headless.data.svc.cluster.local port=5432 dbname=saas_db
```

And PostgreSQL reads its password from a Secret:

```yaml
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials     # ← Kubernetes Secret name
        key: password             # ← Key within the Secret
```

### 3.9 RBAC — Who Can Do What (Inside K8s)

Kubernetes has its own RBAC (separate from our application's RBAC). It controls what **service accounts** (identities for Pods) can access.

**In our project**, RabbitMQ needs to discover other RabbitMQ Pods to form a cluster. So we create:

```
ServiceAccount (rabbitmq)
    ↓ bound via
RoleBinding (rabbitmq-peer-discovery)
    ↓ grants
Role (can "get", "list", "watch" endpoints, pods, services)
```

This allows the RabbitMQ Pods to call the Kubernetes API and find each other.

---

## 4. Our Kubernetes Architecture

Here's what runs in our k3s cluster:

```
k3s Cluster (EC2 t3.medium)
│
├── Namespace: data
│   ├── StatefulSet: postgres (1 replica)
│   │   └── Pod: postgres-0
│   │       ├── Container: postgres:15
│   │       └── Volume: 5Gi (persistent)
│   │
│   ├── Deployment: pgbouncer (1 replica)
│   │   └── Pod: pgbouncer-xxxxx
│   │       └── Container: edoburu/pgbouncer
│   │
│   ├── StatefulSet: rabbitmq (3 replicas)
│   │   ├── Pod: rabbitmq-0
│   │   ├── Pod: rabbitmq-1
│   │   └── Pod: rabbitmq-2
│   │       ├── Container: rabbitmq:3.12-management
│   │       └── Volume: 5Gi each (persistent)
│   │
│   └── Services
│       ├── postgres-headless (Headless, port 5432)
│       ├── postgres (ClusterIP, port 5432)
│       ├── pgbouncer (ClusterIP, port 6432)
│       ├── rabbitmq-headless (Headless, ports 5672/25672/4369)
│       └── rabbitmq (ClusterIP, ports 5672/15672)
│
└── Namespace: kube-system
    └── DaemonSet: fluent-bit
        └── Pod: fluent-bit-xxxxx (1 per node)
            └── Container: fluent/fluent-bit
                └── Sends logs → AWS CloudWatch
```

---

## 5. Walking Through Our YAML Files

Every Kubernetes resource is defined in a **YAML file**. Here's how to read one:

### Anatomy of a YAML Manifest

```yaml
apiVersion: apps/v1       # ← Which K8s API version to use
kind: StatefulSet          # ← What kind of resource this is
metadata:
  name: postgres           # ← The name of this resource
  namespace: data          # ← Which namespace it belongs to
spec:                       # ← The "specification" — what we want
  replicas: 1              # ← How many Pods to run
  selector:
    matchLabels:
      app: postgres        # ← Find Pods with this label
  template:                 # ← Template for creating each Pod
    metadata:
      labels:
        app: postgres      # ← Label assigned to the Pod
    spec:
      containers:           # ← What containers to run inside the Pod
        - name: postgres
          image: postgres:15
```

### Our 4 YAML Files Explained

| File | Kind | What It Creates |
|---|---|---|
| `postgresql.yaml` | 2 Services + 1 StatefulSet | PostgreSQL database with persistent storage, headless service for DNS, and regular service for access |
| `pgbouncer.yaml` | 1 ConfigMap + 1 Deployment + 1 Service | Connection pooler with config, a stateless deployment, and a ClusterIP service on port 6432 |
| `rabbitmq/rabbitmq.yaml` | 1 Secret + 1 ConfigMap + 1 ServiceAccount + 1 Role + 1 RoleBinding + 2 Services + 1 StatefulSet | Full 3-node RabbitMQ cluster with credentials, peer discovery RBAC, headless + regular services, and persistent storage |
| `cloudwatch-logging.yaml` | 1 ConfigMap + 1 DaemonSet + 1 ServiceAccount + 1 ClusterRole + 1 ClusterRoleBinding | Fluent Bit log collector running on every node, forwarding all container logs to AWS CloudWatch |

---

## 6. Essential kubectl Commands

`kubectl` is the command-line tool for talking to your Kubernetes cluster.

### Viewing Resources

```bash
# List all pods in the "data" namespace
kubectl get pods -n data

# List all services in "data" namespace
kubectl get services -n data

# List everything in "data" namespace
kubectl get all -n data

# Get detailed info about a specific pod
kubectl describe pod postgres-0 -n data

# View pod logs
kubectl logs postgres-0 -n data

# Follow logs in real-time (like tail -f)
kubectl logs -f postgres-0 -n data
```

### Interacting With Pods

```bash
# Open a shell inside the PostgreSQL pod
kubectl exec -it postgres-0 -n data -- bash

# Run a single command (check if Postgres is ready)
kubectl exec -it postgres-0 -n data -- pg_isready -U saas_admin -d saas_db

# Connect to PostgreSQL directly
kubectl exec -it postgres-0 -n data -- psql -U saas_admin -d saas_db

# Check RabbitMQ cluster status
kubectl exec -it rabbitmq-0 -n data -- rabbitmq-diagnostics cluster_status
```

### Managing Resources

```bash
# Apply a YAML file (create or update resources)
kubectl apply -f backend/k8s/postgresql.yaml

# Delete resources defined in a YAML file
kubectl delete -f backend/k8s/postgresql.yaml

# Scale a deployment (e.g., add more PgBouncer replicas)
kubectl scale deployment pgbouncer -n data --replicas=3

# Restart a deployment (rolling restart)
kubectl rollout restart deployment pgbouncer -n data
```

### Debugging

```bash
# Why is a pod not starting? Check events:
kubectl describe pod <pod-name> -n data

# Check recent events across the namespace
kubectl get events -n data --sort-by=.metadata.creationTimestamp

# Check node resources
kubectl top nodes
kubectl top pods -n data
```

---

## 7. How It All Connects

Here's the full request flow in our project, showing how Kubernetes fits into the bigger picture:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         AWS Cloud                                    │
│                                                                      │
│  ┌──────────────┐    ┌────────────────┐    ┌─────────────────────┐  │
│  │ API Gateway   │───▶│ Lambda         │    │ k3s Cluster (EC2)   │  │
│  │ (REST + WS)   │    │ Authorizer     │    │                     │  │
│  └──────────────┘    │ (validates JWT) │    │  ┌───────────────┐  │  │
│         │            └────────────────┘    │  │ PostgreSQL    │  │  │
│         ▼                                  │  │ (StatefulSet) │  │  │
│  ┌──────────────┐                          │  └───────┬───────┘  │  │
│  │ Lambda        │    DATABASE_URL          │          ▲          │  │
│  │ Orchestrator  │────────────────────────▶│  ┌───────┴───────┐  │  │
│  │ (permissions) │                          │  │ PgBouncer     │  │  │
│  └──────────────┘                          │  │ (Deployment)  │  │  │
│                                            │  └───────────────┘  │  │
│  ┌──────────────┐       FUTURE             │                     │  │
│  │ Next.js       │────────────────────────▶│  ┌───────────────┐  │  │
│  │ Frontend      │       AMQP              │  │ RabbitMQ      │  │  │
│  └──────────────┘                          │  │ (3-node       │  │  │
│                                            │  │  StatefulSet) │  │  │
│                                            │  └───────────────┘  │  │
│                                            │                     │  │
│                                            │  ┌───────────────┐  │  │
│                       Logs ───────────────▶│  │ Fluent Bit    │──┼──▶ CloudWatch
│                                            │  │ (DaemonSet)   │  │  │
│                                            │  └───────────────┘  │  │
│                                            └─────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### The Data Flow
1. **User request** hits API Gateway
2. **Lambda Authorizer** validates the JWT token
3. **Orchestrator Lambda** checks permissions, then processes the request
4. App connects to **PgBouncer** (port 6432), which pools connections to **PostgreSQL** (port 5432)
5. Async tasks will eventually be published to **RabbitMQ** (port 5672)
6. **Fluent Bit** continuously collects all pod logs and ships them to **AWS CloudWatch**

---

## 8. Common Troubleshooting

### Pod is stuck in `Pending`
```bash
kubectl describe pod <pod-name> -n data
```
Look for **Events** at the bottom. Common causes:
- **Insufficient resources** — the node doesn't have enough CPU/memory
- **PVC pending** — no PersistentVolume available to bind

### Pod is in `CrashLoopBackOff`
The container keeps starting and immediately crashing:
```bash
kubectl logs <pod-name> -n data --previous
```
The `--previous` flag shows logs from the **last crashed** container. Common causes:
- Wrong environment variables or missing secrets
- Database connection errors
- Image pull errors

### Can't connect to a service
```bash
# Check the service exists and has endpoints
kubectl get endpoints <service-name> -n data
```
If there are **0 endpoints**, the service can't find any Pods — check your `selector` labels match.

### Quick Health Check
```bash
# Are all pods running?
kubectl get pods -n data

# PostgreSQL responding?
kubectl exec -it postgres-0 -n data -- pg_isready

# RabbitMQ cluster healthy?
kubectl exec -it rabbitmq-0 -n data -- rabbitmq-diagnostics cluster_status

# PgBouncer connected to Postgres?
kubectl exec -it postgres-0 -n data -- psql -U saas_admin -d saas_db -c "SELECT 1;"
```

---

## Quick Reference: Deployment vs StatefulSet vs DaemonSet

| Feature | Deployment | StatefulSet | DaemonSet |
|---|---|---|---|
| **Best for** | Stateless apps | Databases, message queues | Log collectors, monitoring |
| **Pod names** | Random (`pgbouncer-7f8b9`) | Sequential (`rabbitmq-0`, `rabbitmq-1`) | One per node (`fluent-bit-abc`) |
| **Storage** | Shared or none | Each Pod gets its own persistent volume | Uses host volumes |
| **Startup order** | Any order | Sequential (0 → 1 → 2) | As nodes are added |
| **In our project** | PgBouncer | PostgreSQL, RabbitMQ | Fluent Bit |

---

*Created February 2026 — tailored for the Multi-Tenant SaaS project.*
