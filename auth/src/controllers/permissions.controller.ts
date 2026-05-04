import { Request, Response } from "express";
import pool from "../config/database";

// ---------------------------------------------------------------------------
// Module catalog — static definition of all available modules + sub-permissions
// ---------------------------------------------------------------------------

const MODULE_CATALOG = [
  {
    id: "ai_assistant",
    label: "AI Assistant",
    description: "AI-powered chat and assistant features",
    permissions: [
      { id: "ai_assistant:chat", label: "Chat", description: "Access AI chat" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    description: "Document management and collaboration",
    permissions: [
      { id: "documents:view", label: "View", description: "View documents" },
      { id: "documents:create", label: "Create", description: "Create new documents" },
      { id: "documents:update", label: "Update", description: "Edit existing documents" },
      { id: "documents:delete", label: "Delete", description: "Delete documents" },
      { id: "documents:upload", label: "Upload", description: "Upload files" },
    ],
  },
  {
    id: "web_urls",
    label: "Web URLs",
    description: "Web URL management and crawling",
    permissions: [
      { id: "web_urls:view", label: "View", description: "View web URLs" },
      { id: "web_urls:create", label: "Create", description: "Add new web URLs" },
      { id: "web_urls:update", label: "Update", description: "Edit web URLs" },
      { id: "web_urls:delete", label: "Delete", description: "Delete web URLs" },
    ],
  },
];

// ---------------------------------------------------------------------------
// GET /admin/permissions/modules — super admin: full catalog
// ---------------------------------------------------------------------------

export const getModuleCatalog = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  res.json({ success: true, data: MODULE_CATALOG });
};

// ---------------------------------------------------------------------------
// GET /admin/organizations/:orgId/modules — super admin: which modules are enabled
// ---------------------------------------------------------------------------

export const getOrgModules = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;

  try {
    const result = await pool.query(
      "SELECT module_id FROM org_modules WHERE org_id = $1",
      [orgId],
    );

    const enabledModuleIds = result.rows.map((r: any) => r.module_id);

    const data = MODULE_CATALOG.map((m) => ({
      ...m,
      enabled: enabledModuleIds.includes(m.id),
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error("getOrgModules error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// PUT /admin/organizations/:orgId/modules — super admin: update enabled modules
// ---------------------------------------------------------------------------

export const updateOrgModules = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const { moduleIds } = req.body; // string[] of module ids to enable
  const assignedBy = (req as any).user?.sub;

  if (!Array.isArray(moduleIds)) {
    res.status(400).json({ success: false, message: "moduleIds must be an array" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Remove all existing module assignments for this org
    await client.query("DELETE FROM org_modules WHERE org_id = $1", [orgId]);

    // Insert new ones
    for (const moduleId of moduleIds) {
      if (MODULE_CATALOG.some((m) => m.id === moduleId)) {
        await client.query(
          `INSERT INTO org_modules (org_id, module_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (org_id, module_id) DO NOTHING`,
          [orgId, moduleId, assignedBy],
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Organization modules updated",
      data: { enabled_modules: moduleIds },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("updateOrgModules error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/modules — org admin: modules available to the org
// ---------------------------------------------------------------------------

export const getOrgModulesForAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type !== "super_admin" &&
    !requestingUser.roles?.includes("org_admin") &&
    requestingUser.org_id !== orgId
  ) {
    res.status(403).json({ success: false, message: "Access denied" });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT module_id FROM org_modules WHERE org_id = $1",
      [orgId],
    );

    const enabledModuleIds = result.rows.map((r: any) => r.module_id);

    // Only return modules that are enabled for this org
    const data = MODULE_CATALOG.filter((m) =>
      enabledModuleIds.includes(m.id),
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error("getOrgModulesForAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/roles/:roleId/permissions — org admin: role's granted permissions
// ---------------------------------------------------------------------------

export const getRolePermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, roleId } = req.params;
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type !== "super_admin" &&
    !requestingUser.roles?.includes("org_admin") &&
    requestingUser.org_id !== orgId
  ) {
    res.status(403).json({ success: false, message: "Access denied" });
    return;
  }

  try {
    // Modules available to this org
    const modulesResult = await pool.query(
      "SELECT module_id FROM org_modules WHERE org_id = $1",
      [orgId],
    );
    const enabledModuleIds = modulesResult.rows.map((r: any) => r.module_id);

    // System org_admin has implicit full access to every sub-permission in enabled modules
    const orgAdminRole = await pool.query(
      `SELECT id FROM roles WHERE id = $1 AND name = 'org_admin' AND is_system = true LIMIT 1`,
      [roleId],
    );
    const isSystemOrgAdmin = orgAdminRole.rows.length > 0;

    const permResult = await pool.query(
      "SELECT permission_id FROM role_org_permissions WHERE role_id = $1 AND org_id = $2",
      [roleId, orgId],
    );
    const grantedPermIds = permResult.rows.map((r: any) => r.permission_id);

    const data = MODULE_CATALOG.filter((m) =>
      enabledModuleIds.includes(m.id),
    ).map((m) => ({
      ...m,
      permissions: m.permissions.map((p) => ({
        ...p,
        granted: isSystemOrgAdmin || grantedPermIds.includes(p.id),
      })),
    }));

    const allGrantedIds = isSystemOrgAdmin
      ? data.flatMap((mod) => mod.permissions.map((p) => p.id))
      : grantedPermIds;

    res.json({
      success: true,
      data,
      granted_permissions: allGrantedIds,
      is_system_org_admin: isSystemOrgAdmin,
    });
  } catch (error) {
    console.error("getRolePermissions error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/my-permissions — any authenticated user: own permissions
// ---------------------------------------------------------------------------

export const getMyPermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const requestingUser = (req as any).user;

  try {
    // Org admins and super admins have access to all enabled modules
    if (
      requestingUser.user_type === "super_admin" ||
      requestingUser.roles?.includes("org_admin")
    ) {
      const result = await pool.query(
        "SELECT module_id FROM org_modules WHERE org_id = $1",
        [orgId],
      );
      const enabledModuleIds = result.rows.map((r: any) => r.module_id);
      const allPermIds: string[] = [];
      for (const m of MODULE_CATALOG) {
        if (enabledModuleIds.includes(m.id)) {
          m.permissions.forEach((p) => allPermIds.push(p.id));
        }
      }
      res.json({
        success: true,
        data: { permissions: allPermIds, modules: enabledModuleIds },
      });
      return;
    }

    // Regular user — collect roles in this org, then aggregate permissions
    const userId = requestingUser.sub;
    const rolesRes = await pool.query(
      `SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = $1 AND ur.org_id = $2`,
      [userId, orgId],
    );
    const roleIds = rolesRes.rows.map((r: any) => r.role_id);

    if (roleIds.length === 0) {
      res.json({ success: true, data: { permissions: [], modules: [] } });
      return;
    }

    const permRes = await pool.query(
      `SELECT DISTINCT permission_id FROM role_org_permissions WHERE role_id = ANY($1) AND org_id = $2`,
      [roleIds, orgId],
    );
    const permIds: string[] = permRes.rows.map((r: any) => r.permission_id);
    const moduleIds = [...new Set(permIds.map((p) => p.split(":")[0]))];

    res.json({ success: true, data: { permissions: permIds, modules: moduleIds } });
  } catch (error) {
    console.error("getMyPermissions error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// PUT /organizations/:orgId/roles/:roleId/permissions — org admin: update role permissions
// ---------------------------------------------------------------------------

export const updateRolePermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, roleId } = req.params;
  const { permissionIds } = req.body; // string[] of permission ids to grant
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type !== "super_admin" &&
    !requestingUser.roles?.includes("org_admin") &&
    requestingUser.org_id !== orgId
  ) {
    res.status(403).json({ success: false, message: "Access denied" });
    return;
  }

  if (!Array.isArray(permissionIds)) {
    res.status(400).json({ success: false, message: "permissionIds must be an array" });
    return;
  }

  const orgAdminRole = await pool.query(
    `SELECT id FROM roles WHERE id = $1 AND name = 'org_admin' AND is_system = true LIMIT 1`,
    [roleId],
  );
  if (orgAdminRole.rows.length > 0) {
    res.status(400).json({
      success: false,
      message:
        "The Organization Admin role has full access within modules assigned to this org. Its permissions cannot be edited here.",
    });
    return;
  }

  // Validate that all requested permissions belong to modules enabled for this org
  const client = await pool.connect();
  try {
    const modulesResult = await client.query(
      "SELECT module_id FROM org_modules WHERE org_id = $1",
      [orgId],
    );
    const enabledModuleIds = modulesResult.rows.map((r: any) => r.module_id);

    const allowedPermIds = new Set<string>();
    for (const m of MODULE_CATALOG) {
      if (enabledModuleIds.includes(m.id)) {
        m.permissions.forEach((p) => allowedPermIds.add(p.id));
      }
    }

    const validPermIds = permissionIds.filter((p: string) => allowedPermIds.has(p));

    await client.query("BEGIN");

    // Remove all existing permissions for this role in this org
    await client.query(
      "DELETE FROM role_org_permissions WHERE role_id = $1 AND org_id = $2",
      [roleId, orgId],
    );

    // Insert granted ones
    const grantedBy = requestingUser?.sub;
    for (const permId of validPermIds) {
      await client.query(
        `INSERT INTO role_org_permissions (role_id, org_id, permission_id, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (role_id, org_id, permission_id) DO NOTHING`,
        [roleId, orgId, permId, grantedBy],
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Role permissions updated",
      data: { granted_permissions: validPermIds },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("updateRolePermissions error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};