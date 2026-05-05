'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import './role-permissions.css';

interface PermissionItem {
  id: string;
  label: string;
  description: string;
  granted?: boolean;
}

interface PermissionModule {
  id: string;
  label: string;
  description: string;
  permissions: PermissionItem[];
  granted?: boolean;
}

type GetRolePermissionsResponse = {
  data: PermissionModule[];
  granted_permissions?: string[];
  is_system_org_admin?: boolean;
};

/** Column keys match permission id suffixes. Upload is not a column — documents merge Create + Upload. */
const MATRIX_ACTIONS = ['create', 'view', 'update', 'delete'] as const;

const ACTION_HEADER_TITLE: Record<(typeof MATRIX_ACTIONS)[number], string> = {
  create:
    'Documents: create new entries and upload files (both permissions stay in sync). Web URLs: add new URLs.',
  view: 'View existing content',
  update: 'Edit or change existing content',
  delete: 'Remove content',
};

const MODULE_SORT_ORDER = ['documents', 'web_urls', 'ai_assistant'];

function formatRoleTitle(name: string) {
  if (name === 'org_admin') return 'Organization Admin';
  return name.replace(/_/g, ' ');
}

function actionSlugFromPermId(permId: string): string | null {
  const i = permId.indexOf(':');
  if (i === -1) return null;
  return permId.slice(i + 1).toLowerCase();
}

function permIdForAction(module: PermissionModule, action: string): string | undefined {
  const a = action.toLowerCase();
  return module.permissions.find((p) => actionSlugFromPermId(p.id) === a)?.id;
}

/** Documents: single UI control for create + upload (backend still stores two ids). */
function documentsCreateUploadIds(module: PermissionModule): string[] {
  const c = permIdForAction(module, 'create');
  const u = permIdForAction(module, 'upload');
  return [c, u].filter(Boolean) as string[];
}

/** If either documents create or upload is granted, persist both (keeps them aligned). */
function alignDocumentCreateUploadForSave(
  permissionIds: string[],
  modules: PermissionModule[],
): string[] {
  const doc = modules.find((m) => m.id === 'documents');
  if (!doc) return permissionIds;
  const c = permIdForAction(doc, 'create');
  const u = permIdForAction(doc, 'upload');
  if (!c || !u) return permissionIds;
  const set = new Set(permissionIds);
  if (set.has(c) || set.has(u)) {
    set.add(c);
    set.add(u);
  } else {
    set.delete(c);
    set.delete(u);
  }
  return Array.from(set);
}

function sortModules(mods: PermissionModule[]): PermissionModule[] {
  return [...mods].sort(
    (x, y) =>
      MODULE_SORT_ORDER.indexOf(x.id) - MODULE_SORT_ORDER.indexOf(y.id) ||
      x.label.localeCompare(y.label),
  );
}

