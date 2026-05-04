import { Request, Response, NextFunction } from "express";
import pool from "../config/database";

/**
 * When false, module / sub-permission checks are skipped for authenticated users.
 * Set to `true` to enforce `org_modules` + `role_org_permissions` on protected routes.
 */
export const ENFORCE_MODULE_PERMISSIONS = false;

/**
 * Middleware to check if user has a specific permission.
 *
 * Rules:
 *  - super_admin → always passes
 *  - org_admin   → passes if the module is enabled for their org in org_modules
 *  - regular user → passes if their role in user_roles has the permission in role_org_permissions
 */
export const requirePermission = (requiredPermission: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (!ENFORCE_MODULE_PERMISSIONS) {
      next();
      return;
    }

    // Super admins bypass all permission checks
    if (user.user_type === "super_admin") {
      next();
      return;
    }

    const orgId: string | undefined = user.org_id;
    if (!orgId) {
      res.status(403).json({
        success: false,
        message: "Organization context required to access this resource.",
      });
      return;
    }

    const moduleId = requiredPermission.split(":")[0];

    try {
      // Org admins have all permissions for modules enabled in their org
      if (user.roles?.includes("org_admin")) {
        const modResult = await pool.query(
          "SELECT 1 FROM org_modules WHERE org_id = $1 AND module_id = $2",
          [orgId, moduleId],
        );
        if (modResult.rows.length === 0) {
          res.status(403).json({
            success: false,
            message: `Module '${moduleId}' is not enabled for your organization.`,
          });
          return;
        }
        next();
        return;
      }

      // Regular user: check role_org_permissions via user_roles
      const userId: string = user.sub;
      const permResult = await pool.query(
        `SELECT 1
         FROM role_org_permissions rop
         JOIN user_roles ur ON ur.role_id = rop.role_id AND ur.org_id = rop.org_id
         WHERE ur.user_id = $1
           AND ur.org_id  = $2
           AND rop.org_id = $2
           AND rop.permission_id = $3
         LIMIT 1`,
        [userId, orgId, requiredPermission],
      );

      if (permResult.rows.length === 0) {
        res.status(403).json({
          success: false,
          message: `Permission denied. You do not have '${requiredPermission}' access.`,
        });
        return;
      }

      next();
    } catch (err) {
      console.error("requirePermission error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
};

/**
 * Middleware to check if user has ANY of the specified permissions.
 */
export const requireAnyPermission = (requiredPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (!ENFORCE_MODULE_PERMISSIONS) {
      next();
      return;
    }

    if (user.user_type === "super_admin") {
      next();
      return;
    }

    const orgId: string | undefined = user.org_id;
    if (!orgId) {
      res.status(403).json({ success: false, message: "Organization context required." });
      return;
    }

    try {
      if (user.roles?.includes("org_admin")) {
        // Check that at least one required module is enabled for this org
        const moduleIds = [...new Set(requiredPermissions.map((p) => p.split(":")[0]))];
        const modResult = await pool.query(
          "SELECT 1 FROM org_modules WHERE org_id = $1 AND module_id = ANY($2) LIMIT 1",
          [orgId, moduleIds],
        );
        if (modResult.rows.length === 0) {
          res.status(403).json({ success: false, message: "None of the required modules are enabled for your organization." });
          return;
        }
        next();
        return;
      }

      const userId: string = user.sub;
      const permResult = await pool.query(
        `SELECT 1
         FROM role_org_permissions rop
         JOIN user_roles ur ON ur.role_id = rop.role_id AND ur.org_id = rop.org_id
         WHERE ur.user_id = $1
           AND ur.org_id  = $2
           AND rop.org_id = $2
           AND rop.permission_id = ANY($3)
         LIMIT 1`,
        [userId, orgId, requiredPermissions],
      );

      if (permResult.rows.length === 0) {
        res.status(403).json({
          success: false,
          message: `Permission denied. Required one of: ${requiredPermissions.join(", ")}`,
        });
        return;
      }
      next();
    } catch (err) {
      console.error("requireAnyPermission error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
};

/**
 * Middleware to check if user has ALL of the specified permissions.
 */
export const requireAllPermissions = (requiredPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (!ENFORCE_MODULE_PERMISSIONS) {
      next();
      return;
    }

    if (user.user_type === "super_admin") {
      next();
      return;
    }

    const orgId: string | undefined = user.org_id;
    if (!orgId) {
      res.status(403).json({ success: false, message: "Organization context required." });
      return;
    }

    try {
      if (user.roles?.includes("org_admin")) {
        const moduleIds = [...new Set(requiredPermissions.map((p) => p.split(":")[0]))];
        const modResult = await pool.query(
          "SELECT module_id FROM org_modules WHERE org_id = $1 AND module_id = ANY($2)",
          [orgId, moduleIds],
        );
        const enabledModules = new Set(modResult.rows.map((r: any) => r.module_id));
        if (!moduleIds.every((m) => enabledModules.has(m))) {
          res.status(403).json({ success: false, message: "One or more required modules are not enabled for your organization." });
          return;
        }
        next();
        return;
      }

      const userId: string = user.sub;
      const permResult = await pool.query(
        `SELECT DISTINCT rop.permission_id
         FROM role_org_permissions rop
         JOIN user_roles ur ON ur.role_id = rop.role_id AND ur.org_id = rop.org_id
         WHERE ur.user_id = $1
           AND ur.org_id  = $2
           AND rop.org_id = $2
           AND rop.permission_id = ANY($3)`,
        [userId, orgId, requiredPermissions],
      );

      const granted = new Set(permResult.rows.map((r: any) => r.permission_id));
      const missing = requiredPermissions.filter((p) => !granted.has(p));

      if (missing.length > 0) {
        res.status(403).json({
          success: false,
          message: `Permission denied. Missing: ${missing.join(", ")}`,
        });
        return;
      }
      next();
    } catch (err) {
      console.error("requireAllPermissions error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
};

/**
 * Middleware to check if user belongs to an organization
 */
export const requireOrganization = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const user = (req as any).user;

  if (!user || !user.org_id) {
    res.status(400).json({
      success: false,
      message:
        "Organization context required. Please switch to an organization first.",
    });
    return;
  }

  next();
};

/**
 * Middleware to check if user is a super admin
 */
export const requireSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const user = (req as any).user;

  if (!user) {
    res
      .status(401)
      .json({ success: false, message: "Authentication required" });
    return;
  }

  if (user.user_type !== "super_admin") {
    res
      .status(403)
      .json({ success: false, message: "Super admin access required" });
    return;
  }

  next();
};

/**
 * Middleware to check if user is an org admin or super admin
 */
export const requireOrgAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const user = (req as any).user;

  if (!user) {
    res
      .status(401)
      .json({ success: false, message: "Authentication required" });
    return;
  }

  if (user.user_type !== "super_admin" && !user.roles?.includes("org_admin")) {
    res
      .status(403)
      .json({ success: false, message: "Organization admin access required" });
    return;
  }

  next();
};