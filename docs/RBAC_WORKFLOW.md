# Multi-Tenant RBAC Workflow

This document outlines the design and implementation of the Role-Based Access Control (RBAC) system for the Multi-Tenant SaaS platform.

## 1. Data Model (Prisma)
The system uses a highly scalable many-to-many relationship structure to link Users, Organizations, and Permissions.

### Core Entities:
- **Organization**: The tenant (e.g., Customer A, Customer B).
- **User**: The global unique identity of an employee/client.
- **Role**: A collection of permissions (e.g., `TENANT_ADMIN`).
- **Permission**: Atomic actions (e.g., `agents:create`, `users:read`).
- **UserOrganizationRole**: The junction table that assigns a user a specific role *within* a specific organization.

## 2. Default Roles & Permissions
We have implemented a seeding strategy to ensure every new environment has standard security defaults.

| Role | Target Audience | Primary Permissions |
| :--- | :--- | :--- |
| **SUPER_ADMIN** | Platform Owners | `*` (Full System Access) |
| **TENANT_ADMIN** | Customer Admins | `org:read`, `users:manage`, `users:read` |
| **USER** | Standard Employees | `org:read`, `users:read` |

## 3. The Security Flow (Zero-Trust Architecture)

### Step 1: Federated Enrichment
When a user logs in, the **Auth Enrichment** layer queries the Prisma DB to find all roles associated with the user for their current organization. These are flattened into a single list.

### Step 2: Enriched JWT Generation
The system generates a JWT containing:
- `org_id`: The current tenant context.
- `permissions`: The flattened list of allowed actions.
- `exp`: **60 Minutes** (Security Policy: Tokens expire after 1 hour of inactivity).

### Step 3: API Gateway Authorization
Every request is intercepted by a **Lambda Authorizer**.
- Validates the JWT signature.
- Rejects expired or tampered tokens.
- Forwards the `org_id` and `permissions` to the downstream services via the `requestContext`.

### Step 4: Orchestrator Evaluation
The **Agent Orchestrator** performs the final check. Before executing any business logic, it verifies that the `permissions` list in the context strictly matches the required action for that specific API path.

---
*Created by [Your Name/Team] - Day 4 Infrastructure Phase*
