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
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await apiFetch(`/admin/organizations/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.success) {
        setOrgs(prev => prev.filter(o => o.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        setDeleteError(res.error || 'Failed to delete organization');
      }
    } catch {
      setDeleteError('Failed to delete organization');
    } finally {
      setDeleting(false);
    }
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
                    {!process.env.NEXT_PUBLIC_IS_PRIVATE_DEPLOYMENT && (
                      <th>Plan</th>
                    )}
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
                      {!process.env.NEXT_PUBLIC_IS_PRIVATE_DEPLOYMENT && (
                        <td>
                          <span className="badge badge-active">{org.subscription_tier}</span>
                        </td>
                      )}
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
                            onClick={() => { setDeleteError(''); setDeleteTarget(org); }}
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

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Delete Organization</div>
            <div className="modal-body">
              <p>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 8, padding: '10px 12px', marginTop: 12,
              }}>
                <svg width="15" height="15" fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p style={{ fontSize: 12, color: '#991b1b', margin: 0, lineHeight: 1.5 }}>
                  All data for this organization will be permanently deleted — including all users who only belong to this org, documents, workflows, and chat history. This cannot be undone.
                </p>
              </div>
            </div>
            {deleteError && (
              <div style={{ padding: '0 0 8px', color: '#dc2626', fontSize: 12 }}>{deleteError}</div>
            )}
            <div className="modal-actions">
              <button
                className="btn"
                style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Organization'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
