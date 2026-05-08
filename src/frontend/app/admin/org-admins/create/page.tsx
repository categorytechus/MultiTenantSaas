'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import './admin-org-admins-create.css';

interface Org { id: string; name: string; slug: string; }

export default function CreateOrgAdminPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setPasswordLink, setSetPasswordLink] = useState<string | null>(null);
  const [existingUserAdded, setExistingUserAdded] = useState(false);
  const [setupEmailSent, setSetupEmailSent] = useState(false);
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
      const res = await apiFetch<{ data: { set_password_link?: string }; warnings?: { code: string }[] }>('/admin/org-admins', {
        method: 'POST',
        body: JSON.stringify({ name, email, organizationId }),
      });
      if (!res.success) {
        setError(res.error || 'Failed to create org admin');
        return;
      }
      const warnings = res.data.warnings;
      if (warnings?.some((w) => w.code === 'email_failed')) {
        setError('Account may have been created but the setup email could not be sent. Check server logs or try again.');
        return;
      }
      const link = res.data.data.set_password_link;
      if (link) {
        setSetPasswordLink(link);
      } else if (res.status === 200) {
        setExistingUserAdded(true);
      } else {
        setSetupEmailSent(true);
      }
    } catch {
      setError('Failed to create org admin');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (setPasswordLink) {
      navigator.clipboard.writeText(setPasswordLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (existingUserAdded) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="18" height="18" fill="none" stroke="#2563eb" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              </div>
              <div className="page-title" style={{ margin: 0 }}>Added to Organization</div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              <strong>{email}</strong> already has an account and has been added to the organization as an Org Admin. Share the sign-in link below with them.
            </p>

            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Sign-in link</div>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 12.5, color: '#374151',
                  background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/auth/signin'}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText((process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/auth/signin'); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
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

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => { setExistingUserAdded(false); setName(''); setEmail(''); }} style={{ flex: 1 }}>
                Add Another
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

  if (setupEmailSent) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div className="page-title" style={{ marginBottom: 8 }}>Org admin created</div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
              We sent a password setup link to <strong>{email}</strong>. They can complete setup from the email.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setSetupEmailSent(false); setName(''); setEmail(''); }} style={{ flex: 1 }}>
                Add Another
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

  if (setPasswordLink) {
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
              <div className="page-title" style={{ margin: 0 }}>Org Admin Created</div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              Account created for <strong>{email}</strong>. Share the link below so they can set their password and log in.
            </p>

            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Password setup link</div>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 12.5, color: '#374151',
                  background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {setPasswordLink}
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
                This link is single-use and expires after first use. Share it securely with the admin.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setSetPasswordLink(null); setName(''); setEmail(''); }} style={{ flex: 1 }}>
                Add Another
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
        <div className="page-title">Create Org Admin</div>
        <div className="page-subtitle">
          Create a new org admin account. A password setup link will be generated — share it with them securely.
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                className="fi"
                type="text"
                placeholder="Jane Smith"
                value={name}
                onChange={e => { setName(e.target.value); setError(''); }}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>Email address <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                className="fi"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                required
              />
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
                {loading ? 'Creating…' : 'Create Org Admin'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
