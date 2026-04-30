'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import './home.css';

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
            <button className="btn btn-primary" onClick={() => router.push('/auth/signin')}>
              Sign In
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
            <button className="btn btn-primary" onClick={() => router.push('/auth/signin')}>
              Sign In
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
              <button className="btn btn-primary" onClick={() => router.push('/auth/signin')}>
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