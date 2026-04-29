# Multi-Tenant SaaS Platform - Bedrock Knowledge Base Demo

## 🎯 Overview
This demo showcases our complete S3 + PostgreSQL + AWS Bedrock Knowledge Base integration with vector embeddings for AI-powered document retrieval.

---

## 🏗️ Architecture: Triple Storage System

```
Document Upload Flow:
┌─────────────┐
│   Upload    │
│  Document   │
└──────┬──────┘
       │
       ├──────────────────────────────────────────────┐
       │                                              │
       v                                              v
┌────────────────┐                          ┌──────────────────┐
│   S3 Storage   │                          │   PostgreSQL     │
│                │                          │                  │
│ • Binary File  │                          │ • Metadata       │
│ • Tags         │                          │ • s3_key ref     │
│ • Versioning   │◄─────references──────────│ • Fast queries   │
└────────┬───────┘                          └──────────────────┘
         │
         │ Auto-sync trigger
         v
┌────────────────────────┐
│  Bedrock Knowledge Base│
│                        │
│ • Text extraction      │
│ • Chunking (300 tokens)│
│ • Vector embeddings    │
│   (1536 dimensions)    │
│ • OpenSearch Serverless│
│ • RAG-ready            │
└────────────────────────┘
```

---

## 📋 Pre-Demo Setup

### 1. Database Connection
```bash
psql -U postgres -d multitenant_saas
```

### 2. Verify Infrastructure
```bash
# Check S3 bucket
aws s3 ls s3://multitenant-saas-documents-dev/ --profile DevAdministratorAccess-385143640249

# Check Knowledge Base
aws bedrock-agent get-knowledge-base \
  --knowledge-base-id Z3AFBRV6EQ \
  --region us-east-1 \
  --profile DevAdministratorAccess-385143640249

# Check OpenSearch collection
aws opensearchserverless list-collections \
  --region us-east-1 \
  --profile DevAdministratorAccess-385143640249
```

---

## 🎬 Demo Script

### Step 1: Show Database Schema

```sql
-- Show documents table with new metadata columns
\d documents

-- Highlight these new columns:
-- • user_id_tag       (S3 tag: user-id)
-- • doc_type          (S3 tag: doc-type)
-- • is_confidential   (S3 tag: confidential)
-- • assigned_role     (S3 tag: role)
-- • assigned_user     (S3 tag: specific-user)
-- • description       (user-provided description)
```

**💬 Talking Point:** "We've enhanced our documents table with dedicated metadata columns that capture access control, classification, and ownership information."

---

### Step 2: Show Web URLs Table

```sql
-- Show web_urls table structure
\d web_urls

-- Show any existing URLs
SELECT url, doc_type, is_confidential, status, created_at 
FROM web_urls 
ORDER BY created_at DESC 
LIMIT 5;
```

**💬 Talking Point:** "We can now ingest content from web URLs with the same metadata structure as uploaded documents."

---

### Step 3: Show Knowledge Base Sync Tracking

```sql
-- Show sync tracking table
\d knowledge_base_syncs

-- Show recent sync jobs
SELECT 
  ingestion_job_id,
  status,
  auto_triggered,
  created_at,
  updated_at
FROM knowledge_base_syncs 
ORDER BY created_at DESC 
LIMIT 5;
```

**💬 Talking Point:** "Every sync to our vector database is tracked. Auto-triggered syncs happen after document uploads, and manual syncs can be triggered on-demand."

---

### Step 4: Current State - Show Existing Data

```sql
-- Show documents with complete metadata
SELECT 
  filename,
  file_size / 1024 as size_kb,
  user_id_tag,
  doc_type,
  is_confidential,
  assigned_role,
  description,
  created_at
FROM documents
ORDER BY created_at DESC
LIMIT 10;
```

**💬 Talking Point:** "Here are our existing documents with their metadata. Notice the rich classification and access control information."

---

### Step 5: Live Upload Demo

**Action:** Go to the Documents page in the frontend

1. **Click "Choose file"** → Upload modal appears
2. **Show Metadata Form:**
   - User ID: `demo-user`
   - Document Type: `technical-spec`
   - ✓ Confidential checkbox
   - Assigned Role: `admin`
   - Description: `Q4 Technical Specifications`
