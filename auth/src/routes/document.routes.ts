// auth/src/routes/document.routes.ts
import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import {
  generateUploadUrl,
  createDocument,
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
} from '../controllers/document.controller';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/documents/presigned-url
 * Generate presigned URL for file upload
 * Requires: documents:create permission
 */
router.post(
  '/presigned-url',
  requirePermission('documents:create'),
  generateUploadUrl
);

/**
 * POST /api/documents
 * Save document metadata after upload
 * Requires: documents:create permission
 */
router.post(
  '/',
  requirePermission('documents:create'),
  createDocument
);

/**
 * GET /api/documents
 * List all documents in organization with filtering
 * Requires: documents:view permission
 */
router.get(
  '/',
  requirePermission('documents:view'),
  listDocuments
);

/**
 * GET /api/documents/:id
 * Get document by ID with download URL
 * Requires: documents:view permission
 */
router.get(
  '/:id',
  requirePermission('documents:view'),
  getDocument
);

/**
 * PATCH /api/documents/:id
 * Update document metadata and tags
 * Requires: documents:update permission
 */
router.patch(
  '/:id',
  requirePermission('documents:update'),
  updateDocument
);

/**
 * DELETE /api/documents/:id
 * Delete document from S3 and database
 * Requires: documents:delete permission
 */
router.delete(
  '/:id',
  requirePermission('documents:delete'),
  deleteDocument
);

export default router;
