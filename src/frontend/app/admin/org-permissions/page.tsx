'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import './admin-org-permissions.css';

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
          // Fetch module counts for each org in parallel
          const orgsWithCounts = await Promise.all(
            res.data.data.map(async (o) => {
              try {
                const modRes = await apiFetch<{ data: { id: string; enabled: boolean }[] }>(`/admin/organizations/${o.id}/modules`);
                const enabledModuleCount = modRes.success
                  ? modRes.data.data.filter((m) => m.enabled).length
                  : 0;
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

        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="empty">No organizations found</div>
          ) : (
            <table>
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
                        <div style={{ fontWeight: 500 }}>{org.name}</div>
                        <div style={{ fontSize: 12, color: '#9a9a9a', fontFamily: 'monospace', marginTop: 2 }}>{org.slug}</div>
                      </td>
                      <td>
                        <span className={`badge badge-${org.status}`}>{org.status}</span>
                      </td>
                      <td>
                        <span className="perm-count">{org.enabledModuleCount} / {TOTAL_MODULES}</span>
                      </td>
                      <td>
                        <div className="progress-wrap">
                          <div className="progress-bar">
                            <div
                              className="progress-fill"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="progress-label">{pct}%</span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => router.push(`/admin/org-permissions/${org.id}`)}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
