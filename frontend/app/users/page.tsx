'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';

interface OrgUser {
  id: string;
  email: string;
  full_name: string;
  status: string;
  user_type: string;
  org_role: string;
  created_at: string;
  last_login_at: string | null;
  roles: { id: string; name: string }[];
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
  .table td { padding: 14px 16px; font-size: 13.5px; color: #1a1a1a; border-bottom: 1px solid #f7f6f4; vertical-align: middle; }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: #faf9f7; }
  .badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 500; }
  .badge-active { background: #dcfce7; color: #16a34a; }
  .badge-inactive { background: #f1f5f9; color: #64748b; }
  .badge-suspended { background: #fef2f2; color: #dc2626; }
  .type-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 500; }
  .type-org_admin { background: #fef3c7; color: #b45309; }
  .type-user { background: #f1f5f9; color: #475569; }
  .role-tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; background: #eff6ff; color: #3b82f6; font-size: 11px; font-weight: 500; margin-right: 4px; margin-bottom: 2px; }
  .actions { display: flex; gap: 8px; }
  .empty { text-align: center; padding: 56px 24px; color: #9a9a9a; }
  .err-bar { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: white; border-radius: 12px; padding: 28px; width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
  .modal-title { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
  .modal-body { font-size: 13.5px; color: #666; margin-bottom: 24px; line-height: 1.5; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
`;

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<OrgUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!meRes.success) { router.push('/auth/signin'); return; }
      const ut = meRes.data.data.user_type;
      if (ut === 'user') { router.push('/dashboard'); return; }
    } catch {
      router.push('/auth/signin');
      return;
    }

    try {
      const tokenData = localStorage.getItem('accessToken');
      if (tokenData) {
        const payload = JSON.parse(atob(tokenData.split('.')[1]));
        const oid = payload.org_id;
        if (oid) {
          setOrgId(oid);
          const res = await apiFetch<{ data: OrgUser[] }>(`/organizations/${oid}/users`);
          if (res.success) setUsers(res.data.data);
          else setError(res.error || 'Failed to load users');
        } else {
          setError('no-org');
        }
      }
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { guardAndFetch(); }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.success) {
        setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
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
            <div className="page-title">Users</div>
            <div className="page-subtitle">Manage users in your organization</div>
          </div>
          <button className="btn btn-primary" onClick={() => router.push('/users/create')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Add User
          </button>
        </div>

        {error && error !== 'no-org' && <div className="err-bar">{error}</div>}

        {error === 'no-org' ? (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <svg width="40" height="40" fill="none" stroke="#d4d4d4" strokeWidth="1.5" viewBox="0 0 24 24" style={{ margin: '0 auto 16px' }}>
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>No organization selected</div>
            <div style={{ fontSize: '13px', color: '#9a9a9a', maxWidth: 320, margin: '0 auto' }}>
              Use the organization switcher in the top-right corner to select an organization, then come back here to manage its users.
            </div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#9a9a9a' }}>Loading…</div>
        ) : (
          <div className="card">
            {users.length === 0 ? (
              <div className="empty">No users in this organization yet. Add the first one.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Type</th>
                    <th>Roles</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.full_name || '—'}</td>
                      <td style={{ color: '#555' }}>{u.email}</td>
                      <td>
                        <span className={`type-badge type-${u.user_type}`}>
                          {u.user_type === 'org_admin' ? (
                            <>
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                              </svg>
                              Org Admin
                            </>
                          ) : (
                            <>
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                              </svg>
                              User
                            </>
                          )}
                        </span>
                      </td>
                      <td>
                        {u.roles && u.roles.length > 0
                          ? u.roles.map(r => <span key={r.id} className="role-tag">{r.name}</span>)
                          : <span style={{ color: '#ccc', fontSize: '12px' }}>No roles</span>
                        }
                      </td>
                      <td><span className={`badge badge-${u.status}`}>{u.status}</span></td>
                      <td style={{ color: '#777' }}>{formatDate(u.created_at)}</td>
                      <td style={{ color: '#777' }}>{formatDate(u.last_login_at)}</td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                            onClick={() => router.push(`/users/${u.id}/edit`)}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(u)}>Remove</button>
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
            <div className="modal-title">Remove User</div>
            <div className="modal-body">
              Remove <strong>{deleteTarget.full_name || deleteTarget.email}</strong> from this organization?
            </div>
            <div className="modal-actions">
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
