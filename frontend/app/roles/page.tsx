"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import { apiFetch } from "../../src/lib/api";
import './roles.css';

// Org custom roles: title + description only (no permission matrix in UI for now)

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
}

export default function RolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
      if (!meRes.success || meRes.data.data.user_type === "user") {
        router.push("/dashboard");
        return;
      }
      const payload = JSON.parse(atob(token.split(".")[1]));
      const oid = payload.org_id;
      if (!oid) {
        setError("no-org");
        setLoading(false);
        return;
      }
      setOrgId(oid);
      const res = await apiFetch<{ data: Role[] }>(
        `/organizations/${oid}/roles`,
      );
      if (res.success) setRoles(res.data.data);
      else setError(res.error || "Failed to load roles");
    } catch {
      setError("Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    guardAndFetch();
  }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(
        `/organizations/${orgId}/roles/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (res.success) {
        setRoles((prev) => prev.filter((r) => r.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        setError(res.error || "Delete failed");
      }
    } catch {
      setError("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Layout>
            <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Roles</div>
            <div className="page-subtitle">
              Labels for your organization (e.g. HR, Sales) — name and
              description only
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => router.push("/roles/create")}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create Role
          </button>
        </div>

        {error && error !== "no-org" && <div className="err-bar">{error}</div>}

        {error === "no-org" ? (
          <div style={{ textAlign: "center", padding: "64px 24px" }}>
            <svg
              width="40"
              height="40"
              fill="none"
              stroke="#d4d4d4"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              style={{ margin: "0 auto 16px" }}
            >
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "#1a1a1a",
                marginBottom: 8,
              }}
            >
              No organization selected
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#9a9a9a",
                maxWidth: 320,
                margin: "0 auto",
              }}
            >
              Use the organization switcher in the top-right corner to select an
              organization, then come back here to manage its roles.
            </div>
          </div>
        ) : loading ? (
          <div
            style={{ textAlign: "center", padding: "48px", color: "#9a9a9a" }}
          >
            Loading…
          </div>
        ) : (
          <div className="card">
            {roles.length === 0 ? (
              <div className="empty">
                No roles yet. Create a custom role to get started.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.name}</div>
                        {r.description && (
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#9a9a9a",
                              marginTop: "2px",
                            }}
                          >
                            {r.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${r.is_system ? "badge-system" : "badge-custom"}`}
                        >
                          {r.is_system ? "System" : "Custom"}
                        </span>
                      </td>
                      <td>
                        {!r.is_system && (
                          <div className="actions">
                            <button
                              className="btn btn-sm"
                              style={{
                                background: "#f5f4f1",
                                color: "#1a1a1a",
                                border: "none",
                              }}
                              onClick={() => router.push(`/roles/${r.id}/edit`)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => setDeleteTarget(r)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Delete Role</div>
            <div className="modal-body">
              Delete role <strong>{deleteTarget.name}</strong>? Users with this
              label may need to be updated separately.
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                style={{
                  background: "#f5f4f1",
                  color: "#1a1a1a",
                  border: "none",
                }}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}