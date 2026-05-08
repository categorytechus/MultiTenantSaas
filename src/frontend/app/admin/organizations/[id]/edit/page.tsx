'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Layout from '../../../../../components/Layout';
import { apiFetch } from '../../../../../src/lib/api';

interface OrganizationListItem {
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
      const res = await apiFetch<{ data: OrganizationListItem[] }>('/admin/organizations');
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

  return (
    <Layout>
      <div className="page">
        <button
          className="flex items-center gap-1.5 text-[13px] text-[#9a9a9a] hover:text-[#1a1a1a] mb-5 transition-colors"
          onClick={() => router.push('/admin/organizations')}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Organizations
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">Edit Organization</div>
            <div className="page-subtitle">Update organization details and settings</div>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}

        {fetching ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9a9a9a] py-8">
            <span className="w-4 h-4 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="form-card">
            <div className="form-card-title">Details</div>
            {slug && (
              <div style={{ fontSize: 12, color: '#9a9a9a', marginBottom: 16, display: 'flex', gap: 16 }}>
                <span>Slug: <span style={{ fontFamily: 'monospace', color: '#555' }}>{slug}</span></span>
                <span>ID: <span style={{ fontFamily: 'monospace', color: '#555' }}>{orgId}</span></span>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label className="field-lbl">Organization name <span style={{ color: '#e05' }}>*</span></label>
                <input className="fi" type="text" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-lbl">Domain <span style={{ color: '#bbb', fontWeight: 400 }}>(optional)</span></label>
                <input className="fi" type="text" placeholder="acmecorp.com" value={domain} onChange={e => setDomain(e.target.value)} />
                <p style={{ fontSize: 12, color: '#9a9a9a', marginTop: 4 }}>Optional custom domain for this organization.</p>
              </div>
              <div className="field">
                <label className="field-lbl">Status</label>
                <select className="fi" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div className="field">
                <label className="field-lbl">Subscription plan</label>
                <select className="fi" value={subscriptionTier} onChange={e => setSubscriptionTier(e.target.value)}>
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/organizations')}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading && <span className="spin" />}
                  {loading ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
