"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../../components/Layout";
import { apiFetch } from "../../../src/lib/api";
import { assignableMemberRoles } from "../../../src/lib/org-member-roles";
import './users-create.css';

interface Role {
  id: string;
  name: string;
  is_system: boolean;
}


export default function CreateUserPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [setPasswordLink, setSetPasswordLink] = useState<string | null>(null);
  const [existingUserAdded, setExistingUserAdded] = useState(false);
  const [setupEmailSent, setSetupEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
        const jwtPayload = JSON.parse(atob(token.split(".")[1]));
        const jwtRoles: string[] = jwtPayload.roles ?? [];
        if (!meRes.success || (meRes.data.data.user_type !== "super_admin" && !jwtRoles.includes("org_admin"))) {
          router.push("/dashboard");
          return;
        }
        const oid = jwtPayload.org_id;
        if (!oid) {
          setError("No org context. Switch to an org first.");
          return;
        }
        setOrgId(oid);
        const rolesRes = await apiFetch<{ data: Role[] }>(`/organizations/${oid}/roles`);
        if (rolesRes.success) {
          setRoles(assignableMemberRoles(rolesRes.data.data));
        }
      } catch {
        setError("Failed to load data");
      }
    })();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) { setError("No organization context"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch<{ data: { set_password_link?: string }; warnings?: { code: string }[] }>(`/organizations/${orgId}/users`, {
        method: "POST",
        body: JSON.stringify({ name, email, roleId: roleId || undefined }),
      });
      if (!res.success) {
        setError(res.error || "Failed to create user");
        return;
      }
      const warnings = res.data.warnings;
      if (warnings?.some((w) => w.code === "email_failed")) {
        setError("Account may have been created but the setup email could not be sent. Check server logs or try again.");
        return;
      }
      const link = res.data.data.set_password_link;
      if (link) {
        setSetPasswordLink(link);
      } else if (res.status === 200) {
        setExistingUserAdded(true);
      } else {
        setSetupEmailSent(true);
      }
    } catch {
      setError("Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (setPasswordLink) {
      navigator.clipboard.writeText(setPasswordLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (existingUserAdded) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="18" height="18" fill="none" stroke="#2563eb" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                </svg>
              </div>
              <div className="page-title" style={{ margin: 0 }}>Added to Organization</div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              <strong>{email}</strong> already has an account and has been added to the organization. Share the sign-in link below with them.
            </p>

            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Sign-in link</div>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 12.5, color: '#374151',
                  background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/auth/signin'}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText((process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/auth/signin'); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  style={{
                    padding: '10px 14px', background: copied ? '#f0fdf4' : '#f5f4f1',
                    border: 'none', borderLeft: '1px solid #e5e5e5', cursor: 'pointer',
                    color: copied ? '#16a34a' : '#555', fontSize: 13, fontWeight: 500,
                    fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', transition: 'all .15s',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => { setExistingUserAdded(false); setName(""); setEmail(""); }} style={{ flex: 1 }}>
                Add Another
              </button>
              <button className="btn btn-primary" onClick={() => router.push('/users')} style={{ flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (setupEmailSent) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div className="page-title" style={{ marginBottom: 8 }}>User created</div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 }}>
              We sent a password setup link to <strong>{email}</strong>. They can complete setup from the email.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setSetupEmailSent(false); setName(""); setEmail(""); }} style={{ flex: 1 }}>
                Add Another
              </button>
              <button className="btn btn-primary" onClick={() => router.push('/users')} style={{ flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (setPasswordLink) {
    return (
      <Layout>
        <div className="page">
          <div className="form-card" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="18" height="18" fill="none" stroke="#16a34a" strokeWidth="2.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="page-title" style={{ margin: 0 }}>User Created</div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              Account created for <strong>{email}</strong>. Share the link below so they can set their password and log in.
            </p>

            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 6 }}>Password setup link</div>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 12.5, color: '#374151',
                  background: '#f9f9f8', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {setPasswordLink}
                </div>
                <button
                  onClick={handleCopy}
                  style={{
                    padding: '10px 14px', background: copied ? '#f0fdf4' : '#f5f4f1',
                    border: 'none', borderLeft: '1px solid #e5e5e5', cursor: 'pointer',
                    color: copied ? '#16a34a' : '#555', fontSize: 13, fontWeight: 500,
                    fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', transition: 'all .15s',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 8, padding: '10px 14px', marginBottom: 24, marginTop: 12,
            }}>
              <svg width="15" height="15" fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
                This link is single-use and expires after first use. Share it securely with the user.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setSetPasswordLink(null); setName(""); setEmail(""); }} style={{ flex: 1 }}>
                Add Another
              </button>
              <button className="btn btn-primary" onClick={() => router.push('/users')} style={{ flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page">
        <button className="back-link" onClick={() => router.push("/users")}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Users
        </button>
        <div className="page-title">Create User</div>
        <div className="page-subtitle">
          Create a new user account. A password setup link will be generated — share it with them securely.
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                className="fi"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>Email address <span style={{ color: '#e53e3e' }}>*</span></label>
              <input
                className="fi"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {roles.length > 0 && (
              <div className="field">
                <label>
                  Role{" "}
                  <span style={{ color: "#bbb", fontWeight: 400 }}>(optional)</span>
                </label>
                <select
                  className="fi select"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  <option value="">No role assigned</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <p className="hint">Custom roles define what the user can do within your org.</p>
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-ghost" type="button" onClick={() => router.push("/users")}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spin" />}
                {loading ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
