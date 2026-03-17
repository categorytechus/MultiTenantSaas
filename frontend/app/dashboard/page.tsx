'use client';

import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import ChatInterface from '../../components/ChatInterface';

interface Org { id: string; name: string; slug: string; role: string; }
interface User { id: string; email: string; full_name?: string; }

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [cur, setCur] = useState<Org | null>(null);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      try {
        const [uRes, oRes] = await Promise.all([
          fetch('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('http://localhost:4000/api/organizations', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const uData = await uRes.json();
        const oData = await oRes.json();
        if (uData.success) setUser(uData.data);
        if (oData.success && oData.data.length > 0) { setOrgs(oData.data); setCur(oData.data[0]); }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    })();
  }, []);

  return (
    <Layout>
      <style>{`
        .content {
          padding: 32px;
        }
        .pg-title {
          font-size: 24px;
          font-weight: 700;
          color: #1a1a1a;
          letter-spacing: -0.5px;
          margin-bottom: 4px;
        }
        .pg-sub {
          font-size: 14px;
          color: #9a9a9a;
          margin-bottom: 32px;
        }
        .chip {
          display: inline-flex;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          margin-left: 4px;
        }
        .chip-green {
          background: #f0fdf4;
          color: #16a34a;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .stat-card {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          padding: 20px;
        }
        .stat-lbl {
          font-size: 11px;
          font-weight: 600;
          color: #bbb;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .stat-val {
          font-size: 32px;
          font-weight: 700;
          color: #1a1a1a;
          letter-spacing: -1px;
          line-height: 1;
        }
        .stat-note {
          font-size: 12px;
          color: #16a34a;
          margin-top: 6px;
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .card {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          padding: 24px;
          transition: all 0.2s;
          cursor: pointer;
        }
        .card:hover {
          border-color: #d8d8d8;
          box-shadow: 0 4px 16px rgba(0,0,0,0.05);
          transform: translateY(-2px);
        }
        .card-em {
          font-size: 24px;
          margin-bottom: 12px;
        }
        .card-title {
          font-size: 16px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 6px;
        }
        .card-desc {
          font-size: 13px;
          color: #9a9a9a;
          line-height: 1.5;
        }

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
        .fab svg {
          width: 24px;
          height: 24px;
          color: #1a1a1a;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px) scale(0.8); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (max-width: 768px) {
          .stats { grid-template-columns: 1fr 1fr; }
          .cards { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="content">
        <div>
          <h1 className="pg-title">Good morning, {user?.full_name?.split(' ')[0] || 'there'} 👋</h1>
          <p className="pg-sub">
            Viewing <strong>{cur?.name}</strong> as
            <span className="chip chip-green">{cur?.role || 'member'}</span>
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

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginTop: '24px' }}>
          <div className="cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
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
            <div className="card" style={{ gridColumn: 'span 2' }}>
              <div className="card-em">💬</div>
              <div className="card-title">Support Agent</div>
              <div className="card-desc">24/7 intelligent support via Amazon Strands</div>
            </div>
          </div>
          
          <div>
            <ChatInterface orgId={cur?.id || ''} />
          </div>
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fab-container">
        <button className="fab" title="AI Chat Assistant" onClick={() => alert('Chat feature coming soon!')}>
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        <button className="fab" title="Voice Input" onClick={() => alert('Voice input feature coming soon!')}>
          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      </div>
    </Layout>
  );
}