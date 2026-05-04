'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

type PageState = 'loading' | 'joining' | 'done' | 'error' | 'invalid';

export default function AcceptInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get('token') || '';
  const orgId = searchParams.get('orgId') || '';

  const [pageState, setPageState] = useState<PageState>(() =>
    !token || !orgId ? 'invalid' : 'loading',
  );
  const [orgName, setOrgName] = useState('');
  const [errorMsg, setErrorMsg] = useState(() =>
    !token || !orgId ? 'Missing invite parameters.' : '',
  );

  useEffect(() => {
    if (!token || !orgId) {
      return;
    }

    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
      // Not signed in — redirect to sign-in with returnUrl back here
      const returnUrl = `/auth/accept-invite?token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(orgId)}`;
      router.replace(`/auth/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }

    // Fetch invite info to display org name, then immediately accept
    (async () => {
      try {
        const infoRes = await fetch(
          `${API_BASE}/auth/invite-info?token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(orgId)}`,
        );
        const infoData = await infoRes.json();
        if (!infoData.success) {
          setErrorMsg(infoData.message || 'Invalid or expired invite link.');
          setPageState('invalid');
          return;
        }
        setOrgName(infoData.data.org_name);
        setPageState('joining');

        // Accept the invite
        const joinRes = await fetch(`${API_BASE}/auth/accept-invite`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ token, orgId }),
        });
        const joinData = await joinRes.json();
        if (!joinData.success) {
          setErrorMsg(joinData.message || 'Failed to join organization.');
          setPageState('error');
          return;
        }
        localStorage.setItem('accessToken', joinData.data.accessToken);
        localStorage.setItem('refreshToken', joinData.data.refreshToken);
        setPageState('done');
        setTimeout(() => router.push('/dashboard'), 1200);
      } catch {
        setErrorMsg('Something went wrong. Please try again.');
        setPageState('error');
      }
    })();
  }, [token, orgId, router]);

  if (pageState === 'loading') {
    return (
      <div style={pageStyle}>
        <div style={wrapStyle}>
          <div style={spinnerStyle} />
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 16 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (pageState === 'joining') {
    return (
      <div style={pageStyle}>
        <div style={wrapStyle}>
          <div style={{ ...iconCircle, background: '#eff6ff' }}>
            <svg width="24" height="24" fill="none" stroke="#2563eb" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h2 style={headingStyle}>Joining {orgName}…</h2>
          <div style={spinnerStyle} />
        </div>
      </div>
    );
  }

  if (pageState === 'done') {
    return (
      <div style={pageStyle}>
        <div style={wrapStyle}>
          <div style={{ ...iconCircle, background: '#f0fdf4' }}>
            <svg width="24" height="24" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={headingStyle}>You&apos;ve joined {orgName}!</h2>
          <p style={subStyle}>Redirecting to dashboard…</p>
        </div>
      </div>
    );
  }

  // invalid or error
  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <div style={{ ...iconCircle, background: '#fef2f2' }}>
          <svg width="22" height="22" fill="none" stroke="#dc2626" strokeWidth="2.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 style={headingStyle}>{pageState === 'invalid' ? 'Invalid invite' : 'Something went wrong'}</h2>
        <p style={{ ...subStyle, marginBottom: 24 }}>{errorMsg}</p>
        <Link
          href="/auth/signin"
          style={{ display: 'inline-block', padding: '10px 24px', background: '#1a1a1a', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}
        >
          Go to Sign In
        </Link>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#faf9f7',
  fontFamily: 'DM Sans, sans-serif',
};

const wrapStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 16,
  padding: '40px 36px',
  maxWidth: 400,
  width: '100%',
  textAlign: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
};

const iconCircle: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 20px',
};

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginBottom: 8,
  color: '#1a1a1a',
};

const subStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#6b7280',
};

const spinnerStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: '2.5px solid #e5e5e5',
  borderTopColor: '#1a1a1a',
  borderRadius: '50%',
  animation: 'spin .65s linear infinite',
  margin: '16px auto 0',
};
