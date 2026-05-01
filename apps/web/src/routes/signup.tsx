import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters'),
})

type FormData = z.infer<typeof schema>

export default function SignupPage() {
  const navigate = useNavigate()
  const { register: registerUser } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    const result = await registerUser(data)
    if (result.success) {
      navigate('/dashboard', { replace: true })
    } else {
      setServerError(result.error ?? 'Registration failed. Please try again.')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#fafafa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          backgroundColor: 'white',
          border: '1px solid #ebebeb',
          borderRadius: 12,
          padding: '36px 32px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              backgroundColor: '#1a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6" />
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6" />
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" />
            </svg>
          </div>
        </div>

        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#1a1a1a',
            marginBottom: 6,
            textAlign: 'center',
            letterSpacing: '-0.4px',
          }}
        >
          Create an account
        </h1>
        <p
          style={{
            fontSize: 13.5,
            color: '#888',
            marginBottom: 28,
            textAlign: 'center',
          }}
        >
          Get started with AI SaaS
        </p>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            label="Full name"
            type="text"
            placeholder="Jane Smith"
            error={errors.name?.message}
            {...register('name')}
          />

          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Password</label>
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              error={errors.password?.message}
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  style={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    color: '#aaa',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
              {...register('password')}
            />
          </div>

          {serverError && (
            <p
              style={{
                fontSize: 12.5,
                color: '#e53e3e',
                backgroundColor: '#fff5f5',
                border: '1px solid #fed7d7',
                borderRadius: 6,
                padding: '8px 12px',
              }}
            >
              {serverError}
            </p>
          )}

          <Button
            type="submit"
            loading={isSubmitting}
            style={{ width: '100%', marginTop: 4 }}
          >
            Create account
          </Button>
        </form>

        <p
          style={{
            textAlign: 'center',
            marginTop: 22,
            fontSize: 13,
            color: '#888',
          }}
        >
          Already have an account?{' '}
          <Link
            to="/login"
            style={{ color: '#1a1a1a', fontWeight: 500, textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
