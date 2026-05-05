'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import './org-signup.css';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

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
  const inviteToken = searchParams.get('token') || '';
  const inviteEmail = searchParams.get('email') || '';
  const inviteInvalid = !inviteToken || !orgId;
  const roleLabel = ROLE_LABELS[role] || 'Team Member';

  const [name, setName] = useState('');
  const [email, setEmail] = useState(inviteEmail ? decodeURIComponent(inviteEmail) : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Invite info state (skip fetch UI when params are missing — no effect setState)
  const [inviteInfoLoading, setInviteInfoLoading] = useState(!inviteInvalid);
  const [inviteInfoError, setInviteInfoError] = useState(
    inviteInvalid ? 'Invalid invite link.' : '',
  );
  const [orgName, setOrgName] = useState('');
  const [userExists, setUserExists] = useState(false);
  const [joinState, setJoinState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (inviteInvalid) return;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/auth/invite-info?token=${encodeURIComponent(inviteToken)}&orgId=${encodeURIComponent(orgId)}`,
        );
        const data = await res.json();
        if (!data.success) {
          setInviteInfoError(data.message || 'Invalid or expired invite link.');
        } else {
          setOrgName(data.data.org_name);
          setUserExists(data.data.user_exists);
        }
      } catch {
        setInviteInfoError('Failed to load invite details.');
      } finally {
        setInviteInfoLoading(false);
      }
    })();
  }, [inviteInvalid, inviteToken, orgId]);

  const handleJoin = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      // Not signed in — redirect to sign-in with returnUrl pointing to accept-invite
      const returnUrl = `/auth/accept-invite?token=${encodeURIComponent(inviteToken)}&orgId=${encodeURIComponent(orgId)}`;
      router.push(`/auth/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }
    setJoinState('loading');
    setJoinError('');
    try {
      const res = await fetch(`${API_BASE}/auth/accept-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: inviteToken, orgId }),
      });
      const data = await res.json();
      if (!data.success) {
        setJoinError(data.message || 'Failed to join organization.');
        setJoinState('error');
        return;
      }
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      setJoinState('done');
      router.push('/dashboard');
    } catch {
      setJoinError('Something went wrong. Please try again.');
      setJoinState('error');
    }
  };

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
      const res = await fetch(`${API_BASE}/auth/signup/${orgId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, email, name, password }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.message || 'Failed to create account. The invite link may have expired.');
        setSubmitState('error');
        return;
      }
      // Store tokens and redirect
      if (data.data?.accessToken) {
        localStorage.setItem('accessToken', data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        router.push('/dashboard');
        return;
      }
      setSubmitState('success');
    } catch {
      setErrorMsg('Something went wrong. Please try again or contact your administrator.');
      setSubmitState('error');
    }
  };

  // Loading invite info
  if (inviteInfoLoading) {
    return (
      <div className="page">
        <div className="wrap" style={{ textAlign: 'center', paddingTop: 48 }}>
          <div className="spin" style={{ margin: '0 auto 16px', width: 28, height: 28, border: '2.5px solid #e5e5e5', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'spin .65s linear infinite' }} />
          <p style={{ fontSize: 14, color: '#6b7280' }}>Loading invite details…</p>
        </div>
      </div>
    );
  }

  // Invalid / expired invite
  if (inviteInfoError) {
    return (
      <div className="page">
        <div className="wrap">
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="22" height="22" fill="none" stroke="#dc2626" strokeWidth="2.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Invite link invalid</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>{inviteInfoError}</p>
            <button className="sbtn" onClick={() => router.push('/auth/signin')}>Go to Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  // Existing user — show Join UI
  if (userExists) {
    const isSignedIn = !!localStorage.getItem('accessToken');
    return (
      <div className="page">
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" fill="none" stroke="#2563eb" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Join {orgName}</h1>
            <p style={{ fontSize: 14, color: '#6b7280' }}>
              You&apos;ve been invited to join as a <strong>{roleLabel}</strong>.
            </p>
          </div>

          <div style={{ background: '#f9f9f8', border: '1px solid #e5e5e5', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 4 }}>Organization</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{orgName}</div>
            <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 8, marginBottom: 4 }}>Role</div>
            <div style={{ fontSize: 14 }}>{roleLabel}</div>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: '#1d4ed8', margin: 0 }}>
              An account with this email already exists. {isSignedIn ? 'Click below to join the organization.' : 'Sign in to accept this invite.'}
            </p>
          </div>

          {(joinState === 'error' || joinError) && (
            <div className="err" style={{ marginBottom: 16 }}>{joinError}</div>
          )}

          <button
            className="sbtn"
            onClick={handleJoin}
            disabled={joinState === 'loading' || joinState === 'done'}
          >
            {joinState === 'loading' && <span className="spin" style={{ marginRight: 8 }} />}
            {joinState === 'loading' ? 'Joining…' : isSignedIn ? `Join ${orgName}` : 'Sign in & Join'}
          </button>

          {!isSignedIn && (
            <p className="foot" style={{ marginTop: 16 }}>Already signed in? <Link href="/dashboard">Go to dashboard</Link></p>
          )}
        </div>
        <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
      </div>
    );
  }

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
          <p>You&apos;ve been invited to join <strong>{orgName || 'your organization'}</strong> as a <strong>{roleLabel}</strong></p>
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
            <div style={{ position: "relative" }}>
              <input
                className="fi"
                type="email"
                value={email}
                onChange={inviteEmail ? undefined : e => setEmail(e.target.value)}
                readOnly={!!inviteEmail}
                required
                autoComplete="email"
                style={inviteEmail ? { background: "#f5f4f1", color: "#6b6b6b", cursor: "not-allowed", paddingRight: "2.5rem" } : undefined}
              />
              {inviteEmail && (
                <svg
                  width="14" height="14" fill="none" stroke="#9a9a9a" strokeWidth="2"
                  viewBox="0 0 24 24"
                  style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </div>
            {inviteEmail && (
              <p style={{ fontSize: "11px", color: "#9a9a9a", marginTop: "4px" }}>
                This email address was set by your invite and cannot be changed.
              </p>
            )}
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
