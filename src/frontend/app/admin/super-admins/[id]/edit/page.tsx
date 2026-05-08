'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Layout from '../../../../../components/Layout';
import { apiFetch } from '../../../../../src/lib/api';

interface SuperAdminListItem {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
}

export default function EditSuperAdminPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [email, setEmail] = useState('');
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
        const res = await apiFetch<{ data: SuperAdminListItem[] }>('/admin/super-admins');
        if (res.success) {
          const admin = res.data.data.find((a) => a.id === id);
          if (admin) {
            setName(admin.full_name || '');
            setEmail(admin.email);
            setStatus(admin.status);
          } else {
            setError('Super admin not found');
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
      const res = await apiFetch(`/admin/super-admins/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, status }),
      });
      if (res.success) {
        setSuccess('Super admin updated successfully');
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
        <button
          className="flex items-center gap-1.5 text-[13px] text-[#9a9a9a] hover:text-[#1a1a1a] mb-5 transition-colors"
          onClick={() => router.push('/admin/super-admins')}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Super Admins
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">Edit Super Admin</div>
            <div className="page-subtitle">{email}</div>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {fetchingData ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9a9a9a] py-8">
            <span className="w-4 h-4 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="form-card">
            <div className="form-card-title">Profile</div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label className="field-lbl">Full name</label>
                <input className="fi" type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-lbl">Status</label>
                <select className="fi" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/super-admins')}>Cancel</button>
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
