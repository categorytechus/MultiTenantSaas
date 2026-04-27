'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';

interface OrgAdmin {
  id: string;
  email: string;
  full_name: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  org_id: string | null;
  org_name: string | null;
  org_slug: string | null;
}

const PAGE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; }
  .page { padding: 32px; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .page-title { font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; }
  .page-subtitle { font-size: 13px; color: #9a9a9a; margin-top: 3px; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500; cursor: pointer; border: none; transition: all .13s; }
  .btn-primary { background: #1a1a1a; color: white; }
  .btn-primary:hover { background: #333; box-shadow: 0 3px 10px rgba(0,0,0,.15); }
  .btn-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .btn-danger:hover { background: #fee2e2; }
  .btn-sm { padding: 6px 12px; font-size: 12.5px; }
  .card { background: white; border-radius: 12px; border: 1px solid #f0eeeb; overflow: hidden; }
  .table { width: 100%; border-collapse: collapse; }
  .table th { padding: 12px 16px; text-align: left; font-size: 11.5px; font-weight: 600; color: #9a9a9a; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #f0eeeb; background: #faf9f7; }
  .table td { padding: 14px 16px; font-size: 13.5px; color: #1a1a1a; border-bottom: 1px solid #f7f6f4; }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: #faf9f7; }
  .badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 500; }
  .badge-active { background: #dcfce7; color: #16a34a; }
  .badge-inactive { background: #f1f5f9; color: #64748b; }
  .badge-suspended { background: #fef2f2; color: #dc2626; }
  .org-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 20px; background: #f0f0f0; font-size: 11.5px; color: #555; }
  .actions { display: flex; gap: 8px; }
  .empty { text-align: center; padding: 56px 24px; color: #9a9a9a; }
  .err-bar { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: white; border-radius: 12px; padding: 28px; width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
  .modal-title { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
  .modal-body { font-size: 13.5px; color: #666; margin-bottom: 24px; line-height: 1.5; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
`;

export default function OrgAdminsPage() {
  const router = useRouter();
  const [admins, setAdmins] = useState<OrgAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<OrgAdmin | null>(null);
  const [deleting, setDeleting] = useState(false);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!meRes.success || meRes.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
    } catch {
      router.push('/dashboard');
      return;
    }
    try {
      const res = await apiFetch<{ data: OrgAdmin[] }>('/admin/org-admins');
      if (res.success) setAdmins(res.data.data);
      else setError(res.error || 'Failed to load org admins');
    } catch {
      setError('Failed to load org admins');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { guardAndFetch(); }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/admin/org-admins/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.success) {
        setAdmins(prev => prev.filter(a => a.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        setError(res.error || 'Delete failed');
      }
    } catch {
      setError('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Layout>
      <style>{PAGE_STYLES}</style>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Org Admins</div>
            <div className="page-subtitle">Manage organization administrators across all orgs</div>
          </div>
          <button className="btn btn-primary" onClick={() => router.push('/admin/org-admins/create')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Create Org Admin
          </button>
        </div>

        {error && <div className="err-bar">{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#9a9a9a' }}>Loading…</div>
        ) : (
          <div className="card">
            {admins.length === 0 ? (
              <div className="empty">No org admins found.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Organization</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.full_name || '—'}</td>
                      <td style={{ color: '#555' }}>{a.email}</td>
                      <td>
                        {a.org_name ? (
                          <span className="org-pill">
                            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                            {a.org_name}
                          </span>
                        ) : '—'}
                      </td>
                      <td><span className={`badge badge-${a.status}`}>{a.status}</span></td>
                      <td style={{ color: '#777' }}>{formatDate(a.created_at)}</td>
                      <td style={{ color: '#777' }}>{formatDate(a.last_login_at)}</td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                            onClick={() => router.push(`/admin/org-admins/${a.id}/edit`)}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(a)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Delete Org Admin</div>
            <div className="modal-body">
              Are you sure you want to delete <strong>{deleteTarget.full_name || deleteTarget.email}</strong>? This action cannot be undone.
            </div>
            <div className="modal-actions">
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
