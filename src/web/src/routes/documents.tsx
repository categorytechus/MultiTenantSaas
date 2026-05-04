import React, { useState, useRef, useCallback } from 'react'
import { Upload, Search, Trash2, Eye, FileText, Image, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useDocuments, useUploadDocument, useDeleteDocument } from '../hooks/useDocuments'
import { Document } from '../types'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { StatusBadge, Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'

const PAGE_SIZE = 10

const spinKeyframes = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { mutateAsync: upload, isPending } = useUploadDocument()

  const ALLOWED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ]
  const MAX_SIZE = 50 * 1024 * 1024 // 50MB

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type) && !file.name.endsWith('.md')) {
      return 'Only PDF, DOCX, TXT, and MD files are allowed.'
    }
    if (file.size > MAX_SIZE) {
      return 'File size must be under 50MB.'
    }
    return null
  }

  const handleFileSelect = (file: File) => {
    const err = validateFile(file)
    if (err) {
      setUploadError(err)
      setSelectedFile(null)
    } else {
      setUploadError(null)
      setSelectedFile(file)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [])

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploadError(null)
    try {
      await upload(selectedFile)
      setUploadSuccess(true)
      setSelectedFile(null)
      setTimeout(() => {
        setUploadSuccess(false)
        onClose()
      }, 1500)
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    }
  }

  const handleClose = () => {
    setSelectedFile(null)
    setUploadError(null)
    setUploadSuccess(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload document" size="md">
      {uploadSuccess ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
          <p style={{ fontSize: 13.5, color: '#16a34a', fontWeight: 500 }}>
            Document uploaded! Processing...
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#1a1a1a' : selectedFile ? '#16a34a' : '#e5e5e5'}`,
              borderRadius: 10,
              padding: '32px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: dragOver ? '#f9f9f9' : selectedFile ? '#f0fdf4' : '#fafafa',
              transition: 'all 0.12s ease',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            {selectedFile ? (
              <>
                <FileText size={28} style={{ color: '#16a34a', margin: '0 auto 8px' }} />
                <p style={{ fontSize: 13.5, fontWeight: 500, color: '#16a34a' }}>
                  {selectedFile.name}
                </p>
                <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {formatBytes(selectedFile.size)}
                </p>
              </>
            ) : (
              <>
                <Upload size={28} style={{ color: '#bbb', margin: '0 auto 10px' }} />
                <p style={{ fontSize: 13.5, fontWeight: 500, color: '#555' }}>
                  Drop a file here, or{' '}
                  <span style={{ color: '#1a1a1a', textDecoration: 'underline' }}>browse</span>
                </p>
                <p style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>
                  PDF, DOCX, TXT, MD — max 50MB
                </p>
              </>
            )}
          </div>

          {uploadError && (
            <p style={{ fontSize: 12.5, color: '#e53e3e', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
              {uploadError}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={!selectedFile}
              loading={isPending}
            >
              Upload
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({
  open,
  doc,
  onClose,
}: {
  open: boolean
  doc: Document | null
  onClose: () => void
}) {
  const { mutateAsync: del, isPending } = useDeleteDocument()

  const handleDelete = async () => {
    if (!doc) return
    await del(doc.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete document" size="sm">
      <p style={{ fontSize: 13.5, color: '#555', marginBottom: 20 }}>
        Are you sure you want to delete{' '}
        <strong style={{ color: '#1a1a1a' }}>{doc?.filename}</strong>? This action cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={handleDelete} loading={isPending}>
          Delete
        </Button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useDocuments({
    page,
    size: PAGE_SIZE,
    search: search || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  })

  const docs = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{spinKeyframes}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
            Documents
          </h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            Manage and search your knowledge base documents.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh document statuses"
          >
            <RefreshCw size={14} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={14} />
            Upload document
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="Search by filename..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            leftIcon={<Search size={14} />}
            style={{ width: 220 }}
          />
          <Button type="submit" variant="secondary" size="sm">Search</Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
            >
              Clear
            </Button>
          )}
        </form>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); setPage(1) }}
          style={{
            padding: '7px 10px',
            border: '1px solid #e5e5e5',
            borderRadius: 7,
            fontSize: 12.5,
            color: '#555',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
        <span style={{ fontSize: 12, color: '#bbb' }}>—</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => { setToDate(e.target.value); setPage(1) }}
          style={{
            padding: '7px 10px',
            border: '1px solid #e5e5e5',
            borderRadius: 7,
            fontSize: 12.5,
            color: '#555',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
      </div>

      {/* Table */}
      <div
        style={{
          backgroundColor: 'white',
          border: '1px solid #ebebeb',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        {/* Table header */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
              {['File Name', 'Category', 'Type', 'Size', 'Status', 'Date Modified', 'Actions'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: '#888',
                    letterSpacing: '0.3px',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center' }}>
                  <Spinner />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#e53e3e', fontSize: 13 }}>
                  Failed to load documents.
                </td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                  No documents found.
                </td>
              </tr>
            ) : (
              docs.map((doc, i) => (
                <tr
                  key={doc.id}
                  style={{
                    borderBottom: i < docs.length - 1 ? '1px solid #f5f5f5' : 'none',
                    transition: 'background-color 0.1s',
                  }}
                  onMouseEnter={(e) => { ;(e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#fafafa' }}
                  onMouseLeave={(e) => { ;(e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent' }}
                >
                  {/* Filename */}
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <FileText size={14} style={{ color: '#aaa', flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <span style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {doc.extracted_title || doc.filename}
                        </span>
                        {doc.extracted_title && (
                          <span style={{ fontSize: 11, color: '#aaa', display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {doc.filename}
                          </span>
                        )}
                        {doc.keywords && doc.keywords.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4, maxWidth: 240 }}>
                            {doc.keywords.slice(0, 4).map((kw) => (
                              <span key={kw} style={{ fontSize: 10, background: '#f0f4ff', color: '#4a6fa5', borderRadius: 4, padding: '1px 5px', fontWeight: 500 }}>
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* Category */}
                  <td style={{ padding: '11px 14px' }}>
                    {doc.category === 'image' ? (
                      <Badge variant="purple">
                        <Image size={10} style={{ marginRight: 3 }} />
                        Image
                      </Badge>
                    ) : (
                      <Badge variant="blue">
                        <FileText size={10} style={{ marginRight: 3 }} />
                        Document
                      </Badge>
                    )}
                  </td>
                  {/* MIME */}
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>{doc.file_type || '—'}</span>
                  </td>
                  {/* Size */}
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>{formatBytes(doc.size)}</span>
                  </td>
                  {/* Status */}
                  <td style={{ padding: '11px 14px' }} title={doc.summary || undefined}>
                    <StatusBadge status={doc.status} />
                  </td>
                  {/* Date */}
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>{formatDate(doc.updated_at)}</span>
                  </td>
                  {/* Actions */}
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        title="View"
                        style={{
                          padding: '5px 8px',
                          border: '1px solid #e5e5e5',
                          borderRadius: 6,
                          backgroundColor: 'white',
                          cursor: 'pointer',
                          color: '#555',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => setDeleteDoc(doc)}
                        style={{
                          padding: '5px 8px',
                          border: '1px solid #e5e5e5',
                          borderRadius: 6,
                          backgroundColor: 'white',
                          cursor: 'pointer',
                          color: '#e53e3e',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 16,
          }}
        >
          <p style={{ fontSize: 12.5, color: '#888' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} documents
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '6px 10px',
                border: '1px solid #e5e5e5',
                borderRadius: 6,
                backgroundColor: 'white',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.5 : 1,
                color: '#555',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - page) <= 2)
              .map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    padding: '6px 10px',
                    border: `1px solid ${p === page ? '#1a1a1a' : '#e5e5e5'}`,
                    borderRadius: 6,
                    backgroundColor: p === page ? '#1a1a1a' : 'white',
                    color: p === page ? 'white' : '#555',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    minWidth: 32,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  {p}
                </button>
              ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                padding: '6px 10px',
                border: '1px solid #e5e5e5',
                borderRadius: 6,
                backgroundColor: 'white',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.5 : 1,
                color: '#555',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DeleteConfirm
        open={!!deleteDoc}
        doc={deleteDoc}
        onClose={() => setDeleteDoc(null)}
      />
    </div>
  )
}
