'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Layout from '../../../../../components/Layout';
import { apiFetch } from '../../../../../src/lib/api';
import './admin-org-admins-id-edit.css';

interface OrgAdminListItem {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  org_name?: string | null;
}

export default function EditOrgAdminPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);

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
        const res = await apiFetch<{ data: OrgAdminListItem[] }>('/admin/org-admins');
        if (res.success) {
          const admin = res.data.data.find((a) => a.id === id);
          if (admin) {
            setName(admin.full_name || '');
            setEmail(admin.email);
            setStatus(admin.status);
            setOrgName(admin.org_name || '');
          } else {
            setError('Org admin not found');
          }
        }
      } catch {
        setError('Failed to load data');
      } finally {
        setFetchingData(false);
      }
    })();
  }, [router, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await apiFetch(`/admin/org-admins/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, status }),
      });
      if (res.success) {
        setSuccess('Org admin updated successfully');
      } else {
        setError(res.error || 'Update failed');
      }
    } catch {
      setError('Update failed');
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
        <div className="page-title">Edit Org Admin</div>
        <div className="page-subtitle">{email}{orgName ? ` · ${orgName}` : ''}</div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {fetchingData ? (
          <div style={{ color: '#9a9a9a', fontSize: '13.5px' }}>Loading…</div>
        ) : (
          <div className="form-card">
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Full name</label>
                <input className="fi" type="text" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label>Status</label>
                <select className="fi select" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div className="form-actions">
                <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/org-admins')}>Cancel</button>
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