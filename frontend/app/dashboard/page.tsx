'use client';

import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';

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
          color: #666;
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
    </Layout>
  );
}