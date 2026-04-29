import { Router } from 'express';
import { body } from 'express-validator';
import {
  getUserOrganizations,
  switchOrganization,
  getCurrentOrganization,
} from '../controllers/organization.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * GET /api/organizations
 * Get all organizations the user belongs to
 */
router.get('/', authenticateToken, getUserOrganizations);

/**
 * POST /api/organizations/switch
 * Switch to a different organization
 */
router.post(
  '/switch',
  authenticateToken,
  [body('organizationId').notEmpty().isLength({ min: 36, max: 36 })],
  validateRequest,
  switchOrganization
);

/**
 * GET /api/organizations/current
 * Get current organization details
 */
router.get('/current', authenticateToken, getCurrentOrganization);

export default router;
