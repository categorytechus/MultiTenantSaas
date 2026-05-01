import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Users } from 'lucide-react'
import { Organization } from '../types'
import { api } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { mutateAsync, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.post<Organization>('/admin/organizations', { name })
      if (error) throw new Error(error)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orgs'] })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await mutateAsync()
      setName('')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
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
          <p style={{ fontSize: 12.5, color: '#e53e3e', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" loading={isPending} disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  )
}

function OrgCard({ org }: { org: Organization }) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: '1px solid #ebebeb',
        borderRadius: 10,
        padding: '18px 20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.12s',
      }}
      onMouseEnter={(e) => { ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
      onMouseLeave={(e) => { ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 9,
            backgroundColor: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Building2 size={18} style={{ color: '#555' }} />
        </div>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>{org.name}</h3>
      <p style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
        Slug: <span style={{ fontFamily: 'monospace', color: '#888' }}>{org.slug ?? org.id.slice(0, 8)}</span>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Users size={13} style={{ color: '#bbb' }} />
        <span style={{ fontSize: 12, color: '#888' }}>
          {org.user_count ?? 0} member{(org.user_count ?? 0) !== 1 ? 's' : ''}
        </span>
      </div>
      <p style={{ fontSize: 11, color: '#ccc', marginTop: 8 }}>
        Created {new Date(org.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
    </div>
  )
}

export default function AdminPage() {
  const [createOpen, setCreateOpen] = useState(false)

  const { data: orgs, isLoading, error } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: async () => {
      const { data, error } = await api.get<Organization[]>('/admin/organizations')
      if (error) throw new Error(error)
      return data ?? []
    },
  })

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>Admin Panel</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Manage organizations across the platform.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          New organization
        </Button>
      </div>

      {/* Stats bar */}
      {orgs && (
        <div
          style={{
            backgroundColor: '#fafafa',
            border: '1px solid #ebebeb',
            borderRadius: 10,
            padding: '14px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <div>
            <p style={{ fontSize: 11.5, color: '#aaa', marginBottom: 3, fontWeight: 500 }}>TOTAL ORGANIZATIONS</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>{orgs.length}</p>
          </div>
          <div style={{ width: 1, height: 36, backgroundColor: '#e5e5e5' }} />
          <div>
            <p style={{ fontSize: 11.5, color: '#aaa', marginBottom: 3, fontWeight: 500 }}>TOTAL USERS</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>
              {orgs.reduce((sum, o) => sum + (o.user_count ?? 0), 0)}
            </p>
          </div>
        </div>
      )}

      {/* Org grid */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div style={{ color: '#e53e3e', fontSize: 13, padding: 16, backgroundColor: '#fff5f5', borderRadius: 8, border: '1px solid #fed7d7' }}>
          Failed to load organizations.
        </div>
      ) : !orgs?.length ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#aaa', fontSize: 13 }}>
          No organizations yet. Create one to get started.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
