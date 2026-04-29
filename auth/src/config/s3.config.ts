// auth/src/config/s3.config.ts
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// S3 Client Configuration
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

export const S3_BUCKET = process.env.S3_BUCKET_NAME || 'multitenant-saas-documents';

// Allowed file types
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
];

// Max file size: 50MB
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Generate S3 key for uploaded file
 * Format: {organizationId}/documents/{userId}/{timestamp}-{filename}
 */
export function generateS3Key(
  organizationId: string,
  userId: string,
  filename: string
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${organizationId}/documents/${userId}/${timestamp}-${sanitizedFilename}`;
}

/**
 * Generate presigned URL for PUT operation (upload)
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  tags: Record<string, string>
): Promise<string> {
  // Convert tags to S3 tagging format
  const tagging = Object.entries(tags)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
    Tagging: tagging,
  });

  // URL expires in 15 minutes
  return await getSignedUrl(s3Client, command, { expiresIn: 900 });
}

/**
 * Generate presigned URL for GET operation (download)
 */
export async function generatePresignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  // URL expires in 1 hour
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/**
 * Delete object from S3
 */
export async function deleteS3Object(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Validate file type
 */
export function isValidFileType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

/**
 * Validate file size
 */
export function isValidFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

/**
 * Get file extension from mime type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
  };
  return mimeMap[mimeType] || 'bin';
}
