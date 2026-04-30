'use client';

import Link from 'next/link';
import './auth-signup.css';

export default function SignUpPage() {
  return (
    <div className="page">
      <div className="wrap">
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#f5f3ff', border: '2px solid #ddd6fe',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="24" height="24" fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div className="heading">
          <h1>Invite-only access</h1>
          <p>This platform is invite-only. Ask your administrator for a signup link.</p>
        </div>

        <div style={{
          background: '#f9f9f8', border: '1px solid #ebebeb', borderRadius: 10,
          padding: '16px 18px', marginBottom: 20, fontSize: 13.5, color: '#555', lineHeight: 1.7,
        }}>
          <strong style={{ color: '#1a1a1a', display: 'block', marginBottom: 6 }}>How to get access</strong>
          Your organization admin will send you a unique signup link via email. Open that link to complete your registration and set up your account.
        </div>

        <p className="foot">Already have an account? <Link href="/auth/signin">Sign in</Link></p>
      </div>

      <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
    </div>
  );
}