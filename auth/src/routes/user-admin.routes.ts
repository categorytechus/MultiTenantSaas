import { Router } from 'express';
import { body, query } from 'express-validator';
import {
  listSuperAdmins,
  createSuperAdmin,
  updateSuperAdmin,
  deleteSuperAdmin,
  listOrgAdmins,
  createOrgAdmin,
  updateOrgAdmin,
  deleteOrgAdmin,
  listAllUsers,
  listAllOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from '../controllers/user-admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireSuperAdmin } from '../middleware/permission.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

// All routes require authentication + super admin
router.use(authenticateToken, requireSuperAdmin);

// Super Admins
router.get('/super-admins', listSuperAdmins);

router.post(
  '/super-admins',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').trim().notEmpty(),
  ],
  validateRequest,
  createSuperAdmin
);

router.put(
  '/super-admins/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('status').optional().isIn(['active', 'inactive', 'suspended']),
  ],
  validateRequest,
  updateSuperAdmin
);

router.delete('/super-admins/:id', deleteSuperAdmin);

// Org Admins
router.get('/org-admins', listOrgAdmins);

router.post(
  '/org-admins',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').trim().notEmpty(),
    body('organizationId').notEmpty().isUUID(),
  ],
  validateRequest,
  createOrgAdmin
);

router.put(
  '/org-admins/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('status').optional().isIn(['active', 'inactive', 'suspended']),
  ],
  validateRequest,
  updateOrgAdmin
);

router.delete('/org-admins/:id', deleteOrgAdmin);

// All Users (read-only global view)
router.get('/users', listAllUsers);

// Organizations
router.get('/organizations', listAllOrganizations);

router.post(
  '/organizations',
  [
    body('name').trim().notEmpty().withMessage('Organization name is required'),
    body('domain').optional().trim(),
    body('subscriptionTier').optional().isIn(['free', 'pro', 'enterprise']),
  ],
  validateRequest,
  createOrganization
);

router.put(
  '/organizations/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('domain').optional().trim(),
    body('status').optional().isIn(['active', 'suspended', 'deleted']),
    body('subscriptionTier').optional().isIn(['free', 'pro', 'enterprise']),
  ],
  validateRequest,
  updateOrganization
);

router.delete('/organizations/:id', deleteOrganization);

export default router;