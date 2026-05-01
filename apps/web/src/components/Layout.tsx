import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Bot,
  Users,
  Shield,
  User,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Building2,
} from 'lucide-react'
import { User as UserType, Organization } from '../types'
import { api } from '../lib/api'
import { clearTokens } from '../lib/auth'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
  isAI?: boolean
  requiredRole?: string[]
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Home',
    items: [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: <LayoutDashboard size={16} />,
      },
    ],
  },
  {
    title: 'Knowledge Base',
    items: [
      {
        label: 'Documents',
        path: '/documents',
        icon: <FileText size={16} />,
      },
      {
        label: 'AI Assistant',
        path: '/chat',
        icon: <MessageSquare size={16} />,
        isAI: true,
      },
      {
        label: 'Text-to-SQL Agent',
        path: '/agents',
        icon: <Bot size={16} />,
      },
    ],
  },
  {
    title: 'User Management',
    items: [
      {
        label: 'Users',
        path: '/users',
        icon: <Users size={16} />,
        requiredRole: ['tenant_admin', 'super_admin'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Admin Panel',
        path: '/admin',
        icon: <Shield size={16} />,
        requiredRole: ['super_admin'],
      },
    ],
  },
]

interface LayoutProps {
  children: React.ReactNode
  user: UserType | null
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function getBreadcrumb(pathname: string): string {
  const map: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/documents': 'Documents',
    '/chat': 'AI Assistant',
    '/agents': 'Text-to-SQL Agent',
    '/users': 'Users',
    '/admin': 'Admin Panel',
    '/profile': 'My Profile',
  }
  return map[pathname] ?? 'Dashboard'
}

export function Layout({ children, user }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const orgMenuRef = useRef<HTMLDivElement>(null)

  const breadcrumb = getBreadcrumb(location.pathname)

  useEffect(() => {
    api.get<Organization[]>('/orgs').then(({ data }) => {
      if (data) setOrganizations(data)
    })
  }, [])

  // Close org menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const switchOrg = async (orgId: string) => {
    await api.post('/orgs/switch', { org_id: orgId })
    window.location.reload()
  }

  const handleLogout = () => {
    clearTokens()
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  const filteredSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!item.requiredRole) return true
      return user && item.requiredRole.includes(user.role)
    }),
  })).filter((s) => s.items.length > 0)

  const SidebarContent = () => (
    <div
      style={{
        width: 240,
        height: '100%',
        backgroundColor: '#fafafa',
        borderRight: '1px solid #e5e5e5',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid #e5e5e5',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              backgroundColor: '#1a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" />
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6" />
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6" />
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" />
            </svg>
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1a1a1a',
              letterSpacing: '-0.2px',
            }}
          >
            AI SaaS
          </span>
        </div>
      </div>

      {/* Nav sections */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {filteredSections.map((section) => (
          <div key={section.title} style={{ marginBottom: 4 }}>
            <div
              style={{
                padding: '6px 20px 4px',
                fontSize: 10,
                fontWeight: 600,
                color: '#aaa',
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
              }}
            >
              {section.title}
            </div>
            {section.items.map((item) => {
              const active = isActive(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 20px',
                    margin: '1px 10px',
                    borderRadius: 7,
                    fontSize: 13.5,
                    fontWeight: active ? 500 : 400,
                    color: active ? '#1a1a1a' : '#555',
                    backgroundColor: active ? '#efefef' : 'transparent',
                    textDecoration: 'none',
                    transition: 'all 0.12s ease',
                    borderLeft: active ? '2px solid #1a1a1a' : '2px solid transparent',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#f5f5f5'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  {item.isAI ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </span>
                  ) : (
                    <span
                      style={{
                        color: active ? '#1a1a1a' : '#888',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                  {item.isAI && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                        color: 'white',
                        letterSpacing: '0.3px',
                      }}
                    >
                      AI
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid #e5e5e5',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Avatar */}
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              backgroundColor: '#1a1a1a',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
              cursor: 'pointer',
            }}
            onClick={() => navigate('/profile')}
          >
            {user ? getInitials(user.name) : '??'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: '#1a1a1a',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
              onClick={() => navigate('/profile')}
            >
              {user?.name ?? 'Loading...'}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#999',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.role ?? ''}
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              padding: 6,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'transparent',
              color: '#aaa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.12s ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = '#1a1a1a'
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f0f0f0'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.color = '#aaa'
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: '#ffffff',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Desktop sidebar */}
      <div
        className="hidden md:flex"
        style={{ flexShrink: 0 }}
      >
        <SidebarContent />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
          <div style={{ position: 'relative', zIndex: 50 }}>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <header
          style={{
            height: 60,
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e5e5e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Hamburger for mobile */}
            <button
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
              style={{
                padding: 6,
                borderRadius: 6,
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: '#555',
              }}
            >
              <Menu size={18} />
            </button>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#bbb' }}>Home</span>
              <span style={{ fontSize: 12, color: '#bbb' }}>/</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
                {breadcrumb}
              </span>
            </div>
          </div>

          {/* Org switcher */}
          <div style={{ position: 'relative' }} ref={orgMenuRef}>
            <button
              onClick={() => setOrgMenuOpen((o) => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 7,
                border: '1px solid #e5e5e5',
                backgroundColor: 'white',
                cursor: 'pointer',
                fontSize: 13,
                color: '#1a1a1a',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <Building2 size={14} style={{ color: '#888' }} />
              <span>{user?.org_id ? (organizations.find(o => o.id === user.org_id)?.name ?? 'Organization') : 'Organization'}</span>
              <ChevronDown size={12} style={{ color: '#aaa' }} />
            </button>

            {orgMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 4,
                  width: 200,
                  backgroundColor: 'white',
                  border: '1px solid #ebebeb',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                  zIndex: 100,
                  overflow: 'hidden',
                }}
              >
                {organizations.length === 0 ? (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: '#999' }}>
                    No organizations
                  </div>
                ) : (
                  organizations.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => {
                        switchOrg(org.id)
                        setOrgMenuOpen(false)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '8px 14px',
                        border: 'none',
                        backgroundColor: org.id === user?.org_id ? '#f5f5f5' : 'transparent',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#1a1a1a',
                        textAlign: 'left',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      <Building2 size={13} style={{ color: '#888' }} />
                      {org.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            backgroundColor: '#ffffff',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
