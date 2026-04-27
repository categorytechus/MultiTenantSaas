"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Layout from "../../../../components/Layout";
import { apiFetch } from "../../../../src/lib/api";

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
  .page-subtitle { font-size: 13px; color: #777; margin-bottom: 28px; }
  .form-card { background: white; border-radius: 12px; border: 1px solid #f0eeeb; padding: 28px; max-width: 520px; margin-bottom: 16px; }
  .section-title { font-size: 13.5px; font-weight: 600; color: #1a1a1a; margin-bottom: 14px; }
  .field { margin-bottom: 18px; }
  .field label { display: block; font-size: 12.5px; font-weight: 500; color: #555; margin-bottom: 6px; }
  .fi { width: 100%; padding: 10px 14px; border: 1px solid #ebebeb; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #1a1a1a; outline: none; transition: all .13s; }
  .fi:focus { border-color: #c8c8c8; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
  .select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23999' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; cursor: pointer; }
  .form-actions { display: flex; gap: 10px; margin-top: 8px; }
  .btn { display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500; cursor: pointer; border: none; transition: all .13s; }
  .btn-primary { background: #1a1a1a; color: white; }
  .btn-primary:hover:not(:disabled) { background: #333; }
  .btn-primary:disabled { opacity: .55; cursor: not-allowed; }
  .btn-ghost { background: #f5f4f1; color: #1a1a1a; }
  .btn-ghost:hover { background: #eeeceb; }
  .btn-sm { padding: 6px 12px; font-size: 12.5px; }
  .err-bar { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .ok-bar { background: #dcfce7; border: 1px solid #bbf7d0; color: #16a34a; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .spin { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: rot .65s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }
  .role-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; background: #eff6ff; color: #3b82f6; font-size: 12px; font-weight: 500; margin-right: 6px; margin-bottom: 4px; }
  .role-tag button { background: none; border: none; cursor: pointer; color: #93c5fd; display: flex; align-items: center; padding: 0; }
  .role-tag button:hover { color: #dc2626; }
`;

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [email, setEmail] = useState("");
  const [currentRoles, setCurrentRoles] = useState<Role[]>([]);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [addRoleId, setAddRoleId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);

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
          setFetchingData(false);
          return;
        }
        setOrgId(oid);

        const [usersRes, rolesRes] = await Promise.all([
          apiFetch<{ data: any[] }>(`/organizations/${oid}/users`),
          apiFetch<{ data: Role[] }>(`/organizations/${oid}/roles`),
        ]);

        if (usersRes.success) {
          const u = usersRes.data.data.find((x: any) => x.id === id);
          if (u) {
            setName(u.full_name || "");
            setEmail(u.email);
            setStatus(u.status);
            setCurrentRoles(u.roles || []);
          } else {
            setError("User not found");
          }
        }
        if (rolesRes.success) {
          setAvailableRoles(
            rolesRes.data.data.filter((r: Role) => !r.is_system),
          );
        }
      } catch {
        setError("Failed to load data");
      } finally {
        setFetchingData(false);
      }
    })();
  }, [router, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, status }),
      });
      if (res.success) setSuccess("User updated successfully");
      else setError(res.error || "Update failed");
    } catch {
      setError("Update failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRole = async () => {
    if (!addRoleId) return;
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${id}/roles`, {
        method: "POST",
        body: JSON.stringify({ roleId: addRoleId }),
      });
      if (res.success) {
        const role = availableRoles.find((r) => r.id === addRoleId);
        if (role) setCurrentRoles((prev) => [...prev, role]);
        setAddRoleId("");
      } else {
        setError(res.error || "Failed to assign role");
      }
    } catch {
      setError("Failed to assign role");
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    try {
      const res = await apiFetch(
        `/organizations/${orgId}/users/${id}/roles/${roleId}`,
        { method: "DELETE" },
      );
      if (res.success)
        setCurrentRoles((prev) => prev.filter((r) => r.id !== roleId));
      else setError(res.error || "Failed to remove role");
    } catch {
      setError("Failed to remove role");
    }
  };

  const unassignedRoles = availableRoles.filter(
    (r) => !currentRoles.find((c) => c.id === r.id),
  );

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
        <div className="page-title">Edit User</div>
        <div className="page-subtitle" style={{ color: "#777" }}>
          {email}
        </div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {fetchingData ? (
          <div style={{ color: "#9a9a9a", fontSize: "13.5px" }}>Loading…</div>
        ) : (
          <>
            <div className="form-card">
              <div className="section-title">Profile</div>
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label>Full name</label>
                  <input
                    className="fi"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    className="fi select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
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
                    {loading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>

            {availableRoles.length > 0 && (
              <div className="form-card">
                <div className="section-title">Assigned Roles</div>
                <div style={{ marginBottom: "14px", minHeight: "28px" }}>
                  {currentRoles.length === 0 && (
                    <span style={{ color: "#bbb", fontSize: "13px" }}>
                      No roles assigned
                    </span>
                  )}
                  {currentRoles.map((r) => (
                    <span key={r.id} className="role-tag">
                      {r.name}
                      <button onClick={() => handleRemoveRole(r.id)}>
                        <svg
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          viewBox="0 0 24 24"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
                {unassignedRoles.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <select
                      className="fi select"
                      style={{ flex: 1 }}
                      value={addRoleId}
                      onChange={(e) => setAddRoleId(e.target.value)}
                    >
                      <option value="">Add a role…</option>
                      {unassignedRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      onClick={handleAssignRole}
                      disabled={!addRoleId}
                    >
                      Assign
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}