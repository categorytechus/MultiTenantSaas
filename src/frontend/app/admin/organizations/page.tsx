'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import './admin-organizations.css';

interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  subscription_tier: string;
  member_count: string;
  created_at: string;
}

export default function OrganizationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!openMenuRef.current) return;
      if (!openMenuRef.current.contains(e.target as Node)) setOpenMenuFor(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let selectedOrgId = '';
      try {
        const tokenData = localStorage.getItem('accessToken');
        if (tokenData) {
          const payload = JSON.parse(atob(tokenData.split('.')[1]));
          selectedOrgId = payload.org_id || '';
        }
      } catch {}
      const query = selectedOrgId ? `?orgId=${encodeURIComponent(selectedOrgId)}` : '';
      const res = await apiFetch<{ data: Org[] }>(`/admin/organizations${query}`);
      if (res.success) setOrgs(res.data.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/auth/signin'); return; }
    (async () => {
      const me = await apiFetch<{ data: { user_type: string } }>('/auth/me');
      if (!me.success || me.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
        return;
      }
      await load();
    })();
  }, [router, load]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete organization "${name}"? This action cannot be undone.`)) return;
    const res = await apiFetch(`/admin/organizations/${id}`, { method: 'DELETE' });
    if (res.success) setOrgs(prev => prev.filter(o => o.id !== id));
  };

  const filtered = orgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase()) ||
    (o.domain ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
            <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">Organizations</div>
            <div className="page-subtitle">{orgs.length} organization{orgs.length !== 1 ? 's' : ''} total</div>
          </div>
          <button className="btn btn-primary" onClick={() => router.push('/admin/organizations/create')}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Organization
          </button>
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
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Members</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(org => (
                  <tr key={org.id}>
                    <td style={{ fontWeight: 500 }}>{org.name}</td>
                    <td style={{ color: '#9a9a9a', fontFamily: 'monospace', fontSize: 12 }}>{org.slug}</td>
                    <td style={{ color: '#9a9a9a' }}>{org.domain || '—'}</td>
                    <td>
                      <span className={`badge badge-${org.status}`}>{org.status}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${org.subscription_tier}`}>{org.subscription_tier}</span>
                    </td>
                    <td>{org.member_count}</td>
                    <td style={{ color: '#9a9a9a', fontSize: 12 }}>
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="row-menu">
                        <button
                          className="kebab-btn"
                          onClick={() => setOpenMenuFor(openMenuFor === org.id ? null : org.id)}
                          aria-label="Actions"
                        >
                          <span className="kebab-ellipsis">&#8943;</span>
                        </button>
                        {openMenuFor === org.id && (
                          <div
                            className="kebab-dropdown"
                            ref={openMenuRef}
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              className="kebab-item"
                              onClick={() => { setOpenMenuFor(null); router.push(`/admin/organizations/${org.id}/edit`); }}
                            >
                              Edit
                            </button>
                            <button
                              className="kebab-item"
                              onClick={() => { setOpenMenuFor(null); router.push(`/admin/org-permissions/${org.id}`); }}
                            >
                              Permissions
                            </button>
                            <button
                              className="kebab-item kebab-danger"
                              onClick={() => { setOpenMenuFor(null); handleDelete(org.id, org.name); }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}