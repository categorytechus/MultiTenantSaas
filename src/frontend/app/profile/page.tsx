'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';

interface MeUser {
  id: string;
  email: string;
  name: string;
  user_type: 'super_admin' | 'user';
  status: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);
  const [name, setName] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [roleLabel, setRoleLabel] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        router.push('/auth/signin');
        return;
      }
      try {
        const res = await apiFetch<{ data: MeUser }>('/auth/me');
        if (!res.success) {
          router.push('/auth/signin');
          return;
        }
        const me = res.data.data;
        setUser(me);
        setName(me.name || '');
        // Derive role label from JWT
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const roles: string[] = payload.roles ?? [];
          if (me.user_type === 'super_admin') {
            setRoleLabel('Super Admin');
            setIsAdmin(true);
          } else if (roles.includes('org_admin')) {
            setRoleLabel('Org Admin');
          } else {
            setRoleLabel('User');
          }
        } catch { setRoleLabel(me.user_type); }
      } catch {
        router.push('/auth/signin');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileMessage('');
    setProfileSaving(true);

    try {
      const res = await apiFetch<{ data: MeUser; message?: string }>('/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });

      if (!res.success) {
        setProfileError(res.error || 'Failed to update profile');
        return;
      }

      const updatedUser = res.data.data;
      setUser(updatedUser);
      setName(updatedUser.name || '');
      setProfileMessage(res.data.message || 'Profile updated successfully');
    } catch {
      setProfileError('Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match');
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await apiFetch<{ message?: string }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.success) {
        setPasswordError(res.error || 'Failed to change password');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(res.data.message || 'Password changed successfully');
    } catch {
      setPasswordError('Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <Layout>
      <div className="profile-page">
        <div className="profile-header">
          <h1>My Profile</h1>
          <p>View and update your account details</p>
        </div>

        {loading ? (
          <div className="profile-loading">Loading profile…</div>
        ) : isAdmin ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 24px',
            textAlign: 'center',
            gap: 16,
          }}>
            <svg
              width="48"
              height="48"
              fill="none"
              stroke="#c8c4bc"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>
              Profile editing is managed through Admin Tools
            </div>
            <div style={{ fontSize: 13, color: '#9a9a9a', maxWidth: 380 }}>
              User profiles are shown here. As an administrator, use the admin
              tools to view or update user details.
            </div>
          </div>
        ) : (
          <>
            <div className="profile-tabs">
              <button
                type="button"
                className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
                onClick={() => setActiveTab('profile')}
              >
                Profile
              </button>
              <button
                type="button"
                className={`profile-tab ${activeTab === 'password' ? 'active' : ''}`}
                onClick={() => setActiveTab('password')}
              >
                Change Password
              </button>
            </div>

            <div className="profile-grid">
              {activeTab === 'profile' && (
                <section className="profile-card">
                  <div className="card-title">Profile Details</div>
                  <div className="card-subtitle">Update your name and view account info</div>

                  {profileError && <div className="err-bar">{profileError}</div>}
                  {profileMessage && <div className="ok-bar">{profileMessage}</div>}

                  <form onSubmit={handleSaveProfile}>
                    <div className="field">
                      <label className="field-label">Email</label>
                      <input className="fi" type="email" value={user?.email || ''} disabled />
                    </div>

                    <div className="field">
                      <label className="field-label">Full name</label>
                      <input
                        className="fi"
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="field">
                      <label className="field-label">Role</label>
                      <input className="fi" type="text" value={roleLabel} disabled />
                    </div>

                    <button className="btn btn-primary" type="submit" disabled={profileSaving}>
                      {profileSaving ? 'Saving…' : 'Save Profile'}
                    </button>
                  </form>
                </section>
              )}

              {activeTab === 'password' && (
                <section className="profile-card">
                  <div className="card-title">Change Password</div>
                  <div className="card-subtitle">Use your current password to set a new one</div>

                  {passwordError && <div className="err-bar">{passwordError}</div>}
                  {passwordMessage && <div className="ok-bar">{passwordMessage}</div>}

                  <form onSubmit={handleChangePassword}>
                    <div className="field">
                      <label className="field-label">Current password</label>
                      <input
                        className="fi"
                        type="password"
                        placeholder="Enter current password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                      />
                    </div>

                    <div className="field">
                      <label className="field-label">New password</label>
                      <input
                        className="fi"
                        type="password"
                        placeholder="Minimum 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                    </div>

                    <div className="field">
                      <label className="field-label">Confirm new password</label>
                      <input
                        className="fi"
                        type="password"
                        placeholder="Re-enter new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                    </div>

                    <button className="btn btn-primary" type="submit" disabled={passwordSaving}>
                      {passwordSaving ? 'Updating…' : 'Change Password'}
                    </button>
                  </form>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
