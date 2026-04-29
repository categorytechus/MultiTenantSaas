import { Request, Response } from "express";
import pool from "../config/database";
import { hashPassword, validatePasswordStrength } from "../utils/password";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// SUPER ADMIN MANAGEMENT (super_admin only)
// ---------------------------------------------------------------------------

export const listSuperAdmins = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, avatar_url, status, user_type, created_at, last_login_at
       FROM users
       WHERE user_type = 'super_admin' AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listSuperAdmins error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const createSuperAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    res.status(400).json({
      success: false,
      message: "email, password, and name are required",
    });
    return;
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    res.status(400).json({
      success: false,
      message: "Password does not meet requirements",
      errors: passwordValidation.errors,
    });
    return;
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`;

    await pool.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        cognitoSub,
        email.toLowerCase(),
        true,
        name,
        "active",
        hashedPassword,
        "super_admin",
      ],
    );

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [userId],
    );
    res.status(201).json({
      success: true,
      message: "Super admin created",
      data: user.rows[0],
    });
  } catch (error) {
    console.error("createSuperAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateSuperAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const { name, status } = req.body;

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND user_type = 'super_admin' AND deleted_at IS NULL",
      [id],
    );
    if (existing.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Super admin not found" });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name !== undefined) {
      updates.push(`full_name = $${i++}`);
      values.push(name);
    }
    if (status !== undefined) {
      updates.push(`status = $${i++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
      values,
    );

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [id],
    );
    res.json({
      success: true,
      message: "Super admin updated",
      data: user.rows[0],
    });
  } catch (error) {
    console.error("updateSuperAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteSuperAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const requesterId = (req as any).user?.sub;

  if (id === requesterId) {
    res
      .status(400)
      .json({ success: false, message: "Cannot delete your own account" });
    return;
  }

  try {
    const result = await pool.query(
      "UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = $1 AND user_type = 'super_admin' AND deleted_at IS NULL RETURNING id",
      [id],
    );
    if (result.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Super admin not found" });
      return;
    }
    res.json({ success: true, message: "Super admin deleted" });
  } catch (error) {
    console.error("deleteSuperAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// ORGANIZATION MANAGEMENT (super_admin only)
// ---------------------------------------------------------------------------

export const listAllOrganizations = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { search } = req.query;
  try {
    const conditions = ["o.status != 'deleted'"];
    const values: any[] = [];
    let i = 1;
    if (search) {
      conditions.push(`(o.name ILIKE $${i} OR o.slug ILIKE $${i})`);
      values.push(`%${search}%`);
      i++;
    }
    const result = await pool.query(
      `SELECT
         o.id, o.name, o.slug, o.domain, o.status, o.subscription_tier, o.created_at,
         COUNT(DISTINCT om.user_id) FILTER (WHERE om.status = 'active') as member_count
       FROM organizations o
       LEFT JOIN organization_members om ON o.id = om.organization_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      values,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listAllOrganizations error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const createOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { name, domain, subscriptionTier } = req.body;
  if (!name || !name.trim()) {
    res
      .status(400)
      .json({ success: false, message: "Organization name is required" });
    return;
  }
  try {
    const orgId = uuidv4();
    const slug =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 60) +
      "-" +
      orgId.substring(0, 8);

    await pool.query(
      `INSERT INTO organizations (id, name, slug, domain, status, subscription_tier)
       VALUES ($1, $2, $3, $4, 'active', $5)`,
      [orgId, name.trim(), slug, domain || null, subscriptionTier || "free"],
    );
    const org = await pool.query(
      "SELECT id, name, slug, domain, status, subscription_tier, created_at FROM organizations WHERE id = $1",
      [orgId],
    );
    res.status(201).json({
      success: true,
      message: "Organization created",
      data: org.rows[0],
    });
  } catch (error) {
    console.error("createOrganization error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const { name, domain, status, subscriptionTier } = req.body;
  try {
    const existing = await pool.query(
      "SELECT id FROM organizations WHERE id = $1 AND status != 'deleted'",
      [id],
    );
    if (existing.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(name.trim());
    }
    if (domain !== undefined) {
      updates.push(`domain = $${i++}`);
      values.push(domain);
    }
    if (status !== undefined) {
      updates.push(`status = $${i++}`);
      values.push(status);
    }
    if (subscriptionTier !== undefined) {
      updates.push(`subscription_tier = $${i++}`);
      values.push(subscriptionTier);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE organizations SET ${updates.join(", ")} WHERE id = $${i}`,
      values,
    );
    const org = await pool.query(
      "SELECT id, name, slug, domain, status, subscription_tier, created_at FROM organizations WHERE id = $1",
      [id],
    );
    res.json({
      success: true,
      message: "Organization updated",
      data: org.rows[0],
    });
  } catch (error) {
    console.error("updateOrganization error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE organizations SET status = 'deleted', deleted_at = NOW() WHERE id = $1 AND status != 'deleted' RETURNING id",
      [id],
    );
    if (result.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Organization not found" });
      return;
    }
    res.json({ success: true, message: "Organization deleted" });
  } catch (error) {
    console.error("deleteOrganization error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// ORG ADMIN MANAGEMENT (super_admin only)
// ---------------------------------------------------------------------------

export const listOrgAdmins = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.query;

  try {
    const conditions = ["u.user_type = 'org_admin'", "u.deleted_at IS NULL"];
    const values: any[] = [];
    let i = 1;

    if (orgId) {
      conditions.push(`om.organization_id = $${i++}`);
      values.push(orgId);
    }

    const joinClause = orgId
      ? "JOIN organization_members om ON u.id = om.user_id"
      : "LEFT JOIN organization_members om ON u.id = om.user_id";

    const result = await pool.query(
      `SELECT DISTINCT
         u.id, u.email, u.full_name, u.avatar_url, u.status, u.user_type, u.created_at, u.last_login_at,
         o.id as org_id, o.name as org_name, o.slug as org_slug
       FROM users u
       ${joinClause}
       LEFT JOIN organizations o ON om.organization_id = o.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY u.created_at DESC`,
      values,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listOrgAdmins error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const createOrgAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email, password, name, organizationId } = req.body;

  if (!email || !password || !name || !organizationId) {
    res.status(400).json({
      success: false,
      message: "email, password, name, and organizationId are required",
    });
    return;
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    res.status(400).json({
      success: false,
      message: "Password does not meet requirements",
      errors: passwordValidation.errors,
    });
    return;
  }

  const client = await pool.connect();
  try {
    const orgCheck = await client.query(
      "SELECT id FROM organizations WHERE id = $1 AND status != $2",
      [organizationId, "deleted"],
    );
    if (orgCheck.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`;

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        cognitoSub,
        email.toLowerCase(),
        true,
        name,
        "active",
        hashedPassword,
        "org_admin",
      ],
    );

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'org_admin', status = 'active'`,
      [organizationId, userId, "org_admin", "active"],
    );

    const roleResult = await client.query(
      "SELECT id FROM roles WHERE name = 'org_admin' AND is_system = true LIMIT 1",
    );
    if (roleResult.rows.length > 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, role_id, organization_id) DO NOTHING`,
        [userId, roleResult.rows[0].id, organizationId],
      );
    }

    await client.query("COMMIT");

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [userId],
    );
    res.status(201).json({
      success: true,
      message: "Org admin created",
      data: user.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("createOrgAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

export const updateOrgAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;
  const { name, status } = req.body;

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND user_type = 'org_admin' AND deleted_at IS NULL",
      [id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, message: "Org admin not found" });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name !== undefined) {
      updates.push(`full_name = $${i++}`);
      values.push(name);
    }
    if (status !== undefined) {
      updates.push(`status = $${i++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
      values,
    );

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [id],
    );
    res.json({
      success: true,
      message: "Org admin updated",
      data: user.rows[0],
    });
  } catch (error) {
    console.error("updateOrgAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteOrgAdmin = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = $1 AND user_type = 'org_admin' AND deleted_at IS NULL RETURNING id",
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Org admin not found" });
      return;
    }
    res.json({ success: true, message: "Org admin deleted" });
  } catch (error) {
    console.error("deleteOrgAdmin error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const listAllUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { userType, orgId, search } = req.query;

  try {
    const conditions = ["u.deleted_at IS NULL"];
    const values: any[] = [];
    let i = 1;

    if (userType) {
      conditions.push(`u.user_type = $${i++}`);
      values.push(userType);
    }
    if (orgId) {
      conditions.push(`om.organization_id = $${i++}`);
      values.push(orgId);
    }
    if (search) {
      conditions.push(`(u.email ILIKE $${i} OR u.full_name ILIKE $${i})`);
      values.push(`%${search}%`);
      i++;
    }

    const joinClause = orgId
      ? "JOIN organization_members om ON u.id = om.user_id"
      : "LEFT JOIN organization_members om ON u.id = om.user_id";

    const result = await pool.query(
      `SELECT DISTINCT
         u.id, u.email, u.full_name, u.avatar_url, u.status, u.user_type, u.created_at, u.last_login_at,
         o.id as org_id, o.name as org_name
       FROM users u
       ${joinClause}
       LEFT JOIN organizations o ON om.organization_id = o.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY u.created_at DESC
       LIMIT 200`,
      values,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listAllUsers error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// ORG USER MANAGEMENT (org_admin scoped to their org)
// ---------------------------------------------------------------------------

export const listOrgUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const requestingUser = (req as any).user;

  // Org admins can only list their own org's users
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
    const result = await pool.query(
      `SELECT
         u.id, u.email, u.full_name, u.avatar_url, u.status, u.user_type, u.created_at, u.last_login_at,
         om.role as org_role, om.status as membership_status,
         COALESCE(
           json_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL),
           '[]'
         ) as roles
       FROM users u
       JOIN organization_members om ON u.id = om.user_id AND om.organization_id = $1
       LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.organization_id = $1
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.deleted_at IS NULL AND om.status = 'active'
       GROUP BY u.id, u.email, u.full_name, u.avatar_url, u.status, u.user_type, u.created_at, u.last_login_at, om.role, om.status
       ORDER BY u.created_at DESC`,
      [orgId],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("listOrgUsers error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const createOrgUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId } = req.params;
  const { email, password, name, roleId } = req.body;
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

  if (!email || !password || !name) {
    res.status(400).json({
      success: false,
      message: "email, password, and name are required",
    });
    return;
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    res.status(400).json({
      success: false,
      message: "Password does not meet requirements",
      errors: passwordValidation.errors,
    });
    return;
  }

  const client = await pool.connect();
  try {
    const orgCheck = await client.query(
      "SELECT id FROM organizations WHERE id = $1 AND status != $2",
      [orgId, "deleted"],
    );
    if (orgCheck.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`;

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')`,
      [
        userId,
        cognitoSub,
        email.toLowerCase(),
        true,
        name,
        "active",
        hashedPassword,
      ],
    );

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'user', 'active')`,
      [orgId, userId],
    );

    if (roleId) {
      const roleCheck = await client.query(
        "SELECT id FROM roles WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)",
        [roleId, orgId],
      );
      if (roleCheck.rows.length > 0) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, organization_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, roleId, orgId],
        );
      }
    }

    await client.query("COMMIT");

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [userId],
    );
    res
      .status(201)
      .json({ success: true, message: "User created", data: user.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("createOrgUser error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

export const updateOrgUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, id } = req.params;
  const { name, status } = req.body;
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
      `SELECT u.id FROM users u
       JOIN organization_members om ON u.id = om.user_id AND om.organization_id = $1
       WHERE u.id = $2 AND u.deleted_at IS NULL`,
      [orgId, id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "User not found in this organization",
      });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name !== undefined) {
      updates.push(`full_name = $${i++}`);
      values.push(name);
    }
    if (status !== undefined) {
      updates.push(`status = $${i++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    values.push(id);
    await pool.query(
      `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
      values,
    );

    const user = await pool.query(
      "SELECT id, email, full_name, status, user_type, created_at FROM users WHERE id = $1",
      [id],
    );
    res.json({ success: true, message: "User updated", data: user.rows[0] });
  } catch (error) {
    console.error("updateOrgUser error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteOrgUser = async (
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
    // Remove from org membership; soft-delete user if they have no other orgs
    await pool.query(
      "UPDATE organization_members SET status = $1 WHERE organization_id = $2 AND user_id = $3",
      ["suspended", orgId, id],
    );

    const otherOrgs = await pool.query(
      "SELECT id FROM organization_members WHERE user_id = $1 AND status = 'active' AND organization_id != $2",
      [id, orgId],
    );

    if (otherOrgs.rows.length === 0) {
      await pool.query(
        "UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = $1",
        [id],
      );
    }

    res.json({ success: true, message: "User removed from organization" });
  } catch (error) {
    console.error("deleteOrgUser error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const assignUserRole = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, id } = req.params;
  const { roleId } = req.body;
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
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id, organization_id) DO NOTHING`,
      [id, roleId, orgId],
    );
    res.json({ success: true, message: "Role assigned" });
  } catch (error) {
    console.error("assignUserRole error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const removeUserRole = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { orgId, id, roleId } = req.params;
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
    await pool.query(
      "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2 AND organization_id = $3",
      [id, roleId, orgId],
    );
    res.json({ success: true, message: "Role removed" });
  } catch (error) {
    console.error("removeUserRole error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};