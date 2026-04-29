import { Request, Response } from "express";
import pool from "../config/database";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// ROLE MANAGEMENT — org-scoped custom roles
//
// Custom roles are currently **name + description only** (no permission
// mapping). The `permissions` / `role_permissions` machinery remains in the
// database for future use; re-attach by restoring the block marked
// LEGACY—ROLE-PERMISSIONS below and the permissionIds body fields.
// ---------------------------------------------------------------------------

export const listRoles = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const requestingUser = (req as any).user;

  // Super admin can list roles across orgs; all other user types are limited to their active org.
  if (requestingUser.user_type !== "super_admin" && requestingUser.org_id !== orgId) {
    res
      .status(403)
      .json({ success: false, message: "Access denied to this organization" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT
         r.id, r.name, r.description, r.is_system, r.organization_id, r.created_at
       FROM roles r
       WHERE r.organization_id = $1 OR (r.is_system = true AND r.organization_id IS NULL)
       ORDER BY r.is_system DESC, r.name ASC`,
      [orgId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listRoles error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }

  /* LEGACY—ROLE-PERMISSIONS: previous list with joined permissions
  const result = await pool.query(
    `SELECT
       r.id, r.name, r.description, r.is_system, r.organization_id, r.created_at,
       COALESCE(
         json_agg(
           DISTINCT jsonb_build_object('id', p.id, 'resource', p.resource, 'action', p.action, 'description', p.description)
         ) FILTER (WHERE p.id IS NOT NULL),
         '[]'
       ) as permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON r.id = rp.role_id
     LEFT JOIN permissions p ON rp.permission_id = p.id
     WHERE r.organization_id = $1 OR (r.is_system = true AND r.organization_id IS NULL)
     GROUP BY r.id, r.name, r.description, r.is_system, r.organization_id, r.created_at
     ORDER BY r.is_system DESC, r.name ASC`,
    [orgId],
  );
  */
};

export const createRole = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const { name, description } = req.body;
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type === "org_admin" &&
    requestingUser.org_id !== orgId
  ) {
    res
      .status(403)
      .json({ success: false, message: "Access denied to this organization" });
    return;
  }

  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: "Role name is required" });
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id FROM roles WHERE name = $1 AND organization_id = $2",
      [name.trim(), orgId],
    );
    if (existing.rows.length > 0) {
      res
        .status(409)
        .json({
          success: false,
          message: "A role with this name already exists in this organization",
        });
      return;
    }

    await client.query("BEGIN");

    const roleId = uuidv4();
    await client.query(
      `INSERT INTO roles (id, name, description, is_system, organization_id)
       VALUES ($1, $2, $3, false, $4)`,
      [roleId, name.trim(), description || null, orgId],
    );

    /* LEGACY—ROLE-PERMISSIONS: assign permissionIds from body
    const { permissionIds } = req.body;
    if (Array.isArray(permissionIds) && permissionIds.length > 0) {
      for (const permId of permissionIds) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permId],
        );
      }
    }
    */

    await client.query("COMMIT");

    const role = await pool.query(
      "SELECT id, name, description, is_system, organization_id, created_at FROM roles WHERE id = $1",
      [roleId],
    );
    res
      .status(201)
      .json({ success: true, message: "Role created", data: role.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("createRole error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

export const updateRole = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, id } = req.params;
  const { name, description } = req.body;
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type === "org_admin" &&
    requestingUser.org_id !== orgId
  ) {
    res
      .status(403)
      .json({ success: false, message: "Access denied to this organization" });
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id, is_system FROM roles WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );
    if (existing.rows.length === 0) {
      res
        .status(404)
        .json({
          success: false,
          message: "Role not found in this organization",
        });
      return;
    }
    if (existing.rows[0].is_system) {
      res
        .status(400)
        .json({ success: false, message: "System roles cannot be modified" });
      return;
    }

    await client.query("BEGIN");

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description);
    }

    if (updates.length > 0) {
      values.push(id);
      await client.query(
        `UPDATE roles SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
        values,
      );
    }

    /* LEGACY—ROLE-PERMISSIONS: sync permissionIds
    const { permissionIds } = req.body;
    if (Array.isArray(permissionIds)) {
      await client.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
      for (const permId of permissionIds) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, permId],
        );
      }
    }
    */

    await client.query("COMMIT");

    const role = await pool.query(
      "SELECT id, name, description, is_system, organization_id, created_at FROM roles WHERE id = $1",
      [id],
    );
    res.json({ success: true, message: "Role updated", data: role.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("updateRole error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

export const deleteRole = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, id } = req.params;
  const requestingUser = (req as any).user;

  if (
    requestingUser.user_type === "org_admin" &&
    requestingUser.org_id !== orgId
  ) {
    res
      .status(403)
      .json({ success: false, message: "Access denied to this organization" });
    return;
  }

  try {
    const existing = await pool.query(
      "SELECT id, is_system FROM roles WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );
    if (existing.rows.length === 0) {
      res
        .status(404)
        .json({
          success: false,
          message: "Role not found in this organization",
        });
      return;
    }
    if (existing.rows[0].is_system) {
      res
        .status(400)
        .json({ success: false, message: "System roles cannot be deleted" });
      return;
    }

    await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    res.json({ success: true, message: "Role deleted" });
  } catch (error) {
    console.error("deleteRole error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// PERMISSIONS — reference list (kept for future role-permission UI / other
// user types; not used by custom org role CRUD at this time)
// ---------------------------------------------------------------------------

export const listPermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, resource, action, description
       FROM permissions
       ORDER BY resource ASC, action ASC`,
    );
    const grouped: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!grouped[row.resource]) grouped[row.resource] = [];
      grouped[row.resource].push(row);
    }
    res.json({ success: true, data: result.rows, grouped });
  } catch (error) {
    console.error("listPermissions error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};