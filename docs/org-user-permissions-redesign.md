# Org / User / Permission Management — Redesign Plan

## Problems Being Solved

### 1. Module metadata is hardcoded in the frontend
`CHILDREN_OF`, `PARENT_OF`, `TOP_LEVEL_ORDER` in `org-permissions/[orgId]/page.tsx` must be manually updated every time a new module is added. Adding `api_calling` required code changes in multiple files. The DB (`master_modules`) has no concept of hierarchy, display order, or description.

### 2. Permissions for new modules are not auto-seeded
Each new module requires its own migration to insert rows into `permissions` and `role_permissions`. There is no convention — it is done ad-hoc. `tenant_admin` role must also be manually granted each new permission (migration 040 did this retroactively). The `_MODULES` dict in `tenant_org_routes.py` and `default_descriptions` dict in `admin.py` are both hardcoded copies of the same data.

### 3. Org-enabled modules and role permissions are disconnected
When a super admin enables `api_calling` for an org, the org members' roles are not automatically checked or updated. Whether a user can act on a module depends on `role_permissions` / `user_roles` — these are never synced with `org_modules`. A user could have a `documents:upload` permission grant but the org has `documents` disabled: both layers are checked independently and only one check may fail.

### 4. New features require changes in 5+ places
Currently adding a module requires:
- New migration for `master_modules`
- New migration for `permissions` rows
- New migration for `role_permissions` grants
- Update `_MODULES` in `tenant_org_routes.py`
- Update `default_descriptions` in `admin.py`
- Update `CHILDREN_OF` / `PARENT_OF` / `TOP_LEVEL_ORDER` in frontend
- Update `Layout.tsx` nav gating

The goal: adding a new module should require **only a migration** (plus a new page/component for the feature itself).

---

## Target Architecture

```
master_modules          ← single source of truth for all feature metadata
  id, label, description, parent_id, sort_order, permission_keys[], is_enabled_globally

module_permissions      ← which permission rows belong to each module (auto-seeded)
  module_id → permissions (resource:action)

org_modules             ← which modules a given org has access to (unchanged)
  org_id, module_id

user_roles + role_permissions  ← what a specific user can DO within a module
  (unchanged structure, but grants auto-derived from org_modules on enable)
```

The key change: **`master_modules` becomes the registry**. All other data derives from it.

---

## Phase 1 — Enrich `master_modules` (DB Migration)

### 1a. Add columns to `master_modules`

```sql
ALTER TABLE master_modules
  ADD COLUMN label         VARCHAR(120),           -- display name ("AI Assistant")
  ADD COLUMN description   TEXT,                   -- shown in org-permissions UI
  ADD COLUMN parent_id     VARCHAR(50) REFERENCES master_modules(id) ON DELETE SET NULL,
  ADD COLUMN sort_order    INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN permission_keys TEXT[] NOT NULL DEFAULT '{}';
  -- permission_keys: e.g. ARRAY['ai_assistant:chat'] — the permission rows this module owns
```

### 1b. Backfill existing modules

```sql
UPDATE master_modules SET
  label = 'AI Assistant',
  description = 'AI assistant tools and chat capabilities.',
  parent_id = NULL, sort_order = 1,
  permission_keys = ARRAY['ai_assistant:chat']
WHERE id = 'ai_assistant';

UPDATE master_modules SET
  label = 'Images',
  description = 'Image embedding in chat.',
  parent_id = 'ai_assistant', sort_order = 2,
  permission_keys = ARRAY[]::TEXT[]
WHERE id = 'ai_images';

UPDATE master_modules SET
  label = 'Links',
  description = 'Link embeddings in chat.',
  parent_id = 'ai_assistant', sort_order = 3,
  permission_keys = ARRAY[]::TEXT[]
WHERE id = 'ai_links';

UPDATE master_modules SET
  label = 'Report Generation',
  description = 'Generate PDF reports in chat.',
  parent_id = 'ai_assistant', sort_order = 4,
  permission_keys = ARRAY[]::TEXT[]
WHERE id = 'report_generation';

UPDATE master_modules SET
  label = 'Cost Segregation',
  description = 'IRS MACRS cost segregation classification.',
  parent_id = NULL, sort_order = 10,
  permission_keys = ARRAY['cost_seg:read', 'cost_seg:create', 'cost_seg:delete']
WHERE id = 'cost_seg';

UPDATE master_modules SET
  label = 'Documents',
  description = 'Document library and document actions.',
  parent_id = NULL, sort_order = 20,
  permission_keys = ARRAY['documents:view','documents:create','documents:upload','documents:update','documents:delete']
WHERE id = 'documents';

UPDATE master_modules SET
  label = 'Web URLs',
  description = 'Manage web URL records and sources.',
  parent_id = NULL, sort_order = 30,
  permission_keys = ARRAY['web_urls:view','web_urls:create','web_urls:update','web_urls:delete']
WHERE id = 'web_urls';

UPDATE master_modules SET
  label = 'API Calling',
  description = 'Enable outbound API actions and webhook integrations.',
  parent_id = NULL, sort_order = 40,
  permission_keys = ARRAY['api_calling:execute']
WHERE id = 'api_calling';
```

