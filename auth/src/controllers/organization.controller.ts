import { Request, Response } from "express";
import pool from "../config/database";
import { generateTokenPair, loadOrgRoles } from "../utils/jwt";

/**
 * Get user's organizations
 */
export const getUserOrganizations = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;

  try {
    const result = await pool.query(
      `SELECT 
        o.id,
        o.name,
        o.slug,
        o.status,
        om.role,
        om.status as membership_status
       FROM organizations o
       JOIN organization_members om ON o.id = om.organization_id
       WHERE om.user_id = $1 AND om.status = 'active'
       ORDER BY o.name`,
      [userId],
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Get user organizations error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Switch to a different organization
 * Returns new JWT tokens with the selected organization
 */
export const switchOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;
  const email = (req as any).user?.email;
  const userType = (req as any).user?.user_type;
  const { organizationId } = req.body;

  try {
    let orgName: string;
    let orgSlug: string;
    let orgRole: string;

    if (userType === "super_admin") {
      // Super admins can access any org without membership
      const orgResult = await pool.query(
        `SELECT name, slug FROM organizations WHERE id = $1 AND status != 'deleted'`,
        [organizationId],
      );
      if (orgResult.rows.length === 0) {
        res
          .status(404)
          .json({ success: false, message: "Organization not found" });
        return;
      }
      orgName = orgResult.rows[0].name;
      orgSlug = orgResult.rows[0].slug;
      orgRole = "super_admin";
    } else {
      // Regular users/org_admins must be members
      const membershipResult = await pool.query(
        `SELECT om.role, o.name, o.slug
         FROM organization_members om
         JOIN organizations o ON om.organization_id = o.id
         WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
        [userId, organizationId],
      );
      if (membershipResult.rows.length === 0) {
        res
          .status(403)
          .json({
            success: false,
            message: "You do not have access to this organization",
          });
        return;
      }
      orgName = membershipResult.rows[0].name;
      orgSlug = membershipResult.rows[0].slug;
      orgRole = membershipResult.rows[0].role;
    }

    // Load roles for this organization (empty for super_admin acting as guest)
    const roles = await loadOrgRoles(userId, organizationId);

    // Generate new tokens with organization context
    const tokens = generateTokenPair({
      sub: userId,
      email,
      user_type: userType,
      org_id: organizationId,
      roles,
    });

    res.status(200).json({
      success: true,
      message: "Switched organization successfully",
      data: {
        organization: {
          id: organizationId,
          name: orgName,
          slug: orgSlug,
          role: orgRole,
        },
        roles,
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Switch organization error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Reset organization context (super_admin only)
 * Returns fresh tokens without org_id context.
 */
export const resetOrganizationContext = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;
  const email = (req as any).user?.email;
  const userType = (req as any).user?.user_type;

  if (userType !== "super_admin") {
    res.status(403).json({
      success: false,
      message: "Only super admins can reset organization context",
    });
    return;
  }

  try {
    const tokens = generateTokenPair({
      sub: userId,
      email,
      user_type: userType,
      permissions: [],
    });

    res.status(200).json({
      success: true,
      message: "Organization context reset successfully",
      data: {
        organization: null,
        permissions: [],
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Reset organization context error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get current organization details
 */
export const getCurrentOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;
  const organizationId = (req as any).user?.org_id;

  if (!organizationId) {
    res.status(400).json({
      success: false,
      message: "No organization selected",
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT 
        o.id,
        o.name,
        o.slug,
        o.domain,
        o.status,
        o.subscription_tier,
        om.role
       FROM organizations o
       JOIN organization_members om ON o.id = om.organization_id
       WHERE o.id = $1 AND om.user_id = $2 AND om.status = 'active'`,
      [organizationId, userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get current organization error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};