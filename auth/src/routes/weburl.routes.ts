import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
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
router.get('/', requirePermission('web_urls:view'), getWebUrls);
router.get('/:id', requirePermission('web_urls:view'), getWebUrl);
router.post('/', requirePermission('web_urls:create'), createWebUrl);
router.put('/:id', requirePermission('web_urls:update'), updateWebUrl);
router.delete('/:id', requirePermission('web_urls:delete'), deleteWebUrl);

export default router;