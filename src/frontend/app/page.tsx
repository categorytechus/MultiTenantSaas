'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

const FEATURES = [
  { icon: '⚡', title: 'No-Code Builder', desc: 'Drag-and-drop workflow builder with pre-built templates. Deploy in minutes, not months.' },
  { icon: '🔒', title: 'Enterprise Security', desc: 'On-prem or cloud. RBAC, encryption, audit trails, and SOC2-ready compliance.' },
  { icon: '👥', title: 'Human-in-the-Loop', desc: 'Built-in approval flows and role-based review steps for complete governance.' },
  { icon: '📈', title: 'Real-Time Analytics', desc: 'Live dashboards, ROI tracking, and workflow performance metrics at a glance.' },
  { icon: '🤖', title: 'Multi-Agent AI', desc: 'LangGraph, CrewAI, and Amazon Strands agents working together seamlessly.' },
  { icon: '🌐', title: 'Multi-Tenant Isolation', desc: 'Complete data separation per org with row-level security and scoped permissions.' },
];

const STATS = [
  { value: '10×', label: 'Faster deployment' },
  { value: '99.9%', label: 'Uptime SLA' },
  { value: '500+', label: 'Enterprise clients' },
  { value: 'SOC2', label: 'Compliance ready' },
];

const STEPS = [
  { icon: '📥', step: '01', title: 'Ingest', desc: 'Connect docs, emails, and databases in minutes.' },
  { icon: '🤖', step: '02', title: 'Agent', desc: 'AI agents run RAG-enabled reasoning on your data.' },
  { icon: '✅', step: '03', title: 'Approve', desc: 'Human-in-loop workflows enforce governance.' },
  { icon: '📊', step: '04', title: 'Act & Audit', desc: 'Execute, log everything, and measure ROI.' },
];

