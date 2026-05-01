import React, { useState } from 'react'
import { useNavigate, Link, useLocation, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { isAuthenticated } from '../lib/auth'

const schema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const fromPath = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    const result = await login(data)
    if (result.success) {
      navigate(fromPath, { replace: true })
    } else {
      setServerError(result.error ?? 'Login failed. Please try again.')
    }
  }

  // Redirect if already authenticated (after all hooks)
  if (isAuthenticated()) {
    return <Navigate to={fromPath} replace />
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

        {/* Heading */}
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
          Welcome back
        </h1>
        <p
          style={{
            fontSize: 13.5,
            color: '#888',
            marginBottom: 28,
            textAlign: 'center',
          }}
        >
          Sign in to your account
        </p>

        {/* Google button */}
        <a
          href="/api/auth/google"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            padding: '9px 16px',
            border: '1px solid #e5e5e5',
            borderRadius: 8,
            backgroundColor: 'white',
            color: '#1a1a1a',
            fontSize: 13.5,
            fontWeight: 500,
            textDecoration: 'none',
            cursor: 'pointer',
            marginBottom: 20,
            transition: 'background-color 0.12s',
            fontFamily: "'DM Sans', sans-serif",
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#f5f5f5'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'white'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </a>

        {/* Divider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e5e5' }} />
          <span style={{ fontSize: 12, color: '#bbb' }}>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e5e5' }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Password</label>
              <a
                href="#"
                style={{ fontSize: 12, color: '#888', textDecoration: 'none' }}
                onMouseEnter={(e) => { ;(e.currentTarget as HTMLAnchorElement).style.color = '#1a1a1a' }}
                onMouseLeave={(e) => { ;(e.currentTarget as HTMLAnchorElement).style.color = '#888' }}
              >
                Forgot password?
              </a>
            </div>
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
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
            Sign in
          </Button>
        </form>

        {/* Sign up link */}
        <p
          style={{
            textAlign: 'center',
            marginTop: 22,
            fontSize: 13,
            color: '#888',
          }}
        >
          No account?{' '}
          <Link
            to="/signup"
            style={{ color: '#1a1a1a', fontWeight: 500, textDecoration: 'none' }}
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
