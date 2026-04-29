"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Layout from "../../../../components/Layout";
import { apiFetch } from "../../../../src/lib/api";
import './users-id-edit.css';

interface Role {
  id: string;
  name: string;
  is_system: boolean;
}

interface UserWithRoles {
  id: string;
  email: string;
  full_name?: string;
  status: string;
  roles: Role[];
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
          apiFetch<{ data: UserWithRoles[] }>(`/organizations/${oid}/users`),
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