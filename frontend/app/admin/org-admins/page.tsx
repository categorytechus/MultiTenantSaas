"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../../components/Layout";
import { apiFetch } from "../../../src/lib/api";
import "./admin-org-admins.css";

interface OrgRef {
  id: string;
  name: string;
  slug: string;
}

interface OrgAdmin {
  id: string;
  email: string;
  full_name: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  orgs: OrgRef[];
}

export default function OrgAdminsPage() {
  const router = useRouter();
  const [admins, setAdmins] = useState<OrgAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<OrgAdmin | null>(null);
  const [deleteOrgId, setDeleteOrgId] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  // Password reset state
  const [passwordTarget, setPasswordTarget] = useState<OrgAdmin | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(
    null,
  );
  const [resetCopied, setResetCopied] = useState(false);

  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!openMenuRef.current) return;
      if (!openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
      if (!meRes.success || meRes.data.data.user_type !== "super_admin") {
        router.push("/dashboard");
        return;
      }
    } catch {
      router.push("/dashboard");
      return;
    }
    try {
      const tokenData = localStorage.getItem("accessToken");
      let selectedOrgId = "";
      if (tokenData) {
        const payload = JSON.parse(atob(tokenData.split(".")[1]));
        selectedOrgId = payload.org_id || "";
      }
      const query = selectedOrgId
        ? `?orgId=${encodeURIComponent(selectedOrgId)}`
        : "";
      const adminsRes = await apiFetch<{ data: OrgAdmin[] }>(
        `/admin/org-admins${query}`,
      );
      if (adminsRes.success) setAdmins(adminsRes.data.data);
      else setError(adminsRes.error || "Failed to load org admins");
    } catch {
      setError("Failed to load org admins");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const run = () => {
      void guardAndFetch();
    };
    const timer = window.setTimeout(run, 0);
    return () => window.clearTimeout(timer);
  }, [guardAndFetch]);

  // Delete: if deleteOrgId set → remove from that org only; otherwise full delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url = deleteOrgId
        ? `/admin/org-admins/${deleteTarget.id}/organizations/${deleteOrgId}`
        : `/admin/org-admins/${deleteTarget.id}`;
      const res = await apiFetch(url, { method: "DELETE" });
      if (res.success) {
        if (deleteOrgId) {
          setAdmins((prev) =>
            prev
              .map((a) => {
                if (a.id !== deleteTarget.id) return a;
                const remaining = a.orgs.filter((o) => o.id !== deleteOrgId);
                if (remaining.length === 0) return null as unknown as OrgAdmin;
                return { ...a, orgs: remaining };
              })
              .filter(Boolean),
          );
        } else {
          setAdmins((prev) => prev.filter((a) => a.id !== deleteTarget.id));
        }
        setDeleteTarget(null);
        setDeleteOrgId("");
      } else {
        setError(res.error || "Delete failed");
      }
    } catch {
      setError("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!passwordTarget) return;
    setResettingPassword(true);
    setError("");
    const orgId = passwordTarget.orgs[0]?.id;
    if (!orgId) {
      setError("Admin has no organization context for password reset");
      setResettingPassword(false);
      return;
    }
    try {
      const res = await apiFetch<{ data?: { temp_password?: string } }>(
        `/organizations/${orgId}/users/${passwordTarget.id}/reset-password`,
        { method: "POST" },
      );
      if (res.success) {
        setPasswordTarget(null);
        if (res.data?.data?.temp_password) {
          setResetTempPassword(res.data.data.temp_password);
        }
      } else {
        setError(res.error || "Password reset failed");
      }
    } catch {
      setError("Password reset failed");
    } finally {
      setResettingPassword(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Org Admins</div>
            <div className="page-subtitle">
              Manage organization administrators across all orgs
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={() => router.push("/admin/org-admins/invite")}
            >
              Invite Org Admin
            </button>
            <button
              className="btn btn-primary"
              onClick={() => router.push("/admin/org-admins/create")}
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
              Create Org Admin
            </button>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}

        {loading ? (
          <div
            style={{ textAlign: "center", padding: "48px", color: "#9a9a9a" }}
          >
            Loading…
          </div>
        ) : (
          <div className="card">
            {admins.length === 0 ? (
              <div className="empty">No org admins found.</div>
            ) : (
              <div className="table-responsive-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Organizations</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.full_name || "—"}</td>
                      <td style={{ color: "#555" }}>{a.email}</td>
                      <td>
                        {a.orgs && a.orgs.length > 0 ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 4,
                            }}
                          >
                            {a.orgs.map((o) => (
                              <span key={o.id} className="org-pill">
                                <svg
                                  width="10"
                                  height="10"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                                </svg>
                                {o.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${a.status}`}>
                          {a.status}
                        </span>
                      </td>
                      <td style={{ color: "#777" }}>
                        {formatDate(a.created_at)}
                      </td>
                      <td style={{ color: "#777" }}>
                        {formatDate(a.last_login_at)}
                      </td>
                      <td>
                        <div className="row-menu">
                          <button
                            type="button"
                            className="kebab-btn"
                            aria-label="More actions"
                            aria-haspopup="menu"
                            aria-expanded={openMenuFor === a.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuFor((prev) =>
                                prev === a.id ? null : a.id,
                              );
                            }}
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <circle
                                cx="8.5"
                                cy="12"
                                r="1.6"
                                fill="currentColor"
                              />
                              <circle
                                cx="12"
                                cy="12"
                                r="1.6"
                                fill="currentColor"
                              />
                              <circle
                                cx="15.5"
                                cy="12"
                                r="1.6"
                                fill="currentColor"
                              />
                            </svg>
                          </button>

                          {openMenuFor === a.id && (
                            <div
                              className="kebab-dropdown"
                              ref={openMenuRef}
                              onClick={(e) => e.stopPropagation()}
                              role="menu"
                            >
                              <button
                                type="button"
                                className="kebab-item"
                                onClick={() => {
                                  setOpenMenuFor(null);
                                  router.push(`/admin/org-admins/${a.id}/edit`);
                                }}
                              >
                                Edit
                              </button>
                              {a.orgs.length > 0 && (
                                <button
                                  type="button"
                                  className="kebab-item"
                                  onClick={() => {
                                    setOpenMenuFor(null);
                                    setPasswordTarget(a);
                                  }}
                                >
                                  Reset Password
                                </button>
                              )}
                              <button
                                type="button"
                                className="kebab-item kebab-danger"
                                onClick={() => {
                                  setOpenMenuFor(null);
                                  setDeleteTarget(a);
                                  setDeleteOrgId(
                                    a.orgs.length === 1 ? a.orgs[0].id : "",
                                  );
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Delete modal — adapts based on org count ── */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Delete Org Admin</div>
            {deleteTarget.orgs.length > 1 ? (
              <>
                <div className="modal-body">
                  <strong>
                    {deleteTarget.full_name || deleteTarget.email}
                  </strong>{" "}
                  belongs to multiple organizations. Choose an action:
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    margin: "12px 0",
                  }}
                >
                  {deleteTarget.orgs.map((o) => (
                    <label
                      key={o.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        background:
                          deleteOrgId === o.id ? "#f0f4ff" : "#f9f9f7",
                        border: `1px solid ${deleteOrgId === o.id ? "#c7d7ff" : "#e5e5e5"}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="radio"
                        name="deleteOrg"
                        value={o.id}
                        checked={deleteOrgId === o.id}
                        onChange={() => setDeleteOrgId(o.id)}
                      />
                      Remove from{" "}
                      <strong style={{ marginLeft: 4 }}>{o.name}</strong>
                    </label>
                  ))}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: deleteOrgId === "" ? "#fff5f5" : "#f9f9f7",
                      border: `1px solid ${deleteOrgId === "" ? "#ffc7c7" : "#e5e5e5"}`,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="radio"
                      name="deleteOrg"
                      value=""
                      checked={deleteOrgId === ""}
                      onChange={() => setDeleteOrgId("")}
                    />
                    Delete entirely (remove from all orgs)
                  </label>
                </div>
              </>
            ) : (
              <div className="modal-body">
                Are you sure you want to delete{" "}
                <strong>{deleteTarget.full_name || deleteTarget.email}</strong>?
                This action cannot be undone.
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn"
                style={{
                  background: "#f5f4f1",
                  color: "#1a1a1a",
                  border: "none",
                }}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteOrgId("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting
                  ? "Deleting…"
                  : deleteOrgId
                    ? "Remove from Org"
                    : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Password reset confirmation ── */}
      {passwordTarget && (
        <div className="modal-overlay" onClick={() => setPasswordTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Reset Password</div>
            <div className="modal-body">
              A new temporary password will be generated for{" "}
              <strong>
                {passwordTarget.full_name || passwordTarget.email}
              </strong>
              . They will be required to set a new password on next login.
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                style={{
                  background: "#f5f4f1",
                  color: "#1a1a1a",
                  border: "none",
                }}
                onClick={() => setPasswordTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handlePasswordReset}
                disabled={resettingPassword}
              >
                {resettingPassword ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── One-time temp password reveal after admin reset ── */}
      {resetTempPassword && (
        <div
          className="modal-overlay"
          onClick={() => setResetTempPassword(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Password Reset</div>
            <div className="modal-body">
              Share this temporary password with the admin securely. They will
              be prompted to set a new one on next login.
            </div>
            <div
              style={{
                background: "#f5f4f1",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                padding: "12px 14px",
                color: "#1a1a1a",
                fontFamily: "monospace",
                fontSize: 14,
                letterSpacing: "0.05em",
                margin: "12px 0",
                wordBreak: "break-all",
              }}
            >
              {resetTempPassword}
            </div>
            <p style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
              This will not be shown again.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(resetTempPassword);
                  setResetCopied(true);
                  setTimeout(() => setResetCopied(false), 2000);
                }}
              >
                {resetCopied ? "Copied!" : "Copy Password"}
              </button>
              <button
                className="btn"
                style={{
                  background: "#f5f4f1",
                  color: "#1a1a1a",
                  border: "none",
                }}
                onClick={() => setResetTempPassword(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
