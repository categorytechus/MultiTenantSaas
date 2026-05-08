"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Layout from "../../../../components/Layout";
import { apiFetch } from "../../../../src/lib/api";
import { assignableMemberRoles } from "../../../../src/lib/org-member-roles";

interface Role {
  id: string;
  name: string;
  is_system: boolean;
}

interface OrgUserListItem {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  user_type?: string;
  roles?: Role[];
}

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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);
  const [resettingPwd, setResettingPwd] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pwdCopied, setPwdCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) { router.push("/auth/signin"); return; }
    (async () => {
      try {
        const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
        const payload = JSON.parse(atob(token.split(".")[1]));
        const jwtRoles: string[] = payload.roles ?? [];
        const ut = meRes.data?.data?.user_type;
        if (!meRes.success || (ut !== "super_admin" && !jwtRoles.includes("org_admin"))) {
          router.push("/dashboard"); return;
        }
        setIsSuperAdmin(ut === "super_admin");
        const oid = payload.org_id;
        if (!oid) { setError("No org context"); setFetchingData(false); return; }
        setOrgId(oid);

        const [usersRes, rolesRes] = await Promise.all([
          apiFetch<{ data: OrgUserListItem[] }>(`/organizations/${oid}/users`),
          apiFetch<{ data: Role[] }>(`/organizations/${oid}/roles`),
        ]);

        if (usersRes.success) {
          const u = usersRes.data.data.find((x) => x.id === id);
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
          setAvailableRoles(assignableMemberRoles(rolesRes.data.data));
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
    setError(""); setSuccess(""); setLoading(true);
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, status }),
      });
      if (res.success) setSuccess("User updated successfully");
      else setError(res.error || "Update failed");
    } catch { setError("Update failed"); }
    finally { setLoading(false); }
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
      } else { setError(res.error || "Failed to assign role"); }
    } catch { setError("Failed to assign role"); }
  };

  const handleRemoveRole = async (roleId: string) => {
    try {
      const res = await apiFetch(`/organizations/${orgId}/users/${id}/roles/${roleId}`, { method: "DELETE" });
      if (res.success) setCurrentRoles((prev) => prev.filter((r) => r.id !== roleId));
      else setError(res.error || "Failed to remove role");
    } catch { setError("Failed to remove role"); }
  };

  const handleResetPassword = async () => {
    setResettingPwd(true); setError("");
    try {
      const res = await apiFetch<{ data?: { temp_password?: string } }>(
        `/organizations/${orgId}/users/${id}/reset-password`, { method: "POST" }
      );
      if (res.success && res.data?.data?.temp_password) {
        setTempPassword(res.data.data.temp_password);
      } else { setError(res.error || "Password reset failed"); }
    } catch { setError("Password reset failed"); }
    finally { setResettingPwd(false); }
  };

  const unassignedRoles = availableRoles.filter((r) => !currentRoles.find((c) => c.id === r.id));

  return (
    <Layout>
      <div className="page">
        <button
          className="flex items-center gap-1.5 text-[13px] text-[#9a9a9a] hover:text-[#1a1a1a] mb-5 transition-colors"
          onClick={() => router.push("/users")}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Users
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">Edit User</div>
            <div className="page-subtitle">{email}</div>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {fetchingData ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9a9a9a] py-8">
            <span className="w-4 h-4 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Profile card */}
            <div className="form-card">
              <div className="form-card-title">Profile</div>
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label className="field-lbl">Full name</label>
                  <input className="fi" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="field-lbl">Status</label>
                  <select className="fi" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button className="btn btn-ghost" type="button" onClick={() => router.push("/users")}>Cancel</button>
                  <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading && <span className="spin" />}
                    {loading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>

            {/* Roles card */}
            {availableRoles.length > 0 && (
              <div className="form-card">
                <div className="form-card-title">Assigned Roles</div>
                <div className="flex flex-wrap gap-2 mb-4 min-h-[28px]">
                  {currentRoles.length === 0 && (
                    <span className="text-[13px] text-[#bbb]">No roles assigned</span>
                  )}
                  {currentRoles.map((r) => (
                    <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#f3f4f6] text-[12px] font-medium text-[#374151]">
                      {r.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveRole(r.id)}
                        className="text-[#9ca3af] hover:text-[#374151] transition-colors"
                        aria-label={`Remove ${r.name}`}
                      >
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
                {unassignedRoles.length > 0 && (
                  <div className="flex gap-2 items-center">
                    <select
                      className="fi"
                      style={{ flex: 1 }}
                      value={addRoleId}
                      onChange={(e) => setAddRoleId(e.target.value)}
                    >
                      <option value="">Add a role…</option>
                      {unassignedRoles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <button className="btn btn-sm" type="button" onClick={handleAssignRole} disabled={!addRoleId}>
                      Assign
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Password reset card — super admin only */}
            {isSuperAdmin && (
              <div className="form-card">
                <div className="form-card-title">Password Reset</div>
                <div className="form-card-subtitle">Generate a temporary password for this user. Share it securely — they should change it after signing in.</div>
                {tempPassword ? (
                  <>
                    <div className="flex items-center border border-[#e5e5e5] rounded-lg overflow-hidden mb-3">
                      <div className="flex-1 px-3 py-2.5 font-mono text-[13px] text-[#1a1a1a] bg-[#f9f9f8] break-all">
                        {tempPassword}
                      </div>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(tempPassword); setPwdCopied(true); setTimeout(() => setPwdCopied(false), 2000); }}
                        className="px-4 py-2.5 border-l border-[#e5e5e5] text-[13px] font-medium text-[#555] hover:bg-[#f5f4f1] transition-colors whitespace-nowrap"
                      >
                        {pwdCopied ? "✓ Copied" : "Copy"}
                      </button>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setTempPassword(null)}>Done</button>
                  </>
                ) : (
                  <button className="btn" type="button" onClick={handleResetPassword} disabled={resettingPwd}>
                    {resettingPwd && <span className="spin" />}
                    {resettingPwd ? "Resetting…" : "Generate Temporary Password"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
