"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../../components/Layout";
import { apiFetch } from "../../../src/lib/api";
import './roles-create.css';

// Custom roles: name + description only (no /permissions pickers; catalog kept for future use)

export default function CreateRolePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
          setError("No org context");
          return;
        }
        setOrgId(oid);
      } catch {
        setError("Failed to load");
      }
    })();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) {
      setError("No org context");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      if (res.success) {
        router.push("/roles");
      } else {
        setError(res.error || "Failed to create role");
      }
    } catch {
      setError("Failed to create role");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
<div className="page">
        <button className="back-link" onClick={() => router.push("/roles")}>
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
          Back to Roles
        </button>
        <div className="page-title">Create Role</div>
        <div className="page-subtitle">
          Set a name and description (e.g. HR, Sales, Accountant)
        </div>

        {error && <div className="err-bar">{error}</div>}

        <div className="form-card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Role name</label>
              <input
                className="fi"
                type="text"
                placeholder="e.g. HR, Sales, Accountant"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>
                Description{" "}
                <span style={{ color: "#bbb", fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                className="fi"
                type="text"
                placeholder="What this label represents"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => router.push("/roles")}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
              >
                {loading && <span className="spin" />}
                {loading ? "Creating…" : "Create Role"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}