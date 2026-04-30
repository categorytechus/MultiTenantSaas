'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';
import './users.css';

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

interface InviteItem {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<OrgUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<OrgUser | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [currentUserType, setCurrentUserType] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'invites'>('users');

  // Invite design state (frontend-only for now)
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [invites, setInvites] = useState<InviteItem[]>([]);

  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!openMenuRef.current) return;
      if (!openMenuRef.current.contains(e.target as Node)) setOpenMenuFor(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!meRes.success) { router.push('/auth/signin'); return; }
      const ut = meRes.data.data.user_type;
      setCurrentUserType(ut);
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

  useEffect(() => {
    const run = () => {
      void guardAndFetch();
    };
    const timer = window.setTimeout(run, 0);
    return () => window.clearTimeout(timer);
  }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.success) {
        setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
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

  const handlePasswordReset = async () => {
    if (!passwordTarget || !orgId) return;
    setError('');
    setResettingPassword(true);
    try {
      const res = await apiFetch<{ data?: { temp_password?: string } }>(
        `/organizations/${orgId}/users/${passwordTarget.id}/reset-password`,
        { method: 'POST' }
      );
      if (res.success) {
        setPasswordTarget(null);
        if (res.data?.data?.temp_password) setResetTempPassword(res.data.data.temp_password);
      } else {
        setError(res.error || 'Password reset failed');
      }
    } catch {
      setError('Password reset failed');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    if (!inviteEmail) return;

    const duplicatePending = invites.some(
      (i) => i.email.toLowerCase() === inviteEmail.toLowerCase() && i.status === 'pending'
    );
    if (duplicatePending) {
      setInviteError('A pending invite already exists for this email.');
      return;
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const newInvite: InviteItem = {
      id: crypto.randomUUID(),
      email: inviteEmail.trim().toLowerCase(),
      full_name: inviteName.trim() || undefined,
      role: inviteRole,
      invited_by: 'Current Admin',
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      status: 'pending',
    };
    setInvites((prev) => [newInvite, ...prev]);
    setShowInviteModal(false);
    setInviteEmail('');
    setInviteName('');
    setInviteRole('user');
    setInviteMessage('');
  };

  const handleRevokeInvite = (id: string) => {
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'revoked' } : i)));
  };

  const handleResendInvite = (id: string) => {
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    setInvites((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: 'pending', created_at: now.toISOString(), expires_at: expires.toISOString() }
          : i
      )
    );
  };

  const canChangePassword = () => currentUserType === 'super_admin';

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Users</div>
            <div className="page-subtitle">Manage users and invitations in your organization</div>
          </div>
          <div className="header-actions">
            <button className="btn btn-secondary" onClick={() => setShowInviteModal(true)}>
              Invite User
            </button>
            <button className="btn btn-primary" onClick={() => router.push('/users/create')}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
              Add User
            </button>
          </div>
        </div>

        <div className="users-tabs">
          <button type="button" className={`users-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            Active Users
          </button>
          <button type="button" className={`users-tab ${activeTab === 'invites' ? 'active' : ''}`} onClick={() => setActiveTab('invites')}>
            Invites
          </button>
        </div>

        {error && error !== 'no-org' && <div className="err-bar">{error}</div>}

        {error === 'no-org' ? (
          <div style={{ textAlign: 'center', padding: '64px 24px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>No organization selected</div>
            <div style={{ fontSize: '13px', color: '#9a9a9a', maxWidth: 320, margin: '0 auto' }}>
              Use the organization switcher in the top-right corner to select an organization, then come back here to manage users.
            </div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#9a9a9a' }}>Loading…</div>
        ) : activeTab === 'users' ? (
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
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.full_name || '—'}</td>
                      <td style={{ color: '#555' }}>{u.email}</td>
                      <td><span className={`type-badge type-${u.user_type}`}>{u.user_type === 'org_admin' ? 'Org Admin' : 'User'}</span></td>
                      <td>{u.roles?.length ? u.roles.map((r) => <span key={r.id} className="role-tag">{r.name}</span>) : <span style={{ color: '#ccc', fontSize: '12px' }}>No roles</span>}</td>
                      <td><span className={`badge badge-${u.status}`}>{u.status}</span></td>
                      <td style={{ color: '#777' }}>{formatDate(u.created_at)}</td>
                      <td style={{ color: '#777' }}>{formatDate(u.last_login_at)}</td>
                      <td>
                        <div className="row-menu">
                          <button type="button" className="kebab-btn" aria-haspopup="menu" aria-expanded={openMenuFor === u.id} onClick={(e) => { e.stopPropagation(); setOpenMenuFor((prev) => (prev === u.id ? null : u.id)); }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="15.5" cy="12" r="1.6" fill="currentColor" /></svg>
                          </button>
                          {openMenuFor === u.id && (
                            <div className="kebab-dropdown" ref={openMenuRef} onClick={(e) => e.stopPropagation()} role="menu">
                              <button type="button" className="kebab-item" onClick={() => { setOpenMenuFor(null); router.push(`/users/${u.id}/edit`); }}>Edit</button>
                              {canChangePassword() && <button type="button" className="kebab-item" onClick={() => { setOpenMenuFor(null); setPasswordTarget(u); }}>Reset Password</button>}
                              <button type="button" className="kebab-item kebab-danger" onClick={() => { setOpenMenuFor(null); setDeleteTarget(u); }}>Remove</button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="card">
            {invites.length === 0 ? (
              <div className="empty">No invites yet. Use Invite User to send your first invite.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Invited by</th>
                    <th>Sent</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{inv.email}</div>
                        {inv.full_name && <div style={{ fontSize: 12, color: '#888' }}>{inv.full_name}</div>}
                      </td>
                      <td><span className="role-tag">{inv.role}</span></td>
                      <td style={{ color: '#666' }}>{inv.invited_by}</td>
                      <td style={{ color: '#777' }}>{formatDate(inv.created_at)}</td>
                      <td style={{ color: '#777' }}>{formatDate(inv.expires_at)}</td>
                      <td><span className={`invite-status invite-${inv.status}`}>{inv.status}</span></td>
                      <td>
                        <div className="invite-actions">
                          <button type="button" className="invite-link" onClick={() => handleResendInvite(inv.id)}>Resend</button>
                          <button type="button" className="invite-link invite-link-danger" onClick={() => handleRevokeInvite(inv.id)}>Revoke</button>
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

      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Invite User</div>
            <div className="modal-body">Send an invitation email with secure password setup link.</div>
            {inviteError && <div className="err-bar" style={{ marginBottom: 12 }}>{inviteError}</div>}
            <form onSubmit={handleInviteSubmit}>
              <div className="invite-grid">
                <div>
                  <label className="invite-label">Email address *</label>
                  <input className="invite-input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" required autoFocus />
                </div>
                <div>
                  <label className="invite-label">Full name (optional)</label>
                  <input className="invite-input" type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="invite-label">Role</label>
                  <select className="invite-input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    <option value="user">User</option>
                    <option value="org_admin">Org Admin</option>
                  </select>
                </div>
                <div>
                  <label className="invite-label">Organization</label>
                  <input className="invite-input" type="text" value="Current organization" disabled />
                </div>
                <div>
                  <label className="invite-label">Message (optional)</label>
                  <textarea className="invite-textarea" value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)} placeholder="Welcome to the workspace..." />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setShowInviteModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Send Invite</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Remove User</div>
            <div className="modal-body">Remove <strong>{deleteTarget.full_name || deleteTarget.email}</strong> from this organization?</div>
            <div className="modal-actions">
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Removing…' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}

      {passwordTarget && (
        <div className="modal-overlay" onClick={() => setPasswordTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Reset Password</div>
            <div className="modal-body">A new temporary password will be generated for <strong>{passwordTarget.full_name || passwordTarget.email}</strong>.</div>
            <div className="modal-actions">
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setPasswordTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePasswordReset} disabled={resettingPassword}>{resettingPassword ? 'Resetting…' : 'Reset Password'}</button>
            </div>
          </div>
        </div>
      )}

      {resetTempPassword && (
        <div className="modal-overlay" onClick={() => setResetTempPassword(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Password Reset</div>
            <div className="modal-body">Share this temporary password securely.</div>
            <div style={{ background: '#f5f4f1', border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 14px', color: '#1a1a1a', fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.05em', margin: '12px 0', wordBreak: 'break-all' }}>
              {resetTempPassword}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(resetTempPassword); setResetCopied(true); setTimeout(() => setResetCopied(false), 2000); }}>
                {resetCopied ? 'Copied!' : 'Copy Password'}
              </button>
              <button className="btn" style={{ background: '#f5f4f1', color: '#1a1a1a', border: 'none' }} onClick={() => setResetTempPassword(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}