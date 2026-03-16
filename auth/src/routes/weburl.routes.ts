import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  createWebUrl,
  getWebUrls,
  getWebUrl,
  updateWebUrl,
  deleteWebUrl
} from '../controllers/weburl.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Routes
router.post('/', createWebUrl);           // Create new web URL
router.get('/', getWebUrls);              // Get all web URLs for organization
router.get('/:id', getWebUrl);            // Get single web URL
router.put('/:id', updateWebUrl);         // Update web URL
router.delete('/:id', deleteWebUrl);      // Delete web URL (soft delete)

export default router;