3. **Upload the file**

**💬 Talking Point:** "Watch the triple-storage workflow in action. This single upload triggers three storage operations."

---

### Step 6: Verify S3 Storage

```bash
# Show the file in S3 with tags
aws s3api list-objects-v2 \
  --bucket multitenant-saas-documents-dev \
  --prefix "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/documents/" \
  --query 'Contents[0].[Key,Size,LastModified]' \
  --profile DevAdministratorAccess-385143640249

# Show object tags
aws s3api get-object-tagging \
  --bucket multitenant-saas-documents-dev \
  --key "<S3_KEY_FROM_ABOVE>" \
  --profile DevAdministratorAccess-385143640249
```

**💬 Talking Point:** "The file is stored in S3 with tags for user-id, doc-type, confidential status, and role assignment."

---

### Step 7: Verify PostgreSQL Entry

```sql
-- Show the newly uploaded document
SELECT 
  filename,
  s3_key,
  user_id_tag,
  doc_type,
  is_confidential,
  assigned_role,
  description,
  created_at
FROM documents
ORDER BY created_at DESC
LIMIT 1;
```

**💬 Talking Point:** "PostgreSQL stores the metadata and a reference to the S3 key. This enables fast querying without hitting S3."

---

### Step 8: Show Auto-Sync Triggered

```sql
-- Show the auto-triggered sync job
SELECT 
  ingestion_job_id,
  status,
  auto_triggered,
  created_at
FROM knowledge_base_syncs
ORDER BY created_at DESC
LIMIT 1;
```

**💬 Talking Point:** "Notice auto_triggered is TRUE. The system automatically started vectorizing the document after upload."

---

### Step 9: Check Bedrock Ingestion Job Status

```bash
# Get the job ID from the previous query, then:
aws bedrock-agent get-ingestion-job \
  --knowledge-base-id Z3AFBRV6EQ \
  --data-source-id 0EBLZQZTBA \
  --ingestion-job-id <JOB_ID_FROM_QUERY> \
  --region us-east-1 \
  --profile DevAdministratorAccess-385143640249
```

**💬 Talking Point:** "The ingestion job extracts text, chunks it into 300-token segments with 20% overlap, and generates 1536-dimensional embeddings using Amazon Titan."

---

### Step 10: Show Knowledge Base in AWS Console

**Action:** Open AWS Console → Bedrock → Knowledge bases → `dev-document-kb`

**Show:**
1. **Overview:** Collection details, vector index
2. **Data sources:** S3 bucket configuration
3. **Sync history:** Recent ingestion jobs and their status

**💬 Talking Point:** "This is our vector database. Each document chunk is now searchable via semantic similarity for AI-powered retrieval."

---

### Step 11: Query Statistics

```sql
-- Total documents
SELECT COUNT(*) as total_documents FROM documents WHERE deleted_at IS NULL;

-- Documents by type
SELECT doc_type, COUNT(*) as count 
FROM documents 
WHERE deleted_at IS NULL 
GROUP BY doc_type
ORDER BY count DESC;

-- Confidential vs Non-confidential
SELECT 
  is_confidential,
  COUNT(*) as count 
FROM documents 
WHERE deleted_at IS NULL 
GROUP BY is_confidential;

-- Total sync jobs
SELECT 
  status,
  COUNT(*) as count 
FROM knowledge_base_syncs 
GROUP BY status;

-- Auto vs Manual syncs
SELECT 
  auto_triggered,
  COUNT(*) as count 
FROM knowledge_base_syncs 
GROUP BY auto_triggered;
```

**💬 Talking Point:** "Here's our current usage statistics across all three storage systems."

---

### Step 12: Show Web URLs Feature

**Action:** Go to Web URLs page

1. **Enter URL:** `https://aws.amazon.com/bedrock/`
2. **Fill metadata** (same form as documents)
3. **Click "Add URL"**

```sql
-- Verify URL was added
SELECT * FROM web_urls ORDER BY created_at DESC LIMIT 1;
```

