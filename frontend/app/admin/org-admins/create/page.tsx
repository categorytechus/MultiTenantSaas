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
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        if (orgRes.success) {
          setOrgs(orgRes.data.data);
        }
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
      const res = await apiFetch('/admin/org-admins', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, organizationId }),
      });
      if (res.success) {
        router.push('/admin/org-admins');
      } else {
        setError(res.error || 'Failed to create org admin');
      }
    } catch {
      setError('Failed to create org admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
<div className="page">
        <button className="back-link" onClick={() => router.push('/admin/org-admins')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Org Admins
        </button>
        <div className="page-title">Create Org Admin</div>
        <div className="page-subtitle">Add an administrator to an existing organization</div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input className="fi" type="text" placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email address</label>
              <input className="fi" type="email" placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="fi" type="password" placeholder="Min. 8 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="field">
              <label>Organization</label>
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
              <p className="hint">The admin will be assigned to this organization.</p>
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