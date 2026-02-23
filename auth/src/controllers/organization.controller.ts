import { Request, Response } from 'express';
import pool from '../config/database';
import { generateTokenPair } from '../utils/jwt';

/**
 * Get user's organizations
 */
export const getUserOrganizations = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.userId;

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
      [userId]
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get user organizations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Switch to a different organization
 * Returns new JWT tokens with the selected organization
 */
export const switchOrganization = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.userId;
  const email = (req as any).user?.email;
  const { organizationId } = req.body;

  try {
    // Verify user has access to this organization
    const membershipResult = await pool.query(
      `SELECT om.role, o.name, o.slug
       FROM organization_members om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
      [userId, organizationId]
    );

    if (membershipResult.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'You do not have access to this organization',
      });
      return;
    }

    const membership = membershipResult.rows[0];

    // Get user's permissions for this organization
    const permissionsResult = await pool.query(
      `SELECT DISTINCT p.resource, p.action
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = $1 AND ur.organization_id = $2`,
      [userId, organizationId]
    );

    const permissions = permissionsResult.rows.map(
      (p) => `${p.resource}:${p.action}`
    );

    // Generate new tokens with organization context
    const tokens = generateTokenPair({
      userId,
      email,
      organizationId,
      permissions,
    });

    res.status(200).json({
      success: true,
      message: 'Switched organization successfully',
      data: {
        organization: {
          id: organizationId,
          name: membership.name,
          slug: membership.slug,
          role: membership.role,
        },
        permissions,
        ...tokens,
      },
    });
  } catch (error) {
    console.error('Switch organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Get current organization details
 */
export const getCurrentOrganization = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.userId;
  const organizationId = (req as any).user?.organizationId;

  if (!organizationId) {
    res.status(400).json({
      success: false,
      message: 'No organization selected',
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
      [organizationId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get current organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};