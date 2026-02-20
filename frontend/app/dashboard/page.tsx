'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Org { id: string; name: string; slug: string; role: string; }
interface User { id: string; email: string; full_name?: string; }

const DOT_COLORS = ['#1a1a1a', '#2563eb', '#7c3aed', '#0891b2', '#059669'];

function initials(name?: string, email?: string) {
  if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  return (email ?? 'U').slice(0, 2).toUpperCase();
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser]   = useState<User | null>(null);
  const [orgs, setOrgs]   = useState<Org[]>([]);
  const [cur, setCur]     = useState<Org | null>(null);
  const [loading, setLoading]   = useState(true);
  const [open, setOpen]         = useState(false);
  const [switching, setSwitching] = useState(false);
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
        const [uRes, oRes] = await Promise.all([
          fetch('http://localhost:4000/api/auth/me',      { headers: { Authorization: `Bearer ${token}` } }),
          fetch('http://localhost:4000/api/organizations', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const uData = await uRes.json();
        const oData = await oRes.json();
        if (!uData.success) throw new Error('Unauthorized');
        setUser(uData.data);
        if (oData.success && oData.data.length > 0) { setOrgs(oData.data); setCur(oData.data[0]); }
      } catch { router.push('/auth/signin'); }
      finally  { setLoading(false); }
    })();
  }, [router]);

  const switchOrg = async (org: Org) => {
    if (org.id === cur?.id) { setOpen(false); return; }
    setSwitching(true);
    const token = localStorage.getItem('accessToken');
    try {
      const res  = await fetch('http://localhost:4000/api/organizations/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ organizationId: org.id }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('accessToken',  data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        setCur({ ...org, role: data.data.organization.role });
      }
    } finally { setSwitching(false); setOpen(false); }
  };

  const signOut = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    router.push('/auth/signin');
  };

  const curIdx = orgs.findIndex(o => o.id === cur?.id);

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
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; background: #faf9f7; }

        /* Layout */
        .layout { display: flex; height: 100vh; overflow: hidden; }

        /* Sidebar */
        .side {
          width: 210px; flex-shrink: 0; background: white;
          border-right: 1px solid #ebebeb;
          display: flex; flex-direction: column;
          overflow-y: auto;
        }
        .side-top { padding: 16px 14px 12px; border-bottom: 1px solid #ebebeb; }
        .side-app  { font-size: 13.5px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.2px; }
        .side-sub  { font-size: 11px; color: #9a9a9a; margin-top: 1px; }

        .sec-lbl { font-size: 10.5px; font-weight: 600; color: #ccc; text-transform: uppercase; letter-spacing: 0.7px; padding: 14px 14px 5px; }

        .nav-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px; font-size: 13.5px; font-weight: 400; color: #666;
          cursor: pointer; border-left: 2px solid transparent; white-space: nowrap;
          transition: all .1s; text-decoration: none;
        }
        .nav-item:hover { background: #f5f4f1; color: #1a1a1a; }
        .nav-item.on    { color: #1a1a1a; font-weight: 500; background: #f5f4f1; border-left-color: #1a1a1a; }
        .nav-item svg   { width: 14px; height: 14px; flex-shrink: 0; opacity: .45; }
        .nav-item.on svg { opacity: 1; }

        .sub-item { display: flex; align-items: center; padding: 6px 14px 6px 32px; font-size: 13px; color: #888; cursor: pointer; transition: all .1s; }
        .sub-item:hover { color: #1a1a1a; }

        .side-foot { margin-top: auto; border-top: 1px solid #ebebeb; padding: 12px 14px; }
        .user-row  { display: flex; align-items: center; gap: 8px; }
        .avatar    { width: 28px; height: 28px; border-radius: 50%; background: #1a1a1a; color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
        .uname     { font-size: 13px; font-weight: 500; color: #1a1a1a; }
        .uemail    { font-size: 11px; color: #9a9a9a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
        .signout-btn { margin-left: auto; background: none; border: none; cursor: pointer; color: #ccc; display: flex; padding: 4px; transition: color .12s; }
        .signout-btn:hover { color: #ef4444; }
        .signout-btn svg { width: 14px; height: 14px; }

        /* Main */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        /* Topbar */
        .topbar {
          height: 50px; background: white; border-bottom: 1px solid #ebebeb;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 20px; flex-shrink: 0;
        }
        .breadcrumb      { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #9a9a9a; }
        .breadcrumb-cur  { color: #1a1a1a; font-weight: 500; }
        .breadcrumb svg  { width: 12px; height: 12px; }
        .topbar-right    { display: flex; align-items: center; gap: 8px; }

        /* Tenant Switcher */
        .ts-wrap { position: relative; }
        .ts-btn {
          display: flex; align-items: center; gap: 7px; padding: 5px 9px 5px 7px;
          background: #f5f4f1; border: 1px solid #ebebeb; border-radius: 8px;
          cursor: pointer; font-family: 'DM Sans', sans-serif;
          font-size: 12.5px; font-weight: 500; color: #1a1a1a;
          transition: all .12s; min-width: 150px;
        }
        .ts-btn:hover   { border-color: #c8c8c8; }
        .ts-btn.open    { background: white; border-color: #c8c8c8; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
        .ts-dot         { width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: white; flex-shrink: 0; }
        .ts-info        { flex: 1; text-align: left; line-height: 1.2; }
        .ts-name        { font-size: 12.5px; font-weight: 500; color: #1a1a1a; }
        .ts-role        { font-size: 10px; color: #9a9a9a; }
        .ts-arrow       { color: #bbb; display: flex; transition: transform .18s; }
        .ts-arrow.open  { transform: rotate(180deg); }
        .ts-arrow svg   { width: 12px; height: 12px; }

        .ts-drop {
          position: absolute; top: calc(100% + 7px); right: 0; width: 210px;
          background: white; border: 1px solid #ebebeb; border-radius: 10px;
          box-shadow: 0 6px 24px rgba(0,0,0,.08); overflow: hidden; z-index: 500;
          animation: dropIn .14s ease;
        }
        @keyframes dropIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

        .drop-lbl  { padding: 10px 13px 7px; font-size: 10.5px; font-weight: 600; color: #ccc; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #ebebeb; }
        .drop-item { display: flex; align-items: center; gap: 9px; padding: 9px 13px; cursor: pointer; transition: background .1s; }
        .drop-item:hover { background: #f5f4f1; }
        .drop-item.cur   { background: #f5f4f1; }
        .drop-dot  { width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; flex-shrink: 0; }
        .drop-name { font-size: 13px; font-weight: 500; color: #1a1a1a; }
        .drop-role { font-size: 11px; color: #9a9a9a; }
        .drop-chk  { margin-left: auto; color: #1a1a1a; }
        .drop-chk svg { width: 13px; height: 13px; }
        .drop-div  { height: 1px; background: #ebebeb; }
        .drop-foot { padding: 7px 13px; }
        .drop-new  { display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 0; background: none; border: none; font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: #9a9a9a; cursor: pointer; transition: color .1s; }
        .drop-new:hover { color: #1a1a1a; }
        .drop-new svg { width: 13px; height: 13px; }

        /* Switching overlay */
        .overlay { position: fixed; inset: 0; background: rgba(255,255,255,.7); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 999; }
        .overlay-card { background: white; border: 1px solid #ebebeb; border-radius: 10px; padding: 18px 24px; display: flex; align-items: center; gap: 12px; font-size: 13.5px; font-weight: 500; color: #1a1a1a; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
        .mini-spin { width: 16px; height: 16px; border: 2px solid #eee; border-top-color: #1a1a1a; border-radius: 50%; animation: spin .65s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Content */
        .content { flex: 1; overflow-y: auto; padding: 24px 20px; }
        .pg-title { font-size: 18px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 3px; }
        .pg-sub   { font-size: 13px; color: #9a9a9a; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 20px; }

        .chip       { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 5px; font-size: 11px; font-weight: 500; }
        .chip-green { background: #f0fdf4; color: #16a34a; }
        .chip-slate { background: #f8fafc; color: #64748b; }

        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
        .stat-card { background: white; border: 1px solid #ebebeb; border-radius: 10px; padding: 16px 18px; }
        .stat-lbl  { font-size: 11px; font-weight: 600; color: #bbb; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .stat-val  { font-size: 26px; font-weight: 700; color: #1a1a1a; letter-spacing: -1px; line-height: 1; }
        .stat-note { font-size: 11px; color: #16a34a; margin-top: 4px; }

        .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .card  { background: white; border: 1px solid #ebebeb; border-radius: 10px; padding: 18px; transition: all .13s; cursor: pointer; }
        .card:hover { border-color: #d8d8d8; box-shadow: 0 4px 16px rgba(0,0,0,.05); transform: translateY(-1px); }
        .card-em    { font-size: 18px; margin-bottom: 10px; }
        .card-title { font-size: 13.5px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
        .card-desc  { font-size: 12px; color: #9a9a9a; line-height: 1.5; }

        /* Floating Action Buttons */
        .fab-container {
          position: fixed;
          bottom: 28px;
          right: 28px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 100;
        }
        .fab {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: white;
          border: 1px solid #ebebeb;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(0,0,0,.08);
          animation: fadeIn 0.5s ease both;
        }
        .fab:nth-child(1) { animation-delay: 0.1s; }
        .fab:nth-child(2) { animation-delay: 0.2s; }
        .fab:hover {
          transform: translateY(-4px) scale(1.05);
          box-shadow: 0 12px 24px rgba(0,0,0,.12);
          border-color: #1a1a1a;
        }
        .fab:active {
          transform: translateY(-2px) scale(1.02);
        }
        .fab svg {
          width: 24px;
          height: 24px;
          color: #1a1a1a;
          transition: all 0.2s;
        }
        .fab:hover svg {
          transform: scale(1.1);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px) scale(0.8); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Responsive */
        @media (max-width: 768px) {
          .side { display: none; }
          .stats { grid-template-columns: 1fr 1fr; }
          .cards { grid-template-columns: 1fr 1fr; }
          .fab-container { bottom: 20px; right: 20px; }
          .fab { width: 52px; height: 52px; }
          .fab svg { width: 22px; height: 22px; }
        }
        @media (max-width: 480px) {
          .stats { grid-template-columns: 1fr; }
          .cards { grid-template-columns: 1fr; }
          .ts-btn { min-width: 120px; }
          .breadcrumb span:first-child, .breadcrumb svg:first-of-type { display: none; }
          .fab-container { bottom: 16px; right: 16px; }
          .fab { width: 48px; height: 48px; }
        }
      `}</style>

      {switching && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="mini-spin" />
            Switching organization…
          </div>
        </div>
      )}

      <div className="layout">
        {/* Sidebar */}
        <aside className="side">
          <div className="side-top">
            <div className="side-app">Platform</div>
            <div className="side-sub">Multi-tenant SaaS</div>
          </div>

          <div className="sec-lbl">Platform</div>
          <a className="nav-item on">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Playground
          </a>
          <div className="sub-item">History</div>
          <div className="sub-item">Starred</div>
          <div className="sub-item">Settings</div>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 1 3 3v1a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10a7 7 0 0 0-14 0"/></svg>
            Models
          </a>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Documentation
          </a>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 0-14.14 0M4.93 19.07a10 10 0 0 0 14.14 0"/></svg>
            Settings
          </a>

          <div className="sec-lbl">Projects</div>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            AI Agents
          </a>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Members
          </a>
          <a className="nav-item">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Analytics
          </a>

          <div className="side-foot">
            <div className="user-row">
              <div className="avatar">{initials(user?.full_name, user?.email)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="uname">{user?.full_name || 'User'}</div>
                <div className="uemail">{user?.email}</div>
              </div>
              <button className="signout-btn" onClick={signOut} title="Sign out">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="main">
          {/* Topbar */}
          <nav className="topbar">
            <div className="breadcrumb">
              <span>Dashboard</span>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              <span className="breadcrumb-cur">Overview</span>
            </div>

            <div className="topbar-right">
              {/* Tenant Switcher */}
              <div className="ts-wrap" ref={dropRef}>
                <button className={`ts-btn${open ? ' open' : ''}`} onClick={() => setOpen(!open)}>
                  <div className="ts-dot" style={{ background: DOT_COLORS[curIdx % DOT_COLORS.length] }}>
                    {cur?.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'ORG'}
                  </div>
                  <div className="ts-info">
                    <div className="ts-name">{cur?.name || 'Select org'}</div>
                    <div className="ts-role">{cur?.role || '—'}</div>
                  </div>
                  <div className={`ts-arrow${open ? ' open' : ''}`}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </button>

                {open && (
                  <div className="ts-drop">
                    <div className="drop-lbl">Organizations</div>
                    {orgs.map((org, idx) => (
                      <div key={org.id} className={`drop-item${org.id === cur?.id ? ' cur' : ''}`} onClick={() => switchOrg(org)}>
                        <div className="drop-dot" style={{ background: DOT_COLORS[idx % DOT_COLORS.length] }}>
                          {org.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <div className="drop-name">{org.name}</div>
                          <div className="drop-role">{org.role}</div>
                        </div>
                        {org.id === cur?.id && (
                          <div className="drop-chk">
                            <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="drop-div" />
                    <div className="drop-foot">
                      <button className="drop-new">
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New organization
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* User avatar */}
              <div className="avatar" style={{ border: '1.5px solid #ebebeb', cursor: 'pointer' }}>
                {initials(user?.full_name, user?.email)}
              </div>
            </div>
          </nav>

          {/* Content */}
          <div className="content">
            <div>
              <h1 className="pg-title">Good morning, {user?.full_name?.split(' ')[0] || 'there'} 👋</h1>
              <p className="pg-sub">
                Viewing <strong>{cur?.name}</strong> as
                <span className={`chip ${cur?.role === 'admin' ? 'chip-green' : 'chip-slate'}`}>{cur?.role}</span>
              </p>
            </div>

            <div className="stats">
              <div className="stat-card">
                <div className="stat-lbl">Active Agents</div>
                <div className="stat-val">3</div>
                <div className="stat-note">All operational</div>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Tasks Today</div>
                <div className="stat-val">24</div>
                <div className="stat-note">↑ 12% from yesterday</div>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Organizations</div>
                <div className="stat-val">{orgs.length}</div>
                <div className="stat-note">Active memberships</div>
              </div>
            </div>

            <div className="cards">
              <div className="card">
                <div className="card-em">🤖</div>
                <div className="card-title">Counselor Agent</div>
                <div className="card-desc">AI-powered counseling with LangGraph orchestration</div>
              </div>
              <div className="card">
                <div className="card-em">📋</div>
                <div className="card-title">Enrollment Agent</div>
                <div className="card-desc">Automate enrollment via CrewAI multi-agent system</div>
              </div>
              <div className="card">
                <div className="card-em">💬</div>
                <div className="card-title">Support Agent</div>
                <div className="card-desc">24/7 intelligent support via Amazon Strands</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fab-container">
        {/* Chat Icon */}
        <button className="fab" title="AI Chat Assistant" onClick={() => alert('Chat feature coming soon!')}>
          <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        {/* Voice Recorder Icon */}
        <button className="fab" title="Voice Input" onClick={() => alert('Voice input feature coming soon!')}>
          <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      </div>
    </>
  );
}