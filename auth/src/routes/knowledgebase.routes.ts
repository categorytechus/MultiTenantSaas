import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  syncKnowledgeBase,
  getSyncStatus,
  listSyncJobs
} from '../controllers/knowledgebase.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Routes
router.post('/sync', syncKnowledgeBase);        // Trigger manual sync
router.get('/sync/:jobId', getSyncStatus);      // Get sync job status
router.get('/sync', listSyncJobs);              // List recent sync jobs

export default router;
