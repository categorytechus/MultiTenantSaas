'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import './admin-super-admins-create.css';

export default function CreateSuperAdminPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    apiFetch<{ data: { user_type: string } }>('/auth/me').then(res => {
      if (!res.success || res.data.data.user_type !== 'super_admin') router.push('/dashboard');
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/admin/super-admins', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      if (res.success) {
        router.push('/admin/super-admins');
      } else {
        setError(res.error || 'Failed to create super admin');
      }
    } catch {
      setError('Failed to create super admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
<div className="page">
        <button className="back-link" onClick={() => router.push('/admin/super-admins')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Super Admins
        </button>
        <div className="page-title">Create Super Admin</div>
        <div className="page-subtitle">Add a new global platform administrator</div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input className="fi" type="text" placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email address</label>
              <input className="fi" type="email" placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="fi" type="password" placeholder="Min. 8 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              <p className="hint">Must be at least 8 characters long.</p>
            </div>
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => router.push('/admin/super-admins')}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spin" />}
                {loading ? 'Creating…' : 'Create Super Admin'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}