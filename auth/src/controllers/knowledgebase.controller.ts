import { Request, Response } from 'express';
import { 
  BedrockAgentClient, 
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListIngestionJobsCommand
} from '@aws-sdk/client-bedrock-agent';
import pool from '../config/database';

// Initialize Bedrock Agent client
const bedrockAgent = new BedrockAgentClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

const KNOWLEDGE_BASE_ID = process.env.BEDROCK_KNOWLEDGE_BASE_ID || '';
const DATA_SOURCE_ID = process.env.BEDROCK_DATA_SOURCE_ID || '';

// Trigger knowledge base sync (ingestion job)
export const syncKnowledgeBase = async (req: Request, res: Response) => {
  try {
    if (!KNOWLEDGE_BASE_ID || !DATA_SOURCE_ID) {
      return res.status(500).json({
        success: false,
        message: 'Knowledge Base not configured. Set BEDROCK_KNOWLEDGE_BASE_ID and BEDROCK_DATA_SOURCE_ID environment variables.'
      });
    }

    // Check if there's already an ongoing sync
    const checkQuery = `
      SELECT ingestion_job_id, status 
      FROM knowledge_base_syncs 
      WHERE status IN ('STARTING', 'IN_PROGRESS')
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const checkResult = await pool.query(checkQuery);

    if (checkResult.rows.length > 0) {
      const ongoingJob = checkResult.rows[0];
      return res.status(409).json({
        success: false,
        message: `A sync is already in progress (Job ID: ${ongoingJob.ingestion_job_id})`,
        data: {
          ingestion_job_id: ongoingJob.ingestion_job_id,
          status: ongoingJob.status
        }
      });
    }

    const command = new StartIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: DATA_SOURCE_ID,
      description: 'Manual sync triggered from API'
    });

    const response = await bedrockAgent.send(command);

    // Log the sync job in database
    const user = (req as any).user;
    await pool.query(
      `INSERT INTO knowledge_base_syncs (
        knowledge_base_id,
        data_source_id,
        ingestion_job_id,
        status,
        triggered_by,
        organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        KNOWLEDGE_BASE_ID,
        DATA_SOURCE_ID,
        response.ingestionJob?.ingestionJobId,
        response.ingestionJob?.status,
        user.sub,
        user.org_id
      ]
    );

    return res.json({
      success: true,
      data: {
        ingestionJobId: response.ingestionJob?.ingestionJobId,
        status: response.ingestionJob?.status,
        knowledgeBaseId: KNOWLEDGE_BASE_ID
      },
      message: 'Knowledge base sync started successfully'
    });
  } catch (error: any) {
    console.error('Error syncing knowledge base:', error);
    
    // Handle conflict error gracefully
    if (error.name === 'ConflictException') {
      return res.status(409).json({
        success: false,
        message: 'A sync is already in progress. Please wait for it to complete.',
        error: error.message
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to sync knowledge base',
      error: error.message
    });
  }
};

// Get sync job status
export const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    if (!KNOWLEDGE_BASE_ID || !DATA_SOURCE_ID) {
      return res.status(500).json({
        success: false,
        message: 'Knowledge Base not configured'
      });
    }

    const command = new GetIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: DATA_SOURCE_ID,
      ingestionJobId: jobId as string
    });

    const response = await bedrockAgent.send(command);

    // Update status in database
    await pool.query(
      `UPDATE knowledge_base_syncs 
       SET status = $1, updated_at = NOW()
       WHERE ingestion_job_id = $2`,
      [response.ingestionJob?.status, jobId]
    );

    return res.json({
      success: true,
      data: {
        jobId: response.ingestionJob?.ingestionJobId,
        status: response.ingestionJob?.status,
        statistics: response.ingestionJob?.statistics,
        failureReasons: response.ingestionJob?.failureReasons,
        startedAt: response.ingestionJob?.startedAt,
        updatedAt: response.ingestionJob?.updatedAt
      }
    });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get sync status',
      error: error.message
    });
  }
};

// List recent sync jobs
export const listSyncJobs = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    // Get from database
    const result = await pool.query(
      `SELECT 
        ingestion_job_id,
        status,
        triggered_by,
        created_at,
        updated_at
      FROM knowledge_base_syncs
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
      [user.organizationId]
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error: any) {
    console.error('Error listing sync jobs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list sync jobs',
      error: error.message
    });
  }
};

// Auto-sync after document upload (called internally)
export const autoSyncAfterUpload = async (organizationId: string, userId: string) => {
  try {
    if (!KNOWLEDGE_BASE_ID || !DATA_SOURCE_ID) {
      console.warn('Knowledge Base not configured, skipping auto-sync');
      return;
    }

    // Check if there's already an ongoing sync
    const checkQuery = `
      SELECT ingestion_job_id, status 
      FROM knowledge_base_syncs 
      WHERE status IN ('STARTING', 'IN_PROGRESS')
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const checkResult = await pool.query(checkQuery);

    if (checkResult.rows.length > 0) {
      console.log('Sync already in progress, skipping auto-sync');
      return;
    }

    const command = new StartIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: DATA_SOURCE_ID,
      description: `Auto-sync after document upload by ${userId}`
    });

    const response = await bedrockAgent.send(command);

    // Log the sync job
    await pool.query(
      `INSERT INTO knowledge_base_syncs (
        knowledge_base_id,
        data_source_id,
        ingestion_job_id,
        status,
        triggered_by,
        organization_id,
        auto_triggered
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        KNOWLEDGE_BASE_ID,
        DATA_SOURCE_ID,
        response.ingestionJob?.ingestionJobId,
        response.ingestionJob?.status,
        userId,
        organizationId,
        true
      ]
    );

    console.log(`Auto-sync triggered: ${response.ingestionJob?.ingestionJobId}`);
  } catch (error: any) {
    // Silently skip if conflict (another sync already running)
    if (error.name === 'ConflictException') {
      console.log('Sync already in progress, skipping auto-sync');
      return;
    }
    console.error('Error in auto-sync:', error);
    // Don't throw - auto-sync failures shouldn't block document upload
  }
};