import { Request, Response } from 'express';
import pool from '../config/database';
import { hashPassword, comparePassword, validatePasswordStrength } from '../utils/password';
import { generateTokenPair } from '../utils/jwt';
import { v4 as uuidv4 } from 'uuid';

/**
 * Sign up a new user
 */
export const signup = async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body;

  try {
    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: 'Password does not meet requirements',
        errors: passwordValidation.errors,
      });
      return;
    }

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userExists.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: 'User with this email already exists',
      });
      return;
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`; // For local auth, we use a prefix

    await pool.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, cognitoSub, email.toLowerCase(), false, name, 'active', hashedPassword]
    );

    // Generate tokens
    const tokens = generateTokenPair({
      userId,
      email: email.toLowerCase(),
    });

    // Create session
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [userId, tokens.refreshToken.substring(0, 50)] // Store truncated hash
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId,
        email: email.toLowerCase(),
        name,
        ...tokens,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Sign in with email and password
 */
export const signin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    // Find user
    const result = await pool.query(
      'SELECT id, email, full_name, password_hash, status FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
      return;
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      res.status(403).json({
        success: false,
        message: 'Account is inactive',
      });
      return;
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password_hash);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
      return;
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
    });

    // Create session
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokens.refreshToken.substring(0, 50)]
    );

    res.status(200).json({
      success: true,
      message: 'Sign in successful',
      data: {
        userId: user.id,
        email: user.email,
        name: user.full_name,
        ...tokens,
      },
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Sign out (invalidate session)
 */
export const signout = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.userId;

  try {
    // Delete all sessions for this user
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

    res.status(200).json({
      success: true,
      message: 'Signed out successfully',
    });
  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Get current user info
 */
export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.userId;

  try {
    const result = await pool.query(
      'SELECT id, email, full_name, avatar_url, status, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * Refresh access token using refresh token
 */
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  try {
    // Verify refresh token (will throw if invalid)
    const { verifyRefreshToken } = await import('../utils/jwt');
    const decoded = verifyRefreshToken(refreshToken);

    // Check if session exists
    const sessionResult = await pool.query(
      'SELECT id FROM sessions WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()',
      [decoded.userId, refreshToken.substring(0, 50)]
    );

    if (sessionResult.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
      return;
    }

    // Generate new tokens
    const tokens = generateTokenPair({
      userId: decoded.userId,
      email: decoded.email,
      organizationId: decoded.organizationId,
      permissions: decoded.permissions,
    });

    res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
    });
  }
};