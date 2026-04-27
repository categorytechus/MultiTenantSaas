'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';

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

const PAGE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; }
  .page { padding: 32px; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .page-title { font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; }
  .page-subtitle { font-size: 13px; color: #9a9a9a; margin-top: 3px; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500; cursor: pointer; border: none; transition: all .13s; }
  .btn-primary { background: #1a1a1a; color: white; }
  .btn-primary:hover { background: #333; }
  .search-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .search-input { padding: 9px 14px; border: 1px solid #ebebeb; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; color: #1a1a1a; outline: none; width: 300px; }
  .search-input:focus { border-color: #c8c8c8; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
  .table-wrap { background: white; border-radius: 12px; border: 1px solid #f0eeeb; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  thead th { padding: 12px 20px; text-align: left; font-size: 11.5px; font-weight: 600; color: #9a9a9a; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #f0eeeb; }
  tbody tr { border-bottom: 1px solid #f8f7f5; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: #fdfcfb; }
  tbody td { padding: 14px 20px; font-size: 13.5px; color: #1a1a1a; }
  .badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 500; }
  .badge-active { background: #dcfce7; color: #166534; }
  .badge-suspended { background: #fef9c3; color: #713f12; }
  .badge-deleted { background: #fee2e2; color: #991b1b; }
  .badge-free { background: #f3f4f6; color: #374151; }
  .badge-pro { background: #ede9fe; color: #5b21b6; }
  .badge-enterprise { background: #dbeafe; color: #1e40af; }
  .action-btn { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; color: #999; transition: all .12s; font-size: 12.5px; font-family: 'DM Sans', sans-serif; }
  .action-btn:hover { background: #f5f4f1; color: #1a1a1a; }
  .action-btn.danger:hover { background: #fee2e2; color: #dc2626; }
  .empty { padding: 48px 20px; text-align: center; color: #9a9a9a; font-size: 14px; }
  .loading { padding: 48px 20px; text-align: center; color: #9a9a9a; font-size: 14px; }
`;

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
  }, [router]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: Org[] }>('/admin/organizations');
      if (res.success) setOrgs(res.data.data);
    } finally {
      setLoading(false);
    }
  };

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
      <style>{PAGE_STYLES}</style>
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

        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="empty">No organizations found</div>
          ) : (
            <table>
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
                      <span className={`badge badge-${org.subscription_tier}`}>{org.subscription_tier}</span>
                    </td>
                    <td>{org.member_count}</td>
                    <td style={{ color: '#9a9a9a', fontSize: 12 }}>
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="action-btn" onClick={() => router.push(`/admin/organizations/${org.id}/edit`)}>Edit</button>
                        <button className="action-btn danger" onClick={() => handleDelete(org.id, org.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
