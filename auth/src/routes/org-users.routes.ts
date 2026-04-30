import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  listOrgUsers,
  createOrgUser,
  updateOrgUser,
  deleteOrgUser,
  assignUserRole,
  removeUserRole,
  resetOrgUserPassword,
} from '../controllers/user-admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireOrgAdmin } from '../middleware/permission.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router({ mergeParams: true });

router.use(authenticateToken, requireOrgAdmin);

router.get('/', listOrgUsers);

// Create new user or add existing user to org (password no longer required)
router.post(
  '/',
  [
    body('email').isEmail().normalizeEmail(),
    body('name').optional().trim().notEmpty(),
    body('roleId').optional().isUUID(),
  ],
  validateRequest,
  createOrgUser
);

router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('status').optional().isIn(['active', 'inactive', 'suspended']),
  ],
  validateRequest,
  updateOrgUser
);

router.delete('/:id', deleteOrgUser);

// Role assignment on a user within an org
router.post(
  '/:id/roles',
  [body('roleId').notEmpty().isUUID()],
  validateRequest,
  assignUserRole
);

router.delete('/:id/roles/:roleId', removeUserRole);

router.post(
  '/:id/reset-password',
  resetOrgUserPassword
);

export default router;