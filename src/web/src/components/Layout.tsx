import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { User as UserType, Organization } from '../types'
import { api } from '../lib/api'
import { clearTokens } from '../lib/auth'

const DOT_COLORS = ['#1a1a1a', '#2563eb', '#7c3aed', '#0891b2', '#059669']

function initials(name?: string | null, email?: string | null) {
  if (name)
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  return (email ?? 'U').slice(0, 2).toUpperCase()
}

function getBreadcrumb(pathname: string): { section: string; page: string } {
  if (pathname === '/dashboard') return { section: 'Home', page: 'Dashboard' }
  if (pathname === '/documents') return { section: 'Knowledge Base', page: 'Documents' }
  if (pathname === '/ai_assistant') return { section: 'Home', page: 'AI Assistant' }
  if (pathname === '/agents') return { section: 'Home', page: 'Text-to-SQL Agent' }
  if (pathname === '/users') return { section: 'User Management', page: 'Users' }
  if (pathname === '/users/create') return { section: 'User Management', page: 'Create User' }
  if (pathname === '/users/invite') return { section: 'User Management', page: 'Invite User' }
  if (pathname.startsWith('/users/')) return { section: 'User Management', page: 'Edit User' }
  if (pathname === '/profile') return { section: 'Account', page: 'My Profile' }
  if (pathname === '/admin/organizations') return { section: 'Administration', page: 'Organizations' }
  return { section: 'Home', page: 'Dashboard' }
}

interface LayoutProps {
  children: React.ReactNode
  user: UserType | null
}

interface OrgWithRole extends Organization {
  role?: string
}

export function Layout({ children, user }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [organizations, setOrganizations] = useState<OrgWithRole[]>([])
  const orgMenuRef = useRef<HTMLDivElement>(null)

  const breadcrumb = getBreadcrumb(location.pathname)
  const isSuperAdmin = user?.role === 'super_admin'
  const isAdmin = user?.role === 'super_admin' || user?.role === 'tenant_admin'

  const curOrg = organizations.find((o) => o.id === user?.org_id) ?? null
  const curIdx = organizations.findIndex((o) => o.id === user?.org_id)

  useEffect(() => {
    api.get<OrgWithRole[]>('/orgs/').then(({ data }) => {
      if (data) setOrganizations(data)
    })
  }, [user?.org_id])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node))
        setOrgMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setMobileSidebarOpen(false)
    setOrgMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileSidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileSidebarOpen])

  const switchOrg = async (org: OrgWithRole) => {
    if (org.id === user?.org_id) { setOrgMenuOpen(false); return }
    setSwitching(true)
    try {
      const { data } = await api.post<{ access_token: string; refresh_token: string }>(
        '/orgs/switch',
        { org_id: org.id }
      )
      if (data) {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        window.location.reload()
      }
    } finally {
      setSwitching(false)
      setOrgMenuOpen(false)
    }
  }

  const handleLogout = () => {
    clearTokens()
    navigate('/login')
  }

  const isActive = (path: string) =>
    path === location.pathname || (path !== '/dashboard' && location.pathname.startsWith(path))

  const navItem = (
    path: string,
    label: string,
    icon: React.ReactNode,
    isAI = false
  ) => {
    const active = isActive(path)
    return (
      <Link
        key={path}
        to={path}
        className={`nav-item${active ? ' active' : ''}${isAI ? ' nav-ai' : ''}`}
      >
        {isAI ? (
          <span className="nav-ai-icon">{icon}</span>
        ) : (
          <span className="nav-icon">{icon}</span>
        )}
        <span className={isAI ? 'nav-ai-text' : ''}>{label}</span>
        {isAI && <span className="nav-ai-badge">AI</span>}
      </Link>
    )
  }

  const SidebarContent = () => (
    <div className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-top-row">
          <div className="brand">Platform</div>
          <button className="sidebar-close-btn" onClick={() => setMobileSidebarOpen(false)}>×</button>
        </div>
        <div className="brand-sub">Multi-tenant SaaS</div>
      </div>

      {isSuperAdmin && (
        <div className="nav-section">
          <div className="nav-label">Administration</div>
          {navItem('/admin/organizations', 'Organizations',
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="nav-section">
          <div className="nav-label">User Management</div>
          {navItem('/users', 'Users',
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          )}
        </div>
      )}

      <div className="nav-section">
        <div className="nav-label">Home</div>
        {navItem('/dashboard', 'Dashboard',
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
        )}
        {navItem('/ai_assistant', 'AI Assistant',
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            <circle cx="18" cy="5" r="3" />
          </svg>,
          true
        )}
        {navItem('/profile', 'My Profile',
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        )}
      </div>

      <div className="nav-section">
        <div className="nav-label">Knowledge Base</div>
        {navItem('/documents', 'Documents',
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        )}
        {navItem('/agents', 'Text-to-SQL',
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="user-profile" onClick={() => navigate('/profile')} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/profile')}>
          <div className="avatar">{initials(user?.name, user?.email)}</div>
          <div className="user-info">
            <div className="user-name">{user?.name || 'User'}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button className="signout-btn" onClick={(e) => { e.stopPropagation(); handleLogout() }} title="Sign out">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {switching && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="mini-spin" />
            <span style={{ fontSize: 14, fontWeight: 500 }}>Switching organization...</span>
          </div>
        </div>
      )}

      {mobileSidebarOpen && (
        <div className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />
      )}

      <div className="layout">
        <aside className={`sidebar-wrap${mobileSidebarOpen ? ' open' : ''}`}>
          <SidebarContent />
        </aside>

        <div className="main">
          <div className="topbar">
            <div className="breadcrumb">
              <button className="mobile-menu-btn" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <span>{breadcrumb.section}</span>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="breadcrumb-active">{breadcrumb.page}</span>
            </div>

            <div className="ts-wrap" ref={orgMenuRef}>
              <button className="ts-btn" onClick={() => setOrgMenuOpen(!orgMenuOpen)}>
                <div className="ts-dot" style={{ background: DOT_COLORS[Math.max(curIdx, 0) % DOT_COLORS.length] }}>
                  {curOrg?.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'ORG'}
                </div>
                <span>{curOrg?.name || 'Select org'}</span>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                  style={{ transition: 'transform 0.2s', transform: orgMenuOpen ? 'rotate(180deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {orgMenuOpen && (
                <div className="ts-drop">
                  {organizations.map((org, idx) => (
                    <div key={org.id} className="drop-item" onClick={() => switchOrg(org)}>
                      <div className="ts-dot" style={{ background: DOT_COLORS[idx % DOT_COLORS.length] }}>
                        {org.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{org.name}</div>
                        <div style={{ fontSize: 11, color: '#9a9a9a' }}>{(org as any).role || ''}</div>
                      </div>
                      {org.id === user?.org_id && (
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="content-wrapper">{children}</div>
        </div>
      </div>
    </>
  )
}
