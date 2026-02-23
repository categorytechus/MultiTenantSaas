# Multi-Tenant SaaS Design & Architecture

This document provides a comprehensive overview of the system architecture for the Multi-Tenant SaaS platform, covering infrastructure, security, and application layers.

## 1. System Overview
The platform is designed to support multiple independent organizations (tenants) with high availability, security, and scalability. It leverages a hybrid cloud/Kubernetes approach to optimize costs and performance.

## 2. Infrastructure Layer (AWS + Kubernetes)
- **AWS Provisioning**: Managed via **Terraform** for reproducible environments.
- **Compute**: A **t3.medium** EC2 instance running **k3s** (lightweight Kubernetes).
- **Network**: Custom VPC with public subnets, secured via Security Groups.
- **Auto-Shutdown**: CloudWatch Alarm automatically stops the instance after 60 minutes of inactivity (CPU < 5%) to minimize costs.
- **SSH Access**: Secured via a dedicated RSA-4096 key pair (`.pem` file), with SSM integration for console access.

## 3. Data & Messaging Layer
- **PostgreSQL (v15)**: Deployed as a StatefulSet with persistent storage and headless services for internal cluster communication.
- **PgBouncer**: Acts as a connection pooler to manage database connections efficiently across Lambdas and Frontend.
- **RabbitMQ**: A robust 3-node cluster with k8s peer discovery for asynchronous task orchestration.
- **Secrets Management**: AWS Secrets Manager synchronizes sensitive credentials (DB passwords, JWT keys) directly into Kubernetes Secrets.

## 4. Security & Multi-Tenancy (RBAC)
- **Data Model**: Prisma-based multi-tenant schema that strictly links Users and Roles to an `Organization`.
- **Lambda Authorizer**: Intercepts all API Gateway calls to validate **Enriched JWTs**.
- **Enriched JWTs**: Contains the user's `org_id` and flattened `permissions`. Tokens are set to expire after **60 minutes** of inactivity.
- **Zero-Trust Validation**: Permissions are validated twice—once at the API Gateway (Authorizer) and once at the service layer (Orchestrator).

## 5. API & Orchestration Layer
- **API Gateway**: Hybrid REST (/api/*) and WebSocket (task-status) entry points.
- **Agent Orchestrator**: A specialized Lambda that receives authorized requests, evaluates fine-grained permissions, and coordinates tasks (via RabbitMQ).
- **Front-end**: Next.js 16 application with App Router, using Prisma for secure database interaction.

## 6. Observability
- **Logging**: Fluent Bit daemonset on Kubernetes pushes all cluster logs to **AWS CloudWatch**.
- **Audit**: **AWS CloudTrail** logs all infrastructure mutations to an S3 bucket for compliance and security auditing.

---
*Last Updated: February 2026*
