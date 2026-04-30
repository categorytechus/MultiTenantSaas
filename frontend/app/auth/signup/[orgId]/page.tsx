'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import './org-signup.css';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organization Admin',
  user: 'Team Member',
};

export default function OrgSignupPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const orgId = params.orgId as string;
  const role = searchParams.get('role') || 'user';
  const roleLabel = ROLE_LABELS[role] || 'Team Member';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters');
      return;
    }

    setSubmitState('loading');

    try {
      // TODO (Phase 2): Replace mock with real API call to POST /auth/signup/${orgId}
      // Request body: { name, email, password, role }
      // Expected response: { data: { accessToken: string, refreshToken: string } }
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Mock: simulate email-already-used scenario for demo (comment out to test success)
      // setErrorMsg('This email address is already in use. Please sign in instead.');
      // setSubmitState('error');
      // return;

      setSubmitState('success');
    } catch {
      setErrorMsg('Something went wrong. Please try again or contact your administrator.');
      setSubmitState('error');
    }
  };

  if (submitState === 'success') {
    return (
      <div className="page">
        <div className="wrap">
          <div className="success-icon">
            <svg width="28" height="28" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="heading">
            <h1>Account created!</h1>
            <p>You&apos;re all set. Sign in to get started.</p>
          </div>
          <button className="sbtn" onClick={() => router.push('/auth/signin')}>
            Go to Sign In
          </button>
        </div>
        <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="heading">
          <h1>Complete your registration</h1>
          <p>You&apos;ve been invited to join as a <strong>{roleLabel}</strong></p>
        </div>

        <div className="invite-badge">
          <div className="invite-badge-row">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="invite-icon">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Organization invite</span>
            <span className="role-pill">{roleLabel}</span>
          </div>
        </div>

        {(submitState === 'error' || errorMsg) && (
          <div className="err">{errorMsg}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-lbl">Full name</label>
            <input
              className="fi"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              autoComplete="name"
            />
          </div>

          <div className="field">
            <label className="field-lbl">Email</label>
            <input
              className="fi"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label className="field-lbl">Password</label>
            <div className="irow">
              <input
                className="fi pad"
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="eye" onClick={() => setShowPwd(!showPwd)} tabIndex={-1}>
                {showPwd
                  ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
            <p className="hint">Minimum 8 characters. Use a mix of letters, numbers, and symbols.</p>
          </div>

          <div className="field">
            <label className="field-lbl">Confirm password</label>
            <div className="irow">
              <input
                className="fi pad"
                type={showConfirm ? 'text' : 'password'}
                placeholder="••••••••"
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

          <button className="sbtn" type="submit" disabled={submitState === 'loading'}>
            {submitState === 'loading' && <span className="spin" />}
            {submitState === 'loading' ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="foot">Already have an account? <Link href="/auth/signin">Sign in</Link></p>
      </div>

      <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
    </div>
  );
}
