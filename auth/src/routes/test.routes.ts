import { Router } from 'express';
import { testAdminOnly, testRunAgent } from '../controllers/test.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission, requireOrganization } from '../middleware/permission.middleware';

const router = Router();

/**
 * GET /api/test/admin-only
 * Test endpoint requiring 'members:create' permission
 */
router.get(
  '/admin-only',
  authenticateToken,
  requireOrganization,
  requirePermission('members:create'),
  testAdminOnly
);

/**
 * POST /api/test/run-agent
 * Test endpoint requiring 'agents:run' permission
 */
router.post(
  '/run-agent',
  authenticateToken,
  requireOrganization,
  requirePermission('agents:run'),
  testRunAgent
);

export default router;