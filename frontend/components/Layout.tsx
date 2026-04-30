'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '../src/lib/api';

interface Org { id: string; name: string; slug: string; role: string; }
interface User { id: string; email: string; full_name?: string; user_type?: 'super_admin' | 'org_admin' | 'user'; }

const DOT_COLORS = ['#1a1a1a', '#2563eb', '#7c3aed', '#0891b2', '#059669'];

function initials(name?: string, email?: string) {
  if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  return (email ?? 'U').slice(0, 2).toUpperCase();
}

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [cur, setCur] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) { router.push('/auth/signin'); return; }
      try {
        const uRes = await apiFetch<{ data: User }>('/auth/me');
        if (!uRes.success) throw new Error('Unauthorized');
        const userData = uRes.data.data;
        setUser(userData);

        if (userData.user_type === 'super_admin') {
          // Super admins see all organizations
          const oRes = await apiFetch<{ data: { id: string; name: string; slug: string }[] }>('/admin/organizations');
          if (oRes.success) {
            const allOrgs = oRes.data.data.map(o => ({ ...o, role: 'super_admin' }));
            setOrgs(allOrgs);
            // Set current org from JWT if one is already selected
            const jwtPayload = JSON.parse(atob(token.split('.')[1]));
            const currentOrgId = jwtPayload.org_id;
            if (currentOrgId) {
              const cur = allOrgs.find(o => o.id === currentOrgId);
              if (cur) setCur(cur);
            }
          }
        } else {
          // Regular users see their own orgs
          const oRes = await apiFetch<{ data: Org[] }>('/organizations');
          if (oRes.success && oRes.data.data.length > 0) {
            setOrgs(oRes.data.data);
            // Set current org from JWT if one is already selected
            const jwtPayload = JSON.parse(atob(token.split('.')[1]));
            const currentOrgId = jwtPayload.org_id;
            const cur = oRes.data.data.find(o => o.id === currentOrgId);

            if (cur) {
              setCur(cur);
            } else {
              // Keep UI + token context in sync: when token has no org_id,
              // automatically switch to the first available org.
              const fallbackOrg = oRes.data.data[0];
              const switchRes = await apiFetch<{ data: { accessToken: string, refreshToken: string, organization: { role: string } } }>('/organizations/switch', {
                method: 'POST',
                body: JSON.stringify({ organizationId: fallbackOrg.id }),
              });

              if (switchRes.success) {
                localStorage.setItem('accessToken', switchRes.data.data.accessToken);
                localStorage.setItem('refreshToken', switchRes.data.data.refreshToken);
                setCur({ ...fallbackOrg, role: switchRes.data.data.organization.role });
                window.location.reload();
                return;
              }

              // Fallback visual selection if token switch fails for any reason.
              setCur(fallbackOrg);
            }
          }
        }
      } catch { 
        router.push('/auth/signin'); 
      }
      finally { setLoading(false); }
    })();
  }, [router]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileSidebarOpen]);

  const switchOrg = async (org: Org) => {
    if (org.id === cur?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      const res = await apiFetch<{ data: { accessToken: string, refreshToken: string, organization: { role: string } } }>('/organizations/switch', {
        method: 'POST',
        body: JSON.stringify({ organizationId: org.id }),
      });
      if (res.success) {
        localStorage.setItem('accessToken', res.data.data.accessToken);
        localStorage.setItem('refreshToken', res.data.data.refreshToken);
        setCur({ ...org, role: res.data.data.organization.role });
        window.location.reload(); // Refresh to update permissions
      }
    } finally { setSwitching(false); setOpen(false); }
  };

  const signOut = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    router.push('/auth/signin');
  };

  const curIdx = orgs.findIndex(o => o.id === cur?.id);

  const isSuperAdmin = user?.user_type === 'super_admin';
  const isOrgAdmin = user?.user_type === 'org_admin' || isSuperAdmin;

  // Determine breadcrumb based on pathname
  const getBreadcrumb = () => {
    if (pathname === '/dashboard') return { section: 'Dashboard', page: 'Overview' };
    if (pathname === '/documents') return { section: 'Knowledge Base', page: 'Documents' };
    if (pathname === '/web-urls') return { section: 'Knowledge Base', page: 'Web URLs' };
    if (pathname === '/ai_assistant') return { section: 'Home', page: 'AI Assistant' };
    if (pathname === '/users') return { section: 'User Management', page: 'Users' };
    if (pathname === '/users/create') return { section: 'User Management', page: 'Create User' };
    if (pathname.startsWith('/users/')) return { section: 'User Management', page: 'Edit User' };
    if (pathname === '/profile') return { section: 'Account', page: 'My Profile' };
    if (pathname === '/roles') return { section: 'User Management', page: 'Roles' };
    if (pathname === '/roles/create') return { section: 'User Management', page: 'Create Role' };
    if (pathname.startsWith('/roles/')) return { section: 'User Management', page: 'Edit Role' };
    if (pathname === '/admin/super-admins') return { section: 'Administration', page: 'Super Admins' };
    if (pathname === '/admin/super-admins/create') return { section: 'Administration', page: 'Create Super Admin' };
    if (pathname.startsWith('/admin/super-admins/')) return { section: 'Administration', page: 'Edit Super Admin' };
    if (pathname === '/admin/org-admins') return { section: 'Administration', page: 'Org Admins' };
    if (pathname === '/admin/org-admins/create') return { section: 'Administration', page: 'Create Org Admin' };
    if (pathname.startsWith('/admin/org-admins/')) return { section: 'Administration', page: 'Edit Org Admin' };
    if (pathname === '/admin/organizations') return { section: 'Administration', page: 'Organizations' };
    if (pathname === '/admin/organizations/create') return { section: 'Administration', page: 'Create Organization' };
    if (pathname.startsWith('/admin/organizations/')) return { section: 'Administration', page: 'Edit Organization' };
    return { section: 'Dashboard', page: 'Overview' };
  };

  const breadcrumb = getBreadcrumb();

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f7' }}>
      <div style={{ width: 28, height: 28, border: '2.5px solid #e5e5e5', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'spin .65s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'DM Sans', sans-serif; background: #ffffff; }

        .layout { display: flex; height: 100vh; overflow: hidden; }

        /* Sidebar */
        .sidebar {
          width: 240px;
          background: #fafafa;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #e5e5e5;
        }
        .sidebar-top {
          padding: 20px;
        }
        .sidebar-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .sidebar-close-btn {
          display: none;
          background: transparent;
          border: none;
          color: #6b7280;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
        }
        .sidebar-close-btn:hover {
          background: #f1f5f9;
          color: #111827;
        }
        .brand {
          font-size: 16px;
          font-weight: 700;
          color: #1a1a1a;
          letter-spacing: -0.3px;
        }
        .brand-sub {
          font-size: 11px;
          color: #9a9a9a;
          margin-top: 2px;
        }

        .nav-section {
          padding: 16px 0;
        }
        .nav-label {
          padding: 0 20px 8px;
          font-size: 11px;
          font-weight: 600;
          color: #9a9a9a;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 20px;
          font-size: 14px;
          color: #1a1a1a;
          cursor: pointer;
          transition: all 0.12s;
          text-decoration: none;
          border-left: 3px solid transparent;
        }
        .nav-item:hover {
          background: #f5f5f5;
          color: #1a1a1a;
        }
        .nav-item.active {
          background: #f5f5f5;
          color: #1a1a1a;
          font-weight: 600;
          border-left-color: #1a1a1a;
        }
        .nav-item svg {
          width: 18px;
          height: 18px;
          opacity: 0.7;
        }
        .nav-item.active svg {
          opacity: 1;
        }

        /* AI Assistant Special Styling */
        .nav-ai {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%);
        }
        .nav-ai:hover {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(59, 130, 246, 0.12) 100%);
        }
        .nav-ai.active {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%);
          border-left-color: #8b5cf6;
        }
        .nav-ai svg {
          color: #8b5cf6;
          opacity: 1;
        }
        .nav-ai-text {
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 600;
        }

        .sidebar-footer {
          margin-top: auto;
          padding: 16px 20px;
        }
        .user-profile {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }
        .user-profile:hover { background: transparent; }
        .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #1a1a1a;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
        }
        .user-info {
          flex: 1;
          min-width: 0;
        }
        .user-name {
          font-size: 13px;
          font-weight: 600;
          color: #1a1a1a;
        }
        .user-email {
          font-size: 11px;
          color: #666;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .signout-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: #ccc;
          padding: 6px;
          transition: color 0.12s;
        }
        .signout-btn:hover {
          color: #ef4444;
        }
        .signout-btn svg {
          width: 16px;
          height: 16px;
        }

        /* Main */
        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #ffffff;
        }

        /* Topbar */
        .topbar {
          height: 60px;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          border-radius: 0 0 20px 0px;
          border-bottom: 1px solid #f3f4f6;
        }
        .mobile-menu-btn {
          display: none;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          cursor: pointer;
        }
        .mobile-menu-btn:hover {
          background: #f9fafb;
        }
        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #666;
        }
        .breadcrumb-active {
          color: #1a1a1a;
          font-weight: 600;
        }

        /* Tenant Switcher */
        .ts-wrap { position: relative; }
        .ts-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: #f5f4f1;
          border: 1px solid #ebebeb;
          border-radius: 8px;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: #1a1a1a;
          transition: all 0.12s;
        }
        .ts-btn:hover { border-color: #c8c8c8; }
        .ts-dot {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: white;
        }
        .ts-drop {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 240px;
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12);
          overflow: hidden;
          z-index: 1000;
          animation: dropIn 0.15s ease;
        }
        @keyframes dropIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .drop-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: background 0.1s;
          color: #1a1a1a;
        }
        .drop-item:hover { background: #f5f4f1; }

        /* Overlay */
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(255,255,255,.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }
        .overlay-card {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          padding: 20px 32px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.08);
        }
        .mini-spin {
          width: 20px;
          height: 20px;
          border: 2px solid #eee;
          border-top-color: #1a1a1a;
          border-radius: 50%;
          animation: spin .65s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Content wrapper */
        .content-wrapper {
          flex: 1;
          overflow-y: auto;
          background: #ffffff;
        }
        .mobile-sidebar-backdrop {
          display: none;
        }
        @media (max-width: 1024px) {
          .mobile-menu-btn {
            display: inline-flex;
          }
          .topbar {
            padding: 0 16px;
          }
          .breadcrumb {
            gap: 6px;
            font-size: 13px;
            min-width: 0;
          }
          .breadcrumb span {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 1100;
            width: min(280px, 85vw);
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .sidebar-close-btn {
            display: inline-flex;
          }
          .mobile-sidebar-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.28);
            z-index: 1090;
          }
          .ts-btn span {
            max-width: 96px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
      `}</style>

      {switching && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="mini-spin" />
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Switching organization...</span>
          </div>
        </div>
      )}

      {mobileSidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="layout">
        {/* Sidebar */}
        <aside className={`sidebar${mobileSidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-top">
            <div className="sidebar-top-row">
              <div className="brand">Platform</div>
              <button
                className="sidebar-close-btn"
                onClick={() => setMobileSidebarOpen(false)}
                aria-label="Close sidebar"
              >
                ×
              </button>
            </div>
            <div className="brand-sub">Multi-tenant SaaS</div>
          </div>

          {isSuperAdmin && (
            <div className="nav-section">
              <div className="nav-label">Administration</div>
              <a href="/admin/super-admins" className={`nav-item${pathname.startsWith('/admin/super-admins') ? ' active' : ''}`}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M12 14c-6 0-8 2-8 4v1h16v-1c0-2-2-4-8-4z"/>
                  <path d="M18.5 2.5l.5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5z"/>
                </svg>
                Super Admins
              </a>
              <a href="/admin/org-admins" className={`nav-item${pathname.startsWith('/admin/org-admins') ? ' active' : ''}`}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                Org Admins
              </a>
              <a href="/admin/organizations" className={`nav-item${pathname.startsWith('/admin/organizations') ? ' active' : ''}`}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                </svg>
                Organizations
              </a>
            </div>
          )}

          {isOrgAdmin && (
            <div className="nav-section">
              <div className="nav-label">User Management</div>
              <a href="/users" className={`nav-item${pathname === '/users' || pathname.startsWith('/users/') ? ' active' : ''}`}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                </svg>
                Users
              </a>
              <a href="/roles" className={`nav-item${pathname === '/roles' || pathname.startsWith('/roles/') ? ' active' : ''}`}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
                Roles
              </a>
            </div>
          )}

          <div className="nav-section">
            <div className="nav-label">Home</div>
            <a href="/dashboard" className={`nav-item${pathname === '/dashboard' ? ' active' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              Dashboard
            </a>
            <a href="/ai_assistant" className={`nav-item nav-ai${pathname === '/ai_assistant' ? ' active' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                <circle cx="18" cy="5" r="3"/>
              </svg>
              <span className="nav-ai-text">AI Assistant</span>
            </a>
            <a href="/profile" className={`nav-item${pathname === '/profile' ? ' active' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              My Profile
            </a>
          </div>

          <div className="nav-section">
            <div className="nav-label">Knowledge Base</div>
            <a href="/documents" className={`nav-item${pathname === '/documents' ? ' active' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Documents
            </a>
            <a href="/web-urls" className={`nav-item${pathname === '/web-urls' ? ' active' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
              </svg>
              Web URLs
            </a>
          </div>

          <div className="sidebar-footer">
            <div
              className="user-profile"
              onClick={() => router.push('/profile')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') router.push('/profile');
              }}
            >
              <div className="avatar">{initials(user?.full_name, user?.email)}</div>
              <div className="user-info">
                <div className="user-name">{user?.full_name || 'User'}</div>
                <div className="user-email">{user?.email}</div>
              </div>
              <button
                className="signout-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  signOut();
                }}
              >
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="main">
          {/* Topbar */}
          <div className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu-btn"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <span>{breadcrumb.section}</span>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span className="breadcrumb-active">{breadcrumb.page}</span>
            </div>

            <div className="ts-wrap" ref={dropRef}>
              <button className="ts-btn" onClick={() => setOpen(!open)}>
                <div className="ts-dot" style={{ background: DOT_COLORS[curIdx % DOT_COLORS.length] }}>
                  {cur?.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'ORG'}
                </div>
                <span>{cur?.name || 'Select org'}</span>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {open && (
                <div className="ts-drop">
                  {orgs.map((org, idx) => (
                    <div key={org.id} className="drop-item" onClick={() => switchOrg(org)}>
                      <div className="ts-dot" style={{ background: DOT_COLORS[idx % DOT_COLORS.length] }}>
                        {org.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{org.name}</div>
                        <div style={{ fontSize: '11px', color: '#9a9a9a' }}>{org.role}</div>
                      </div>
                      {org.id === cur?.id && (
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Page Content */}
          <div className="content-wrapper">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}