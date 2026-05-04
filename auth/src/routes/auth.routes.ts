import { Router } from 'express';
import { body } from 'express-validator';
import {
  signup,
  signin,
  signout,
  getCurrentUser,
  refreshToken,
  forgotPassword,
  confirmPasswordReset,
  changePassword,
  setPassword,
  updateProfile,
  googleCallback,
  signupViaInvite,
  getInviteInfo,
  acceptInvite,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import passport from '../config/passport';

const router = Router();

/**
 * POST /api/auth/signup
 * Register a new user
 */
router.post(
  '/signup',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').trim().notEmpty(),
    body('organizationName').trim().notEmpty().withMessage('Organization name is required'),
  ],
  validateRequest,
  signup
);

/**
 * POST /api/auth/signin
 * Sign in with email and password
 */
router.post(
  '/signin',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validateRequest,
  signin
);

/**
 * POST /api/auth/signout
 * Sign out (invalidate session)
 */
router.post('/signout', authenticateToken, signout);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, getCurrentUser);

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  [body('refreshToken').notEmpty()],
  validateRequest,
  refreshToken
);

/**
 * POST /api/auth/forgot-password
 * Request password reset code
 */
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  validateRequest,
  forgotPassword
);

/**
 * POST /api/auth/reset-password
 * Confirm password reset with code
 */
router.post(
  '/reset-password',
  [
    body('email').isEmail().normalizeEmail(),
    body('code').isLength({ min: 6, max: 6 }),
    body('newPassword')
      .isString()
      .withMessage('newPassword is required')
      .isLength({ min: 8 })
      .withMessage('newPassword must be at least 8 characters long'),
  ],
  validateRequest,
  confirmPasswordReset
);

/**
 * POST /api/auth/change-password
 * Change password for authenticated user
 */
router.post(
  '/change-password',
  authenticateToken,
  [
    body('currentPassword').notEmpty(),
    body('newPassword')
      .isString()
      .withMessage('newPassword is required')
      .isLength({ min: 8 })
      .withMessage('newPassword must be at least 8 characters long'),
  ],
  validateRequest,
  changePassword
);

/**
 * POST /api/auth/set-password
 * Two modes:
 *  - Unauthenticated: { token, email, password } — setup link flow
 *  - Authenticated: { newPassword } — must_change_password flow
 */
router.post('/set-password', setPassword);

/**
 * GET /api/auth/invite-info
 * Public — returns org name, role, email, user_exists for a given invite token
 */
router.get('/invite-info', getInviteInfo);

/**
 * POST /api/auth/accept-invite
 * Authenticated — existing user accepts invite: joins org, returns new JWT
 */
router.post(
  '/accept-invite',
  authenticateToken,
  [body('token').notEmpty(), body('orgId').notEmpty()],
  validateRequest,
  acceptInvite,
);

/**
 * POST /api/auth/signup/:orgId
 * Register via an invite link
 */
router.post(
  '/signup/:orgId',
  [
    body('token').notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('name').trim().notEmpty(),
    body('password').isLength({ min: 8 }),
  ],
  validateRequest,
  signupViaInvite
);

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put(
  '/profile',
  authenticateToken,
  [
    body('name').optional().trim().notEmpty(),
    body('avatar_url').optional().isURL(),
  ],
  validateRequest,
  updateProfile
);

/**
 * GET /api/auth/google
 * Initiate Google OAuth flow
 */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

/**
 * GET /api/auth/google/callback
 * Google OAuth callback
 */
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL}/auth/signin?error=google_auth_failed`,
  }),
  googleCallback
);

export default router;