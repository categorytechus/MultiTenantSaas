"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import { apiFetch } from "../../src/lib/api";
import { Pencil, Trash2, KeyRound } from "lucide-react";

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
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [currentUserType, setCurrentUserType] = useState<string | null>(null);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) { router.push("/auth/signin"); return; }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
      if (!meRes.success) { router.push("/auth/signin"); return; }
      const ut = meRes.data.data.user_type;
      const jwtPayload = JSON.parse(atob(token.split(".")[1]));
      const jwtRoles: string[] = jwtPayload.roles ?? [];
      setCurrentUserType(jwtRoles.includes("org_admin") ? "org_admin" : ut);
      if (ut !== "super_admin" && !jwtRoles.includes("org_admin")) {
        router.push("/dashboard"); return;
      }
    } catch { router.push("/auth/signin"); return; }

    try {
      const tokenData = localStorage.getItem("accessToken");
      if (tokenData) {
        const payload = JSON.parse(atob(tokenData.split(".")[1]));
        const oid = payload.org_id;
        if (oid) {
          setOrgId(oid);
          const res = await apiFetch<{ data: OrgUser[] }>(`/organizations/${oid}/users`);
          if (res.success) setUsers(res.data.data);
          else setError(res.error || "Failed to load users");
        } else {
          setError("no-org");
        }
      }
    } catch { setError("Failed to load users"); }
    finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void guardAndFetch(); }, 0);
    return () => window.clearTimeout(timer);
  }, [guardAndFetch]);

  const handleDelete = async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${deleteTarget.id}`, { method: "DELETE" });
      if (res.success) { setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id)); setDeleteTarget(null); }
      else setError(res.error || "Delete failed");
    } catch { setError("Delete failed"); }
    finally { setDeleting(false); }
  };

  const handlePasswordReset = async () => {
    if (!passwordTarget || !orgId) return;
    setError(""); setResettingPassword(true);
    try {
      const res = await apiFetch<{ data?: { temp_password?: string } }>(
        `/organizations/${orgId}/users/${passwordTarget.id}/reset-password`, { method: "POST" }
      );
      if (res.success) {
        setPasswordTarget(null);
        if (res.data?.data?.temp_password) setResetTempPassword(res.data.data.temp_password);
      } else { setError(res.error || "Password reset failed"); }
    } catch { setError("Password reset failed"); }
    finally { setResettingPassword(false); }
  };

  const isSuperAdmin = currentUserType === "super_admin";

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const getRoleTags = (u: OrgUser) => {
    if (u.roles?.length) return u.roles.map((r) => r.name);
    if (u.org_role) return [u.org_role];
    return [];
  };

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Users</div>
            <div className="page-subtitle">Manage users in your organization</div>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => router.push("/users/invite")}>
              Invite User
            </button>
            <button className="btn btn-primary" onClick={() => router.push("/users/create")}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create User
            </button>
          </div>
        </div>

        {error && error !== "no-org" && <div className="err-bar">{error}</div>}

        {error === "no-org" ? (
          <div className="card flex flex-col items-center py-16 text-center gap-2">
            <p className="text-[15px] font-semibold text-[#1a1a1a]">No organization selected</p>
            <p className="text-[13px] text-[#9a9a9a] max-w-xs">Use the organization switcher in the top-right to select an org, then come back here.</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-[#9a9a9a] text-[13px]">
            <span className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="card">
            {users.length === 0 ? (
              <div className="empty">No users in this organization yet. Create or invite the first one.</div>
            ) : (
              <div className="table-responsive-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Roles</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Last login</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const roleTags = getRoleTags(u);
                      return (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 500 }}>{u.full_name || "—"}</td>
                          <td style={{ color: "#555" }}>{u.email}</td>
                          <td>
                            {roleTags.length ? (
                              <div className="flex flex-wrap gap-1">
                                {roleTags.map((name) => (
                                  <span
                                    key={name}
                                    className={`role-tag${name === "org_admin" ? " role-tag-org_admin" : name === "super_admin" ? " role-tag-super_admin" : " role-tag-user"}`}
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: "#ccc", fontSize: "12px" }}>No roles</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge badge-${u.status}`}>{u.status}</span>
                          </td>
                          <td style={{ color: "#777" }}>{formatDate(u.created_at)}</td>
                          <td style={{ color: "#777" }}>{formatDate(u.last_login_at)}</td>
                          <td>
                            <div className="actions">
                              <button
                                className="btn btn-sm"
                                style={{ background: "#f5f4f1", color: "#1a1a1a", border: "none" }}
                                title="Edit user"
                                onClick={() => router.push(`/users/${u.id}/edit`)}
                              >
                                <Pencil size={13} />
                                Edit
                              </button>
                              {isSuperAdmin && (
                                <button
                                  className="btn btn-sm"
                                  style={{ background: "#f5f4f1", color: "#1a1a1a", border: "none" }}
                                  title="Reset password"
                                  onClick={() => setPasswordTarget(u)}
                                >
                                  <KeyRound size={13} />
                                </button>
                              )}
                              <button
                                className="btn btn-sm btn-danger"
                                title="Delete user"
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Remove User</div>
            <div className="modal-body">
              Remove <strong>{deleteTarget.full_name || deleteTarget.email}</strong> from this organization?
            </div>
            <div className="modal-actions">
              <button className="btn" style={{ background: "#f5f4f1", color: "#1a1a1a", border: "none" }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
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
              A new temporary password will be generated for <strong>{passwordTarget.full_name || passwordTarget.email}</strong>.
            </div>
            <div className="modal-actions">
              <button className="btn" style={{ background: "#f5f4f1", color: "#1a1a1a", border: "none" }} onClick={() => setPasswordTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePasswordReset} disabled={resettingPassword}>
                {resettingPassword ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetTempPassword && (
        <div className="modal-overlay" onClick={() => setResetTempPassword(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Password Reset</div>
            <div className="modal-body">Share this temporary password securely.</div>
            <div style={{ background: "#f5f4f1", border: "1px solid #e5e5e5", borderRadius: 8, padding: "12px 14px", color: "#1a1a1a", fontFamily: "monospace", fontSize: 14, letterSpacing: "0.05em", margin: "12px 0", wordBreak: "break-all" }}>
              {resetTempPassword}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(resetTempPassword); setResetCopied(true); setTimeout(() => setResetCopied(false), 2000); }}>
                {resetCopied ? "Copied!" : "Copy Password"}
              </button>
              <button className="btn" style={{ background: "#f5f4f1", color: "#1a1a1a", border: "none" }} onClick={() => setResetTempPassword(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
