'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import '../create/admin-org-admins-create.css';

interface Org { id: string; name: string; slug: string; }

export default function InviteOrgAdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupLink, setSignupLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    let selectedOrgFromToken = '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      selectedOrgFromToken = payload.org_id || '';
    } catch {}
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!meRes.success || meRes.data.data.user_type !== 'super_admin') {
          router.push('/dashboard');
          return;
        }
        const query = selectedOrgFromToken ? `?orgId=${encodeURIComponent(selectedOrgFromToken)}` : '';
        const orgRes = await apiFetch<{ data: Org[] }>(`/admin/organizations${query}`);
        if (orgRes.success) {
          setOrgs(orgRes.data.data);
          if (!organizationId && orgRes.data.data.length === 1) {
            setOrganizationId(orgRes.data.data[0].id);
          }
        }
      } catch {
        setError('Failed to load organizations');
      }
    })();
  }, [router, organizationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) { setError('Please select an organization'); return; }
    setError('');
    setLoading(true);
    try {
      // TODO (Phase 2): Replace mock with real API call to POST /admin/org-admins/invites
      // Request: { email, organizationId }
      // Expected response: { data: { signup_link: string, role: 'org_admin', organization_id: string } }
      await new Promise((resolve) => setTimeout(resolve, 800));
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const link = `${base}/auth/signup/${organizationId}?role=org_admin`;
      setSignupLink(link);
    } catch {
      setError('Failed to generate invite link');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (signupLink) {
      navigator.clipboard.writeText(signupLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const selectedOrg = orgs.find(o => o.id === organizationId);

  if (signupLink) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="page-title" style={{ margin: 0 }}>Invite Link Generated</div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.6 }}>
              Share this link with <strong>{email}</strong>. They will use it to create their org admin account — they set their own name and password.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {selectedOrg && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
                  borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500,
                }}>
                  <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  {selectedOrg.name}
                </span>
              )}
            </div>

            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Signup link</div>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 12.5, color: '#374151',
                  background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {signupLink}
                </div>
                <button
                  onClick={handleCopy}
                  style={{
                    padding: '10px 14px', background: copied ? '#f0fdf4' : '#f5f4f1',
                    border: 'none', borderLeft: '1px solid #e5e5e5', cursor: 'pointer',
                    color: copied ? '#16a34a' : '#555', fontSize: 13, fontWeight: 500,
                    fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', transition: 'all .15s',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 8, padding: '10px 14px', marginBottom: 24, marginTop: 12,
            }}>
              <svg width="15" height="15" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
                This link is single-use and expires once the admin completes signup.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setSignupLink(null); setEmail(''); }} style={{ flex: 1 }}>
                Invite Another
              </button>
              <button className="btn btn-primary" onClick={() => router.push('/admin/org-admins')} style={{ flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page">
        <button className="back-link" onClick={() => router.push('/admin/org-admins')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Org Admins
        </button>
        <div className="page-title">Invite Org Admin</div>
        <div className="page-subtitle">
          Enter the email and select an organization. A unique signup link will be generated — they complete registration themselves by setting their name and password.
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email address <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                className="fi"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                required
                autoFocus
              />
              <p className="hint">The admin will follow the signup link to create their account.</p>
            </div>
            <div className="field">
              <label>Organization <span style={{ color: '#e53e3e' }}>*</span></label>
              {orgs.length > 0 ? (
                <select className="fi select" value={organizationId} onChange={e => setOrganizationId(e.target.value)} required>
                  <option value="">Select organization…</option>
                  {orgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              ) : (
                <input className="fi" type="text" placeholder="Organization ID (UUID)" value={organizationId} onChange={e => setOrganizationId(e.target.value)} required />
              )}
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/org-admins')}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spin" />}
                {loading ? 'Generating link…' : 'Generate Invite Link'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}