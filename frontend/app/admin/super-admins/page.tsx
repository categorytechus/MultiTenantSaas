'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import './admin-super-admins.css';

interface SuperAdmin {
  id: string;
  email: string;
  full_name: string;
  status: string;
  user_type: string;
  created_at: string;
  last_login_at: string | null;
}

export default function SuperAdminsPage() {
  const router = useRouter();
  const [admins, setAdmins] = useState<SuperAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SuperAdmin | null>(null);
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
      const res = await apiFetch<{ data: SuperAdmin[] }>('/admin/super-admins');
      if (res.success) setAdmins(res.data.data);
      else setError(res.error || 'Failed to load super admins');
    } catch {
      setError('Failed to load super admins');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void guardAndFetch();
    }, 0);
    return () => window.clearTimeout(t);
  }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/admin/super-admins/${deleteTarget.id}`, { method: 'DELETE' });
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
            <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Super Admins</div>
            <div className="page-subtitle">Manage global platform administrators</div>
          </div>
          <button className="btn btn-primary" onClick={() => router.push('/admin/super-admins/create')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Create Super Admin
          </button>
        </div>

        {error && <div className="err-bar">{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#9a9a9a' }}>Loading…</div>
        ) : (
          <div className="card">
            {admins.length === 0 ? (
              <div className="empty">
                <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
                No super admins yet. Create the first one.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
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
                        <span className={`badge badge-${a.status}`}>{a.status}</span>
                      </td>
                      <td style={{ color: '#777' }}>{formatDate(a.created_at)}</td>
                      <td style={{ color: '#777' }}>{formatDate(a.last_login_at)}</td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }}
                            onClick={() => router.push(`/admin/super-admins/${a.id}/edit`)}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(a)}>
                            Delete
                          </button>
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
            <div className="modal-title">Delete Super Admin</div>
            <div className="modal-body">
              Are you sure you want to delete <strong>{deleteTarget.full_name || deleteTarget.email}</strong>?
              This action cannot be undone.
            </div>
            <div className="modal-actions">
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
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