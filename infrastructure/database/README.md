# Database Schema & Migrations

This directory contains PostgreSQL database schema, migrations, and seed data for the Multi-Tenant SaaS Platform.

## Directory Structure
```
database/
├── migrations/          # Database schema migrations (apply in order)
│   ├── 001_extensions.sql
│   ├── 002_core_schema.sql
│   └── 003_rls_policies.sql
├── seeds/              # Sample data for development/testing
│   ├── 001_sample_data.sql
│   └── 002_test_rls.sql
└── README.md
```

## Quick Start

### 1. Apply Migrations (In Order)
```bash
# Connect to your PostgreSQL database
psql postgresql://postgres:password@localhost:5432/multitenant_saas

# Apply migrations in order
\i infrastructure/database/migrations/001_extensions.sql
\i infrastructure/database/migrations/002_core_schema.sql
\i infrastructure/database/migrations/003_rls_policies.sql
```

### 2. Load Sample Data (Development Only)
```bash
# Load sample organizations, users, roles, and permissions
\i infrastructure/database/seeds/001_sample_data.sql
```

### 3. Test RLS Policies
```bash
# Run RLS validation tests
\i infrastructure/database/seeds/002_test_rls.sql
```

## Schema Overview

### Core Tables

#### Organizations & Tenancy
- **organizations** - Multi-tenant organizations
- **organization_members** - User membership in organizations

#### Users & Authentication
- **users** - User accounts (mirrors Cognito)
- **sessions** - Active user sessions

#### RBAC (Role-Based Access Control)
- **roles** - System and custom roles
- **permissions** - Granular permissions (resource + action)
- **role_permissions** - Role-to-permission mappings
- **user_roles** - User role assignments per organization

#### AI Agents
- **agent_tasks** - Queued and executing agent tasks
- **agent_results** - Agent execution results

#### Audit & Compliance
- **audit_logs** - System-wide audit trail

### Row Level Security (RLS)

All org-scoped tables have RLS policies to ensure:
- Users can only see data from their organizations
- Permission-based access control for sensitive operations
- Session isolation per user
- Comprehensive audit logging

### Key Features

#### 1. Multi-Tenant Isolation
```sql
-- Users automatically see only their org's data
SET app.current_user_id = '<user-uuid>';
SELECT * FROM agent_tasks;  -- Only returns tasks from user's orgs
```

#### 2. Permission System
```sql
-- Check if user has permission
SELECT user_has_permission(
    '<user-uuid>',
    '<org-uuid>',
    'agents',
    'run'
);
```

#### 3. Automatic Timestamps
All tables with `updated_at` automatically update via triggers.

## Sample Data

The seed data creates:

### Organizations
- **Acme Corporation** (enterprise)
- **Tech Startup Inc** (pro)
- **Healthcare Co** (free)

### Users
- **Alice** (alice@acme.com) - Admin at Acme Corp
- **Bob** (bob@acme.com) - Member at Acme Corp
- **Charlie** (charlie@techstartup.io) - Admin at Tech Startup
- **Diana** (diana@healthcare.com) - Admin at Healthcare Co

### Roles
- **super_admin** - Full system access
- **org_admin** - Organization administrator
- **org_member** - Regular member
- **agent_user** - Can run AI agents

## Testing RLS Policies

The test script validates:
- ✅ Alice sees only Acme Corp data
- ✅ Charlie sees only Tech Startup data
- ✅ Bob cannot see Charlie's data (cross-org isolation)
- ✅ Users see only their own sessions
- ✅ Permission-based updates work correctly

## Production Deployment

### Using Docker/Kubernetes
```bash
# Apply migrations via init container
kubectl exec -it postgres-pod -- psql -U postgres -d multitenant_saas \
  -f /migrations/001_extensions.sql

# Or use Flyway/Liquibase for automated migrations
```

### Using Terraform

The migrations can be applied via Terraform using the `postgresql` provider:
```hcl
resource "postgresql_database" "main" {
  name = "multitenant_saas"
}

resource "null_resource" "db_migrations" {
  provisioner "local-exec" {
    command = "psql ${var.database_url} -f infrastructure/database/migrations/001_extensions.sql"
  }
}
```

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never disable RLS** - All production tables must have RLS enabled
2. **Service Role** - Only use `service_role` for system operations
3. **User Context** - Always set `app.current_user_id` before queries
4. **Secrets** - Never commit database passwords or connection strings
5. **Audit Logs** - Keep audit logs for compliance (minimum 90 days)

## Extension Requirements

- **uuid-ossp** - UUID generation
- **vector** - pgvector for AI embeddings (version 0.5.0+)
- **pgcrypto** - Cryptographic functions
- **citext** - Case-insensitive text
- **btree_gist** - Advanced indexing

## Connection String Format
```
postgresql://username:password@hostname:5432/multitenant_saas?sslmode=require
```

## Troubleshooting

### Issue: RLS policies blocking legitimate queries
**Solution:** Ensure `app.current_user_id` is set:
```sql
SET app.current_user_id = '<user-uuid>';
```

### Issue: Extension not found
**Solution:** Install PostgreSQL contrib packages:
```bash
apt-get install postgresql-contrib
```

### Issue: Permission denied on migrations
**Solution:** Run as database superuser or grant appropriate privileges

## Maintenance

### Backup
```bash
pg_dump -Fc multitenant_saas > backup.dump
```

### Restore
```bash
pg_restore -d multitenant_saas backup.dump
```

### Cleanup Test Data
```sql
DELETE FROM organizations WHERE slug LIKE '%acme%';
```

## Next Steps

- [ ] Apply migrations to development database
- [ ] Run RLS validation tests
- [ ] Configure connection pooling (PgBouncer)
- [ ] Set up automated backups
- [ ] Configure monitoring and alerts

---

**Last Updated:** Day 3 - Database Schema Implementation
**Version:** 1.0.0