import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'

function mockPassword() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

export default function CreateUserPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<{ email: string; tempPassword: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const tempPassword = mockPassword()
    try {
      const { error: err } = await api.post('/users/invite', {
        email,
        name,
        role,
        password: tempPassword,
      })
      if (err) throw new Error(err)
      setCreated({ email, tempPassword })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (created) {
      navigator.clipboard.writeText(created.tempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (created) {
    return (
      <div className="page">
        <div className="form-card" style={{ maxWidth: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: '#f0fdf4',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="page-title" style={{ margin: 0, fontSize: 16 }}>User Created</div>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
            Account created for <strong>{created.email}</strong>. Share the temporary password below so they can sign in.
          </p>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Temporary password</div>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{
                flex: 1, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13.5,
                color: '#374151', background: '#f9f9f8', letterSpacing: '0.08em',
              }}>
                {created.tempPassword}
              </div>
              <button
                onClick={handleCopy}
                style={{
                  padding: '10px 14px', background: copied ? '#f0fdf4' : '#f5f4f1',
                  border: 'none', borderLeft: '1px solid #e5e5e5', cursor: 'pointer',
                  color: copied ? '#16a34a' : '#555', fontSize: 13, fontWeight: 500,
                  fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', transition: 'all .15s',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, padding: '10px 14px', marginBottom: 24,
          }}>
            <svg width="15" height="15" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
              Share this password securely. The user should change it after first login.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => { setCreated(null); setName(''); setEmail('') }} style={{ flex: 1 }}>
              Add Another
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/users')} style={{ flex: 1 }}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate('/users')}>
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to Users
      </button>
      <div className="page-title">Create User</div>
      <div className="page-subtitle">
        Create a new user account. A temporary password will be generated — share it with them securely.
      </div>

      {error && <div className="err-bar">{error}</div>}

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Full name <span style={{ color: '#e53e3e' }}>*</span></label>
            <input
              className="fi"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label>Email address <span style={{ color: '#e53e3e' }}>*</span></label>
            <input
              className="fi"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
            <p className="hint">Defines what the user can do within your organization.</p>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" type="button" onClick={() => navigate('/users')}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading && <span className="spin" />}
              {loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
