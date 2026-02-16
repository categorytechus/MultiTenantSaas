import { Request, Response } from 'express';

/**
 * Test endpoint that requires 'members:create' permission
 */
export const testAdminOnly = async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;

  res.status(200).json({
    success: true,
    message: 'You have admin access!',
    data: {
      userId: user.userId,
      organizationId: user.organizationId,
      permissions: user.permissions,
    },
  });
};

/**
 * Test endpoint that requires 'agents:run' permission
 */
export const testRunAgent = async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user;

  res.status(200).json({
    success: true,
    message: 'You can run agents!',
    data: {
      userId: user.userId,
      organizationId: user.organizationId,
      agentType: req.body.agentType || 'counselor',
    },
  });
};