export default function LandingPage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a] font-sans">

      {/* ── NAV ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${scrolled ? 'bg-white/90 backdrop-blur-md border-b border-[#ebe9e6] shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="text-[17px] font-bold tracking-tight text-[#1a1a1a]">
            <span className="text-indigo-600">▸</span> MultiTenant SaaS
          </div>
          <div className="hidden md:flex items-center gap-8 text-[13.5px] font-medium text-[#555]">
            <a href="#features" className="hover:text-[#1a1a1a] transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-[#1a1a1a] transition-colors">How It Works</a>
            <a href="#solutions" className="hover:text-[#1a1a1a] transition-colors">Solutions</a>
          </div>
          <button
            onClick={() => router.push('/auth/signin')}
            className="bg-[#1a1a1a] text-white text-[13px] font-semibold px-5 py-2 rounded-lg hover:bg-[#333] transition-colors"
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-24 px-6 overflow-hidden bg-gradient-to-br from-[#f5f3ff] via-white to-[#eff6ff]">
        {/* Background decorations */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-br from-indigo-100/60 to-blue-100/40 rounded-full blur-3xl opacity-70" />
          <div className="absolute top-40 left-16 w-64 h-64 bg-violet-200/30 rounded-full blur-2xl" />
          <div className="absolute bottom-0 right-12 w-80 h-80 bg-blue-200/30 rounded-full blur-2xl" />
          {/* Dot grid */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.5" fill="#6366f1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-700 text-[12px] font-semibold px-4 py-1.5 rounded-full mb-8 tracking-wide">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
            Trusted by security-first enterprise teams · SOC2-ready
          </div>

          <h1 className="text-[52px] leading-[1.1] font-extrabold text-[#0f0f0f] tracking-tight mb-6 max-md:text-[38px] max-sm:text-[30px]">
            Agentic AI Workflows<br />
            <span className="bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent">for Enterprise</span>
          </h1>

          <p className="text-[17px] text-[#555] leading-relaxed max-w-2xl mx-auto mb-10 max-sm:text-[15px]">
            Build secure, auditable AI workflows with drag-and-drop simplicity, full governance, and flexible on-prem or cloud deployment.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => router.push('/auth/signin')}
              className="bg-[#1a1a1a] text-white text-[14px] font-semibold px-7 py-3.5 rounded-xl hover:bg-[#333] transition-all shadow-lg shadow-black/10 hover:shadow-xl hover:-translate-y-0.5"
            >
              Get Started Free
            </button>
            <button
              onClick={() => router.push('/auth/signin')}
              className="bg-white text-[#1a1a1a] text-[14px] font-semibold px-7 py-3.5 rounded-xl border border-[#ebe9e6] hover:bg-[#faf9f7] transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5"
            >
              View Demo →
            </button>
          </div>

          {/* Stats row */}
          <div className="mt-16 grid grid-cols-4 gap-6 max-w-2xl mx-auto max-sm:grid-cols-2">
            {STATS.map(({ value, label }) => (
              <div key={label} className="bg-white/80 backdrop-blur border border-[#ebe9e6] rounded-xl py-4 px-3 shadow-sm">
                <div className="text-[22px] font-extrabold text-[#1a1a1a] tracking-tight">{value}</div>
                <div className="text-[11px] text-[#9a9a9a] font-medium mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-indigo-50 text-indigo-600 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4">Why Choose Us</div>
            <h2 className="text-[36px] font-extrabold text-[#0f0f0f] tracking-tight mb-4 max-sm:text-[26px]">Built for Enterprise Scale</h2>
            <p className="text-[16px] text-[#707070] max-w-xl mx-auto">Everything you need to deploy governed AI workflows securely and at scale.</p>
          </div>

          <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {FEATURES.map(({ icon, title, desc }) => (
              <div key={title} className="group bg-[#faf9f7] border border-[#ebe9e6] rounded-2xl p-6 hover:bg-white hover:shadow-lg hover:border-indigo-100 hover:-translate-y-1 transition-all duration-200">
                <div className="text-3xl mb-4">{icon}</div>
                <h3 className="text-[15px] font-bold text-[#1a1a1a] mb-2">{title}</h3>
                <p className="text-[13.5px] text-[#707070] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 px-6 bg-gradient-to-b from-[#faf9f7] to-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-indigo-50 text-indigo-600 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4">Platform Overview</div>
            <h2 className="text-[36px] font-extrabold text-[#0f0f0f] tracking-tight mb-4 max-sm:text-[26px]">How It Works</h2>
            <p className="text-[16px] text-[#707070] max-w-xl mx-auto">Connect your data, deploy agents, approve decisions, and track results — all in one governed workflow.</p>
          </div>

          <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2 max-sm:grid-cols-1">
            {STEPS.map(({ icon, step, title, desc }, i) => (
              <div key={title} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-indigo-200 to-transparent z-0 -translate-y-px" style={{ width: 'calc(100% - 16px)', left: 'calc(50% + 28px)' }} />
                )}
                <div className="relative z-10 bg-white border border-[#ebe9e6] rounded-2xl p-6 text-center shadow-sm hover:shadow-md transition-shadow">
                  <div className="text-[11px] font-bold text-indigo-400 tracking-widest mb-3">{step}</div>
                  <div className="text-3xl mb-3">{icon}</div>
                  <h4 className="text-[14px] font-bold text-[#1a1a1a] mb-2">{title}</h4>
                  <p className="text-[12.5px] text-[#9a9a9a] leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOLUTIONS ── */}
      <section id="solutions" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block bg-indigo-50 text-indigo-600 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4">Explore Solutions</div>
            <h2 className="text-[36px] font-extrabold text-[#0f0f0f] tracking-tight mb-4 max-sm:text-[26px]">AI Workflows for Every Function</h2>
            <p className="text-[16px] text-[#707070] max-w-xl mx-auto">Pre-built templates and customizable flows for your most critical operations.</p>
          </div>

          <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
            {[
              { icon: '🤖', title: 'Counselor Agent', desc: 'AI-powered counseling workflows with LangGraph orchestration for personalized guidance.' },
              { icon: '📋', title: 'Enrollment Agent', desc: 'Automate enrollment using CrewAI multi-agent systems for seamless onboarding.' },
              { icon: '💬', title: 'Support Agent', desc: '24/7 intelligent support powered by Amazon Strands for instant resolution.' },
              { icon: '📊', title: 'Analytics Dashboard', desc: 'Track performance, measure ROI, and optimize workflows with real-time insights.' },
              { icon: '🔐', title: 'Access Control', desc: 'Role-based permissions and multi-tenant isolation for complete data security.' },
              { icon: '⚡', title: 'Real-Time Processing', desc: 'WebSocket-powered updates and async task processing at any scale.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-[#faf9f7] border border-[#ebe9e6] rounded-2xl p-6 hover:bg-white hover:shadow-md hover:border-indigo-100 transition-all duration-200 group">
                <div className="text-2xl shrink-0 mt-0.5">{icon}</div>
                <div>
                  <h3 className="text-[14px] font-bold text-[#1a1a1a] mb-1.5">{title}</h3>
                  <p className="text-[13px] text-[#707070] leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-[#0f0f0f] to-[#1a1a2e]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 mb-5">Get Started Today</div>
          <h2 className="text-[40px] font-extrabold text-white tracking-tight mb-5 max-sm:text-[28px]">
            Ready to build agentic<br />workflows?
          </h2>
          <p className="text-[16px] text-[#9a9a9a] mb-10 leading-relaxed">
            Join enterprise teams achieving real outcomes with governed, auditable AI workflows.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => router.push('/auth/signin')}
              className="bg-indigo-600 text-white text-[14px] font-semibold px-8 py-3.5 rounded-xl hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/40"
            >
              Start for Free
            </button>
            <button
              onClick={() => router.push('/auth/signin')}
              className="bg-white/10 text-white text-[14px] font-semibold px-8 py-3.5 rounded-xl border border-white/20 hover:bg-white/20 transition-colors"
            >
              Talk to Sales →
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-[#0a0a0a] text-[#9a9a9a] px-6 pt-16 pb-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-4 gap-10 mb-12 max-lg:grid-cols-2 max-sm:grid-cols-1">
            <div>
              <div className="text-[17px] font-bold text-white mb-3">
                <span className="text-indigo-400">▸</span> MultiTenant SaaS
              </div>
              <p className="text-[13px] leading-relaxed text-[#666]">Enterprise AI platform with intelligent agent orchestration for counseling, enrollment, and support workflows.</p>
            </div>
            <div>
              <h4 className="text-[12px] font-bold text-white uppercase tracking-widest mb-4">Solutions</h4>
              <div className="flex flex-col gap-3">
                {['Counselor Agent', 'Enrollment Agent', 'Support Agent'].map(l => (
                  <a key={l} href="#" className="text-[13px] hover:text-white transition-colors">{l}</a>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-[12px] font-bold text-white uppercase tracking-widest mb-4">Company</h4>
              <div className="flex flex-col gap-3">
                {['About Us', 'Resources', 'Contact'].map(l => (
                  <a key={l} href="#" className="text-[13px] hover:text-white transition-colors">{l}</a>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-[12px] font-bold text-white uppercase tracking-widest mb-4">Legal</h4>
              <div className="flex flex-col gap-3">
                {['Privacy Policy', 'Terms of Service', 'Security'].map(l => (
                  <a key={l} href="#" className="text-[13px] hover:text-white transition-colors">{l}</a>
                ))}
              </div>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 text-center text-[12px] text-[#444]">
            © 2026 MultiTenant SaaS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
