import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Middleware to verify JWT access token
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Access token required',
    });
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    
    // Attach user info to request
    (req as any).user = decoded;
    
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      message: 'Invalid or expired token',
    });
    return;
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      (req as any).user = decoded;
    } catch (error) {
      // Silently ignore invalid tokens in optional auth
    }
  }

  next();
};