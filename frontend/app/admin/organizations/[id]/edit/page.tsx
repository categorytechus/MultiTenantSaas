'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Layout from '../../../../../components/Layout';
import { apiFetch } from '../../../../../src/lib/api';
import './admin-organizations-id-edit.css';

interface Organization {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  subscription_tier: string;
  slug: string;
}

export default function EditOrganizationPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params.id as string;

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState('active');
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      const res = await apiFetch<{ data: Organization[] }>('/admin/organizations');
      if (res.success) {
        const org = res.data.data.find((o) => o.id === orgId);
        if (org) {
          setName(org.name);
          setDomain(org.domain || '');
          setStatus(org.status);
          setSubscriptionTier(org.subscription_tier);
          setSlug(org.slug);
        }
      }
      setFetching(false);
    })();
  }, [router, orgId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/organizations/${orgId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, domain: domain || null, status, subscriptionTier }),
      });
      if (res.success) {
        router.push('/admin/organizations');
      } else {
        setError(res.error || 'Failed to update organization');
      }
    } catch {
      setError('Failed to update organization');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return (
    <Layout>
      <div style={{ padding: 48, textAlign: 'center', color: '#9a9a9a' }}>Loading…</div>
    </Layout>
  );

  return (
    <Layout>
<div className="page">
        <button className="back-link" onClick={() => router.push('/admin/organizations')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Organizations
        </button>
        <div className="page-title">Edit Organization</div>
        <div className="page-subtitle">Update organization details and settings</div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <div className="meta">
            <strong>Slug:</strong> {slug}<br/>
            <strong>ID:</strong> {orgId}
          </div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Organization name *</label>
              <input className="fi" type="text" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Domain</label>
              <input className="fi" type="text" placeholder="acmecorp.com" value={domain} onChange={e => setDomain(e.target.value)} />
              <p className="hint">Optional custom domain for this organization.</p>
            </div>
            <div className="field">
              <label>Status</label>
              <select className="fi select" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="field">
              <label>Subscription plan</label>
              <select className="fi select" value={subscriptionTier} onChange={e => setSubscriptionTier(e.target.value)}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/organizations')}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spin" />}
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}