function PermissionMatrixTable({
  modules,
  enabledSubPerms,
  isSystemOrgAdmin,
  readOnly,
  onToggle,
}: {
  modules: PermissionModule[];
  enabledSubPerms: Set<string>;
  isSystemOrgAdmin: boolean;
  readOnly: boolean;
  onToggle: (permId: string | string[]) => void;
}) {
  const sorted = useMemo(() => sortModules(modules), [modules]);

  return (
    <div className="perm-matrix-wrap">
      <table className="perm-matrix">
        <thead>
          <tr>
            <th scope="col">Module</th>
            {MATRIX_ACTIONS.map((action) => (
              <th key={action} scope="col" title={ACTION_HEADER_TITLE[action]}>
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((module) => {
            if (module.id === 'ai_assistant') {
              const chatPerm =
                module.permissions.find(
                  (p) =>
                    actionSlugFromPermId(p.id) === 'chat' ||
                    p.label.toLowerCase() === 'chat',
                ) ?? module.permissions[0];
              if (!chatPerm) return null;
              const checked = isSystemOrgAdmin || enabledSubPerms.has(chatPerm.id);
              return (
                <tr key={module.id}>
                  <td>{module.label}</td>
                  <td colSpan={MATRIX_ACTIONS.length} className="perm-matrix-chat">
                    <label>
                      <input
                        type="checkbox"
                        className="perm-matrix-checkbox"
                        checked={checked}
                        disabled={readOnly || isSystemOrgAdmin}
                        onChange={() => onToggle(chatPerm.id)}
                        aria-label={`${module.label}: Chat`}
                      />
                      <span>Chat</span>
                    </label>
                    <span className="org-admin-flat-desc" style={{ display: 'block', marginTop: 6 }}>
                      Use the AI assistant in your organization
                    </span>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={module.id}>
                <td>{module.label}</td>
                {MATRIX_ACTIONS.map((action) => {
                  if (module.id === 'documents' && action === 'create') {
                    const group = documentsCreateUploadIds(module);
                    if (group.length === 0) {
                      return (
                        <td key="documents-create">
                          <span className="perm-matrix-cell-dash" aria-hidden>
                            —
                          </span>
                        </td>
                      );
                    }
                    const checked =
                      isSystemOrgAdmin || group.some((pid) => enabledSubPerms.has(pid));
                    const titles = group
                      .map((pid) => module.permissions.find((p) => p.id === pid)?.description)
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <td key="documents-create-upload">
                        <input
                          type="checkbox"
                          className="perm-matrix-checkbox"
                          checked={checked}
                          disabled={readOnly || isSystemOrgAdmin}
                          onChange={() => onToggle(group)}
                          title={titles}
                          aria-label={`${module.label}: Create and upload`}
                        />
                      </td>
                    );
                  }

                  const permId = permIdForAction(module, action);
                  if (!permId) {
                    return (
                      <td key={action}>
                        <span className="perm-matrix-cell-dash" aria-hidden>
                          —
                        </span>
                      </td>
                    );
                  }
                  const checked = isSystemOrgAdmin || enabledSubPerms.has(permId);
                  return (
                    <td key={permId}>
                      <input
                        type="checkbox"
                        className="perm-matrix-checkbox"
                        checked={checked}
                        disabled={readOnly || isSystemOrgAdmin}
                        onChange={() => onToggle(permId)}
                        title={module.permissions.find((p) => p.id === permId)?.description}
                        aria-label={`${module.label}: ${action}`}
                      />
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

export default function RolePermissionsPage() {
  const { id: roleId } = useParams<{ id: string }>();
  const router = useRouter();
  const [roleName, setRoleName] = useState('');
  const [modules, setModules] = useState<PermissionModule[]>([]);
  const [orgModuleIds, setOrgModuleIds] = useState<Set<string>>(new Set());
  const [enabledSubPerms, setEnabledSubPerms] = useState<Set<string>>(new Set());
  const [orgId, setOrgId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSystemOrgAdmin, setIsSystemOrgAdmin] = useState(false);
  const [isSystemBaseRole, setIsSystemBaseRole] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/auth/signin');
      return;
    }

    (async () => {
      try {
        const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!me.success) {
          router.push('/auth/signin');
          return;
        }
        const payload = JSON.parse(atob(token.split('.')[1]));
        const jwtRoles: string[] = payload.roles ?? [];
        if (me.data.data.user_type !== 'super_admin' && !jwtRoles.includes('org_admin')) {
          router.push('/dashboard');
          return;
        }

        const oid = payload.org_id || '';
        setOrgId(oid);

        if (oid) {
          const rolesRes = await apiFetch<{ data: { id: string; name: string; is_system: boolean }[] }>(
            `/organizations/${oid}/roles`,
          );
          if (rolesRes.success) {
            const role = rolesRes.data.data.find((r: { id: string }) => r.id === roleId);
            if (role) {
              setRoleName(role.name);
              setIsSystemBaseRole(
                role.is_system && (role.name === 'org_admin' || role.name === 'user'),
              );
            }
          }

          const modRes = await apiFetch<GetRolePermissionsResponse>(
            `/organizations/${oid}/roles/${roleId}/permissions`,
          );

          if (modRes.success) {
            const body = modRes.data;
            const mods = body.data ?? [];
            setIsSystemOrgAdmin(body.is_system_org_admin === true);
            setModules(mods);
            setOrgModuleIds(new Set(mods.map((m) => m.id)));
            const granted = new Set<string>();
            mods.forEach((m) =>
              m.permissions.forEach((p) => {
                if (p.granted) granted.add(p.id);
              }),
            );
            setEnabledSubPerms(granted);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [roleId, router]);

  const toggleSubPermission = (target: string | string[]) => {
    const ids = Array.isArray(target) ? target : [target];
    setEnabledSubPerms((prev) => {
      const next = new Set(prev);
      if (ids.length > 1) {
        const anyOn = ids.some((i) => next.has(i));
        if (anyOn) ids.forEach((i) => next.delete(i));
        else ids.forEach((i) => next.add(i));
      } else {
        const id = ids[0];
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!orgId || isSystemOrgAdmin) return;
    setSaving(true);
    try {
      const permissionIds = alignDocumentCreateUploadForSave(
        Array.from(enabledSubPerms),
        modules,
      );
      const res = await apiFetch(`/organizations/${orgId}/roles/${roleId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionIds }),
      });
      if (res.success) {
        setEnabledSubPerms(new Set(permissionIds));
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  const visibleModules = useMemo(
    () => modules.filter((module) => orgModuleIds.has(module.id)),
    [modules, orgModuleIds],
  );

  const hasMatrixRows = visibleModules.length > 0;

  if (loading) {
    return (
      <Layout>
        <div className="page">
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#9a9a9a' }}>Loading…</div>
        </div>
      </Layout>
    );
  }

  if (isSystemBaseRole) {
    return (
      <Layout>
        <div className="page">
          <button type="button" className="back-link" onClick={() => router.push('/roles')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Roles
          </button>

          <div className="page-header org-admin-perm-header">
            <div>
              <div className="page-title">
                {roleName ? `${formatRoleTitle(roleName)} — access` : 'System Role — access'}
              </div>
              <div className="page-subtitle">
                {isSystemOrgAdmin
                  ? 'This system role always has every feature in all modules assigned to your organization. Nothing needs to be configured here.'
                  : 'This is a system role. Permissions are shown in the matrix below (read-only).'}
              </div>
            </div>
          </div>

          <div className="info-banner org-admin-info">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {isSystemOrgAdmin ? (
              <>
                Super admins choose which <strong>modules</strong> your org can use (AI Assistant, Documents, Web
                URLs). Organization Admins automatically receive all capabilities within those modules.
              </>
            ) : (
              <>
                Super admins choose which <strong>modules</strong> your org can use. This system role uses the
                configured module matrix; editing is disabled.
              </>
            )}
          </div>

          {!hasMatrixRows ? (
            <div className="empty-state">
              <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>
                No modules assigned to this organization yet
              </div>
              <div style={{ fontSize: 13, color: '#9a9a9a' }}>
                Once a super admin enables modules for this org, the permission matrix will appear here.
              </div>
            </div>
          ) : (
            <section aria-label="Capabilities for this role">
              <PermissionMatrixTable
                modules={visibleModules}
                enabledSubPerms={enabledSubPerms}
                isSystemOrgAdmin={isSystemOrgAdmin}
                readOnly
                onToggle={() => {}}
              />
            </section>
          )}

          <div className="save-footer">
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/roles')}>
              Back to roles
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page">
        <button type="button" className="back-link" onClick={() => router.push('/roles')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Roles
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">
              {roleName ? `Permissions — ${formatRoleTitle(roleName)}` : 'Role Permissions'}
            </div>
            <div className="page-subtitle">
              For <strong>Documents</strong>, the Create checkbox grants both new records and file uploads.{' '}
              <strong>AI Assistant</strong> is only the Chat row. Other modules use the columns as shown. Hover
              headers for short hints.
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving && <span className="spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {saved && (
          <div className="ok-bar">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Role permissions updated successfully
          </div>
        )}

        <div className="info-banner">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Only modules enabled for your organization are shown. Check the actions this role may perform; save when
          done.
        </div>

        {!hasMatrixRows ? (
          <div className="empty-state">
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>No modules available</div>
            <div style={{ fontSize: 13, color: '#9a9a9a' }}>
              Your organization has no modules assigned yet. Contact your super admin to assign modules.
            </div>
          </div>
        ) : (
          <section aria-label="Role permissions matrix">
            <PermissionMatrixTable
              modules={visibleModules}
              enabledSubPerms={enabledSubPerms}
              isSystemOrgAdmin={isSystemOrgAdmin}
              readOnly={false}
              onToggle={toggleSubPermission}
            />
          </section>
        )}

        {hasMatrixRows && (
          <div className="save-footer">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving && <span className="spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/roles')}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
