'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import { Pencil, Trash2, Settings } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  subscription_tier: string;
  member_count: string;
  created_at: string;
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let selectedOrgId = '';
      try {
        const tokenData = localStorage.getItem('accessToken');
        if (tokenData) {
          const payload = JSON.parse(atob(tokenData.split('.')[1]));
          selectedOrgId = payload.org_id || '';
        }
      } catch {}
      const query = selectedOrgId ? `?orgId=${encodeURIComponent(selectedOrgId)}` : '';
      const res = await apiFetch<{ data: Org[] }>(`/admin/organizations${query}`);
      if (res.success) setOrgs(res.data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      await load();
    })();
  }, [router, load]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete organization "${name}"? This action cannot be undone.`)) return;
    const res = await apiFetch(`/admin/organizations/${id}`, { method: 'DELETE' });
    if (res.success) setOrgs(prev => prev.filter(o => o.id !== id));
  };

  const filtered = orgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase()) ||
    (o.domain ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Organizations</div>
            <div className="page-subtitle">{orgs.length} organization{orgs.length !== 1 ? 's' : ''} total</div>
          </div>
          <button className="btn btn-primary" onClick={() => router.push('/admin/organizations/create')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Organization
          </button>
        </div>

        <div className="mb-5">
          <input
            className="w-full max-w-sm px-3 py-2 text-[13px] border border-[#ebe9e6] rounded-lg bg-white outline-none focus:border-[#1a1a1a] transition-colors placeholder-[#9a9a9a]"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-[#9a9a9a] text-[13px]">
              <span className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">No organizations found</div>
          ) : (
            <div className="table-responsive-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Domain</th>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Members</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(org => (
                    <tr key={org.id}>
                      <td style={{ fontWeight: 500 }}>{org.name}</td>
                      <td style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 12 }}>{org.slug}</td>
                      <td style={{ color: '#9a9a9a' }}>{org.domain || '—'}</td>
                      <td>
                        <span className={`badge badge-${org.status}`}>{org.status}</span>
                      </td>
                      <td>
                        <span className="badge badge-active">{org.subscription_tier}</span>
                      </td>
                      <td>{org.member_count}</td>
                      <td style={{ color: '#9a9a9a', fontSize: 12 }}>
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            className="btn btn-sm"
                            style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                            title="Edit organization"
                            onClick={() => router.push(`/admin/organizations/${org.id}/edit`)}
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                            title="Permissions"
                            onClick={() => router.push(`/admin/org-permissions/${org.id}`)}
                          >
                            <Settings size={13} />
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            title="Delete organization"
                            onClick={() => handleDelete(org.id, org.name)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
