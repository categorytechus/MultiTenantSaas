import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, MoreVertical, Trash2, Edit2 } from 'lucide-react'
import { OrgUser } from '../types'
import { api } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'

function roleVariant(role: string) {
  if (role === 'tenant_admin') return 'purple' as const
  if (role === 'user') return 'blue' as const
  return 'default' as const
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'tenant_admin' | 'user' | 'viewer'>('user')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { mutateAsync, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.post<OrgUser>('/users', { email, role })
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await mutateAsync()
      setEmail('')
      setRole('user')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add user')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add user" size="sm">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Email address"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'tenant_admin' | 'user' | 'viewer')}
            style={{
              padding: '8px 10px',
              border: '1px solid #e5e5e5',
              borderRadius: 7,
              fontSize: 13,
              color: '#1a1a1a',
              outline: 'none',
              backgroundColor: 'white',
              fontFamily: "'DM Sans', sans-serif",
              cursor: 'pointer',
            }}
          >
            <option value="tenant_admin">Admin</option>
            <option value="user">User</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        {error && (
          <p style={{ fontSize: 12.5, color: '#e53e3e', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={isPending}>Add user</Button>
        </div>
      </form>
    </Modal>
  )
}

function EditRoleModal({ open, user, onClose }: { open: boolean; user: OrgUser | null; onClose: () => void }) {
  const [role, setRole] = useState<'tenant_admin' | 'user' | 'viewer'>(user?.role ?? 'user')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  React.useEffect(() => { if (user) setRole(user.role) }, [user])

  const { mutateAsync, isPending } = useMutation({
    mutationFn: async () => {
      if (!user) return
      const { error } = await api.patch(`/users/${user.id}`, { role })
      if (error) throw new Error(error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await mutateAsync()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit role" size="sm">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: '#555' }}>
          Changing role for <strong>{user?.name}</strong>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            style={{
              padding: '8px 10px',
              border: '1px solid #e5e5e5',
              borderRadius: 7,
              fontSize: 13,
              color: '#1a1a1a',
              outline: 'none',
              backgroundColor: 'white',
              fontFamily: "'DM Sans', sans-serif",
              cursor: 'pointer',
            }}
          >
            <option value="tenant_admin">Admin</option>
            <option value="user">User</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        {error && (
          <p style={{ fontSize: 12.5, color: '#e53e3e', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function UsersPage() {
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<OrgUser | null>(null)
  const [removeUser, setRemoveUser] = useState<OrgUser | null>(null)
  const queryClient = useQueryClient()

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await api.get<OrgUser[]>('/users')
      if (error) throw new Error(error)
      return data ?? []
    },
  })

  const { mutateAsync: deleteUser, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.delete(`/users/${id}`)
      if (error) throw new Error(error)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const handleRemove = async () => {
    if (!removeUser) return
    await deleteUser(removeUser.id)
    setRemoveUser(null)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>Users</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Manage team members and their permissions.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus size={14} />
          Add user
        </Button>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: 'white', border: '1px solid #ebebeb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
              {['Name', 'Email', 'Role', 'Joined', 'Actions'].map((h) => (
                <th
                  key={h}
                  style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11.5, fontWeight: 600, color: '#888', letterSpacing: '0.3px', textTransform: 'uppercase' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: 40, textAlign: 'center' }}>
                  <Spinner />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#e53e3e', fontSize: 13 }}>
                  Failed to load users.
                </td>
              </tr>
            ) : !users?.length ? (
              <tr>
                <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                  No users yet.
                </td>
              </tr>
            ) : (
              users.map((user, i) => (
                <tr
                  key={user.id}
                  style={{ borderBottom: i < users.length - 1 ? '1px solid #f5f5f5' : 'none' }}
                  onMouseEnter={(e) => { ;(e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#fafafa' }}
                  onMouseLeave={(e) => { ;(e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent' }}
                >
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          backgroundColor: '#1a1a1a',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {user.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{user.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: '#555' }}>{user.email}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <Badge variant={roleVariant(user.role)} className="capitalize">
                      {user.role.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12, color: '#888' }}>{formatDate(user.created_at)}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setEditUser(user)}
                        title="Edit role"
                        style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, backgroundColor: 'white', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center' }}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => setRemoveUser(user)}
                        title="Remove user"
                        style={{ padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, backgroundColor: 'white', cursor: 'pointer', color: '#e53e3e', display: 'flex', alignItems: 'center' }}
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

      {/* Modals */}
      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditRoleModal open={!!editUser} user={editUser} onClose={() => setEditUser(null)} />
      <Modal open={!!removeUser} onClose={() => setRemoveUser(null)} title="Remove user" size="sm">
        <p style={{ fontSize: 13.5, color: '#555', marginBottom: 20 }}>
          Remove <strong>{removeUser?.name}</strong> from the organization? They will lose access immediately.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setRemoveUser(null)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleRemove} loading={deleting}>Remove</Button>
        </div>
      </Modal>
    </div>
  )
}
