'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';
import './admin-org-permissions-detail.css';

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

// TODO (Phase 2): Replace with GET /admin/permissions/modules
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
const MOCK_ENABLED_MODULES: Record<string, string[]> = {
  '11111111-1111-1111-1111-111111111111': ['ai_assistant', 'documents', 'web_urls'],
  '22222222-2222-2222-2222-222222222222': ['ai_assistant', 'documents'],
  '33333333-3333-3333-3333-333333333333': ['ai_assistant'],
};

export default function OrgPermissionsDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [orgName, setOrgName] = useState('');
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      // Fetch org name
      // TODO (Phase 2): Also fetch real module assignments from GET /admin/organizations/:orgId/modules
      try {
        const res = await apiFetch<{ data: { id: string; name: string }[] }>('/admin/organizations');
        if (res.success) {
          const org = res.data.data.find((o: { id: string; name: string }) => o.id === orgId);
          if (org) setOrgName(org.name);
        }
      } catch {}
      setEnabledModules(new Set(MOCK_ENABLED_MODULES[orgId] ?? []));
    })();
  }, [orgId, router]);

  const toggleModule = (id: string) => {
    setEnabledModules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    // TODO (Phase 2): PUT /admin/organizations/:orgId/modules with { moduleIds: [...enabledModules] }
    await new Promise(r => setTimeout(r, 800));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const enabledCount = enabledModules.size;
  const totalCount = MODULES.length;

  return (
    <Layout>
      <div className="page">
        <button className="back-link" onClick={() => router.push('/admin/org-permissions')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Organization Permissions
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">
              {orgName ? `Modules — ${orgName}` : 'Organization Modules'}
            </div>
            <div className="page-subtitle">
              Super admins assign full modules to organizations. Org admins can then grant sub-permissions within assigned modules.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="enabled-summary">{enabledCount} / {totalCount} enabled</span>
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
            Module access updated successfully
          </div>
        )}

        <div className="info-banner">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Select module access for this organization. Org admins can later assign module-level or sub-permission access to individual users.
        </div>

        <div className="perm-groups">
          {MODULES.map(module => {
            const isEnabled = enabledModules.has(module.id);
            return (
              <div key={module.id} className="perm-group">
                <div className="perm-group-header">
                  <div className="perm-group-title">
                    <span className="resource-label">{module.label}</span>
                    <span className="group-count">Module access</span>
                  </div>
                  <input
                    type="checkbox"
                    className="perm-checkbox"
                    checked={isEnabled}
                    onChange={() => toggleModule(module.id)}
                    aria-label={`Toggle ${module.label} module`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="save-footer">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving && <span className="spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button className="btn btn-ghost" onClick={() => router.push('/admin/org-permissions')}>
            Cancel
          </button>
        </div>
      </div>
    </Layout>
  );
}
