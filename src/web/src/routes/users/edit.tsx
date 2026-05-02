import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { OrgUser } from '../../types'
import { api } from '../../lib/api'

export default function EditUserPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [user, setUser] = useState<OrgUser | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    if (!id) return
    api.get<OrgUser[]>('/users').then(({ data, error: err }) => {
      if (err) { setError(err); setFetching(false); return }
      const u = (data ?? []).find((x) => x.id === id)
      if (!u) { setError('User not found'); setFetching(false); return }
      setUser(u)
      setName(u.name ?? '')
      setRole(u.role ?? 'user')
      setFetching(false)
    })
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const { error: err } = await api.patch(`/users/${id}`, { name, role })
      if (err) throw new Error(err)
      setSuccess('User updated successfully')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate('/users')}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to Users
      </button>
      <div className="page-title">Edit User</div>
      {user && <div className="page-subtitle" style={{ color: '#777' }}>{user.email}</div>}

      {error && <div className="err-bar">{error}</div>}
      {success && <div className="ok-bar">{success}</div>}

      {fetching ? (
        <div style={{ color: '#9a9a9a', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : (
        <div className="form-card">
          <div className="section-title">Profile</div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input
                className="fi"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select className="fi select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="tenant_admin">Admin</option>
                <option value="user">User</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => navigate('/users')}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spin" />}
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
