"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import { apiFetch } from "../../src/lib/api";

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
}

interface PermissionItem {
  id: string;
  label: string;
  description?: string;
  granted?: boolean;
}

interface PermissionModule {
  id: string;
  label: string;
  description: string;
  permissions: PermissionItem[];
}

type RolePermsData = {
  modules: PermissionModule[];
  isSystemOrgAdmin: boolean;
};

function isSystemBaseRole(r: Role) {
  return r.is_system && (r.name === "org_admin" || r.name === "user");
}

function formatRoleTitle(name: string) {
  if (name === "org_admin") return "Organization Admin";
  return name.replace(/_/g, " ");
}

// Inline read-only permission matrix for the modal
const MATRIX_ACTIONS = ["create", "view", "update", "delete"] as const;

function actionSlug(permId: string) {
  const i = permId.indexOf(":");
  return i === -1 ? null : permId.slice(i + 1).toLowerCase();
}

function ReadOnlyMatrix({ modules, isSystemOrgAdmin }: { modules: PermissionModule[]; isSystemOrgAdmin: boolean }) {
  const sorted = useMemo(() => {
    const order = ["documents", "web_urls", "ai_assistant"];
    return [...modules].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.label.localeCompare(b.label),
    );
  }, [modules]);

  if (sorted.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "#9a9a9a", fontSize: 13 }}>
        No modules assigned to this organization yet.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#faf9f7" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", color: "#555", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #ebe9e6", minWidth: 140 }}>
              Module
            </th>
            {MATRIX_ACTIONS.map((a) => (
              <th key={a} style={{ textAlign: "center", padding: "10px 14px", color: "#555", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #ebe9e6" }}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((module) => {
            if (module.id === "ai_assistant") {
              const chatPerm = module.permissions.find((p) => actionSlug(p.id) === "chat" || p.label.toLowerCase() === "chat") ?? module.permissions[0];
              if (!chatPerm) return null;
              const checked = isSystemOrgAdmin || !!chatPerm.granted;
              return (
                <tr key={module.id} style={{ borderTop: "1px solid #f0eeeb" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500, color: "#1a1a1a" }}>{module.label}</td>
                  <td colSpan={MATRIX_ACTIONS.length} style={{ padding: "10px 14px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "default" }}>
                      <input type="checkbox" checked={checked} readOnly disabled style={{ width: 14, height: 14 }} />
                      <span>Chat</span>
                    </label>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={module.id} style={{ borderTop: "1px solid #f0eeeb" }}>
                <td style={{ padding: "10px 14px", fontWeight: 500, color: "#1a1a1a" }}>{module.label}</td>
                {MATRIX_ACTIONS.map((action) => {
                  if (module.id === "documents" && action === "create") {
                    const c = module.permissions.find((p) => actionSlug(p.id) === "create");
                    const u = module.permissions.find((p) => actionSlug(p.id) === "upload");
                    const checked = isSystemOrgAdmin || !!(c?.granted || u?.granted);
                    return (
                      <td key="doc-create" style={{ padding: "10px 14px", textAlign: "center" }}>
                        <input type="checkbox" checked={checked} readOnly disabled style={{ width: 14, height: 14 }} />
                      </td>
                    );
                  }
                  const perm = module.permissions.find((p) => actionSlug(p.id) === action);
                  if (!perm) return <td key={action} style={{ padding: "10px 14px", textAlign: "center", color: "#ccc" }}>—</td>;
                  const checked = isSystemOrgAdmin || !!perm.granted;
                  return (
                    <td key={perm.id} style={{ padding: "10px 14px", textAlign: "center" }}>
                      <input type="checkbox" checked={checked} readOnly disabled style={{ width: 14, height: 14 }} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  // View permissions modal state
  const [viewTarget, setViewTarget] = useState<Role | null>(null);
  const [viewPerms, setViewPerms] = useState<RolePermsData | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const guardAndFetch = useCallback(async () => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.push("/auth/signin");
      return;
    }
    try {
      const meRes = await apiFetch<{ data: { user_type: string } }>("/auth/me");
      const payload = JSON.parse(atob(token.split(".")[1]));
      const jwtRoles: string[] = payload.roles ?? [];
      if (
        !meRes.success ||
        (meRes.data.data.user_type !== "super_admin" &&
          !jwtRoles.includes("org_admin"))
      ) {
        router.push("/dashboard");
        return;
      }
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
    const run = () => {
      void guardAndFetch();
    };
    const timer = window.setTimeout(run, 0);
    return () => window.clearTimeout(timer);
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

  const openViewModal = async (r: Role) => {
    setViewTarget(r);
    setViewPerms(null);
    if (!orgId) return;
    setViewLoading(true);
    try {
      const res = await apiFetch<{ data: PermissionModule[]; is_system_org_admin?: boolean }>(
        `/organizations/${orgId}/roles/${r.id}/permissions`,
      );
      if (res.success) {
        setViewPerms({
          modules: res.data.data ?? [],
          isSystemOrgAdmin: res.data.is_system_org_admin === true,
        });
      }
    } catch {
      // ignore — modal will show empty state
    } finally {
      setViewLoading(false);
    }
  };

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Roles</div>
            <div className="page-subtitle">
              Define labels for your organization and assign module access per
              role. Users inherit permissions from their roles.
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
              <div className="table-responsive-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Type</th>
                    <th>Permissions</th>
                    <th>Actions</th>
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
                        {isSystemBaseRole(r) ? (
                          <span
                            className="perm-cell-na"
                            title={
                              r.name === "org_admin"
                                ? "Organization Admin has full access to all modules enabled for your org"
                                : "User is a system role with simplified permission view"
                            }
                          >
                            {r.name === "org_admin"
                              ? "Built-in full access"
                              : "Built-in role"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-permissions"
                            onClick={() =>
                              router.push(`/roles/${r.id}/permissions`)
                            }
                          >
                            Manage
                          </button>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          {/* Eye / view button for every role */}
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="View permissions"
                            style={{
                              background: "#f5f4f1",
                              color: "#555",
                              border: "none",
                              padding: "5px 8px",
                            }}
                            onClick={() => void openViewModal(r)}
                          >
                            <svg
                              width="15"
                              height="15"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          {!r.is_system && (
                            <>
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
                            </>
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

      {/* Delete confirm modal */}
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

      {/* View permissions modal */}
      {viewTarget && (
        <div className="modal-overlay" onClick={() => setViewTarget(null)}>
          <div
            className="modal"
            style={{ maxWidth: 620, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {formatRoleTitle(viewTarget.name)} — Permissions
            </div>

            <div className="modal-body" style={{ padding: 0 }}>
              {viewLoading ? (
                <div style={{ padding: "32px", textAlign: "center", color: "#9a9a9a", fontSize: 13 }}>
                  Loading…
                </div>
              ) : viewPerms?.isSystemOrgAdmin ? (
                <div style={{ padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, color: "#15803d" }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    This role has <strong style={{ marginLeft: 3 }}>full access</strong> to every module assigned to the organization.
                  </div>
                  {viewPerms.modules.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <ReadOnlyMatrix modules={viewPerms.modules} isSystemOrgAdmin />
                    </div>
                  )}
                </div>
              ) : (
                <ReadOnlyMatrix
                  modules={viewPerms?.modules ?? []}
                  isSystemOrgAdmin={false}
                />
              )}
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => setViewTarget(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
