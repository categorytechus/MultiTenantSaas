'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';

interface Module {
  id: string;
  label: string;
  description: string;
  parent_id?: string | null;
  sort_order?: number;
  enabled: boolean;
}

function Toggle({ on, disabled, onToggle, label }: { on: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      style={{
        flexShrink: 0,
        marginLeft: 20,
        width: 36,
        height: 22,
        borderRadius: 11,
        background: on ? '#1a1a1a' : '#e5e5e5',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background .15s',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 18, height: 18, borderRadius: '50%', background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
      <span className="sr-only">{on ? 'Disable' : 'Enable'} {label}</span>
    </button>
  );
}

export default function OrgPermissionsDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  const [orgName, setOrgName] = useState('');
  const [modules, setModules] = useState<Module[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!me.success || me.data.data.user_type !== 'super_admin') {
          router.push('/dashboard'); return;
        }
        const [orgsRes, modRes] = await Promise.all([
          apiFetch<{ data: { id: string; name: string }[] }>('/admin/organizations'),
          apiFetch<{ data: Module[] }>(`/admin/organizations/${orgId}/modules`),
        ]);
        if (cancelled) return;
        if (orgsRes.success) {
          const org = orgsRes.data.data.find((o) => o.id === orgId);
          if (org) setOrgName(org.name);
        }
        if (modRes.success) {
          const list = modRes.data.data;
          setModules(list);
          setEnabled(new Set(list.filter((m) => m.enabled).map((m) => m.id)));
          // Auto-expand all parent modules that have children
          const parentIds = new Set(
            list.filter(m => m.parent_id).map(m => m.parent_id as string)
          );
          setExpanded(parentIds);
        }
      } catch {
        if (!cancelled) setError('Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, router]);

  // Derive hierarchy dynamically from parent_id — no hardcoded constants
  const childrenOf = (parentId: string): Module[] =>
    modules
      .filter(m => m.parent_id === parentId)
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));

  const topLevel: Module[] = modules
    .filter(m => !m.parent_id)
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        childrenOf(id).forEach(c => next.delete(c.id));
      } else {
        next.add(id);
        const mod = modules.find(m => m.id === id);
        if (mod?.parent_id) next.add(mod.parent_id);
      }
      return next;
    });
    setSuccess('');
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await apiFetch(`/admin/organizations/${orgId}/modules`, {
        method: 'PUT',
        body: JSON.stringify({ 
          moduleIds: Array.from(enabled),
        }),
      });
      if (res.success) {
        setSuccess('Module access updated successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(res.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="page">
        <button
          className="flex items-center gap-1.5 text-[13px] text-[#9a9a9a] hover:text-[#1a1a1a] mb-5 transition-colors"
          onClick={() => router.push('/admin/org-permissions')}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Organization Permissions
        </button>

        <div className="page-header">
          <div>
            <div className="page-title">{orgName ? `Modules — ${orgName}` : 'Organization Modules'}</div>
            <div className="page-subtitle">
              Enable or disable feature modules. Sub-capabilities are only active when their parent module is enabled.
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              {saving && <span className="spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {error && <div className="err-bar">{error}</div>}
        {success && <div className="ok-bar">{success}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-[#9a9a9a] text-[13px]">
            <span className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
            Loading…
          </div>
        ) : modules.length === 0 ? (
          <div className="card">
            <div className="empty">No modules configured for this organization.</div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {topLevel.map((mod, i) => {
              const on = enabled.has(mod.id);
              const children = childrenOf(mod.id);
              const isLast = i === topLevel.length - 1 && children.length === 0;

              return (
                <div key={mod.id}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: !isLast ? '1px solid #f0eeeb' : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', marginBottom: 2 }}>{mod.label}</div>
                      <div style={{ fontSize: 12, color: '#9a9a9a', lineHeight: 1.5 }}>{mod.description}</div>
                    </div>
                    <Toggle on={on} onToggle={() => toggle(mod.id)} label={mod.label} />
                  </div>
                  

                  {children.length > 0 && (() => {
                    const isOpen = expanded.has(mod.id);
                    return (
                      <div style={{
                        background: '#f9f8f6',
                        borderBottom: i < topLevel.length - 1 ? '1px solid #f0eeeb' : 'none',
                      }}>
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => {
                            const next = new Set(prev);
                            if (next.has(mod.id)) next.delete(mod.id); else next.add(mod.id);
                            return next;
                          })}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', padding: '7px 20px', background: 'none', border: 'none', cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#b0aaa0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            Extended Capabilities
                          </span>
                          <svg width="12" height="12" fill="none" stroke="#b0aaa0" strokeWidth="2.5" viewBox="0 0 24 24"
                            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>

                        {isOpen && children.map((child, ci) => (
                          <div
                            key={child.id}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '11px 20px 11px 36px', borderTop: '1px solid #f0eeeb',
                              opacity: !on ? 0.45 : 1, transition: 'opacity .15s', position: 'relative',
                            }}
                          >
                            <span style={{ position: 'absolute', left: 20, top: ci === 0 ? '50%' : 0, bottom: ci === children.length - 1 ? '50%' : 0, width: 1, background: '#d9d6d0' }} />
                            <span style={{ position: 'absolute', left: 20, top: '50%', width: 10, height: 1, background: '#d9d6d0' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', marginBottom: 1 }}>{child.label}</div>
                              <div style={{ fontSize: 11, color: '#9a9a9a', lineHeight: 1.5 }}>{child.description}</div>
                            </div>
                            <Toggle on={enabled.has(child.id)} disabled={!on} onToggle={() => toggle(child.id)} label={child.label} />
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
