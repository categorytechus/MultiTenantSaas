'use client';

import { useState, useEffect, useRef } from 'react';
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

export default function OrgPermissionsDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [orgName, setOrgName] = useState('');
  const [modules, setModules] = useState<PermissionModule[]>([]);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/auth/signin');
      return;
    }
    let cancelled = false;
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      try {
        const orgsRes = await apiFetch<{ data: { id: string; name: string }[] }>('/admin/organizations');
        if (orgsRes.success && !cancelled) {
          const org = orgsRes.data.data.find((o: { id: string; name: string }) => o.id === orgId);
          if (org) setOrgName(org.name);
        }
        const modRes = await apiFetch<{
          data: (PermissionModule & { enabled: boolean })[];
        }>(`/admin/organizations/${orgId}/modules`);
        if (modRes.success && !cancelled) {
          setModules(modRes.data.data);
          const enabled = new Set(
            modRes.data.data.filter((m) => m.enabled).map((m) => m.id),
          );
          setEnabledModules(enabled);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, router]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [dropdownOpen]);

  const toggleModule = (id: string) => {
    setEnabledModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSaved(false);
  };

  const selectAllModules = () => {
    setEnabledModules(new Set(modules.map((m) => m.id)));
    setSaved(false);
  };

  const clearAllModules = () => {
    setEnabledModules(new Set());
    setSaved(false);
  };

  const removeChip = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModule(id);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/admin/organizations/${orgId}/modules`, {
        method: 'PUT',
        body: JSON.stringify({ moduleIds: Array.from(enabledModules) }),
      });
      if (res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = enabledModules.size;
  const totalCount = modules.length;
  const selectedList = modules.filter((m) => enabledModules.has(m.id));

  return (
    <Layout>
      <div className="page org-perm-detail-page">
        <button className="back-link" onClick={() => router.push('/admin/org-permissions')}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Organization Permissions
        </button>

        <div className="org-perm-hero">
          <div className="org-perm-hero-icon" aria-hidden>
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h10M4 18h16" />
            </svg>
          </div>
          <div className="org-perm-hero-text">
            <h1 className="page-title org-perm-hero-title">
              {orgName ? `Modules for ${orgName}` : 'Organization modules'}
            </h1>
            <p className="page-subtitle org-perm-hero-sub">
              Assign whole modules to this organization. Org admins can grant sub-permissions inside enabled modules only.
            </p>
          </div>
        </div>

        <div className="org-perm-toolbar">
          <span className="enabled-summary org-perm-count">
            <strong>{enabledCount}</strong> of <strong>{totalCount}</strong> modules enabled
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving && <span className="spin" />}
              {saving ? 'Saving…' : 'Save changes'}
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Use the multiselect below to toggle AI Assistant, Documents, Web URLs, and more in one place.
        </div>

        {loading ? (
          <div className="org-perm-skeleton" aria-busy="true">
            <div className="org-perm-skeleton-line" />
            <div className="org-perm-skeleton-line short" />
          </div>
        ) : (
          <div className="module-ms-card">
            <label className="module-ms-label" htmlFor="module-ms-trigger">
              Modules enabled for this organization
            </label>
            <div className="module-ms-wrap" ref={wrapRef}>
              <button
                id="module-ms-trigger"
                type="button"
                className="module-ms-trigger"
                aria-expanded={dropdownOpen}
                aria-haspopup="listbox"
                onClick={() => setDropdownOpen((o) => !o)}
              >
                <span className="module-ms-trigger-text">
                  {enabledCount === 0 ? (
                    <span className="module-ms-placeholder">Click to choose modules…</span>
                  ) : (
                    <span>
                      {enabledCount} module{enabledCount === 1 ? '' : 's'} selected
                      <span className="module-ms-trigger-hint"> — open list to add or remove</span>
                    </span>
                  )}
                </span>
                <span className={`module-ms-chevron ${dropdownOpen ? 'open' : ''}`} aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>

              {selectedList.length > 0 && (
                <div className="module-ms-chips-row" aria-label="Selected modules">
                  {selectedList.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="module-ms-chip"
                      onClick={(e) => removeChip(e, m.id)}
                      title={`Remove ${m.label}`}
                    >
                      <span>{m.label}</span>
                      <span className="module-ms-chip-x" aria-hidden>
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {dropdownOpen && (
                <div className="module-ms-panel" role="listbox" aria-multiselectable="true">
                  <div className="module-ms-panel-head">
                    <span className="module-ms-panel-title">Available modules</span>
                    <div className="module-ms-panel-actions">
                      <button type="button" className="module-ms-link-btn" onClick={selectAllModules}>
                        Select all
                      </button>
                      <span className="module-ms-dot">·</span>
                      <button type="button" className="module-ms-link-btn" onClick={clearAllModules}>
                        Clear all
                      </button>
                    </div>
                  </div>
                  <div className="module-ms-options">
                    {modules.map((module) => {
                      const checked = enabledModules.has(module.id);
                      return (
                        <label
                          key={module.id}
                          className={`module-ms-option ${checked ? 'selected' : ''}`}
                          role="option"
                          aria-selected={checked}
                        >
                          <input
                            type="checkbox"
                            className="module-ms-option-input"
                            checked={checked}
                            onChange={() => toggleModule(module.id)}
                          />
                          <span className="module-ms-check" aria-hidden>
                            {checked && (
                              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            )}
                          </span>
                          <span className="module-ms-option-body">
                            <span className="module-ms-opt-title">{module.label}</span>
                            <span className="module-ms-opt-desc">{module.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="save-footer">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving && <span className="spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => router.push('/admin/org-permissions')}
          >
            Cancel
          </button>
        </div>
      </div>
    </Layout>
  );
}
