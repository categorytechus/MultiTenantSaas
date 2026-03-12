// auth/src/controllers/document.controller.ts
import { Request, Response } from 'express';
import pool  from '../config/database';
import {
  generateS3Key,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  deleteS3Object,
  isValidFileType,
  isValidFileSize,
  S3_BUCKET,
} from '../config/s3.config';
import { autoSyncAfterUpload } from './knowledgebase.controller';

/**
 * Generate presigned URL for file upload
 * POST /api/documents/presigned-url
 */
export async function generateUploadUrl(req: Request, res: Response) {
  try {
    const { filename, contentType, fileSize, tags } = req.body;
    const userId = (req as any).user.userId;
    const organizationId = (req as any).user.organizationId;

    // Validation
    if (!filename || !contentType || !fileSize) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: filename, contentType, fileSize',
      });
    }

    if (!isValidFileType(contentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Allowed: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, JPG, PNG, GIF',
      });
    }

    if (!isValidFileSize(fileSize)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file size. Maximum 50MB allowed',
      });
    }

    // Generate S3 key
    const s3Key = generateS3Key(organizationId, userId, filename);

    // Prepare S3 tags (now including new metadata tags)
    const s3Tags = {
      'user-id': tags?.['user-id'] || userId,
      'org-id': organizationId,
      owner: tags?.owner || userId,
      category: tags?.category || 'general',
      status: tags?.status || 'active',
      ...(tags?.['doc-type'] && { 'doc-type': tags['doc-type'] }),
      ...(tags?.confidential && { confidential: tags.confidential }),
      ...(tags?.role && { role: tags.role }),
      ...(tags?.['specific-user'] && { 'specific-user': tags['specific-user'] }),
    };

    // Generate presigned URL
    const uploadUrl = await generatePresignedUploadUrl(s3Key, contentType, s3Tags);

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        s3Key,
        bucket: S3_BUCKET,
        expiresIn: 900, // 15 minutes
      },
    });
  } catch (error: any) {
    console.error('Error generating presigned URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
      error: error.message,
    });
  }
}

/**
 * Save document metadata after successful upload
 * POST /api/documents
 */
export async function createDocument(req: Request, res: Response) {
  try {
    const { filename, s3Key, fileSize, mimeType, tags, description } = req.body;
    const userId = (req as any).user.userId;
    const organizationId = (req as any).user.organizationId;

    // Validation
    if (!filename || !s3Key || !fileSize || !mimeType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Extract metadata from tags for dedicated columns
    const userIdTag = tags?.['user-id'] || null;
    const docType = tags?.['doc-type'] || null;
    const isConfidential = tags?.confidential === 'true' || tags?.confidential === true;
    const assignedRole = tags?.role || null;
    const assignedUser = tags?.['specific-user'] || null;

    const query = `
      INSERT INTO documents (
        filename,
        original_filename,
        s3_key,
        s3_bucket,
        file_size,
        mime_type,
        user_id,
        organization_id,
        user_id_tag,
        doc_type,
        is_confidential,
        assigned_role,
        assigned_user,
        tags,
        description,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      filename,
      filename,
      s3Key,
      S3_BUCKET,
      fileSize,
      mimeType,
      userId,
      organizationId,
      userIdTag,
      docType,
      isConfidential,
      assignedRole,
      assignedUser,
      JSON.stringify(tags || {}),
      description || null,
      'active',
    ];

    const result = await pool.query(query, values);

    // Trigger auto-sync to Knowledge Base (non-blocking)
    autoSyncAfterUpload(organizationId, userId).catch(err => {
      console.error('Auto-sync failed:', err);
    });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error saving document metadata:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save document',
      error: error.message,
    });
  }
}

/**
 * List documents with filtering
 * GET /api/documents
 */
export async function listDocuments(req: Request, res: Response) {
  try {
    const organizationId = (req as any).user.organizationId;
    const { tag, status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        id,
        filename,
        original_filename,
        s3_key,
        file_size,
        mime_type,
        user_id_tag,
        doc_type,
        is_confidential,
        assigned_role,
        assigned_user,
        tags,
        description,
        status,
        created_at,
        updated_at
      FROM documents
      WHERE organization_id = $1 AND deleted_at IS NULL
    `;

    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Filter by tag
    if (tag) {
      query += ` AND tags @> $${paramIndex}::jsonb`;
      values.push(JSON.stringify({ [tag.toString().split(':')[0]]: tag.toString().split(':')[1] }));
      paramIndex++;
    }

    // Filter by status
    if (status) {
      query += ` AND status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(Number(limit), Number(offset));

    const result = await pool.query(query, values);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: result.rowCount,
      },
    });
  } catch (error: any) {
    console.error('Error listing documents:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list documents',
      error: error.message,
    });
  }
}

/**
 * Get document by ID with download URL
 * GET /api/documents/:id
 */
export async function getDocument(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const organizationId = (req as any).user.organizationId;

    const query = `
      SELECT * FROM documents
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;

    const result = await pool.query(query, [id, organizationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const document = result.rows[0];

    // Generate download URL
    const downloadUrl = await generatePresignedDownloadUrl(document.s3_key);

    return res.status(200).json({
      success: true,
      data: {
        ...document,
        downloadUrl,
        downloadUrlExpiresIn: 3600, // 1 hour
      },
    });
  } catch (error: any) {
    console.error('Error getting document:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get document',
      error: error.message,
    });
  }
}

/**
 * Update document metadata and tags
 * PATCH /api/documents/:id
 */
export async function updateDocument(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { tags, description, status } = req.body;
    const organizationId = (req as any).user.organizationId;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (tags) {
      updates.push(`tags = $${paramIndex}`);
      values.push(JSON.stringify(tags));
      paramIndex++;

      // Also update dedicated metadata columns if tags change
      const userIdTag = tags?.['user-id'];
      const docType = tags?.['doc-type'];
      const isConfidential = tags?.confidential === 'true' || tags?.confidential === true;
      const assignedRole = tags?.role;
      const assignedUser = tags?.['specific-user'];

      if (userIdTag !== undefined) {
        updates.push(`user_id_tag = $${paramIndex}`);
        values.push(userIdTag);
        paramIndex++;
      }
      if (docType !== undefined) {
        updates.push(`doc_type = $${paramIndex}`);
        values.push(docType);
        paramIndex++;
      }
      if (tags.confidential !== undefined) {
        updates.push(`is_confidential = $${paramIndex}`);
        values.push(isConfidential);
        paramIndex++;
      }
      if (assignedRole !== undefined) {
        updates.push(`assigned_role = $${paramIndex}`);
        values.push(assignedRole);
        paramIndex++;
      }
      if (assignedUser !== undefined) {
        updates.push(`assigned_user = $${paramIndex}`);
        values.push(assignedUser);
        paramIndex++;
      }
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }

    if (status) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    values.push(id, organizationId);

    const query = `
      UPDATE documents
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1} AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error updating document:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update document',
      error: error.message,
    });
  }
}

/**
 * Delete document (soft delete + S3 deletion)
 * DELETE /api/documents/:id
 */
export async function deleteDocument(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const organizationId = (req as any).user.organizationId;

    // Get document info
    const query = `
      SELECT * FROM documents
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;

    const result = await pool.query(query, [id, organizationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const document = result.rows[0];

    // Delete from S3
    await deleteS3Object(document.s3_key);

    // Soft delete in database
    const deleteQuery = `
      UPDATE documents
      SET deleted_at = CURRENT_TIMESTAMP, status = 'deleted'
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `;

    await pool.query(deleteQuery, [id, organizationId]);

    return res.status(200).json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message,
    });
  }
}