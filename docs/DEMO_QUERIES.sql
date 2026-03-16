-- ============================================================================
-- Bedrock Knowledge Base Demo - PostgreSQL Queries
-- Run these in order during the demo
-- ============================================================================

-- Connect to database first:
-- psql -U postgres -d multitenant_saas

-- ============================================================================
-- PART 1: Schema Inspection
-- ============================================================================

-- Show documents table structure with new metadata columns
\d documents

-- Show web_urls table structure
\d web_urls

-- Show knowledge_base_syncs table structure
\d knowledge_base_syncs


-- ============================================================================
-- PART 2: Current Data Overview
-- ============================================================================

-- Show all documents with complete metadata
SELECT 
  filename,
  ROUND(file_size::numeric / 1024, 2) as size_kb,
  user_id_tag,
  doc_type,
  is_confidential,
  assigned_role,
  assigned_user,
  description,
  created_at
FROM documents
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Show recent sync jobs
SELECT 
  ingestion_job_id,
  status,
  CASE WHEN auto_triggered THEN 'Auto' ELSE 'Manual' END as trigger_type,
  created_at,
  updated_at
FROM knowledge_base_syncs 
ORDER BY created_at DESC 
LIMIT 10;

-- Show web URLs (if any)
SELECT 
  url,
  doc_type,
  is_confidential,
  status,
  created_at
FROM web_urls 
WHERE deleted_at IS NULL
ORDER BY created_at DESC 
LIMIT 5;


-- ============================================================================
-- PART 3: After Upload - Verification Queries
-- ============================================================================

-- Show the most recently uploaded document
SELECT 
  filename,
  s3_key,
  user_id_tag,
  doc_type,
  is_confidential,
  assigned_role,
  assigned_user,
  description,
  tags,
  created_at
FROM documents
ORDER BY created_at DESC
LIMIT 1;

-- Show the most recent sync job (should be auto-triggered)
SELECT 
  ingestion_job_id,
  status,
  auto_triggered,
  created_at,
  updated_at
FROM knowledge_base_syncs
ORDER BY created_at DESC
LIMIT 1;


-- ============================================================================
-- PART 4: Statistics & Analytics
-- ============================================================================

-- Total documents count
SELECT COUNT(*) as total_documents 
FROM documents 
WHERE deleted_at IS NULL;

-- Documents by type
SELECT 
  doc_type,
  COUNT(*) as count 
FROM documents 
WHERE deleted_at IS NULL 
GROUP BY doc_type
ORDER BY count DESC;

-- Confidential vs Non-confidential
SELECT 
  CASE 
    WHEN is_confidential THEN 'Confidential' 
    ELSE 'Public' 
  END as confidentiality,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM documents 
WHERE deleted_at IS NULL 
GROUP BY is_confidential;

-- Documents by assigned role
SELECT 
  assigned_role,
  COUNT(*) as count 
FROM documents 
WHERE deleted_at IS NULL AND assigned_role IS NOT NULL
GROUP BY assigned_role
ORDER BY count DESC;

-- Sync job status breakdown
SELECT 
  status,
  COUNT(*) as count 
FROM knowledge_base_syncs 
GROUP BY status;

-- Auto vs Manual syncs
SELECT 
  CASE WHEN auto_triggered THEN 'Auto-triggered' ELSE 'Manual' END as sync_type,
  COUNT(*) as count 
FROM knowledge_base_syncs 
GROUP BY auto_triggered;

-- Average file size
SELECT 
  ROUND(AVG(file_size)::numeric / 1024 / 1024, 2) as avg_mb,
  ROUND(MIN(file_size)::numeric / 1024, 2) as min_kb,
  ROUND(MAX(file_size)::numeric / 1024 / 1024, 2) as max_mb
FROM documents 
WHERE deleted_at IS NULL;

-- Upload frequency (last 7 days)
SELECT 
  DATE(created_at) as upload_date,
  COUNT(*) as uploads
FROM documents
WHERE created_at > NOW() - INTERVAL '7 days'
  AND deleted_at IS NULL
GROUP BY DATE(created_at)
ORDER BY upload_date DESC;

