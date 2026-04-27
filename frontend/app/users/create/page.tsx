"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../../components/Layout";
import { apiFetch } from "../../../src/lib/api";

interface Role {
  id: string;
  name: string;
  is_system: boolean;
}

const FORM_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; }
  .page { padding: 32px; }
  .back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: #9a9a9a; cursor: pointer; margin-bottom: 20px; border: none; background: none; font-family: 'DM Sans', sans-serif; }
  .back-link:hover { color: #1a1a1a; }
  .page-title { font-size: 20px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 4px; }
  .page-subtitle { font-size: 13px; color: #9a9a9a; margin-bottom: 28px; }
  .form-card { background: white; border-radius: 12px; border: 1px solid #f0eeeb; padding: 28px; max-width: 520px; }
  .field { margin-bottom: 18px; }
  .field label { display: block; font-size: 12.5px; font-weight: 500; color: #555; margin-bottom: 6px; }
  .fi { width: 100%; padding: 10px 14px; border: 1px solid #ebebeb; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #1a1a1a; outline: none; transition: all .13s; }
  .fi:focus { border-color: #c8c8c8; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
  .fi::placeholder { color: #d4d4d4; }
  .select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23999' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; cursor: pointer; }
  .hint { font-size: 11.5px; color: #9a9a9a; margin-top: 5px; }
  .form-actions { display: flex; gap: 10px; margin-top: 8px; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500; cursor: pointer; border: none; transition: all .13s; }
  .btn-primary { background: #1a1a1a; color: white; }
  .btn-primary:hover:not(:disabled) { background: #333; }
  .btn-primary:disabled { opacity: .55; cursor: not-allowed; }
  .btn-ghost { background: #f5f4f1; color: #1a1a1a; }
  .btn-ghost:hover { background: #eeeceb; }
  .err-bar { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .spin { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: rot .65s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }
`;

export default function CreateUserPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>(
          "/auth/me",
        );
        if (!meRes.success || meRes.data.data.user_type === "user") {
          router.push("/dashboard");
          return;
        }
        const payload = JSON.parse(atob(token.split(".")[1]));
        const oid = payload.org_id;
        if (!oid) {
          setError("No org context. Switch to an org first.");
          return;
        }
        setOrgId(oid);
        const rolesRes = await apiFetch<{ data: Role[] }>(
          `/organizations/${oid}/roles`,
        );
        if (rolesRes.success) {
          setRoles(rolesRes.data.data.filter((r: Role) => !r.is_system));
        }
      } catch {
        setError("Failed to load data");
      }
    })();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) {
      setError("No organization context");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users`, {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          roleId: roleId || undefined,
        }),
      });
      if (res.success) {
        router.push("/users");
      } else {
        setError(res.error || "Failed to create user");
      }
    } catch {
      setError("Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <style>{FORM_STYLES}</style>
      <div className="page">
        <button className="back-link" onClick={() => router.push("/users")}>
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Users
        </button>
        <div className="page-title">Add User</div>
        <div className="page-subtitle">
          Create a new user in your organization
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input
                className="fi"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Email address</label>
              <input
                className="fi"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="fi"
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="hint">The user can change this after signing in.</p>
            </div>
            {roles.length > 0 && (
              <div className="field">
                <label>
                  Role{" "}
                  <span style={{ color: "#bbb", fontWeight: 400 }}>
                    (optional)
                  </span>
                </label>
                <select
                  className="fi select"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  <option value="">No role assigned</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  Custom roles define what the user can do within your org.
                </p>
              </div>
            )}
            <div className="form-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => router.push("/users")}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
              >
                {loading && <span className="spin" />}
                {loading ? "Creating…" : "Add User"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}