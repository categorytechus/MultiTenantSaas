import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to check if user has a specific permission
 */
export const requirePermission = (requiredPermission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    const permissions = user.permissions || [];

    if (!permissions.includes(requiredPermission)) {
      res.status(403).json({
        success: false,
        message: `Permission denied. Required permission: ${requiredPermission}`,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user has ANY of the specified permissions
 */
export const requireAnyPermission = (requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    const permissions = user.permissions || [];
    const hasPermission = requiredPermissions.some((perm) => permissions.includes(perm));

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: `Permission denied. Required one of: ${requiredPermissions.join(', ')}`,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user has ALL of the specified permissions
 */
export const requireAllPermissions = (requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    const permissions = user.permissions || [];
    const hasAllPermissions = requiredPermissions.every((perm) => permissions.includes(perm));

    if (!hasAllPermissions) {
      const missingPermissions = requiredPermissions.filter((perm) => !permissions.includes(perm));
      res.status(403).json({
        success: false,
        message: `Permission denied. Missing permissions: ${missingPermissions.join(', ')}`,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user belongs to an organization
 */
export const requireOrganization = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as any).user;

  if (!user || !user.organizationId) {
    res.status(400).json({
      success: false,
      message: 'Organization context required. Please switch to an organization first.',
    });
    return;
  }

  next();
};