### 1c. Update the SQLModel

```python
class MasterModule(SQLModel, table=True):
    __tablename__ = "master_modules"

    id: str = Field(primary_key=True, max_length=50)
    name: str = Field(nullable=False, max_length=120)       # internal name (unchanged)
    label: str | None = Field(default=None, max_length=120) # display name
    description: str | None = Field(default=None)
    parent_id: str | None = Field(default=None, foreign_key="master_modules.id")
    sort_order: int = Field(default=100)
    permission_keys: list[str] = Field(default_factory=list, sa_column=Column(ARRAY(String)))
    enabled: bool = Field(default=True, nullable=False)
    created_at: datetime = ...
```

---

## Phase 2 — Module Tree API

Replace the hardcoded `CHILDREN_OF` / `PARENT_OF` / `TOP_LEVEL_ORDER` in the frontend with a single API call.

### 2a. New endpoint: `GET /admin/modules`

Returns the full module tree for super-admin UI (org-permissions page):

```python
@router.get("/modules")
async def list_master_modules(ctx = Depends(require_super_admin)):
    modules = await session.execute(
        select(MasterModule)
        .where(MasterModule.enabled == True)
        .order_by(MasterModule.sort_order)
    )
    return {"data": [
        {
            "id": m.id,
            "label": m.label or m.name,
            "description": m.description or "",
            "parent_id": m.parent_id,
            "sort_order": m.sort_order,
        }
        for m in modules.scalars()
    ]}
```

### 2b. Update `GET /admin/organizations/{org_id}/modules`

Already fetches from `master_modules` + `org_modules`. Enrich with `label`, `description`, `parent_id` from the master record:

```python
# Replace default_descriptions dict with data from master_modules columns
return ModuleItem(
    id=m.id,
    label=m.label or m.name,
    description=m.description or "",
    parent_id=m.parent_id,
    enabled=(m.id in assigned_module_ids),
)
```

### 2c. Frontend — remove all hardcoded constants

Delete `CHILDREN_OF`, `PARENT_OF`, `TOP_LEVEL_ORDER` from `org-permissions/[orgId]/page.tsx`. Replace with:

```typescript
// Fetched once on load alongside module list
const [moduleTree, setModuleTree] = useState<ModuleTreeItem[]>([]);

// Derive hierarchy from parent_id in the API response
const childrenOf = (parentId: string) =>
  modules.filter(m => m.parent_id === parentId);
const topLevel = modules
  .filter(m => !m.parent_id)
  .sort((a, b) => a.sort_order - b.sort_order);
```

---

## Phase 3 — Auto-seed Permissions

### 3a. Convention for permission IDs

All permission rows have deterministic IDs based on `resource:action`. This lets migrations be idempotent:

```python
def perm_id(resource: str, action: str) -> str:
    # SHA-256 truncated to UUID format, stable across environments
    import hashlib, uuid
    h = hashlib.sha256(f"{resource}:{action}".encode()).hexdigest()
    return str(uuid.UUID(h[:32]))
```

### 3b. `auto_seed_module_permissions()` helper

Called at the end of every migration that adds a new module. Seeds `permissions` rows and grants them to the `tenant_admin` system role:

```python
def auto_seed_module_permissions(module_id: str, permission_keys: list[str]) -> None:
    """Seed permissions + tenant_admin grants for a new module."""
    for key in permission_keys:
        resource, action = key.split(":", 1)
        pid = perm_id(resource, action)
        op.execute(f"""
            INSERT INTO permissions (id, resource, action, description, created_at)
            VALUES ('{pid}', '{resource}', '{action}', '{module_id} {action}', NOW())
            ON CONFLICT (resource, action) DO NOTHING
        """)
        op.execute(f"""
            INSERT INTO role_permissions (id, role_id, permission_id, created_at)
            SELECT gen_random_uuid(), r.id, '{pid}', NOW()
            FROM roles r
            WHERE r.name IN ('tenant_admin', 'org_admin') AND r.is_system = TRUE
            ON CONFLICT DO NOTHING
        """)
```

### 3c. Future module migrations use the helper

```python
# 041_add_reporting_module.py
def upgrade():
    op.execute("INSERT INTO master_modules ...")
    auto_seed_module_permissions("reporting", ["reporting:view", "reporting:export"])
```

---

## Phase 4 — On-Enable Permission Sync

When super admin enables a module for an org (PUT `/admin/organizations/{id}/modules`), automatically ensure all org members who can access the module have the necessary permissions.

### 4a. `sync_org_role_grants()` — called on module enable

```python
async def sync_org_role_grants(session, org_id: UUID, module_ids: list[str]) -> None:
    """
    For each newly enabled module, ensure the org_admin role in that org has
    the module's permission grants in role_permissions (global) or role_org_permissions.
    Nothing needs to change for end users — their role_permissions already cover it
    at the system level via tenant_admin grants.
    """
    # Fetch permission_keys for the enabled modules from master_modules
    result = await session.execute(
        select(MasterModule.permission_keys)
        .where(MasterModule.id.in_(module_ids))
    )
    all_keys = [key for row in result.all() for key in (row[0] or [])]

    for key in all_keys:
        resource, action = key.split(":", 1)
        # Ensure the permission row exists
        perm = await ensure_permission(session, resource, action)
        # Grant to tenant_admin system role (idempotent)
        await ensure_role_permission(session, role_name="tenant_admin", permission_id=perm.id)
```