**💬 Talking Point:** "We can also ingest content from web URLs, not just uploaded files. Same metadata structure, same vectorization workflow."

---

### Step 13: Knowledge Base Sync Component

**Action:** Show the "Sync Now" button on Documents page

**Demonstrate:**
1. Click "Sync Now"
2. Show status indicator
3. Explain one-sync-at-a-time constraint

**💬 Talking Point:** "Users can manually trigger syncs, but the system prevents concurrent jobs to avoid conflicts. Auto-sync happens automatically after uploads."

---

## 🎯 Key Technical Achievements

### 1. **Triple Storage Architecture**
- ✅ S3 for binary files with tags
- ✅ PostgreSQL for fast metadata queries
- ✅ OpenSearch Serverless for vector search

### 2. **Rich Metadata System**
- ✅ User identification
- ✅ Document classification
- ✅ Access control (role/user-based)
- ✅ Confidentiality flags
- ✅ Descriptions and tags

### 3. **Automated Vectorization**
- ✅ Auto-sync after uploads
- ✅ Background processing
- ✅ Job status tracking
- ✅ Conflict prevention

### 4. **Multi-Source Ingestion**
- ✅ File uploads
- ✅ Web URLs
- ✅ Same metadata for both

### 5. **Infrastructure as Code**
- ✅ Terraform for all AWS resources
- ✅ Database migrations for schema changes
- ✅ Reproducible across environments

---

## 📊 Performance Metrics

```sql
-- Average file size
SELECT 
  AVG(file_size) / 1024 / 1024 as avg_mb,
  MIN(file_size) / 1024 as min_kb,
  MAX(file_size) / 1024 / 1024 as max_mb
FROM documents 
WHERE deleted_at IS NULL;

-- Upload frequency (last 7 days)
SELECT 
  DATE(created_at) as upload_date,
  COUNT(*) as uploads
FROM documents
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY upload_date;

-- Most active users
SELECT 
  user_id_tag,
  COUNT(*) as uploads
FROM documents
WHERE deleted_at IS NULL
GROUP BY user_id_tag
ORDER BY uploads DESC
LIMIT 5;
```

---

## 🔮 Next Steps (Day 4)

### Agentic RAG Chat Implementation
- Connect AI Assistant page to Bedrock Knowledge Base
- Query vector store with user prompts
- Retrieve relevant document chunks
- Generate contextual responses using Claude

**Demo Preview:** "In our next update, the AI Assistant will be able to answer questions by searching through all vectorized documents."

---

## 🛠️ Technical Stack

- **Storage:** AWS S3 + PostgreSQL + OpenSearch Serverless
- **AI/ML:** AWS Bedrock (Titan Embeddings, Claude)
- **Infrastructure:** Terraform
- **Backend:** Node.js + Express + TypeScript
- **Frontend:** Next.js + React + TypeScript
- **Database:** PostgreSQL with RLS policies

---

## 📝 Commands Quick Reference

```bash
# Connect to database
psql -U postgres -d multitenant_saas

# Check S3 bucket
aws s3 ls s3://multitenant-saas-documents-dev/ --profile DevAdministratorAccess-385143640249

# Check Knowledge Base
aws bedrock-agent get-knowledge-base --knowledge-base-id Z3AFBRV6EQ --region us-east-1

# Check sync job
aws bedrock-agent get-ingestion-job --knowledge-base-id Z3AFBRV6EQ --data-source-id 0EBLZQZTBA --ingestion-job-id <JOB_ID> --region us-east-1

# List sync history
aws bedrock-agent list-ingestion-jobs --knowledge-base-id Z3AFBRV6EQ --data-source-id 0EBLZQZTBA --region us-east-1
```

---

## ✅ Demo Checklist

Before the demo, ensure:
- [ ] Backend is running (`npm run dev` in auth/)
- [ ] Frontend is running (`npm run dev` in frontend/)
- [ ] Database is accessible
- [ ] AWS credentials are configured
- [ ] Have a test document ready to upload
- [ ] Have a test URL ready to add
- [ ] Browser is open to the application
- [ ] Terminal windows are prepared with commands

---

**End of Demo Script**
