import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, Shield } from 'lucide-react'
import { useAuthContext } from '../App'
import { api } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
})

type FormData = z.infer<typeof schema>

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
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: user?.name ?? '' },
  })

  const onSubmit = async (data: FormData) => {
    setSaveError(null)
    setSaveSuccess(false)
    const { error } = await api.patch('/auth/me', { name: data.name })
    if (error) {
      setSaveError(error)
    } else {
      setSaveSuccess(true)
      refetch()
      setTimeout(() => setSaveSuccess(false), 3000)
    }
  }

  if (!user) return null

  return (
    <div style={{ padding: '28px 32px', maxWidth: 640, fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
          My Profile
        </h1>
        <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Manage your account settings.</p>
      </div>

      {/* Profile card */}
      <div
        style={{
          backgroundColor: 'white',
          border: '1px solid #ebebeb',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          marginBottom: 20,
        }}
      >
        {/* Cover / Avatar section */}
        <div
          style={{
            backgroundColor: '#fafafa',
            borderBottom: '1px solid #f0f0f0',
            padding: '28px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              backgroundColor: '#1a1a1a',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {getInitials(user.name)}
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
              {user.name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#888' }}>{user.email}</span>
              <Badge variant={roleBadgeVariant(user.role)}>
                {roleLabel(user.role)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Info items */}
        <div style={{ padding: '0 24px' }}>
          {[
            { icon: <User size={14} style={{ color: '#888' }} />, label: 'Full name', value: user.name },
            { icon: <Mail size={14} style={{ color: '#888' }} />, label: 'Email address', value: user.email },
            { icon: <Shield size={14} style={{ color: '#888' }} />, label: 'Role', value: roleLabel(user.role) },
          ].map((item, i) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '14px 0',
                borderBottom: i < 2 ? '1px solid #f5f5f5' : 'none',
                gap: 12,
              }}
            >
              {item.icon}
              <div>
                <p style={{ fontSize: 11.5, color: '#aaa', marginBottom: 2, fontWeight: 500 }}>
                  {item.label.toUpperCase()}
                </p>
                <p style={{ fontSize: 13.5, color: '#1a1a1a' }}>{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit form */}
      <div
        style={{
          backgroundColor: 'white',
          border: '1px solid #ebebeb',
          borderRadius: 12,
          padding: '22px 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 18 }}>
          Edit profile
        </h2>
        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label="Full name"
            type="text"
            placeholder="Your name"
            error={errors.name?.message}
            {...register('name')}
          />

          {saveError && (
            <p style={{ fontSize: 12.5, color: '#e53e3e', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '8px 12px' }}>
              {saveError}
            </p>
          )}

          {saveSuccess && (
            <p style={{ fontSize: 12.5, color: '#16a34a', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px' }}>
              Profile updated successfully.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              size="sm"
              loading={isSubmitting}
              disabled={!isDirty}
            >
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
