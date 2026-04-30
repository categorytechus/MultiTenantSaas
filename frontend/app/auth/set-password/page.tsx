'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import './set-password.css';

export default function SetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="page">
        <div className="wrap">
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#fef2f2', border: '2px solid #fecaca',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="24" height="24" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div className="heading">
            <h1>Invalid link</h1>
            <p>This password setup link is missing required information. Please request a new link from your administrator.</p>
          </div>
          <Link href="/auth/signin" className="sbtn" style={{ textDecoration: 'none', justifyContent: 'center' }}>
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page">
        <div className="wrap">
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: '#f0fdf4', border: '2px solid #bbf7d0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="28" height="28" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="heading">
            <h1>Password set!</h1>
            <p>Your account is ready. Sign in to get started.</p>
          </div>
          <button className="sbtn" onClick={() => router.push('/auth/signin')}>
            Go to Sign In
          </button>
        </div>
        <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      // TODO (Phase 2): Replace mock with real API call to POST /auth/set-password
      // Request: { token, email, password }
      // Expected response: { success: true }
      await new Promise(r => setTimeout(r, 900));
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again or contact your administrator.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="wrap">
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: '#f5f3ff', border: '2px solid #ddd6fe',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="22" height="22" fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <div className="heading">
          <h1>Set your password</h1>
          <p>Choose a password for your new account</p>
        </div>

        {email && (
          <div className="email-chip">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            {decodeURIComponent(email)}
          </div>
        )}

        {error && <div className="err">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-lbl">New password</label>
            <div className="irow">
              <input
                className="fi pad"
                type={showPwd ? 'text' : 'password'}
                placeholder="Minimum 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
              />
              <button type="button" className="eye" onClick={() => setShowPwd(!showPwd)} tabIndex={-1}>
                {showPwd
                  ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
            <p className="hint">Use at least 8 characters with a mix of letters, numbers, and symbols.</p>
          </div>

          <div className="field">
            <label className="field-lbl">Confirm password</label>
            <div className="irow">
              <input
                className="fi pad"
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="eye" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}>
                {showConfirm
                  ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          <button className="sbtn" type="submit" disabled={loading}>
            {loading && <span className="spin" />}
            {loading ? 'Setting password…' : 'Set Password'}
          </button>
        </form>

        <p className="foot">Already set up? <Link href="/auth/signin">Sign in</Link></p>
      </div>

      <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
    </div>
  );
}