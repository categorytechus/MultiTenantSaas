'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';

export default function CreateOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
      }
    })();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name, domain: domain || undefined, subscriptionTier }),
      });
      if (res.success) {
        router.push('/admin/organizations');
      } else {
        setError(res.error || 'Failed to create organization');
      }
    } catch {
      setError('Failed to create organization');
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
            <div className="page-title">Create Organization</div>
            <div className="page-subtitle">Set up a new organization in the platform</div>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <div className="form-card-title">Details</div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-lbl">Organization name <span style={{ color: '#e05' }}>*</span></label>
              <input className="fi" type="text" placeholder="Acme Corp" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-lbl">Domain <span style={{ color: '#bbb', fontWeight: 400 }}>(optional)</span></label>
              <input className="fi" type="text" placeholder="acmecorp.com" value={domain} onChange={e => setDomain(e.target.value)} />
              <p style={{ fontSize: 12, color: '#9a9a9a', marginTop: 4 }}>Optional custom domain for this organization.</p>
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
                {loading ? 'Creating…' : 'Create Organization'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
