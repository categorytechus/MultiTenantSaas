// ── Auth ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  name: string
  role: 'super_admin' | 'tenant_admin' | 'user' | 'viewer'
  org_id: string
  created_at: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  name: string
}

// ── Organization ──────────────────────────────────────────────────────────────
export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  user_count?: number
}

// ── Document ──────────────────────────────────────────────────────────────────
export type DocumentStatus = 'processing' | 'ready' | 'failed' | 'blocked'
export type DocumentCategory = 'document' | 'image'

export interface Document {
  id: string
  filename: string
  // Backend field names
  mime_type: string
  size_bytes: number
  status: DocumentStatus
  s3_key?: string
  created_at: string
  download_url?: string | null
  org_id?: string
  // Derived/compat
  file_type: string      // alias for mime_type (set in hook)
  size: number           // alias for size_bytes (set in hook)
  category: DocumentCategory  // derived from mime_type
  updated_at: string     // alias for created_at
}

export interface DocumentsResponse {
  items: Document[]
  total: number
  page: number
  size: number
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export type MessageRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: string
  streaming?: boolean
}

export interface ChatSession {
  id: string
  title?: string | null
  created_at: string
}

// ── Agent ─────────────────────────────────────────────────────────────────────
export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AgentTask {
  task_id: string
  type: string
  question: string
  status: AgentTaskStatus
  result?: AgentTaskResult
  created_at: string
}

export interface AgentTaskResult {
  answer: string
  sql?: string
  rows?: Record<string, unknown>[]
  columns?: string[]
  steps?: AgentStep[]
}

export interface AgentStep {
  name: 'plan' | 'generate' | 'validate' | 'execute' | 'format'
  status: 'pending' | 'running' | 'completed' | 'failed'
  detail?: string
}

// ── Users ─────────────────────────────────────────────────────────────────────
export interface OrgUser {
  id: string
  name: string
  email: string
  role: 'tenant_admin' | 'user' | 'viewer'
  created_at: string
}

// ── API helpers ───────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T | null
  error: string | null
  status: number
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
export interface DashboardStats {
  total: number
  success: number
  error: number
  successRate: number
}

export interface ChartDataPoint {
  date: string
  count: number
}
