'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import './user-permissions.css';

interface PermissionItem {
  id: string;
  label: string;
  description: string;
}

interface PermissionModule {
  id: string;
  label: string;
  description: string;
  permissions: PermissionItem[];
}

// TODO (Phase 2): Replace with GET /organizations/:orgId/modules
const MODULES: PermissionModule[] = [
  {
    id: 'ai_assistant',
    label: 'AI Assistant',
    description: 'AI assistant tools and chat capabilities.',
    permissions: [
      { id: 'ai_chat', label: 'Chat', description: 'Start and continue AI assistant chats' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Document library and document actions.',
    permissions: [
      { id: 'documents_view', label: 'View', description: 'View documents' },
      { id: 'documents_update', label: 'Update', description: 'Update document content and metadata' },
      { id: 'documents_delete', label: 'Delete', description: 'Delete documents' },
      { id: 'documents_upload', label: 'Upload', description: 'Upload new documents' },
    ],
  },
  {
    id: 'web_urls',
    label: 'Web URLs',
    description: 'Manage web URL records and sources.',
    permissions: [
      { id: 'web_urls_view', label: 'View', description: 'View web URLs' },
      { id: 'web_urls_create', label: 'Create', description: 'Create new web URLs' },
      { id: 'web_urls_update', label: 'Update', description: 'Update web URLs' },
      { id: 'web_urls_delete', label: 'Delete', description: 'Delete web URLs' },
    ],
  },
];

// TODO (Phase 2): Replace with GET /admin/organizations/:orgId/modules
const MOCK_ORG_ENABLED_MODULES: Record<string, string[]> = {
  '11111111-1111-1111-1111-111111111111': ['ai_assistant', 'documents', 'web_urls'],
  '22222222-2222-2222-2222-222222222222': ['ai_assistant', 'documents'],
  '33333333-3333-3333-3333-333333333333': ['ai_assistant'],
};

// TODO (Phase 2): Replace with GET /organizations/:orgId/users/:userId/permissions
const MOCK_USER_SUB_PERMISSIONS: Record<string, string[]> = {
  default: ['ai_chat', 'documents_view', 'documents_upload'],
};

export default function UserPermissionsPage() {
  const { id: userId } = useParams<{ id: string }>();
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [orgModuleIds, setOrgModuleIds] = useState<Set<string>>(new Set());
  const [userEnabledSubPerms, setUserEnabledSubPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      try {
        const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!me.success) { router.push('/auth/signin'); return; }
        const payload = JSON.parse(atob(token.split('.')[1]));
        const jwtRoles: string[] = payload.roles ?? [];
        if (me.data.data.user_type !== 'super_admin' && !jwtRoles.includes('org_admin')) { router.push('/dashboard'); return; }

        const oid = payload.org_id || '';

        // Load org users to get user name
        // TODO (Phase 2): Also fetch real user permissions from GET /organizations/:orgId/users/:userId/permissions
        if (oid) {
          const usersRes = await apiFetch<{ data: { id: string; full_name: string; email: string }[] }>(`/organizations/${oid}/users`);
          if (usersRes.success) {
            const u = usersRes.data.data.find((u: { id: string }) => u.id === userId);
            if (u) setUserName(u.full_name || u.email);
          }
        }

        const orgModules = MOCK_ORG_ENABLED_MODULES[oid] ?? Object.values(MOCK_ORG_ENABLED_MODULES)[0] ?? [];
        setOrgModuleIds(new Set(orgModules));
        setUserEnabledSubPerms(new Set(MOCK_USER_SUB_PERMISSIONS[userId] ?? MOCK_USER_SUB_PERMISSIONS['default']));
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, router]);

  const toggleSubPermission = (id: string) => {
    setUserEnabledSubPerms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const toggleModule = (module: PermissionModule) => {
    const ids = module.permissions.map(p => p.id);
    const allOn = ids.every(id => userEnabledSubPerms.has(id));
    setUserEnabledSubPerms(prev => {
      const next = new Set(prev);
      ids.forEach(id => allOn ? next.delete(id) : next.add(id));
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    // TODO (Phase 2): PUT /organizations/:orgId/users/:userId/permissions with { subPermissionIds: [...userEnabledSubPerms] }
    await new Promise(r => setTimeout(r, 800));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const visibleModules = MODULES.filter(module => orgModuleIds.has(module.id));

  const enabledModulesCount = visibleModules.filter(module =>
    module.permissions.every(perm => userEnabledSubPerms.has(perm.id))
  ).length;
  const availableModulesCount = visibleModules.length;

  if (loading) {
    return (
      <Layout>
        <div className="page">
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#9a9a9a' }}>Loading…</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page">
        <button className="back-link" onClick={() => router.push('/users')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Users
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">
              {userName ? `Permissions — ${userName}` : 'User Module Permissions'}
            </div>
            <div className="page-subtitle">
              Your organization has module access. Assign full modules or individual sub-permissions to this user.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="enabled-summary">{enabledModulesCount} / {availableModulesCount} modules fully granted</span>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving && <span className="spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {saved && (
          <div className="ok-bar">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            User permissions updated successfully
          </div>
        )}

        <div className="info-banner">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Org admins can grant either whole modules or specific sub-permissions. Selecting all sub-permissions grants whole module access.
        </div>

        {visibleModules.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>No modules available</div>
            <div style={{ fontSize: 13, color: '#9a9a9a' }}>Your organization has no modules assigned yet. Contact your super admin to assign modules.</div>
          </div>
        ) : (
          <div className="perm-groups">
            {visibleModules.map(module => {
              const allOn = module.permissions.every(p => userEnabledSubPerms.has(p.id));
              const someOn = module.permissions.some(p => userEnabledSubPerms.has(p.id));
              return (
                <div key={module.id} className="perm-group">
                  <div className="perm-group-header">
                    <div className="perm-group-title">
                      <span className="resource-label">{module.label}</span>
                      <span className="group-count">
                        {module.permissions.filter(p => userEnabledSubPerms.has(p.id)).length} / {module.permissions.length}
                      </span>
                    </div>
                    <button
                      className={`toggle-all-btn ${allOn ? 'active' : someOn ? 'partial' : ''}`}
                      onClick={() => toggleModule(module)}
                    >
                      {allOn ? 'Remove module' : 'Grant module'}
                    </button>
                  </div>
                  <div className="page-subtitle" style={{ margin: '10px 20px 0', maxWidth: 'none' }}>{module.description}</div>
                  <div className="perm-list">
                    {module.permissions.map(perm => (
                      <label key={perm.id} className={`perm-row ${userEnabledSubPerms.has(perm.id) ? 'checked' : ''}`}>
                        <input
                          type="checkbox"
                          className="perm-checkbox"
                          checked={userEnabledSubPerms.has(perm.id)}
                          onChange={() => toggleSubPermission(perm.id)}
                        />
                        <div className="perm-info">
                          <span className="perm-action">{perm.label}</span>
                          <span className="perm-desc">{perm.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {visibleModules.length > 0 && (
          <div className="save-footer">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving && <span className="spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button className="btn btn-ghost" onClick={() => router.push('/users')}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
