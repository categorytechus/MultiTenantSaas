"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { copyToClipboard } from "../../../../src/lib/clipboard";
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
  const searchParams = useSearchParams();
  const id = params?.id as string;

  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [email, setEmail] = useState("");
  const [currentRoles, setCurrentRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [orgId, setOrgId] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
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
        const isSA = ut === "super_admin";
        setIsSuperAdmin(isSA);
        setIsOrgAdmin(!isSA && jwtRoles.includes("org_admin"));
        const oid = payload.org_id || searchParams?.get("orgId") || "";
        if (!oid) { setError("No org context"); setFetchingData(false); return; }
        setOrgId(oid);

        const [usersRes, rolesRes] = await Promise.all([
          apiFetch<{ data: (OrgUserListItem & { org_role?: string })[] }>(`/organizations/${oid}/users`),
          apiFetch<{ data: Role[] }>(`/organizations/${oid}/roles`),
        ]);

        const assignable = rolesRes.success ? assignableMemberRoles(rolesRes.data.data) : [];
        setAvailableRoles(assignable);

        if (usersRes.success) {
          const u = usersRes.data.data.find((x) => x.id === id);
          if (u) {
            setName(u.full_name || "");
            setEmail(u.email);
            setStatus(u.status);

            // The server may return pseudo-roles like {id: "tenant_admin", name: "org_admin"}
            // for users who have only a membership role but no user_roles entry.
            // Always resolve to a real UUID from the assignable list.
            const rbacRoles = u.roles || [];
            let matchedRole: Role | null = null;

            // 1. UUID match — user has a real user_roles entry
            for (const r of rbacRoles) {
              const found = assignable.find((a) => a.id === r.id);
              if (found) { matchedRole = found; break; }
            }
            // 2. Name match — handles pseudo-role {id: "tenant_admin", name: "org_admin"}
            if (!matchedRole) {
              for (const r of rbacRoles) {
                const found = assignable.find((a) => a.name === r.name);
                if (found) { matchedRole = found; break; }
              }
            }
            // 3. Derive from org_role membership field
            if (!matchedRole) {
              const orgRoleToName: Record<string, string> = { tenant_admin: "org_admin" };
              const lookupName = orgRoleToName[u.org_role ?? ""] ?? u.org_role;
              matchedRole = lookupName ? (assignable.find((r) => r.name === lookupName) ?? null) : null;
            }

            if (matchedRole) {
              setCurrentRoles([matchedRole]);
              setSelectedRoleId(matchedRole.id);
            } else {
              setCurrentRoles([]);
              setSelectedRoleId("");
            }
          } else {
            setError("User not found");
          }
        }
      } catch {
        setError("Failed to load data");
      } finally {
        setFetchingData(false);
      }
    })();
  }, [router, id]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      const profileRes = await apiFetch(`/organizations/${orgId}/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, status }),
      });
      if (!profileRes.success) {
        setError(profileRes.error || "Update failed");
        return;
      }

      const previousRoleId = currentRoles[0]?.id ?? "";
      if (selectedRoleId !== previousRoleId) {
        for (const r of currentRoles) {
          await apiFetch(`/organizations/${orgId}/users/${id}/roles/${r.id}`, { method: "DELETE" });
        }
        if (selectedRoleId) {
          const assignRes = await apiFetch(`/organizations/${orgId}/users/${id}/roles`, {
            method: "POST",
            body: JSON.stringify({ roleId: selectedRoleId }),
          });
          if (!assignRes.success) {
            setError(assignRes.error || "Profile saved but role assignment failed");
            return;
          }
        }
        const newRole = availableRoles.find((r) => r.id === selectedRoleId) ?? null;
        setCurrentRoles(newRole ? [newRole] : []);
      }

      setSuccess("User updated successfully");
    } catch {
      setError("Update failed");
    } finally {
      setLoading(false);
    }
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
                {availableRoles.length > 0 && (
                  <div className="field">
                    <label className="field-lbl">
                      Role <span style={{ color: "#bbb", fontWeight: 400 }}>(optional)</span>
                    </label>
                    <select className="fi" value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)}>
                      <option value="">No role assigned</option>
                      {availableRoles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-3 justify-end mt-6">
                  <button className="btn btn-ghost" type="button" onClick={() => router.push("/users")}>Cancel</button>
                  <button className="btn btn-primary" type="submit" disabled={loading}>
                    {loading && <span className="spin" />}
                    {loading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>

            {(isSuperAdmin || isOrgAdmin) && (
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
                        onClick={() => { copyToClipboard(tempPassword); setPwdCopied(true); setTimeout(() => setPwdCopied(false), 2000); }}
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
