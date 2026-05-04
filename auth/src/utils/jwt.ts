import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import pool from '../config/database';

dotenv.config();

const JWT_SECRET = process.env.JWT_KEY || 'dev-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export interface JWTPayload {
  sub: string;
  email: string;
  user_type?: 'super_admin' | 'user';
  org_id?: string;
  roles?: string[];
  permissions?: string[];
  token_version?: number;
  type: 'access' | 'refresh';
}

export const generateAccessToken = (payload: Omit<JWTPayload, 'type'>): string => {
  return jwt.sign(
    { ...payload, type: 'access' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as any
  );
};

export const generateRefreshToken = (payload: Omit<JWTPayload, 'type'>): string => {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN } as any
  );
};

export const verifyAccessToken = (token: string): JWTPayload => {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
};

export const verifyRefreshToken = (token: string): JWTPayload => {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
};

export const generateTokenPair = (payload: Omit<JWTPayload, 'type'>) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};

/**
 * Load the role names a user has in a given organization.
 * Returns an empty array when org_id is null (e.g. super_admin with no org context).
 */
export const loadOrgRoles = async (
  userId: string,
  organizationId: string | null,
): Promise<string[]> => {
  if (!organizationId) return [];
  try {
    const result = await pool.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND ur.organization_id = $2`,
      [userId, organizationId],
    );
    return result.rows.map((row: { name: string }) => row.name);
  } catch {
    return [];
  }
};