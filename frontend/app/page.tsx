'use client';

import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }

        .page {
          min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #faf9f7;
          padding: 40px 20px;
        }

        .hero {
          text-align: center;
          max-width: 580px;
          animation: up .4s ease both;
        }
        @keyframes up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .hero h1 {
          font-size: 38px; font-weight: 600; color: #1a1a1a;
          letter-spacing: -0.8px; margin-bottom: 12px; line-height: 1.2;
        }
        .hero p {
          font-size: 16px; color: #9a9a9a; line-height: 1.6;
          margin-bottom: 32px;
        }

        .btns {
          display: flex; align-items: center;
          justify-content: center; gap: 10px;
        }

        .btn {
          padding: 11px 24px;
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px; font-weight: 500;
          cursor: pointer; transition: all .13s;
          text-decoration: none; display: inline-block;
        }

        .btn-primary {
          background: #1a1a1a; color: white; border: none;
        }
        .btn-primary:hover {
          background: #333;
          box-shadow: 0 4px 14px rgba(0,0,0,.14);
        }

        .btn-secondary {
          background: white; color: #1a1a1a;
          border: 1px solid #ebebeb;
        }
        .btn-secondary:hover {
          border-color: #c8c8c8;
          box-shadow: 0 2px 8px rgba(0,0,0,.06);
        }

        .features {
          margin-top: 64px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          max-width: 900px;
        }

        .feat {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 10px;
          padding: 24px;
          text-align: left;
          animation: up .4s ease both;
        }
        .feat:nth-child(1) { animation-delay: .05s; }
        .feat:nth-child(2) { animation-delay: .1s; }
        .feat:nth-child(3) { animation-delay: .15s; }

        .feat-icon {
          font-size: 24px;
          margin-bottom: 12px;
        }
        .feat-title {
          font-size: 15px; font-weight: 600;
          color: #1a1a1a; margin-bottom: 6px;
          letter-spacing: -0.2px;
        }
        .feat-desc {
          font-size: 13px; color: #9a9a9a;
          line-height: 1.5;
        }

        @media (max-width: 768px) {
          .hero h1 { font-size: 32px; }
          .hero p { font-size: 15px; }
          .features { grid-template-columns: 1fr; max-width: 400px; }
        }

        @media (max-width: 480px) {
          .hero h1 { font-size: 28px; }
          .btns { flex-direction: column; width: 100%; max-width: 280px; }
          .btn { width: 100%; }
        }
      `}</style>

      <div className="page">
        <div className="hero">
          <h1>MultiTenant SaaS Platform</h1>
          <p>
            AI-powered platform with intelligent agent orchestration.
            Streamline counseling, enrollment, and support workflows.
          </p>

          <div className="btns">
            <button className="btn btn-primary" onClick={() => router.push('/auth/signin')}>
              Sign In
            </button>
            <button className="btn btn-secondary" onClick={() => router.push('/auth/signup')}>
              Sign Up
            </button>
          </div>
        </div>

        <div className="features">
          <div className="feat">
            <div className="feat-icon">🤖</div>
            <div className="feat-title">AI Agents</div>
            <div className="feat-desc">
              Counselor, Enrollment, and Support agents powered by LangGraph, CrewAI, and Strands
            </div>
          </div>

          <div className="feat">
            <div className="feat-icon">🏢</div>
            <div className="feat-title">Multi-Tenant</div>
            <div className="feat-desc">
              Complete data isolation with row-level security and RBAC for organizations
            </div>
          </div>

          <div className="feat">
            <div className="feat-icon">⚡</div>
            <div className="feat-title">Real-Time</div>
            <div className="feat-desc">
              WebSocket-powered updates and asynchronous task processing at scale
            </div>
          </div>
        </div>
      </div>
    </>
  );
}