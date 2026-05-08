'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  enabledModuleCount: number;
}

const TOTAL_MODULES = 3;

export default function OrgPermissionsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      try {
        const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
        if (!me.success || me.data.data.user_type !== 'super_admin') {
          router.push('/dashboard');
          return;
        }
        let orgId = '';
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          orgId = payload.org_id || '';
        } catch {}
        const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
        const res = await apiFetch<{ data: { id: string; name: string; slug: string; status: string }[] }>(`/admin/organizations${query}`);
        if (res.success) {
          const orgsWithCounts = await Promise.all(
            res.data.data.map(async (o) => {
              try {
                const modRes = await apiFetch<{ data: { id: string; enabled: boolean }[] }>(`/admin/organizations/${o.id}/modules`);
                const enabledModuleCount = modRes.success ? modRes.data.data.filter((m) => m.enabled).length : 0;
                return { ...o, enabledModuleCount };
              } catch {
                return { ...o, enabledModuleCount: 0 };
              }
            })
          );
          setOrgs(orgsWithCounts);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const filtered = orgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Organization Permissions</div>
            <div className="page-subtitle">Control which modules are available to each organization and its users</div>
          </div>
        </div>

        <div className="mb-5">
          <input
            className="w-full max-w-sm px-3 py-2 text-[13px] border border-[#ebe9e6] rounded-lg bg-white outline-none focus:border-[#1a1a1a] transition-colors placeholder-[#9a9a9a]"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-[#9a9a9a] text-[13px]">
              <span className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">No organizations found</div>
          ) : (
            <div className="table-responsive-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Status</th>
                    <th>Modules Enabled</th>
                    <th>Coverage</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(org => {
                    const pct = TOTAL_MODULES > 0 ? Math.round((org.enabledModuleCount / TOTAL_MODULES) * 100) : 0;
                    return (
                      <tr key={org.id}>
                        <td>
                          <div className="font-medium text-[#1a1a1a]">{org.name}</div>
                          <div className="text-[12px] text-[#9a9a9a] font-mono mt-0.5">{org.slug}</div>
                        </td>
                        <td>
                          <span className={`badge badge-${org.status}`}>{org.status}</span>
                        </td>
                        <td>
                          <span className="text-[13px] font-semibold text-[#1a1a1a]">{org.enabledModuleCount}</span>
                          <span className="text-[12px] text-[#9a9a9a]"> / {TOTAL_MODULES}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-[#f0eeeb] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#1a1a1a] rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[12px] text-[#9a9a9a] w-8">{pct}%</span>
                          </div>
                        </td>
                        <td>
                          <button className="btn btn-sm" onClick={() => router.push(`/admin/org-permissions/${org.id}`)}>
                            Manage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
