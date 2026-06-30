'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import { Loader2, Plus, Pencil, Trash2, Check, X, ShieldAlert, RefreshCw } from 'lucide-react';

interface DueDiligenceRule {
  id: string;
  offering_category: string;
  offering_type: string;
  rule_key: string;
  rule_label: string;
  operator: string;
  threshold: number;
  unit: string;
  enabled: boolean;
}

const OPERATORS = [
  { value: 'lt', label: '< (Less than)' },
  { value: 'lte', label: '<= (Less than or equal)' },
  { value: 'gt', label: '> (Greater than)' },
  { value: 'gte', label: '>= (Greater than or equal)' },
  { value: 'eq', label: '= (Equal to)' },
];

const OPERATOR_MAP: Record<string, string> = {
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  eq: '=',
};

export default function DueDiligenceRulesAdminPage() {
  const router = useRouter();
  const [rules, setRules] = useState<DueDiligenceRule[]>([]);
  const [loading, setLoading] = useState(true);
  
  type SortField = 'rule_label' | 'operator' | 'offering_category' | 'enabled';
  const [sortField, setSortField] = useState<SortField>('rule_label');
  const [sortDesc, setSortDesc] = useState(false);
  
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<DueDiligenceRule | null>(null);
  
  const [form, setForm] = useState({
    offering_category: 'real_estate',
    offering_type: 'multifamily',
    rule_key: '',
    rule_label: '',
    operator: 'lt',
    threshold: 0,
    unit: '',
    enabled: true,
  });
  
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOrg, setHasOrg] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasModulePermission, setHasModulePermission] = useState(true);

  const [guidelines, setGuidelines] = useState("");
  const [originalGuidelines, setOriginalGuidelines] = useState("");
  const [guidelinesLoading, setGuidelinesLoading] = useState(false);
  const [guidelinesSaving, setGuidelinesSaving] = useState(false);
  const [guidelinesSaved, setGuidelinesSaved] = useState(false);
  const [guidelinesError, setGuidelinesError] = useState<string | null>(null);

  const loadGuidelines = useCallback(async () => {
    setGuidelinesLoading(true);
    const res = await apiFetch<{ data: { content: string } }>('/due-diligence-rules/guidelines');
    if (res.success && res.data?.data) {
      setGuidelines(res.data.data.content || "");
      setOriginalGuidelines(res.data.data.content || "");
    }
    setGuidelinesLoading(false);
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<DueDiligenceRule[]>('/due-diligence-rules');
    if (res.success) {
      setRules((res.data as any) || []);
      setHasModulePermission(true);
    } else {
      if ((res.error as any)?.includes?.('module is not enabled') || (res.error as any)?.message?.includes?.('module is not enabled')) {
        setHasModulePermission(false);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/auth/signin');
      return;
    }
    apiFetch<{ data: { user_type: string } }>('/auth/me').then(res => {
      if (!res.success || res.data.data.user_type !== 'super_admin') {
        router.push('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    });
    
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.org_id) {
        setHasOrg(false);
        setLoading(false);
      } else {
        setHasOrg(true);
        loadRules();
        loadGuidelines();
      }
    } catch {
      setHasOrg(false);
      setLoading(false);
    }
  }, [router, loadRules, loadGuidelines]);

  const handleGuidelinesSave = async () => {
    setGuidelinesSaving(true);
    setGuidelinesError(null);
    const res = await apiFetch('/due-diligence-rules/guidelines', {
      method: 'POST',
      body: JSON.stringify({ content: guidelines })
    });
    setGuidelinesSaving(false);
    if (!res.success) {
      setGuidelinesError(res.error || 'Failed to save guidelines');
    } else {
      setOriginalGuidelines(guidelines);
      setGuidelinesSaved(true);
      setTimeout(() => setGuidelinesSaved(false), 3000);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setGuidelines(event.target.result as string);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const openNew = () => {
    setEditingRule(null);
    setForm({
      offering_category: 'real_estate',
      offering_type: 'multifamily',
      rule_key: '',
      rule_label: '',
      operator: 'lt',
      threshold: 0,
      unit: '',
      enabled: true,
    });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (rule: DueDiligenceRule) => {
    setEditingRule(rule);
    setForm({
      offering_category: rule.offering_category,
      offering_type: rule.offering_type,
      rule_key: rule.rule_key,
      rule_label: rule.rule_label,
      operator: rule.operator,
      threshold: rule.threshold,
      unit: rule.unit || '',
      enabled: rule.enabled,
    });
    setError(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const isEdit = !!editingRule;
    const url = isEdit ? `/due-diligence-rules/${editingRule.id}` : '/due-diligence-rules';
    const method = isEdit ? 'PUT' : 'POST';

    const payload = isEdit 
      ? { 
          rule_label: form.rule_label,
          operator: form.operator,
          threshold: form.threshold,
          unit: form.unit || null,
          enabled: form.enabled,
        }
      : {
          offering_category: form.offering_category,
          offering_type: form.offering_type,
          rule_key: form.rule_key,
          rule_label: form.rule_label,
          operator: form.operator,
          threshold: form.threshold,
          unit: form.unit || null,
          enabled: form.enabled,
        };

    const res = await apiFetch<DueDiligenceRule>(url, {
      method,
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (res.success) {
      setShowModal(false);
      loadRules();
    } else {
      setError(res.error || 'Failed to save rule.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    setDeletingId(id);
    await apiFetch(`/due-diligence-rules/${id}`, { method: 'DELETE' });
    setDeletingId(null);
    loadRules();
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    const res = await apiFetch('/due-diligence-rules/seed-defaults', { method: 'POST' });
    setSeeding(false);
    if (res.success) {
      loadRules();
    } else {
      alert(res.error || 'Failed to seed default rules.');
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(false);
    }
  };

  const sortedRules = [...rules].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    
    if (aVal < bVal) return sortDesc ? 1 : -1;
    if (aVal > bVal) return sortDesc ? -1 : 1;
    return 0;
  });

  if (checkingAuth) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-20">
          <Loader2 size={30} className="animate-spin text-[#9ca3af]" />
        </div>
      </Layout>
    );
  }

  if (!hasModulePermission) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center p-20 max-w-lg mx-auto text-center">
          <ShieldAlert size={48} className="text-[#9ca3af] mb-4" />
          <h2 className="text-[18px] font-bold text-[#1a1a1a] mb-2">Module Disabled</h2>
          <p className="text-[13px] text-[#6b7280]">
            The Due Diligence module is not enabled for this organization. You cannot configure rules.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex-1 p-8 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                <ShieldAlert size={18} className="text-white" />
              </div>
              <h1 className="text-[22px] font-bold text-[#1a1a1a]">Due Diligence Rules</h1>
            </div>
            <p className="text-[13px] text-[#7a7a7a] ml-12">
              Configure pass/fail evaluation rules for AI market research reports.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSeedDefaults}
              disabled={seeding || loading}
              className="flex items-center gap-2 px-4 py-2 border border-[#e5e7eb] text-[#374151] rounded-lg text-[13px] font-medium hover:bg-[#f9f9f8] transition-colors disabled:opacity-50"
            >
              {seeding ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Seed Defaults
            </button>
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors"
            >
              <Plus size={15} />
              Add Rule
            </button>
          </div>
        </div>

        {!hasOrg ? (
          <div className="bg-white border border-[#e5e7eb] rounded-2xl p-16 text-center shadow-sm">
            <div className="w-16 h-16 bg-[#f3f4f6] rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldAlert size={32} className="text-[#9ca3af]" />
            </div>
            <h2 className="text-[18px] font-bold text-[#1a1a1a] mb-2">No Organization Selected</h2>
            <p className="text-[14px] text-[#6b7280] max-w-md mx-auto mb-6">
              Select an organization from the top right menu to view and manage its due diligence rules.
            </p>
          </div>
        ) : (
          <>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-[#f3f4f6] flex justify-between items-center bg-[#faf9f7]">
                <h2 className="text-[15px] font-bold text-[#1a1a1a]">
                  {editingRule ? 'Edit Rule' : 'New Rule'}
                </h2>
                <button onClick={() => setShowModal(false)} className="text-[#9ca3af] hover:text-[#1a1a1a]">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSave} className="p-6 space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 text-red-600 rounded-lg text-[13px] border border-red-200">
                    {error}
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Category</label>
                    <select
                      value={form.offering_category}
                      onChange={(e) => setForm({ ...form, offering_category: e.target.value })}
                      disabled={!!editingRule}
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white disabled:bg-[#f3f4f6]"
                    >
                      <option value="real_estate">Real Estate</option>
                      <option value="startup">Startup</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Type</label>
                    <select
                      value={form.offering_type}
                      onChange={(e) => setForm({ ...form, offering_type: e.target.value })}
                      disabled={!!editingRule}
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white disabled:bg-[#f3f4f6]"
                    >
                      {form.offering_category === 'real_estate' ? (
                        <option value="multifamily">Multifamily</option>
                      ) : (
                        <option value="early_stage">Early Stage</option>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Rule Key (Metric ID) *</label>
                  <input
                    type="text"
                    value={form.rule_key}
                    onChange={(e) => setForm({ ...form, rule_key: e.target.value })}
                    disabled={!!editingRule}
                    placeholder="e.g. crime_rate_pct"
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] disabled:bg-[#f3f4f6] font-mono"
                    required
                  />
                  <p className="text-[11px] text-[#9ca3af] mt-1">Machine-readable key used by AI agent. Cannot be changed.</p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Rule Label *</label>
                  <input
                    type="text"
                    value={form.rule_label}
                    onChange={(e) => setForm({ ...form, rule_label: e.target.value })}
                    placeholder="e.g. Crime Rate"
                    className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Operator</label>
                    <select
                      value={form.operator}
                      onChange={(e) => setForm({ ...form, operator: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white"
                    >
                      {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Threshold</label>
                    <input
                      type="number"
                      value={form.threshold}
                      onChange={(e) => setForm({ ...form, threshold: parseFloat(e.target.value) || 0 })}
                      step="any"
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Unit (Optional)</label>
                    <input
                      type="text"
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      placeholder="e.g. %, miles"
                      className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="ruleEnabled"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="ruleEnabled" className="text-[13px] font-medium text-[#1a1a1a]">
                    Rule is active
                  </label>
                </div>

                <div className="flex gap-3 pt-4 border-t border-[#f3f4f6]">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Save Rule
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
          </div>
        ) : rules.length === 0 ? (
          <div className="bg-white border border-[#e5e7eb] rounded-xl py-20 text-center">
            <ShieldAlert size={28} className="text-[#9ca3af] mx-auto mb-4" />
            <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-1">No rules configured</h3>
            <p className="text-[13px] text-[#9ca3af] mb-5 max-w-xs mx-auto">
              Add custom evaluation rules or seed defaults to get started.
            </p>
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-[13px] font-semibold hover:bg-indigo-100 transition-colors"
            >
              {seeding ? <Loader2 size={14} className="animate-spin" /> : null}
              Seed Default Rules
            </button>
          </div>
        ) : (
          <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-[#faf9f7] border-b border-[#e5e7eb]">
                <tr>
                  <th onClick={() => handleSort('rule_label')} className="px-5 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors">
                    Metric Label {sortField === 'rule_label' && (sortDesc ? '↓' : '↑')}
                  </th>
                  <th onClick={() => handleSort('operator')} className="px-5 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors">
                    Evaluation Logic {sortField === 'operator' && (sortDesc ? '↓' : '↑')}
                  </th>
                  <th onClick={() => handleSort('offering_category')} className="px-5 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors">
                    Category {sortField === 'offering_category' && (sortDesc ? '↓' : '↑')}
                  </th>
                  <th onClick={() => handleSort('enabled')} className="px-5 py-3 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors">
                    Status {sortField === 'enabled' && (sortDesc ? '↓' : '↑')}
                  </th>
                  <th className="px-5 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f4f6]">
                {sortedRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-[#fafafa] transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-[13px] font-bold text-[#1a1a1a]">{rule.rule_label}</div>
                      <div className="text-[11px] text-[#9ca3af] font-mono mt-0.5">{rule.rule_key}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 px-2 py-1 rounded text-[12px] font-mono font-semibold border border-blue-100">
                        <span>{OPERATOR_MAP[rule.operator] || rule.operator}</span>
                        <span>{rule.threshold}</span>
                        {rule.unit && <span className="opacity-70">{rule.unit}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-[12px] text-[#374151] capitalize">{rule.offering_category.replace('_', ' ')}</div>
                      <div className="text-[11px] text-[#9ca3af] capitalize">{rule.offering_type.replace('_', ' ')}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                        rule.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {rule.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(rule)}
                          className="p-1.5 rounded-lg text-[#9ca3af] hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          disabled={deletingId === rule.id}
                          className="p-1.5 rounded-lg text-[#9ca3af] hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {deletingId === rule.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
        
        {/* Global Market Research Guidelines */}
        <div className="mt-12 pt-10 border-t border-[#e5e7eb]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[18px] font-bold text-[#1a1a1a]">Global Market Research Guidelines</h2>
              <p className="text-[13px] text-[#7a7a7a]">
                These guidelines will be strictly followed by the AI during all due diligence market research.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 border border-[#e5e7eb] text-[#374151] rounded-lg text-[13px] font-medium hover:bg-[#f9f9f8] transition-colors cursor-pointer">
                Upload File
                <input
                  type="file"
                  accept=".txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
              <button
                onClick={handleGuidelinesSave}
                disabled={guidelinesSaving || guidelinesLoading || guidelines === originalGuidelines}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
              >
                {guidelinesSaving ? <Loader2 size={15} className="animate-spin" /> : guidelinesSaved ? <Check size={15} /> : null}
                {guidelinesSaved ? "Saved!" : (guidelines === originalGuidelines && !guidelinesSaving ? "No Changes" : "Save Guidelines")}
              </button>
            </div>
          </div>
          
          {guidelinesError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-[13px]">
              {guidelinesError}
            </div>
          )}
          
          <div className="relative">
            {guidelinesLoading && (
              <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10 rounded-lg">
                <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
              </div>
            )}
            <textarea
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder="Enter market research guidelines in text format..."
              className="w-full h-[400px] p-4 bg-white border border-[#e5e7eb] rounded-xl text-[13px] font-mono leading-relaxed outline-none focus:border-[#1a1a1a] resize-y shadow-sm"
              spellCheck={false}
            />
          </div>
        </div>

      </div>
    </Layout>
  );
}
