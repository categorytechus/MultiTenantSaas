'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '../../../../components/Layout';
import { apiFetch } from '../../../../src/lib/api';

interface Module {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export default function OrgPermissionsDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  const [orgName, setOrgName] = useState('');
  const [modules, setModules] = useState<Module[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
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
          setModules(modRes.data.data);
          setEnabled(new Set(modRes.data.data.filter((m) => m.enabled).map((m) => m.id)));
        }
      } catch {
        if (!cancelled) setError('Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, router]);

  const toggle = (id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSuccess('');
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await apiFetch(`/admin/organizations/${orgId}/modules`, {
        method: 'PUT',
        body: JSON.stringify({ moduleIds: Array.from(enabled) }),
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
              Enable or disable feature modules for this organization. Org admins can configure sub-permissions within enabled modules.
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
            {modules.map((mod, i) => {
              const on = enabled.has(mod.id);
              return (
                <div
                  key={mod.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: i < modules.length - 1 ? '1px solid #f0eeeb' : 'none',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', marginBottom: 2 }}>
                      {mod.label}
                    </div>
                    <div style={{ fontSize: 12, color: '#9a9a9a', lineHeight: 1.5 }}>
                      {mod.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(mod.id)}
                    style={{
                      flexShrink: 0, marginLeft: 24,
                      width: 40, height: 24, borderRadius: 12,
                      background: on ? '#1a1a1a' : '#e5e5e5',
                      border: 'none', cursor: 'pointer',
                      position: 'relative', transition: 'background .15s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 2,
                      left: on ? 18 : 2,
                      width: 20, height: 20, borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                      transition: 'left .15s',
                    }} />
                    <span className="sr-only">{on ? 'Disable' : 'Enable'} {mod.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-3 justify-end mt-6">
          <button className="btn btn-ghost" onClick={() => router.push('/admin/org-permissions')}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving && <span className="spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Layout>
  );
}
