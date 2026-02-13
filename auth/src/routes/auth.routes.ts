import { Router } from 'express';
import { body } from 'express-validator';
import {
  signup,
  signin,
  signout,
  getCurrentUser,
  refreshToken,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

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

export default router;