import React, { useState, useEffect, useRef } from 'react'
import { Organization } from '../../types'
import { api } from '../../lib/api'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

function CreateOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error: err } = await api.post<Organization>('/admin/organizations', { name })
      if (err) throw new Error(err)
      setName('')
      onCreated()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create organization" size="sm">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Organization name"
          type="text"
          placeholder="Acme Corp"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && (
          <p style={{ fontSize: 12.5, color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={loading} disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await api.get<Organization[]>('/admin/organizations')
    setOrgs(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current || !menuRef.current.contains(e.target as Node)) {
        setOpenMenuFor(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    const { error } = await api.delete(`/admin/organizations/${id}`)
    if (!error) setOrgs((prev) => prev.filter((o) => o.id !== id))
  }

  const filtered = orgs.filter((o) => {
    const q = search.toLowerCase()
    return o.name.toLowerCase().includes(q) || (o.slug ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Organizations</div>
          <div className="page-subtitle">{orgs.length} organization{orgs.length !== 1 ? 's' : ''} total</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Organization
        </button>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search organizations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No organizations found</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Members</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((org) => (
                <tr key={org.id}>
                  <td style={{ fontWeight: 500 }}>{org.name}</td>
                  <td style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 12 }}>{org.slug ?? org.id.slice(0, 8)}</td>
                  <td style={{ color: '#555' }}>{org.user_count ?? 0}</td>
                  <td style={{ color: '#9a9a9a', fontSize: 12 }}>{new Date(org.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="row-menu">
                      <button
                        className="kebab-btn"
                        onClick={() => setOpenMenuFor(openMenuFor === org.id ? null : org.id)}
                        aria-label="Actions"
                      >
                        <span className="kebab-ellipsis">&#8943;</span>
                      </button>
                      {openMenuFor === org.id && (
                        <div
                          className="kebab-dropdown"
                          ref={menuRef}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="kebab-item kebab-danger"
                            onClick={() => { setOpenMenuFor(null); handleDelete(org.id, org.name) }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  )
}
