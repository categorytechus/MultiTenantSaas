'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('http://localhost:4000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }

        .page {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #faf9f7; padding: 80px 20px 40px;
        }
        .wrap { width: 100%; max-width: 360px; animation: up .3s ease both; }
        @keyframes up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .heading { text-align: center; margin-bottom: 28px; }
        .heading h1 { font-size: 22px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.4px; margin-bottom: 4px; }
        .heading p  { font-size: 13.5px; color: #9a9a9a; }

        .err { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 10px 13px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }

        .g-btn {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 11px 16px; background: white; border: 1px solid #ebebeb; border-radius: 9px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500; color: #1a1a1a;
          cursor: pointer; transition: all .13s; margin-bottom: 18px;
        }
        .g-btn:hover { border-color: #c8c8c8; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
        .g-btn svg { width: 17px; height: 17px; flex-shrink: 0; }

        .divider { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
        .div-line { flex: 1; height: 1px; background: #ebebeb; }
        .div-txt  { font-size: 12px; color: #d0d0d0; }

        .field { margin-bottom: 14px; }
        .field-lbl {
          display: block;
          font-size: 12.5px; font-weight: 500; color: #555; margin-bottom: 6px;
        }

        .irow { position: relative; }
        .fi {
          width: 100%; padding: 10px 14px; border: 1px solid #ebebeb; border-radius: 8px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; color: #1a1a1a;
          background: white; outline: none; transition: all .13s;
        }
        .fi::placeholder { color: #d4d4d4; }
        .fi:focus { border-color: #c8c8c8; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
        .fi.pad { padding-right: 40px; }

        .eye {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #ccc;
          display: flex; align-items: center; padding: 0; transition: color .12s;
        }
        .eye:hover { color: #888; }
        .eye svg { width: 15px; height: 15px; }

        .sbtn {
          width: 100%; padding: 11px; background: #1a1a1a; color: white; border: none;
          border-radius: 8px; cursor: pointer; font-family: 'DM Sans', sans-serif;
          font-size: 14px; font-weight: 500; margin-top: 4px; transition: all .13s;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .sbtn:hover { background: #333; box-shadow: 0 4px 14px rgba(0,0,0,.14); }
        .sbtn:disabled { opacity: .55; cursor: not-allowed; }

        .spin { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: rot .65s linear infinite; }
        @keyframes rot { to { transform: rotate(360deg); } }

        .foot { text-align: center; margin-top: 18px; font-size: 13.5px; color: #9a9a9a; }
        .foot a { color: #1a1a1a; font-weight: 500; text-decoration: none; }
        .foot a:hover { text-decoration: underline; }

        .terms { text-align: center; margin-top: 28px; font-size: 11.5px; color: #ccc; line-height: 1.6; }
        .terms a { color: #bbb; text-decoration: underline; }

        @media (max-width: 400px) { .page { padding: 60px 16px 32px; } }
      `}</style>

      <div className="page">
        <div className="wrap">
          <div className="heading">
            <h1>Create your account</h1>
            <p>Get started with your free account</p>
          </div>

          {error && <div className="err">{error}</div>}

          <button className="g-btn" type="button" onClick={() => { window.location.href = 'http://localhost:4000/api/auth/google'; }}>
            <svg viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="divider">
            <div className="div-line" /><span className="div-txt">or</span><div className="div-line" />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-lbl">Full name</label>
              <input className="fi" type="text" placeholder="John Doe" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
            </div>

            <div className="field">
              <label className="field-lbl">Email</label>
              <input className="fi" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>

            <div className="field">
              <label className="field-lbl">Password</label>
              <div className="irow">
                <input className="fi pad" type={showPwd ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
                <button type="button" className="eye" onClick={() => setShowPwd(!showPwd)} tabIndex={-1}>
                  {showPwd
                    ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <div className="field">
              <label className="field-lbl">Confirm password</label>
              <div className="irow">
                <input className="fi pad" type={showConfirm ? 'text' : 'password'} placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
                <button type="button" className="eye" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}>
                  {showConfirm
                    ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <button className="sbtn" type="submit" disabled={loading}>
              {loading && <span className="spin" />}
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="foot">Already have an account? <Link href="/auth/signin">Sign in</Link></p>
        </div>

        <p className="terms">By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></p>
      </div>
    </>
  );
}