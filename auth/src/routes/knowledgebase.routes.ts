import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import {
  syncKnowledgeBase,
  getSyncStatus,
  listSyncJobs
} from '../controllers/knowledgebase.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Knowledge base sync is part of the documents module
router.post('/sync', requirePermission('documents:create'), syncKnowledgeBase);
router.get('/sync/:jobId', requirePermission('documents:view'), getSyncStatus);
router.get('/sync', requirePermission('documents:view'), listSyncJobs);

export default router;