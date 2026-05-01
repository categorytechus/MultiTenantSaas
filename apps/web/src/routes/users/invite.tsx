import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'

export default function InviteUserPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupLink, setSignupLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: err } = await api.post('/users/invite', { email, role })
      if (err) throw new Error(err)
      const link = `${window.location.origin}/login`
      setSignupLink(link)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite user')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (signupLink) {
      navigator.clipboard.writeText(signupLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (signupLink) {
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
            <div className="page-title" style={{ margin: 0, fontSize: 16 }}>User Invited</div>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
            <strong>{email}</strong> has been added to your organization. Share the login link so they can sign in.
          </p>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Login link</div>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{
                flex: 1, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12.5,
                color: '#374151', background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
              }}>
                {signupLink}
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
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 8, padding: '10px 14px', marginBottom: 24,
          }}>
            <svg width="15" height="15" fill="none" stroke="#2563eb" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ fontSize: 12, color: '#1d4ed8', margin: 0, lineHeight: 1.5 }}>
              The user account has been created. You may need to share their temporary password separately if they don't have one yet.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => { setSignupLink(null); setEmail('') }} style={{ flex: 1 }}>
              Invite Another
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
      <div className="page-title">Invite User</div>
      <div className="page-subtitle">
        Add a user to your organization by email address.
      </div>

      {error && <div className="err-bar">{error}</div>}

      <div className="form-card">
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email address <span style={{ color: '#e53e3e' }}>*</span></label>
            <input
              className="fi"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <p className="hint">The user will be added to your organization immediately.</p>
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
              {loading ? 'Inviting…' : 'Invite User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
