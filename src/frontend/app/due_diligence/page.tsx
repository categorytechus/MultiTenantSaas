'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';
import { PERMISSION_MODULE_ENABLED } from '../../src/lib/permissions';
import { Plus, Briefcase, ChevronRight, Trash2, Loader2, FileSearch } from 'lucide-react';

interface DueDiligenceStudy {
  id: string;
  title: string;
  offering_category: string;
  offering_type: string;
  status: string;
  created_at: string;
  updated_at: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#6b7280' },
  details_added: { label: 'Details Added', color: '#2563eb' },
  documents_uploaded: { label: 'Docs Uploaded', color: '#7c3aed' },
  analyzing: { label: 'Analyzing…', color: '#d97706' },
  analysis_complete: { label: 'Ready for Review', color: '#059669' },
  paid: { label: 'Paid', color: '#0891b2' },
  report_ready: { label: 'Report Ready', color: '#16a34a' },
};

const STEP_FOR_STATUS: Record<string, number> = {
  draft: 1,
  details_added: 2,
  documents_uploaded: 3,
  analyzing: 3,
  analysis_complete: 4,
  paid: 5,
  report_ready: 6,
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, color: '#6b7280' };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: meta.color + '18', color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DueDiligencePage() {
  const router = useRouter();
  const [studies, setStudies] = useState<DueDiligenceStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('real_estate');
  const [newType, setNewType] = useState('multifamily');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const CATEGORIES = [
    { value: 'real_estate', label: 'Real Estate' },
    { value: 'startup', label: 'Startup' },
  ];

  const TYPES: Record<string, { value: string; label: string }[]> = {
    real_estate: [{ value: 'multifamily', label: 'Multifamily' }],
    startup: [{ value: 'early_stage', label: 'Early Stage' }],
  };

  // Permission guard
  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem('userModulesUnrestricted');
    if (unrestricted) return;
    const raw = sessionStorage.getItem('userModules');
    if (raw) {
      try {
        const modules: string[] = JSON.parse(raw);
        if (!modules.includes('due_diligence')) router.replace('/dashboard');
      } catch { /* ignore */ }
    }
  }, [router]);

  const loadStudies = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ data: DueDiligenceStudy[] }>('/due-diligence/studies');
    if (res.success) {
      const list = (res.data as { data?: DueDiligenceStudy[] }).data ?? (res.data as unknown as DueDiligenceStudy[]);
      setStudies(Array.isArray(list) ? list : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadStudies(); }, [loadStudies]);

  // When category changes, auto-select first available type
  useEffect(() => {
    const types = TYPES[newCategory];
    if (types && types.length > 0) {
      setNewType(types[0].value);
    }
  }, [newCategory]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    const res = await apiFetch<{ data: DueDiligenceStudy }>('/due-diligence/studies', {
      method: 'POST',
      body: JSON.stringify({ 
        title: newTitle.trim(),
        offering_category: newCategory,
        offering_type: newType,
      }),
    });
    setCreating(false);
    if (res.success) {
      const created = (res.data as { data?: DueDiligenceStudy }).data ?? (res.data as unknown as DueDiligenceStudy);
      setShowNew(false);
      setNewTitle('');
      setNewCategory('real_estate');
      router.push(`/due_diligence/${created.id}`);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this due diligence study? This cannot be undone.')) return;
    setDeletingId(id);
    await apiFetch(`/due-diligence/studies/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    setStudies((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <Layout>
      <div className="flex-1 p-8 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <FileSearch size={18} className="text-white" />
              </div>
              <h1 className="text-[22px] font-bold text-[#1a1a1a]">Due Diligence</h1>
            </div>
            <p className="text-[13px] text-[#7a7a7a] ml-12">
              AI-powered investment due diligence analysis and report generation
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors"
          >
            <Plus size={15} />
            New Study
          </button>
        </div>

        {/* New study modal */}
        {showNew && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-[16px] font-bold text-[#1a1a1a] mb-4">New Due Diligence Study</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Study Title *</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Acme Corp Series A / 123 Main St Multifamily"
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] transition-colors"
                    autoFocus
                    required
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Offering Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] transition-colors bg-white"
                  >
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Offering Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] transition-colors bg-white"
                  >
                    {TYPES[newCategory]?.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowNew(false); setNewTitle(''); setNewCategory('real_estate'); }}
                    className="flex-1 px-4 py-2 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !newTitle.trim()}
                    className="flex-1 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {creating ? <Loader2 size={13} className="animate-spin" /> : null}
                    Create Study
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Studies list */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
          </div>
        ) : studies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#f3f4f6] flex items-center justify-center mb-4">
              <FileSearch size={28} className="text-[#9ca3af]" />
            </div>
            <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-1">No studies yet</h3>
            <p className="text-[13px] text-[#9ca3af] mb-5 max-w-xs">
              Create your first due diligence study to analyze investment opportunities.
            </p>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors"
            >
              <Plus size={14} />
              New Study
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {studies.map((study) => {
              const step = STEP_FOR_STATUS[study.status] ?? 1;
              return (
                <div
                  key={study.id}
                  onClick={() => router.push(`/due_diligence/${study.id}`)}
                  className="group flex items-center gap-4 p-4 bg-white border border-[#e5e7eb] rounded-xl hover:border-[#1a1a1a] hover:shadow-sm cursor-pointer transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center shrink-0">
                    <Briefcase size={18} className="text-blue-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="text-[14px] font-semibold text-[#1a1a1a] truncate">{study.title}</span>
                      <StatusBadge status={study.status} />
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-[#9ca3af]">
                      <span className="uppercase tracking-wider font-semibold text-[10px]">
                        {study.offering_type.replace('_', ' ')}
                      </span>
                      <span className="text-[#d1d5db]">·</span>
                      <span>Created {formatDate(study.created_at)}</span>
                      <span className="text-[#d1d5db]">·</span>
                      <span>Step {step} of 6</span>
                    </div>
                  </div>

                  {/* Step progress dots */}
                  <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                    {[1, 2, 3, 4, 5, 6].map((s) => (
                      <div
                        key={s}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          s <= step ? 'bg-blue-500' : 'bg-[#e5e7eb]'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => handleDelete(study.id, e)}
                      disabled={deletingId === study.id}
                      className="p-1.5 rounded text-[#9ca3af] hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      {deletingId === study.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />}
                    </button>
                    <ChevronRight size={16} className="text-[#d1d5db] group-hover:text-[#6b7280] transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
