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
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!meRes.success || meRes.data.data.user_type !== 'super_admin') {
          router.push('/dashboard');
          return;
        }
        const orgRes = await apiFetch<{ data: Org[] }>('/admin/organizations');
        if (orgRes.success) setOrgs(orgRes.data.data);
      } catch {
        setError('Failed to load organizations');
      }
    })();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId) { setError('Please select an organization'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ data: { temp_password?: string } }>('/admin/org-admins', {
        method: 'POST',
        body: JSON.stringify({ name: name || undefined, email, organizationId }),
      });
      if (res.success) {
        if (res.data.data?.temp_password) {
          setTempPassword(res.data.data.temp_password);
        } else {
          // Existing org admin added to org — go straight back
          router.push('/admin/org-admins');
        }
      } else {
        setError(res.error || 'Failed to add org admin');
      }
    } catch {
      setError('Failed to add org admin');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (tempPassword) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 480 }}>
            <div className="page-title" style={{ marginBottom: 4 }}>Admin Created</div>
            <div className="page-subtitle" style={{ marginBottom: 20 }}>
              Share this temporary password with <strong>{email}</strong> securely. They will be prompted to set a new password on first login.
            </div>
            <div style={{
              background: '#f5f4f1',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              padding: '14px 16px',
              color: '#1a1a1a',
              fontFamily: 'monospace',
              fontSize: 15,
              letterSpacing: '0.05em',
              marginBottom: 16,
              wordBreak: 'break-all',
            }}>
              {tempPassword}
            </div>
            <p style={{ fontSize: 12, color: '#999', marginBottom: 20 }}>
              This password will not be shown again.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={handleCopy} style={{ flex: 1 }}>
                {copied ? 'Copied!' : 'Copy Password'}
              </button>
              <button className="btn btn-ghost" onClick={() => router.push('/admin/org-admins')} style={{ flex: 1 }}>
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
        <div className="page-title">Add Org Admin</div>
        <div className="page-subtitle">
          Enter an email to add an existing org admin to an organization, or fill in the name too to create a new one. A temporary password will be generated for new admins.
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
            </div>
            <div className="field">
              <label>
                Full name
                <span className="hint" style={{ display: 'inline', marginLeft: 8 }}>Required for new admins — leave blank if they already have an account</span>
              </label>
              <input
                className="fi"
                type="text"
                placeholder="Jane Smith"
                value={name}
                onChange={e => setName(e.target.value)}
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
                {loading ? 'Saving…' : 'Add Org Admin'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}