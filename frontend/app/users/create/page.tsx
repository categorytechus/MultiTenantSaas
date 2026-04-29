"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../../components/Layout";
import { apiFetch } from "../../../src/lib/api";
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