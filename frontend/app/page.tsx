'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
          font-family: 'Inter', sans-serif;
          background: #0a0a0f;
          color: #ffffff;
          overflow-x: hidden;
        }

        /* Navigation */
        .nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          transition: all 0.3s ease;
        }
        .nav.scrolled {
          background: rgba(10, 10, 15, 0.95);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .nav-inner {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .logo {
          font-size: 24px;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: -0.5px;
        }
        .nav-links {
          display: flex;
          gap: 32px;
          align-items: center;
        }
        .nav-link {
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: color 0.2s;
        }
        .nav-link:hover { color: #ffffff; }
        .nav-btns {
          display: flex;
          gap: 12px;
        }
        .btn {
          padding: 10px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          text-decoration: none;
          display: inline-block;
        }
        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #ffffff;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
          background: transparent;
          border: 1.5px solid rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.4);
        }

        /* Hero Section */
        .hero {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          overflow: hidden;
          padding: 120px 40px 80px;
        }
        .hero-bg {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(102, 126, 234, 0.15) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-glow {
          position: absolute;
          top: -200px;
          left: 50%;
          transform: translateX(-50%);
          width: 800px;
          height: 800px;
          background: radial-gradient(circle, rgba(102, 126, 234, 0.3) 0%, transparent 70%);
          filter: blur(80px);
          pointer-events: none;
        }
        .hero-content {
          position: relative;
          z-index: 1;
          max-width: 900px;
          animation: fadeUp 0.8s ease both;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .hero-badge {
          display: inline-block;
          padding: 8px 20px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 50px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 24px;
        }
        .hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin-bottom: 24px;
          background: linear-gradient(135deg, #ffffff 0%, rgba(255, 255, 255, 0.7) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .hero-subtitle {
          font-size: 20px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
          margin-bottom: 40px;
          max-width: 700px;
          margin-left: auto;
          margin-right: auto;
        }
        .hero-cta {
          display: flex;
          gap: 16px;
          justify-content: center;
          flex-wrap: wrap;
        }

        /* Features Section */
        .section {
          padding: 100px 40px;
          position: relative;
        }
        .section-header {
          text-align: center;
          margin-bottom: 64px;
          animation: fadeUp 0.8s ease both;
        }
        .section-tag {
          font-size: 14px;
          font-weight: 600;
          color: #667eea;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 16px;
        }
        .section-title {
          font-size: 48px;
          font-weight: 700;
          letter-spacing: -1.5px;
          margin-bottom: 16px;
        }
        .section-desc {
          font-size: 18px;
          color: rgba(255, 255, 255, 0.6);
          max-width: 600px;
          margin: 0 auto;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .features-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 32px;
        }
        .feature-card {
          padding: 32px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          transition: all 0.3s ease;
          animation: fadeUp 0.8s ease both;
        }
        .feature-card:nth-child(1) { animation-delay: 0.1s; }
        .feature-card:nth-child(2) { animation-delay: 0.2s; }
        .feature-card:nth-child(3) { animation-delay: 0.3s; }
        .feature-card:nth-child(4) { animation-delay: 0.4s; }
        .feature-card:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(102, 126, 234, 0.3);
          transform: translateY(-4px);
        }
        .feature-icon {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          margin-bottom: 20px;
        }
        .feature-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .feature-desc {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        /* Solutions Grid */
        .solutions-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        .solution-card {
          padding: 40px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          transition: all 0.3s ease;
          animation: fadeUp 0.8s ease both;
        }
        .solution-card:nth-child(1) { animation-delay: 0.1s; }
        .solution-card:nth-child(2) { animation-delay: 0.2s; }
        .solution-card:nth-child(3) { animation-delay: 0.3s; }
        .solution-card:nth-child(4) { animation-delay: 0.4s; }
        .solution-card:nth-child(5) { animation-delay: 0.5s; }
        .solution-card:nth-child(6) { animation-delay: 0.6s; }
        .solution-card:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(102, 126, 234, 0.3);
          transform: translateY(-6px);
        }
        .solution-icon {
          font-size: 40px;
          margin-bottom: 24px;
        }
        .solution-title {
          font-size: 22px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .solution-desc {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        /* Process Flow */
        .process-flow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          max-width: 1000px;
          margin: 0 auto;
        }
        .process-step {
          flex: 1;
          text-align: center;
          animation: fadeUp 0.8s ease both;
        }
        .process-step:nth-child(1) { animation-delay: 0.1s; }
        .process-step:nth-child(2) { animation-delay: 0.3s; }
        .process-step:nth-child(3) { animation-delay: 0.5s; }
        .process-step:nth-child(4) { animation-delay: 0.7s; }
        .process-icon {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
          border: 2px solid rgba(102, 126, 234, 0.3);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          margin: 0 auto 20px;
        }
        .process-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .process-desc {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
        }
        .process-arrow {
          font-size: 24px;
          color: rgba(255, 255, 255, 0.3);
          margin: 0 20px;
        }

        /* CTA Section */
        .cta-section {
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
          border: 1px solid rgba(102, 126, 234, 0.2);
          border-radius: 24px;
          padding: 80px 60px;
          text-align: center;
          margin: 0 auto;
          max-width: 1000px;
        }
        .cta-title {
          font-size: 40px;
          font-weight: 700;
          margin-bottom: 20px;
          letter-spacing: -1px;
        }
        .cta-desc {
          font-size: 18px;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 40px;
        }

        /* Footer */
        .footer {
          padding: 80px 40px 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 60px;
          margin-bottom: 40px;
        }
        .footer-brand {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .footer-desc {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }
        .footer-col-title {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 16px;
          color: rgba(255, 255, 255, 0.9);
        }
        .footer-links {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .footer-link {
          color: rgba(255, 255, 255, 0.6);
          text-decoration: none;
          font-size: 14px;
          transition: color 0.2s;
        }
        .footer-link:hover { color: #ffffff; }
        .footer-bottom {
          max-width: 1200px;
          margin: 0 auto;
          padding-top: 32px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-copy {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.5);
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .features-grid { grid-template-columns: repeat(2, 1fr); }
          .solutions-grid { grid-template-columns: repeat(2, 1fr); }
          .footer-content { grid-template-columns: 1fr 1fr; gap: 40px; }
        }
        @media (max-width: 768px) {
          .nav-links { display: none; }
          .hero-title { font-size: 40px; }
          .hero-subtitle { font-size: 16px; }
          .features-grid { grid-template-columns: 1fr; }
          .solutions-grid { grid-template-columns: 1fr; }
          .process-flow { flex-direction: column; }
          .process-arrow { transform: rotate(90deg); margin: 20px 0; }
          .section-title { font-size: 32px; }
          .footer-content { grid-template-columns: 1fr; gap: 32px; }
        }
      `}</style>

      {/* Navigation */}
      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-inner">
          <div className="logo">MultiTenant SaaS</div>
          <div className="nav-links">
            <a href="#features" className="nav-link">Features</a>
            <a href="#solutions" className="nav-link">Solutions</a>
            <a href="#how-it-works" className="nav-link">How It Works</a>
          </div>
          <div className="nav-btns">
            <button className="btn btn-secondary" onClick={() => router.push('/auth/signin')}>
              Sign In
            </button>
            <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
              Sign Up
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-bg"></div>
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className="hero-badge">
            Trusted by security-first teams | SOC2-ready | On-prem & cloud
          </div>
          <h1 className="hero-title">
            Agentic AI Workflows for Enterprise No Code, Fully Governed
          </h1>
          <p className="hero-subtitle">
            Build secure, auditable AI workflows for counseling, enrollment, and support with drag-and-drop simplicity, full governance, and flexible deployment.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
              Get Started Free
            </button>
            <button className="btn btn-secondary" onClick={() => router.push('/auth/signin')}>
              View Demo
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section" id="features">
        <div className="container">
          <div className="section-header">
            <div className="section-tag">Why Choose Us</div>
            <h2 className="section-title">Built for Enterprise Scale</h2>
          </div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🎨</div>
              <h3 className="feature-title">No-code builder</h3>
              <p className="feature-desc">Build workflows with drag & drop; templates included.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <h3 className="feature-title">Human-in-the-loop</h3>
              <p className="feature-desc">Approvals, audit trails & role-based reviews.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🚀</div>
              <h3 className="feature-title">Deploy fast, scale safely</h3>
              <p className="feature-desc">Sandbox → Pilot → Enterprise rollout.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3 className="feature-title">Enterprise-grade security</h3>
              <p className="feature-desc">On-prem, encryption, RBAC, and compliance-ready.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Solutions Section */}
      <section className="section" id="solutions">
        <div className="container">
          <div className="section-header">
            <div className="section-tag">Explore Solutions</div>
            <h2 className="section-title">AI Workflows for Every Function</h2>
            <p className="section-desc">
              Pre-built templates and customizable flows for the processes that matter most.
            </p>
          </div>
          <div className="solutions-grid">
            <div className="solution-card">
              <div className="solution-icon">🤖</div>
              <h3 className="solution-title">Counselor Agent</h3>
              <p className="solution-desc">
                AI-powered counseling workflows with LangGraph orchestration for personalized guidance and support.
              </p>
            </div>
            <div className="solution-card">
              <div className="solution-icon">📋</div>
              <h3 className="solution-title">Enrollment Agent</h3>
              <p className="solution-desc">
                Automate enrollment processes using CrewAI multi-agent system for seamless onboarding.
              </p>
            </div>
            <div className="solution-card">
              <div className="solution-icon">💬</div>
              <h3 className="solution-title">Support Agent</h3>
              <p className="solution-desc">
                24/7 intelligent support powered by Amazon Strands for instant resolution.
              </p>
            </div>
            <div className="solution-card">
              <div className="solution-icon">📊</div>
              <h3 className="solution-title">Analytics Dashboard</h3>
              <p className="solution-desc">
                Track performance, measure ROI, and optimize workflows with real-time insights.
              </p>
            </div>
            <div className="solution-card">
              <div className="solution-icon">🔐</div>
              <h3 className="solution-title">Access Control</h3>
              <p className="solution-desc">
                Role-based permissions and multi-tenant isolation for complete data security.
              </p>
            </div>
            <div className="solution-card">
              <div className="solution-icon">⚡</div>
              <h3 className="solution-title">Real-Time Processing</h3>
              <p className="solution-desc">
                WebSocket-powered updates and asynchronous task processing at scale.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="section" id="how-it-works">
        <div className="container">
          <div className="section-header">
            <div className="section-tag">Platform Overview</div>
            <h2 className="section-title">How It Works</h2>
            <p className="section-desc">
              Connect your data, deploy AI agents, approve decisions, and track results in one governed workflow.
            </p>
          </div>
          <div className="process-flow">
            <div className="process-step">
              <div className="process-icon">📥</div>
              <h4 className="process-title">Ingest</h4>
              <p className="process-desc">Connect docs, emails, databases.</p>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="process-icon">🤖</div>
              <h4 className="process-title">Agent</h4>
              <p className="process-desc">No-code agents run RAG-enabled reasoning.</p>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="process-icon">✅</div>
              <h4 className="process-title">Approve</h4>
              <p className="process-desc">Human-in-loop workflows ensure governance.</p>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="process-icon">📊</div>
              <h4 className="process-title">Act & Audit</h4>
              <p className="process-desc">Execute tasks, log everything, measure ROI.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section">
        <div className="container">
          <div className="cta-section">
            <h2 className="cta-title">Ready to build agentic workflows?</h2>
            <p className="cta-desc">
              Join enterprise teams achieving real outcomes with governed AI workflows.
            </p>
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => router.push('/auth/signup')}>
                Get Started Free
              </button>
              <button className="btn btn-secondary" onClick={() => router.push('/auth/signin')}>
                Sign In
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div>
            <div className="footer-brand">MultiTenant SaaS</div>
            <p className="footer-desc">
              Enterprise AI platform with intelligent agent orchestration for counseling, enrollment, and support workflows.
            </p>
          </div>
          <div>
            <h4 className="footer-col-title">Solutions</h4>
            <div className="footer-links">
              <a href="#" className="footer-link">Counselor Agent</a>
              <a href="#" className="footer-link">Enrollment Agent</a>
              <a href="#" className="footer-link">Support Agent</a>
            </div>
          </div>
          <div>
            <h4 className="footer-col-title">Company</h4>
            <div className="footer-links">
              <a href="#" className="footer-link">About Us</a>
              <a href="#" className="footer-link">Resources</a>
              <a href="#" className="footer-link">Contact</a>
            </div>
          </div>
          <div>
            <h4 className="footer-col-title">Legal</h4>
            <div className="footer-links">
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Terms of Service</a>
              <a href="#" className="footer-link">Security</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p className="footer-copy">© 2026 MultiTenant SaaS. All rights reserved.</p>
        </div>
      </footer>
    </>
  );
}