-- Most active uploaders
SELECT 
  user_id_tag,
  COUNT(*) as uploads,
  SUM(file_size) / 1024 / 1024 as total_mb
FROM documents
WHERE deleted_at IS NULL
GROUP BY user_id_tag
ORDER BY uploads DESC
LIMIT 5;

-- Recent activity timeline
SELECT 
  filename,
  doc_type,
  created_at,
  AGE(NOW(), created_at) as time_ago
FROM documents
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 5;


-- ============================================================================
-- PART 5: Storage Efficiency
-- ============================================================================

-- Total storage used
SELECT 
  COUNT(*) as total_files,
  ROUND(SUM(file_size)::numeric / 1024 / 1024, 2) as total_mb,
  ROUND(AVG(file_size)::numeric / 1024, 2) as avg_kb
FROM documents
WHERE deleted_at IS NULL;

-- Storage by document type
SELECT 
  doc_type,
  COUNT(*) as files,
  ROUND(SUM(file_size)::numeric / 1024 / 1024, 2) as total_mb
FROM documents
WHERE deleted_at IS NULL
GROUP BY doc_type
ORDER BY total_mb DESC;


-- ============================================================================
-- PART 6: Access Control Audit
-- ============================================================================

-- Documents with no access restrictions
SELECT 
  filename,
  doc_type,
  is_confidential
FROM documents
WHERE deleted_at IS NULL
  AND assigned_role IS NULL
  AND assigned_user IS NULL
ORDER BY created_at DESC;

-- Highly restricted documents
SELECT 
  filename,
  doc_type,
  assigned_role,
  assigned_user,
  is_confidential
FROM documents
WHERE deleted_at IS NULL
  AND is_confidential = TRUE
ORDER BY created_at DESC;


-- ============================================================================
-- PART 7: Sync Performance
-- ============================================================================

-- Average sync duration (if available)
SELECT 
  status,
  COUNT(*) as jobs,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_seconds
FROM knowledge_base_syncs
GROUP BY status;

-- Recent sync failures (if any)
SELECT 
  ingestion_job_id,
  status,
  created_at,
  updated_at
FROM knowledge_base_syncs
WHERE status = 'FAILED'
ORDER BY created_at DESC
LIMIT 5;

-- Sync frequency
SELECT 
  DATE(created_at) as sync_date,
  COUNT(*) as syncs,
  SUM(CASE WHEN auto_triggered THEN 1 ELSE 0 END) as auto,
  SUM(CASE WHEN auto_triggered THEN 0 ELSE 1 END) as manual
FROM knowledge_base_syncs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY sync_date DESC;


-- ============================================================================
-- PART 8: Web URLs Analytics (if using that feature)
-- ============================================================================

-- Total web URLs
SELECT COUNT(*) as total_urls 
FROM web_urls 
WHERE deleted_at IS NULL;

-- URLs by status
SELECT 
  status,
  COUNT(*) as count
FROM web_urls
WHERE deleted_at IS NULL
GROUP BY status;


-- ============================================================================
-- PART 9: Clean Demo Data
-- ============================================================================

-- Show a clean summary for presentation
SELECT 
  'Total Documents' as metric,
  COUNT(*)::text as value
FROM documents WHERE deleted_at IS NULL
UNION ALL
SELECT 
  'Confidential Documents',
  COUNT(*)::text
FROM documents WHERE deleted_at IS NULL AND is_confidential = TRUE
UNION ALL
SELECT 
  'Total Syncs',
  COUNT(*)::text
FROM knowledge_base_syncs
UNION ALL
SELECT 
  'Auto Syncs',
  COUNT(*)::text
FROM knowledge_base_syncs WHERE auto_triggered = TRUE
UNION ALL
SELECT 
  'Storage (MB)',
  ROUND(SUM(file_size)::numeric / 1024 / 1024, 2)::text
FROM documents WHERE deleted_at IS NULL
UNION ALL
SELECT 
  'Avg File Size (KB)',
  ROUND(AVG(file_size)::numeric / 1024, 2)::text
FROM documents WHERE deleted_at IS NULL;


-- ============================================================================
-- END OF DEMO QUERIES
-- ============================================================================
