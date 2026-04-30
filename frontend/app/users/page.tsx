"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/ui/PageHeader";
import { apiFetch } from "../../src/lib/api";
import "./users.css";

interface OrgUser {
  id: string;
  email: string;
  full_name: string;
  status: string;
  user_type: string;
  org_role: string;
  created_at: string;
  last_login_at: string | null;
  roles: { id: string; name: string }[];
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OrgUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<OrgUser | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(
    null,
  );
  const [resetCopied, setResetCopied] = useState(false);
  const [currentUserType, setCurrentUserType] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!openMenuRef.current) return;
      if (!openMenuRef.current.contains(e.target as Node)) setOpenMenuFor(null);
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
      if (!meRes.success) {
        router.push("/auth/signin");
        return;
      }
      const ut = meRes.data.data.user_type;
      setCurrentUserType(ut);
      if (ut === "user") {
        router.push("/dashboard");
        return;
      }
    } catch {
      router.push("/auth/signin");
      return;
    }

    try {
      const tokenData = localStorage.getItem("accessToken");
      if (tokenData) {
        const payload = JSON.parse(atob(tokenData.split(".")[1]));
        const oid = payload.org_id;
        if (oid) {
          setOrgId(oid);
          const res = await apiFetch<{ data: OrgUser[] }>(
            `/organizations/${oid}/users`,
          );
          if (res.success) setUsers(res.data.data);
          else setError(res.error || "Failed to load users");
        } else {
          setError("no-org");
        }
      }
    } catch {
      setError("Failed to load users");
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
        `/organizations/${orgId}/users/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (res.success) {
        setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
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

  const handlePasswordReset = async () => {
    if (!passwordTarget || !orgId) return;
    setError("");
    setResettingPassword(true);
    try {
      const res = await apiFetch<{ data?: { temp_password?: string } }>(
        `/organizations/${orgId}/users/${passwordTarget.id}/reset-password`,
        { method: "POST" },
      );
      if (res.success) {
        setPasswordTarget(null);
        if (res.data?.data?.temp_password)
          setResetTempPassword(res.data.data.temp_password);
      } else {
        setError(res.error || "Password reset failed");
      }
    } catch {
      setError("Password reset failed");
    } finally {
      setResettingPassword(false);
    }
  };

  const canChangePassword = () => currentUserType === "super_admin";

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
      <div className="app-page page">
        <PageHeader
          title="Users"
          subtitle="Manage users in your organization"
          actions={
            <div className="header-actions">
              <Button variant="secondary" onClick={() => router.push("/users/invite")}>
                Invite User
              </Button>
              <Button onClick={() => router.push("/users/create")}>
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
                Create User
              </Button>
            </div>
          }
        />

        {error && error !== "no-org" && <div className="err-bar">{error}</div>}

        {error === "no-org" ? (
          <div style={{ textAlign: "center", padding: "64px 24px" }}>
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
              organization, then come back here to manage users.
            </div>
          </div>
        ) : loading ? (
          <div
            style={{ textAlign: "center", padding: "48px", color: "#9a9a9a" }}
          >
            Loading…
          </div>
        ) : (
          <Card className="card">
            {users.length === 0 ? (
              <div className="empty">
                No users in this organization yet. Create or invite the first one.
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Type</th>
                    <th>Roles</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.full_name || "—"}</td>
                      <td style={{ color: "#555" }}>{u.email}</td>
                      <td>
                        <span className={`type-badge type-${u.user_type}`}>
                          {u.user_type === "org_admin" ? "Org Admin" : "User"}
                        </span>
                      </td>
                      <td>
                        {u.roles?.length ? (
                          u.roles.map((r) => (
                            <span key={r.id} className="role-tag">
                              {r.name}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "#ccc", fontSize: "12px" }}>
                            No roles
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${u.status}`}>
                          {u.status}
                        </span>
                      </td>
                      <td style={{ color: "#777" }}>
                        {formatDate(u.created_at)}
                      </td>
                      <td style={{ color: "#777" }}>
                        {formatDate(u.last_login_at)}
                      </td>
                      <td>
                        <div className="row-menu">
                          <button
                            type="button"
                            className="kebab-btn"
                            aria-haspopup="menu"
                            aria-expanded={openMenuFor === u.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuFor((prev) =>
                                prev === u.id ? null : u.id,
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
                          {openMenuFor === u.id && (
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
                                  router.push(`/users/${u.id}/edit`);
                                }}
                              >
                                Edit
                              </button>
                              {canChangePassword() && (
                                <button
                                  type="button"
                                  className="kebab-item"
                                  onClick={() => {
                                    setOpenMenuFor(null);
                                    setPasswordTarget(u);
                                  }}
                                >
                                  Reset Password
                                </button>
                              )}
                              <button
                                type="button"
                                className="kebab-item"
                                onClick={() => {
                                  setOpenMenuFor(null);
                                  router.push(`/users/${u.id}/permissions`);
                                }}
                              >
                                Permissions
                              </button>
                              <button
                                type="button"
                                className="kebab-item kebab-danger"
                                onClick={() => {
                                  setOpenMenuFor(null);
                                  setDeleteTarget(u);
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Remove User</div>
            <div className="modal-body">
              Remove{" "}
              <strong>{deleteTarget.full_name || deleteTarget.email}</strong>{" "}
              from this organization?
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
                {deleting ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordTarget && (
        <div className="modal-overlay" onClick={() => setPasswordTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Reset Password</div>
            <div className="modal-body">
              A new temporary password will be generated for{" "}
              <strong>
                {passwordTarget.full_name || passwordTarget.email}
              </strong>
              .
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

      {resetTempPassword && (
        <div
          className="modal-overlay"
          onClick={() => setResetTempPassword(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Password Reset</div>
            <div className="modal-body">
              Share this temporary password securely.
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