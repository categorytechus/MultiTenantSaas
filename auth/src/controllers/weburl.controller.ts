import { Request, Response } from 'express';
import pool from '../config/database';

// Create web URL with metadata
export const createWebUrl = async (req: Request, res: Response) => {
  try {
    const { url, title, tags, description } = req.body;
    const user = (req as any).user;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    // Extract metadata from tags
    const userIdTag = tags?.['user-id'] || null;
    const docType = tags?.['doc-type'] || null;
    const isConfidential = tags?.['confidential'] === 'true';
    const assignedRole = tags?.['role'] || null;
    const assignedUser = tags?.['specific-user'] || null;

    const query = `
      INSERT INTO web_urls (
        organization_id,
        uploaded_by,
        url,
        title,
        user_id_tag,
        doc_type,
        is_confidential,
        assigned_role,
        assigned_user,
        description,
        tags,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      user.organizationId,
      user.userId,
      url,
      title || null,
      userIdTag,
      docType,
      isConfidential,
      assignedRole,
      assignedUser,
      description || null,
      JSON.stringify(tags || {}),
      'active'
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Web URL saved successfully'
    });
  } catch (error: any) {
    console.error('Error creating web URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save web URL',
      error: error.message
    });
  }
};

// Get all web URLs for organization
export const getWebUrls = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const query = `
      SELECT 
        id,
        url,
        title,
        user_id_tag,
        doc_type,
        is_confidential,
        assigned_role,
        assigned_user,
        description,
        tags,
        status,
        created_at,
        updated_at
      FROM web_urls
      WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [user.organizationId]);

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error: any) {
    console.error('Error fetching web URLs:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch web URLs',
      error: error.message
    });
  }
};

// Get single web URL
export const getWebUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const query = `
      SELECT * FROM web_urls
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;
    const result = await pool.query(query, [id, user.organizationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Web URL not found'
      });
    }

    return res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error fetching web URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch web URL',
      error: error.message
    });
  }
};

// Update web URL
export const updateWebUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { url, title, tags, description } = req.body;
    const user = (req as any).user;

    // Check if URL exists
    const checkQuery = `
      SELECT id FROM web_urls
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;
    const checkResult = await pool.query(checkQuery, [id, user.organizationId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Web URL not found'
      });
    }

    // Extract metadata from tags
    const userIdTag = tags?.['user-id'];
    const docType = tags?.['doc-type'];
    const isConfidential = tags?.['confidential'] === 'true';
    const assignedRole = tags?.['role'];
    const assignedUser = tags?.['specific-user'];

    const updateQuery = `
      UPDATE web_urls
      SET 
        url = COALESCE($1, url),
        title = COALESCE($2, title),
        user_id_tag = COALESCE($3, user_id_tag),
        doc_type = COALESCE($4, doc_type),
        is_confidential = COALESCE($5, is_confidential),
        assigned_role = COALESCE($6, assigned_role),
        assigned_user = COALESCE($7, assigned_user),
        description = COALESCE($8, description),
        tags = COALESCE($9, tags)
      WHERE id = $10 AND organization_id = $11
      RETURNING *
    `;

    const values = [
      url || null,
      title || null,
      userIdTag || null,
      docType || null,
      isConfidential,
      assignedRole || null,
      assignedUser || null,
      description || null,
      JSON.stringify(tags || {}),
      id,
      user.organizationId
    ];

    const result = await pool.query(updateQuery, values);

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Web URL updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating web URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update web URL',
      error: error.message
    });
  }
};

// Delete web URL (soft delete)
export const deleteWebUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    // Check if URL exists
    const checkQuery = `
      SELECT id FROM web_urls
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;
    const checkResult = await pool.query(checkQuery, [id, user.organizationId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Web URL not found'
      });
    }

    // Soft delete
    const deleteQuery = `
      UPDATE web_urls
      SET deleted_at = NOW()
      WHERE id = $1 AND organization_id = $2
    `;
    await pool.query(deleteQuery, [id, user.organizationId]);

    return res.json({
      success: true,
      message: 'Web URL deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting web URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete web URL',
      error: error.message
    });
  }
};