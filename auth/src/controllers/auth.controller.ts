import { Request, Response } from "express";
import pool from "../config/database";
import { allowEmailDebugResponse } from "../config/email-policy";
import {
  isSesConfigured,
  sendForgotPasswordEmail,
} from "../services/email.service";
import {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
} from "../utils/password";
import { generateTokenPair, loadOrgRoles } from "../utils/jwt";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const normalizeEmail = (email?: string): string =>
  (email || "").trim().toLowerCase();

/**
 * Sign up a new user as org_admin — auto-creates their organization
 */
export const signup = async (req: Request, res: Response): Promise<void> => {
  const { email, password, name, organizationName } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!organizationName || !organizationName.trim()) {
    res.status(400).json({
      success: false,
      message: "Organization name is required",
    });
    return;
  }

  const client = await pool.connect();
  try {
    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordValidation.errors,
      });
      return;
    }

    // Check if user already exists
    const userExists = await client.query(
      "SELECT id FROM users WHERE lower(trim(email)) = $1",
      [normalizedEmail],
    );

    if (userExists.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
      return;
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    await client.query("BEGIN");

    // Create user with user_type = user (org_admin role assigned via user_roles)
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`;
    await client.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        cognitoSub,
        normalizedEmail,
        false,
        name,
        "active",
        hashedPassword,
        "user",
      ],
    );

    // Create organization — derive slug from org name
    const orgId = uuidv4();
    const slug =
      organizationName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 60) +
      "-" +
      orgId.substring(0, 8);

    await client.query(
      `INSERT INTO organizations (id, name, slug, status, subscription_tier)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, organizationName.trim(), slug, "active", "free"],
    );

    // Add user as org_admin member
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3, $4)`,
      [orgId, userId, "org_admin", "active"],
    );

    // Assign system org_admin RBAC role
    const roleResult = await client.query(
      `SELECT id FROM roles WHERE name = 'org_admin' AND is_system = true LIMIT 1`,
    );
    if (roleResult.rows.length > 0) {
      const roleId = roleResult.rows[0].id;
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3)`,
        [userId, roleId, orgId],
      );
    }

    await client.query("COMMIT");

    // Load roles for the new user in this org
    const roles = await loadOrgRoles(userId, orgId);

    // Generate tokens with org context
    const tokens = generateTokenPair({
      sub: userId,
      email: normalizedEmail,
      user_type: "user",
      org_id: orgId,
      roles,
    });

    // Create session
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [userId, tokens.refreshToken.substring(0, 50)],
    );

    res.status(201).json({
      success: true,
      message: "Account and organization created successfully",
      data: {
        userId,
        email: normalizedEmail,
        name,
        user_type: "user",
        roles,
        organization: { id: orgId, name: organizationName.trim(), slug },
        ...tokens,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
};

/**
 * Sign in with email and password
 */
export const signin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);

  try {
    // Find user
    const result = await pool.query(
      "SELECT id, email, full_name, password_hash, status, user_type, must_change_password, token_version FROM users WHERE lower(trim(email)) = $1",
      [normalizedEmail],
    );

    if (result.rows.length === 0) {
      console.warn(`Sign-in failed: User not found for email ${email}`);
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
      return;
    }

    const user = result.rows[0];
    console.log(`User found: ${user.email}, verifying password...`);

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password_hash);

    if (!isPasswordValid) {
      console.warn(`Sign-in failed: Invalid password for user ${email}`);
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
      return;
    }

    // Check if user is active
    if (user.status !== "active") {
      res.status(403).json({
        success: false,
        message: "Account is inactive",
      });
      return;
    }

    // Get user's first organization (deterministic order by join date)
    const orgResult = await pool.query(
      `SELECT organization_id
       FROM organization_members
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 1`,
      [user.id],
    );

    const organizationId = orgResult.rows[0]?.organization_id || null;

    // Load roles for that organization
    const roles = await loadOrgRoles(user.id, organizationId);

    // Update last login
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);

    // Generate tokens (token_version included for session invalidation)
    const tokens = generateTokenPair({
      sub: user.id,
      email: user.email,
      user_type: user.user_type,
      org_id: organizationId,
      roles,
      token_version: user.token_version,
    });

    // Create session
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokens.refreshToken.substring(0, 50)],
    );

    res.status(200).json({
      success: true,
      message: "Sign in successful",
      data: {
        userId: user.id,
        email: user.email,
        name: user.full_name,
        user_type: user.user_type,
        roles,
        must_change_password: user.must_change_password,
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Signin error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Sign out (invalidate session)
 */
export const signout = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.sub;

  try {
    // Delete all sessions for this user
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

    res.status(200).json({
      success: true,
      message: "Signed out successfully",
    });
  } catch (error) {
    console.error("Signout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get current user info
 */
export const getCurrentUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;

  try {
    const result = await pool.query(
      "SELECT id, email, full_name, avatar_url, status, user_type, created_at FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Refresh access token using refresh token
 */
export const refreshToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { refreshToken } = req.body;

  try {
    // Verify refresh token (will throw if invalid)
    const { verifyRefreshToken } = await import("../utils/jwt");
    const decoded = verifyRefreshToken(refreshToken);

    // Check if session exists
    const sessionResult = await pool.query(
      "SELECT id FROM sessions WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()",
      [decoded.sub, refreshToken.substring(0, 50)],
    );

    if (sessionResult.rows.length === 0) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
      return;
    }

    // Generate new tokens (re-load roles from DB to stay current)
    const roles = await loadOrgRoles(decoded.sub, decoded.org_id || null);
    const tokens = generateTokenPair({
      sub: decoded.sub,
      email: decoded.email,
      user_type: decoded.user_type,
      org_id: decoded.org_id,
      roles,
    });

    res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
};

/**
 * Forgot password - Generate reset code
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);

  try {
    // Find user
    const result = await pool.query(
      "SELECT id, email, full_name FROM users WHERE lower(trim(email)) = $1",
      [normalizedEmail],
    );

    // Always return success even if user not found (security: don't reveal if email exists)
    if (result.rows.length === 0) {
      res.status(200).json({
        success: true,
        message: "If the email exists, a password reset code has been sent",
      });
      return;
    }

    const user = result.rows[0];

    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store reset code in database
    await pool.query(
      `UPDATE users 
       SET reset_code = $1, reset_code_expiry = $2 
       WHERE id = $3`,
      [resetCode, resetCodeExpiry, user.id],
    );

    let forgotPasswordEmailFailed = false;
    try {
      await sendForgotPasswordEmail({
        to: user.email,
        recipientName: user.full_name,
        resetCode,
        minutesValid: 15,
      });
    } catch (err) {
      forgotPasswordEmailFailed = true;
      console.error("Forgot password email send failed:", err);
    }

    if (!isSesConfigured() || forgotPasswordEmailFailed) {
      console.log(`Password reset code for ${email}: ${resetCode}`);
    }

    const payload: Record<string, unknown> = {
      success: true,
      message: "If the email exists, a password reset code has been sent",
    };
    if (allowEmailDebugResponse()) {
      payload.debug = { resetCode };
    }
    if (forgotPasswordEmailFailed && isSesConfigured() && !allowEmailDebugResponse()) {
      payload.warnings = [{ code: "email_failed" }];
    }

    res.status(200).json(payload);
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Confirm password reset with code
 */
export const confirmPasswordReset = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { email, code, newPassword } = req.body;
  const normalizedEmail = normalizeEmail(email);

  try {
    // Validate new password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordValidation.errors,
      });
      return;
    }

    // Find user and verify reset code
    const result = await pool.query(
      `SELECT id, reset_code, reset_code_expiry 
       FROM users 
       WHERE lower(trim(email)) = $1 AND reset_code = $2 AND reset_code_expiry > NOW()`,
      [normalizedEmail, code],
    );

    if (result.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "Invalid or expired reset code",
      });
      return;
    }

    const user = result.rows[0];

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and clear reset code
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, reset_code = NULL, reset_code_expiry = NULL 
       WHERE id = $2`,
      [hashedPassword, user.id],
    );

    // Invalidate all existing sessions
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Confirm password reset error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Change password (for authenticated users)
 */
export const changePassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;
  const { currentPassword, newPassword } = req.body;

  try {
    // Validate new password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordValidation.errors,
      });
      return;
    }

    // Get current password hash
    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Verify current password
    const isPasswordValid = await comparePassword(
      currentPassword,
      result.rows[0].password_hash,
    );

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
      return;
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and bump token_version to invalidate existing sessions
    await pool.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
      [hashedPassword, userId],
    );

    // Invalidate all sessions except current one
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update user profile
 */
export const updateProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).user?.sub;
  const { name, avatar_url } = req.body;

  try {
    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`full_name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramCount}`);
      values.push(avatar_url);
      paramCount++;
    }

    if (updates.length === 0) {
      res.status(400).json({
        success: false,
        message: "No fields to update",
      });
      return;
    }

    // Add userId to values
    values.push(userId);

    // Execute update
    await pool.query(
      `UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${paramCount}`,
      values,
    );

    // Get updated user
    const result = await pool.query(
      "SELECT id, email, full_name, avatar_url, status, created_at FROM users WHERE id = $1",
      [userId],
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Set password — two modes:
 * 1. Unauthenticated: body has { token, email, password } → verify setup_token
 * 2. Authenticated (legacy): user is signed in with must_change_password=true
 */
export const setPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { token, email, password, newPassword } = req.body;

  // --- Unauthenticated branch: setup_token flow ---
  if (token && email) {
    const pwd = password || newPassword;
    if (!pwd) {
      res.status(400).json({ success: false, message: "password is required" });
      return;
    }

    const passwordValidation = validatePasswordStrength(pwd);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordValidation.errors,
      });
      return;
    }

    try {
      const userResult = await pool.query(
        `SELECT id FROM users
         WHERE lower(trim(email)) = lower(trim($1))
           AND setup_token = $2
           AND setup_token_expiry > NOW()
           AND deleted_at IS NULL`,
        [email, token],
      );

      if (userResult.rows.length === 0) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired setup link",
        });
        return;
      }

      const userId = userResult.rows[0].id;
      const hashedPassword = await hashPassword(pwd);

      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             setup_token = NULL,
             setup_token_expiry = NULL,
             must_change_password = false,
             token_version = token_version + 1,
             updated_at = NOW()
         WHERE id = $2`,
        [hashedPassword, userId],
      );

      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

      res.status(200).json({
        success: true,
        message: "Password set successfully. You can now sign in.",
      });
    } catch (error) {
      console.error("Set password (token) error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
    return;
  }

  // --- Authenticated branch: must_change_password flow ---
  const userId = (req as any).user?.sub;
  const pwd = newPassword || password;

  if (!userId) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }

  try {
    const userResult = await pool.query(
      "SELECT must_change_password FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (!userResult.rows[0].must_change_password) {
      res.status(400).json({
        success: false,
        message: "Password change not required. Use change-password instead.",
      });
      return;
    }

    const passwordValidation = validatePasswordStrength(pwd);
    if (!passwordValidation.valid) {
      res.status(400).json({
        success: false,
        message: "Password does not meet requirements",
        errors: passwordValidation.errors,
      });
      return;
    }

    const hashedPassword = await hashPassword(pwd);

    await pool.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = false, token_version = token_version + 1, updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, userId],
    );

    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

    res.status(200).json({
      success: true,
      message: "Password set successfully. Please sign in with your new password.",
    });
  } catch (error) {
    console.error("Set password error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Sign up via invite link (POST /auth/signup/:orgId)
 * Validates invite_tokens row, creates user, assigns role, returns JWT pair.
 */
export const signupViaInvite = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const orgId = req.params.orgId as string;
  const { token, email, name, password } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!token || !email || !name || !password) {
    res.status(400).json({
      success: false,
      message: "token, email, name, and password are required",
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
    // Validate invite token
    const inviteResult = await client.query(
      `SELECT id, role, email FROM invite_tokens
       WHERE token = $1
         AND lower(trim(email)) = $2
         AND org_id = $3
         AND used_at IS NULL
         AND expires_at > NOW()`,
      [token, normalizedEmail, orgId],
    );

    if (inviteResult.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "Invalid or expired invite link",
      });
      return;
    }

    const invite = inviteResult.rows[0];

    // Check if user already exists
    const userExists = await client.query(
      "SELECT id FROM users WHERE lower(trim(email)) = $1 AND deleted_at IS NULL",
      [normalizedEmail],
    );
    if (userExists.rows.length > 0) {
      res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please sign in.",
      });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();
    const cognitoSub = `local_${userId}`;

    await client.query("BEGIN");

    // Create user
    await client.query(
      `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, status, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')`,
      [userId, cognitoSub, normalizedEmail, true, name, "active", hashedPassword],
    );

    // Add as org member
    const memberRole = invite.role === "org_admin" ? "org_admin" : "user";
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3, status = 'active'`,
      [orgId, userId, memberRole],
    );

    // Assign system role if org_admin
    if (invite.role === "org_admin") {
      const roleResult = await client.query(
        "SELECT id FROM roles WHERE name = 'org_admin' AND is_system = true LIMIT 1",
      );
      if (roleResult.rows.length > 0) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, organization_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id, organization_id) DO NOTHING`,
          [userId, roleResult.rows[0].id, orgId],
        );
      }
    }

    // Mark invite as used
    await client.query(
      "UPDATE invite_tokens SET used_at = NOW() WHERE id = $1",
      [invite.id],
    );

    await client.query("COMMIT");

    const roles = await loadOrgRoles(userId, orgId);
    const tokens = generateTokenPair({
      sub: userId,
      email: normalizedEmail,
      user_type: "user",
      org_id: orgId,
      roles,
    });

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [userId, tokens.refreshToken.substring(0, 50)],
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: { userId, email: normalizedEmail, name, user_type: "user", roles, ...tokens },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("signupViaInvite error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * GET /auth/invite-info — public
 * Returns org name, role, email, and whether a user with that email already exists.
 */
export const getInviteInfo = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { token, orgId } = req.query as { token?: string; orgId?: string };

  if (!token || !orgId) {
    res.status(400).json({ success: false, message: "token and orgId are required" });
    return;
  }

  try {
    const inviteResult = await pool.query(
      `SELECT it.id, it.email, it.role, o.name AS org_name
       FROM invite_tokens it
       JOIN organizations o ON o.id = it.org_id
       WHERE it.token = $1
         AND it.org_id = $2
         AND it.used_at IS NULL
         AND it.expires_at > NOW()`,
      [token, orgId],
    );

    if (inviteResult.rows.length === 0) {
      res.status(400).json({ success: false, message: "Invalid or expired invite link" });
      return;
    }

    const invite = inviteResult.rows[0];

    const userResult = await pool.query(
      "SELECT id FROM users WHERE lower(trim(email)) = lower(trim($1)) AND deleted_at IS NULL",
      [invite.email],
    );

    res.json({
      success: true,
      data: {
        org_name: invite.org_name,
        role: invite.role,
        email: invite.email,
        user_exists: userResult.rows.length > 0,
      },
    });
  } catch (error) {
    console.error("getInviteInfo error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * POST /auth/accept-invite — authenticated
 * Existing user accepts an invite link: joins org, marks token used, returns new JWT.
 */
export const acceptInvite = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { token, orgId } = req.body;
  const requestingUser = (req as any).user;
  const userId: string = requestingUser.sub;
  const userEmail: string = requestingUser.email;

  if (!token || !orgId) {
    res.status(400).json({ success: false, message: "token and orgId are required" });
    return;
  }

  const client = await pool.connect();
  try {
    const inviteResult = await client.query(
      `SELECT id, role, email FROM invite_tokens
       WHERE token = $1
         AND org_id = $2
         AND used_at IS NULL
         AND expires_at > NOW()`,
      [token, orgId],
    );

    if (inviteResult.rows.length === 0) {
      res.status(400).json({ success: false, message: "Invalid or expired invite link" });
      return;
    }

    const invite = inviteResult.rows[0];

    if (invite.email.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
      res.status(403).json({
        success: false,
        message: "This invite was not sent to your email address",
      });
      return;
    }

    await client.query("BEGIN");

    const memberRole = invite.role === "org_admin" ? "org_admin" : "user";
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3, status = 'active'`,
      [orgId, userId, memberRole],
    );

    if (invite.role === "org_admin") {
      const roleResult = await client.query(
        "SELECT id FROM roles WHERE name = 'org_admin' AND is_system = true LIMIT 1",
      );
      if (roleResult.rows.length > 0) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, organization_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, role_id, organization_id) DO NOTHING`,
          [userId, roleResult.rows[0].id, orgId],
        );
      }
    }

    await client.query(
      "UPDATE invite_tokens SET used_at = NOW() WHERE id = $1",
      [invite.id],
    );

    await client.query("COMMIT");

    const userTypeRes = await pool.query(
      "SELECT user_type FROM users WHERE id = $1",
      [userId],
    );
    const userType = userTypeRes.rows[0]?.user_type || "user";

    const roles = await loadOrgRoles(userId, orgId);
    const tokens = generateTokenPair({
      sub: userId,
      email: userEmail,
      user_type: userType,
      org_id: orgId,
      roles,
    });

    res.json({
      success: true,
      message: "Successfully joined organization",
      data: { ...tokens, org_id: orgId },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("acceptInvite error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * Google OAuth callback handler
 */
export const googleCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;

    if (!user) {
      res.redirect(
        `${process.env.FRONTEND_URL}/auth/signin?error=authentication_failed`,
      );
      return;
    }

    // Generate tokens
    const tokens = generateTokenPair({
      sub: user.id,
      email: user.email,
    });

    // Create session
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, tokens.refreshToken.substring(0, 50)],
    );

    // Redirect to frontend with tokens
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Google callback error:", error);
    res.redirect(`${process.env.FRONTEND_URL}/auth/signin?error=server_error`);
  }
};