### 4b. Admin endpoint update

```python
@router.put("/organizations/{org_id}/modules")
async def set_org_modules(org_id, body, session, ctx):
    # ... existing logic to update org_modules ...
    newly_enabled = set(body.moduleIds) - set(previously_enabled)
    if newly_enabled:
        await sync_org_role_grants(session, org_id, list(newly_enabled))
    return {"success": True}
```

---

## Phase 5 — Role Permissions Page (Org Admin UI)

The roles page at `/roles/{id}/permissions` currently uses a hardcoded `_MODULES` dict in `tenant_org_routes.py`. This should derive from the modules enabled for the org.

### 5a. Update `GET /organizations/{org_id}/roles/{role_id}/permissions`

```python
# Instead of hardcoded _MODULES dict:
enabled_modules = await session.execute(
    select(MasterModule)
    .join(OrgModule, OrgModule.module_id == MasterModule.id)
    .where(OrgModule.org_id == org_id, MasterModule.enabled == True)
    .order_by(MasterModule.sort_order)
)
# Build the permissions view from master_modules.permission_keys
```

This means the permissions page automatically shows only the modules enabled for that org, and automatically includes new modules when they're enabled.

### 5b. Remove `_MODULES` dict from `tenant_org_routes.py`

The `_MODULES` constant currently has `ai_assistant`, `documents`, `web_urls` only — missing `api_calling`, `cost_seg`, etc. With the DB-driven approach, all modules appear automatically.

---

## Phase 6 — Layout Nav Hardcoding

`Layout.tsx` currently gates nav items with `hasModule("api_calling")` hardcoded per-item. This is fine for feature-level gating, but the module IDs themselves should not be magic strings scattered through the code.

### 6a. Central module ID constants

```typescript
// src/lib/module-ids.ts
export const MODULE = {
  AI_ASSISTANT: "ai_assistant",
  AI_IMAGES: "ai_images",
  AI_LINKS: "ai_links",
  REPORT_GENERATION: "report_generation",
  COST_SEG: "cost_seg",
  DOCUMENTS: "documents",
  WEB_URLS: "web_urls",
  API_CALLING: "api_calling",
} as const;
```

Usage: `hasModule(MODULE.API_CALLING)` — one refactor, consistent everywhere.

### 6b. Nav items driven by module registry (optional, longer term)

For a fully dynamic nav, `Layout.tsx` could fetch the module tree and render nav items from a config that maps `module_id → { href, label, icon }`. New modules get a nav entry without a code change.

---

## Migration Execution Order

```
041_enrich_master_modules.py          — adds columns, backfills existing rows
042_seed_missing_module_permissions.py — seeds permissions for api_calling, cost_seg, etc.
                                         that currently have no permission rows
043_remove_legacy_hardcoded_grants.py  — optional cleanup of orphaned grants
```

---

## What Stays The Same

- `org_modules` table — no change
- `user_roles` + `role_permissions` + `role_org_permissions` — no change to structure
- `OrgMembership.role` as the JWT base role — no change
- `authorize("resource:action")` FastAPI dependency — no change
- `hasModule("id")` frontend check — no change (just uses a constant instead of a string literal)

---

## Checklist for Adding a New Module

After this plan is implemented, adding a new module requires:

- [ ] New migration: `INSERT INTO master_modules` with `label`, `description`, `parent_id`, `sort_order`, `permission_keys`
- [ ] Call `auto_seed_module_permissions()` in the same migration
- [ ] Add module ID constant to `src/lib/module-ids.ts`
- [ ] Build the feature page/component
- [ ] Add nav entry in `Layout.tsx` with `hasModule(MODULE.NEW_MODULE)` guard (or it appears automatically if using dynamic nav)

No changes needed to: `CHILDREN_OF`, `PARENT_OF`, `TOP_LEVEL_ORDER`, `_MODULES` dict, `default_descriptions` dict, or `role_permissions` tables.

---

## Summary of Files Changed Per Phase

| Phase | Server Files | Frontend Files |
|-------|-------------|----------------|
| 1 — Enrich master_modules | `models/master_module.py`, new migration | — |
| 2 — Module Tree API | `api/admin.py`, `tenant_org_routes.py` | `org-permissions/[orgId]/page.tsx` |
| 3 — Auto-seed permissions | New migration helper, each module migration | — |
| 4 — On-enable sync | `api/admin.py`, new `services/module_sync.py` | — |
| 5 — Role perms page | `tenant_org_routes.py` (remove `_MODULES` dict) | `roles/[id]/permissions/page.tsx` |
| 6 — Nav constants | — | `src/lib/module-ids.ts`, `Layout.tsx` |
