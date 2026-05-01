import React, { useState } from 'react'
import { User, Mail, Shield } from 'lucide-react'
import { useAuthContext } from '../App'
import { api } from '../lib/api'
import { Badge } from '../components/ui/Badge'

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    super_admin: 'Super Admin',
    tenant_admin: 'Admin',
    user: 'User',
    viewer: 'Viewer',
  }
  return map[role] ?? role
}

function roleBadgeVariant(role: string) {
  if (role === 'super_admin') return 'error' as const
  if (role === 'tenant_admin') return 'purple' as const
  return 'default' as const
}

export default function ProfilePage() {
  const { user, refetch } = useAuthContext()
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile')

  // Profile tab state
  const [name, setName] = useState(user?.name ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  // Password tab state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    setSaveSuccess(false)
    setSaving(true)
    const { error } = await api.patch('/auth/me', { name })
    if (error) {
      setSaveError(error)
    } else {
      setSaveSuccess(true)
      refetch()
      setTimeout(() => setSaveSuccess(false), 3000)
    }
    setSaving(false)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match')
      return
    }
    setPwSaving(true)
    const { error } = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
    if (error) {
      setPwError(error)
    } else {
      setPwSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPwSuccess(false), 3000)
    }
    setPwSaving(false)
  }

  if (!user) return null

  const tabStyle = (tab: 'profile' | 'password'): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: `2px solid ${activeTab === tab ? '#1a1a1a' : 'transparent'}`,
    background: 'none',
    cursor: 'pointer',
    fontSize: 13.5,
    fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? '#1a1a1a' : '#888',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.1s',
    marginBottom: -1,
  })

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    border: '1px solid #e5e5e5',
    borderRadius: 7,
    fontSize: 13,
    color: '#1a1a1a',
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
    width: '100%',
    transition: 'border-color 0.1s',
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 680, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>My Profile</h1>
        <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Manage your account settings.</p>
      </div>

      {/* Profile card */}
      <div style={{ backgroundColor: 'white', border: '1px solid #ebebeb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', marginBottom: 20 }}>
        <div style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f0f0f0', padding: '28px 24px', display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%', backgroundColor: '#1a1a1a',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 600, flexShrink: 0,
          }}>
            {getInitials(user.name)}
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>{user.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#888' }}>{user.email}</span>
              <Badge variant={roleBadgeVariant(user.role)}>{roleLabel(user.role)}</Badge>
            </div>
          </div>
        </div>

        <div style={{ padding: '0 24px' }}>
          {([
            { icon: <User size={14} style={{ color: '#888' }} />, label: 'Full name', value: user.name },
            { icon: <Mail size={14} style={{ color: '#888' }} />, label: 'Email address', value: user.email },
            { icon: <Shield size={14} style={{ color: '#888' }} />, label: 'Role', value: roleLabel(user.role) },
          ] as const).map((item, i) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: i < 2 ? '1px solid #f5f5f5' : 'none', gap: 12 }}>
              {item.icon}
              <div>
                <p style={{ fontSize: 11.5, color: '#aaa', marginBottom: 2, fontWeight: 500 }}>{item.label.toUpperCase()}</p>
                <p style={{ fontSize: 13.5, color: '#1a1a1a' }}>{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e5e5e5', display: 'flex', marginBottom: 20 }}>
        <button style={tabStyle('profile')} onClick={() => setActiveTab('profile')}>Profile</button>
        <button style={tabStyle('password')} onClick={() => setActiveTab('password')}>Change Password</button>
      </div>

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #ebebeb', borderRadius: 12, padding: '22px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 18 }}>Edit profile</h2>
          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Full name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                style={inputStyle}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = '#1a1a1a' }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = '#e5e5e5' }}
              />
            </div>

            {saveError && (
              <p style={{ fontSize: 12.5, color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
                {saveError}
              </p>
            )}
            {saveSuccess && (
              <p style={{ fontSize: 12.5, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px' }}>
                Profile updated successfully.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: '#1a1a1a', color: 'white', border: 'none',
                  fontFamily: "'DM Sans', sans-serif", opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Password tab */}
      {activeTab === 'password' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #ebebeb', borderRadius: 12, padding: '22px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>Change Password</h2>
          <p style={{ fontSize: 12.5, color: '#888', marginBottom: 20 }}>Use your current password to set a new one.</p>

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {([
              { label: 'Current password', value: currentPassword, set: setCurrentPassword, placeholder: 'Enter current password' },
              { label: 'New password', value: newPassword, set: setNewPassword, placeholder: 'Min. 8 characters' },
              { label: 'Confirm new password', value: confirmPassword, set: setConfirmPassword, placeholder: 'Re-enter new password' },
            ] as const).map(({ label, value, set, placeholder }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{label}</label>
                <input
                  type="password"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  required
                  minLength={label === 'Current password' ? undefined : 8}
                  style={inputStyle}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = '#1a1a1a' }}
                  onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = '#e5e5e5' }}
                />
              </div>
            ))}

            {pwError && (
              <p style={{ fontSize: 12.5, color: '#e53e3e', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
                {pwError}
              </p>
            )}
            {pwSuccess && (
              <p style={{ fontSize: 12.5, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px' }}>
                Password changed successfully.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={pwSaving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 500,
                  cursor: pwSaving ? 'not-allowed' : 'pointer',
                  background: '#1a1a1a', color: 'white', border: 'none',
                  fontFamily: "'DM Sans', sans-serif", opacity: pwSaving ? 0.7 : 1,
                }}
              >
                {pwSaving ? 'Updating…' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
