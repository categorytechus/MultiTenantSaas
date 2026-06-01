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

function downloadRecoveryKey(email: string, key: string) {
  const content = [
    'Super Admin Recovery Key',
    '========================',
    '',
    `Account: ${email}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'Recovery Key:',
    key,
    '',
    'IMPORTANT: Store this file securely. This key grants full super admin',
    'access and cannot be retrieved again. If lost, generate a new one by',
    'changing your password again.',
  ].join('\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `recovery-key-${email.replace(/[^a-z0-9]/gi, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
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

  // Change password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);

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

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    if (newPassword.length < 8) {
      setPwdError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('Passwords do not match');
      return;
    }
    setPwdLoading(true);
    try {
      const res = await apiFetch<{ data: { recovery_key: string } }>(
        `/admin/super-admins/${id}/change-password`,
        { method: 'POST', body: JSON.stringify({ password: newPassword }) },
      );
      if (res.success) {
        const key = res.data.data.recovery_key;
        downloadRecoveryKey(email, key);
        setNewPassword('');
        setConfirmPassword('');
        setSuccess('Password changed. Recovery key file downloaded — store it safely.');
      } else {
        setPwdError(res.error || 'Password change failed');
      }
    } catch {
      setPwdError('Password change failed');
    } finally {
      setPwdLoading(false);
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
          <>
            {/* Profile section */}
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

            {/* Change password section */}
            <div className="form-card" style={{ marginTop: 24 }}>
              <div className="form-card-title">Change Password</div>
              <div style={{ fontSize: 13, color: '#9a9a9a', marginBottom: 16 }}>
                Changing the password generates a new recovery key file (.txt) that can be used to sign in if the password is forgotten.
              </div>

              {pwdError && <div className="err-bar" style={{ marginBottom: 16 }}>{pwdError}</div>}

              <form onSubmit={handleChangePassword}>
                <div className="field">
                  <label className="field-lbl">New password</label>
                  <div className="irow">
                    <input
                      className="fi pad"
                      type={showNewPwd ? 'text' : 'password'}
                      placeholder="Min 8 characters"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <button type="button" className="eye" onClick={() => setShowNewPwd(!showNewPwd)} tabIndex={-1}>
                      {showNewPwd
                        ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label className="field-lbl">Confirm new password</label>
                  <div className="irow">
                    <input
                      className="fi pad"
                      type={showConfirmPwd ? 'text' : 'password'}
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                    />
                    <button type="button" className="eye" onClick={() => setShowConfirmPwd(!showConfirmPwd)} tabIndex={-1}>
                      {showConfirmPwd
                        ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', marginBottom: 16 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  A recovery key file will be downloaded automatically. Keep it in a secure location — it will not be shown again.
                </div>

                <div className="flex gap-3 justify-end">
                  <button className="btn btn-primary" type="submit" disabled={pwdLoading}>
                    {pwdLoading && <span className="spin" />}
                    {pwdLoading ? 'Changing…' : 'Change Password & Download Key'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
