'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import {
  ChevronLeft, ChevronRight, Check, Upload, Loader2, Plus, Trash2,
  Pencil, X, AlertTriangle, Download, Building2, FileText,
  CreditCard, BarChart3, RefreshCw,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  study_date: string | null;
  status: string;
}

interface Property {
  property_name: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  property_type: string;
  acquisition_date: string | null;
  total_cost: number;
  land_value: number | null;
  building_value: number | null;
  improvement_cost: number | null;
  notes: string | null;
}

interface CostSegDoc {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  created_at: string;
}

interface LineItem {
  id: string;
  description: string;
  amount: number;
  category_id: string;
  category_label: string;
  recovery_period: number | null;
  bonus_eligible: boolean;
  year1_deduction: number | null;
  confidence: number | null;
  ai_notes: string | null;
  user_edited: boolean;
}

interface Category {
  id: string;
  label: string;
  recovery_period: number | null;
  bonus_eligible: boolean;
  depreciable: boolean | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Project Info', icon: Building2 },
  { id: 2, label: 'Property Details', icon: Building2 },
  { id: 3, label: 'Upload Docs', icon: Upload },
  { id: 4, label: 'Review Items', icon: BarChart3 },
  { id: 5, label: 'Payment', icon: CreditCard },
  { id: 6, label: 'Download Report', icon: Download },
];

const STATUS_TO_STEP: Record<string, number> = {
  draft: 1,
  property_added: 2,
  documents_uploaded: 3,
  analyzing: 3,
  analysis_complete: 4,
  paid: 5,
  report_ready: 6,
};

const PROPERTY_TYPES = [
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'medical', label: 'Medical / Healthcare' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'other', label: 'Other Commercial' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtBytes(n: number | null) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ConfidencePill({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: color + '18', color }}>
      {pct}%
    </span>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, idx) => {
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
              done ? 'bg-emerald-50 text-emerald-700' :
              active ? 'bg-[#1a1a1a] text-white' :
              'text-[#9ca3af]'
            }`}>
              {done ? (
                <Check size={12} className="text-emerald-600" />
              ) : (
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                  active ? 'border-white/40 text-white' : 'border-[#d1d5db] text-[#9ca3af]'
                }`}>{step.id}</span>
              )}
              <span className="hidden sm:block">{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`w-6 h-px mx-1 ${done ? 'bg-emerald-300' : 'bg-[#e5e7eb]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Project Info ───────────────────────────────────────────────────────

function Step1({
  project,
  onSave,
  saving,
}: {
  project: Project;
  onSave: (name: string, studyDate: string) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [studyDate, setStudyDate] = useState(project.study_date ?? '');

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Study Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[14px] outline-none focus:border-[#1a1a1a] transition-colors"
          placeholder="e.g. 123 Main St Office Building"
        />
      </div>
      <div>
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Study Date</label>
        <input
          type="date"
          value={studyDate}
          onChange={(e) => setStudyDate(e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[14px] outline-none focus:border-[#1a1a1a] transition-colors"
        />
        <p className="text-[11px] text-[#9ca3af] mt-1.5">Date the study is being prepared (used for bonus depreciation calculation)</p>
      </div>
      <div className="pt-2">
        <button
          onClick={() => onSave(name, studyDate)}
          disabled={saving || !name.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          Save & Continue
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Property Details ───────────────────────────────────────────────────

function Step2({
  initial,
  onSave,
  saving,
  onBack,
}: {
  initial: Partial<Property>;
  onSave: (data: Property) => Promise<void>;
  saving: boolean;
  onBack: () => void;
}) {
  const [form, setForm] = useState<Property>({
    property_name: initial.property_name ?? '',
    address: initial.address ?? '',
    city: initial.city ?? '',
    state: initial.state ?? '',
    zip_code: initial.zip_code ?? '',
    property_type: initial.property_type ?? 'office',
    acquisition_date: initial.acquisition_date ?? '',
    total_cost: initial.total_cost ?? 0,
    land_value: initial.land_value ?? null,
    building_value: initial.building_value ?? null,
    improvement_cost: initial.improvement_cost ?? null,
    notes: initial.notes ?? '',
  });

  const set = (k: keyof Property, v: string | number | null) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Property Name *</label>
          <input type="text" value={form.property_name} onChange={(e) => set('property_name', e.target.value)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
            placeholder="e.g. Sunrise Office Park" />
        </div>
        <div className="col-span-2">
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Street Address *</label>
          <input type="text" value={form.address} onChange={(e) => set('address', e.target.value)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
            placeholder="123 Main Street" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">City</label>
          <input type="text" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">State</label>
            <input type="text" value={form.state ?? ''} onChange={(e) => set('state', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
              maxLength={2} placeholder="TX" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">ZIP</label>
            <input type="text" value={form.zip_code ?? ''} onChange={(e) => set('zip_code', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Property Type *</label>
          <select value={form.property_type} onChange={(e) => set('property_type', e.target.value)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
            {PROPERTY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Acquisition / Placed-in-Service Date</label>
          <input type="date" value={form.acquisition_date ?? ''} onChange={(e) => set('acquisition_date', e.target.value || null)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
        </div>
      </div>

      <div className="border-t border-[#f3f4f6] pt-4">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Cost Basis</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Total Depreciable Cost *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.total_cost} onChange={(e) => set('total_cost', parseFloat(e.target.value) || 0)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                min="0" step="1000" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Land Value (excluded from depreciation)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.land_value ?? ''} onChange={(e) => set('land_value', e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                min="0" step="1000" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Building Value</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.building_value ?? ''} onChange={(e) => set('building_value', e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                min="0" step="1000" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Improvement / Renovation Cost</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.improvement_cost ?? ''} onChange={(e) => set('improvement_cost', e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                min="0" step="1000" placeholder="0" />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Notes</label>
        <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)}
          rows={3}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] resize-none"
          placeholder="Any additional context about this property..." />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.property_name.trim() || !form.address.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          Save & Continue
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Upload Documents ───────────────────────────────────────────────────

function Step3({
  projectId,
  docs,
  analyzing,
  onUpload,
  onDelete,
  onAnalyze,
  onBack,
}: {
  projectId: string;
  docs: CostSegDoc[];
  analyzing: boolean;
  onUpload: (files: FileList) => Promise<void>;
  onDelete: (docId: string) => Promise<void>;
  onAnalyze: () => Promise<void>;
  onBack: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    await onUpload(files);
    setUploading(false);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-[13px] text-[#6b7280]">
        Upload invoices, construction budgets, cost breakdowns, or receipts. Supported: PDF, DOCX, TXT, CSV.
        The AI will extract and classify line items automatically.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          await handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragOver ? 'border-[#1a1a1a] bg-[#f9f9f8]' : 'border-[#d1d5db] hover:border-[#9ca3af] hover:bg-[#fafafa]'
        }`}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx" className="hidden"
          onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
            <p className="text-[13px] text-[#6b7280]">Uploading…</p>
          </div>
        ) : (
          <>
            <Upload size={28} className="mx-auto mb-3 text-[#9ca3af]" />
            <p className="text-[13px] font-medium text-[#374151]">Drop files here or click to browse</p>
            <p className="text-[11px] text-[#9ca3af] mt-1">PDF, DOCX, TXT, CSV · Up to 50MB each</p>
          </>
        )}
      </div>

      {/* Uploaded docs */}
      {docs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[12px] font-semibold text-[#6b7280] uppercase tracking-wider">Uploaded Documents ({docs.length})</h3>
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 p-3 bg-[#f9f9f8] border border-[#e5e7eb] rounded-lg">
              <FileText size={16} className="text-[#6b7280] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#1a1a1a] truncate">{doc.filename}</div>
                <div className="text-[11px] text-[#9ca3af]">{fmtBytes(doc.size_bytes)}</div>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                doc.status === 'ready' ? 'bg-emerald-50 text-emerald-700' :
                doc.status === 'failed' ? 'bg-red-50 text-red-600' :
                'bg-yellow-50 text-yellow-700'
              }`}>
                {doc.status}
              </span>
              <button onClick={() => onDelete(doc.id)}
                className="p-1 rounded text-[#9ca3af] hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {analyzing && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-[13px] text-amber-800">
          <Loader2 size={16} className="animate-spin shrink-0" />
          <span>AI is analyzing your documents and extracting line items… This may take a minute.</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <button
          onClick={onAnalyze}
          disabled={docs.length === 0 || analyzing}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {analyzing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {analyzing ? 'Analyzing…' : 'Analyze Documents'}
          {!analyzing && <ChevronRight size={14} />}
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Review Line Items ──────────────────────────────────────────────────

function Step4({
  items,
  categories,
  onUpdate,
  onDelete,
  onAdd,
  onNext,
  onBack,
}: {
  items: LineItem[];
  categories: Category[];
  onUpdate: (id: string, data: Partial<LineItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (data: Pick<LineItem, 'description' | 'amount' | 'category_id'>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<LineItem>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ description: '', amount: '', category_id: 'building_39yr' });

  const totalCost = items.reduce((s, i) => s + i.amount, 0);
  const totalYear1 = items.reduce((s, i) => s + (i.year1_deduction ?? 0), 0);
  const savingsVs39yr = totalYear1 - totalCost * 0.0256;

  const startEdit = (item: LineItem) => {
    setEditingId(item.id);
    setEditBuf({ description: item.description, amount: item.amount, category_id: item.category_id });
  };

  const commitEdit = async (id: string) => {
    setSavingId(id);
    await onUpdate(id, editBuf);
    setSavingId(null);
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
  };

  const handleAdd = async () => {
    if (!newItem.description.trim() || !newItem.amount) return;
    await onAdd({
      description: newItem.description,
      amount: parseFloat(newItem.amount),
      category_id: newItem.category_id,
    });
    setNewItem({ description: '', amount: '', category_id: 'building_39yr' });
    setShowAdd(false);
  };

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Analyzed', value: fmt(totalCost), sub: `${items.length} line items` },
          { label: 'Year-1 Deductions', value: fmt(totalYear1), sub: 'with bonus depreciation (2026)' },
          { label: 'Accelerated Savings', value: fmt(Math.max(0, savingsVs39yr)), sub: 'vs. straight-line 39-year', green: true },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-[#e5e7eb] rounded-xl p-4">
            <div className="text-[11px] text-[#9ca3af] uppercase tracking-wider mb-1">{card.label}</div>
            <div className={`text-[20px] font-bold ${card.green ? 'text-emerald-600' : 'text-[#1a1a1a]'}`}>{card.value}</div>
            <div className="text-[11px] text-[#9ca3af] mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Items table */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f3f4f6]">
          <span className="text-[13px] font-semibold text-[#1a1a1a]">Line Items</span>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-[#6b7280] border border-[#e5e7eb] rounded-lg hover:bg-[#f9f9f8] transition-colors">
            <Plus size={12} /> Add Item
          </button>
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[#9ca3af]">
            No line items yet. Add items manually or re-run the analysis.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-[#f9f9f8]">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Description</th>
                <th className="text-left px-3 py-2.5 font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Category</th>
                <th className="text-right px-3 py-2.5 font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Amount</th>
                <th className="text-right px-3 py-2.5 font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Yr-1 Deduction</th>
                <th className="text-center px-3 py-2.5 font-semibold text-[#6b7280] uppercase tracking-wider text-[10px]">Conf.</th>
                <th className="px-3 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editingId === item.id;
                const isSaving = savingId === item.id;
                return (
                  <tr key={item.id} className="border-t border-[#f3f4f6] hover:bg-[#fafafa]">
                    <td className="px-4 py-2.5 max-w-[260px]">
                      {isEditing ? (
                        <input value={editBuf.description ?? ''} onChange={(e) => setEditBuf((b) => ({ ...b, description: e.target.value }))}
                          className="w-full px-2 py-1 border border-[#e5e7eb] rounded text-[12px] outline-none focus:border-[#1a1a1a]" />
                      ) : (
                        <div className="truncate text-[#1a1a1a]">
                          {item.description}
                          {item.user_edited && <span className="ml-1.5 text-[10px] text-violet-500 font-medium">[edited]</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <select value={editBuf.category_id ?? item.category_id}
                          onChange={(e) => setEditBuf((b) => ({ ...b, category_id: e.target.value }))}
                          className="w-full px-2 py-1 border border-[#e5e7eb] rounded text-[12px] outline-none focus:border-[#1a1a1a] bg-white">
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      ) : (
                        <span className="text-[#374151]">{item.category_label}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {isEditing ? (
                        <input type="number" value={editBuf.amount ?? item.amount}
                          onChange={(e) => setEditBuf((b) => ({ ...b, amount: parseFloat(e.target.value) || 0 }))}
                          className="w-28 px-2 py-1 border border-[#e5e7eb] rounded text-[12px] outline-none focus:border-[#1a1a1a] text-right" />
                      ) : (
                        <span className="text-[#1a1a1a]">{fmt(item.amount)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-700">
                      {item.year1_deduction !== null ? fmt(item.year1_deduction) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <ConfidencePill value={item.confidence} />
                    </td>
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={() => commitEdit(item.id)} disabled={isSaving}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors">
                            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 text-[#9ca3af] hover:bg-[#f3f4f6] rounded transition-colors">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                          <button onClick={() => startEdit(item)} className="p-1 text-[#9ca3af] hover:text-[#374151] hover:bg-[#f3f4f6] rounded transition-colors">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                            className="p-1 text-[#9ca3af] hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                            {deletingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#f9f9f8] border-t-2 border-[#e5e7eb]">
              <tr>
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-[#1a1a1a] text-[12px]">Totals</td>
                <td className="px-3 py-2.5 text-right font-bold font-mono text-[#1a1a1a]">{fmt(totalCost)}</td>
                <td className="px-3 py-2.5 text-right font-bold font-mono text-emerald-700">{fmt(totalYear1)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Add item modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-[15px] font-bold text-[#1a1a1a] mb-4">Add Line Item</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#6b7280] mb-1">Description *</label>
                <input type="text" value={newItem.description} onChange={(e) => setNewItem((n) => ({ ...n, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                  placeholder="e.g. HVAC Unit – Server Room" autoFocus />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#6b7280] mb-1">Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
                  <input type="number" value={newItem.amount} onChange={(e) => setNewItem((n) => ({ ...n, amount: e.target.value }))}
                    className="w-full pl-7 pr-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]"
                    min="0" step="100" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#6b7280] mb-1">Category *</label>
                <select value={newItem.category_id} onChange={(e) => setNewItem((n) => ({ ...n, category_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 px-4 py-2 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8]">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={!newItem.description.trim() || !newItem.amount}
                className="flex-1 px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] disabled:opacity-50">
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <button onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors">
          Continue to Payment <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Payment ────────────────────────────────────────────────────────────

function Step5({
  onPay,
  paying,
  onBack,
}: {
  onPay: () => Promise<void>;
  paying: boolean;
  onBack: () => void;
}) {
  return (
    <div className="max-w-md space-y-5">
      <div className="bg-white border border-[#e5e7eb] rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <CreditCard size={20} className="text-emerald-600" />
          </div>
          <div>
            <div className="text-[15px] font-bold text-[#1a1a1a]">Cost Segregation Report</div>
            <div className="text-[12px] text-[#9ca3af]">Professional tax study</div>
          </div>
        </div>

        <div className="space-y-2 mb-5">
          {[
            'Full MACRS classification analysis',
            'Year-1 depreciation schedule',
            'IRS-compliant HTML/PDF report',
            'Downloadable for your tax advisor',
          ].map((feat) => (
            <div key={feat} className="flex items-center gap-2.5 text-[13px] text-[#374151]">
              <Check size={14} className="text-emerald-500 shrink-0" />
              {feat}
            </div>
          ))}
        </div>

        <div className="border-t border-[#f3f4f6] pt-4 mb-5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[#6b7280]">Study fee</span>
            <span className="font-bold text-[#1a1a1a] text-[18px]">$999.00</span>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4 text-[12px] text-amber-800 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span><strong>Test Mode:</strong> Payment is bypassed for demonstration. Click below to continue without charging.</span>
        </div>

        <button
          onClick={onPay}
          disabled={paying}
          className="w-full py-3 bg-emerald-600 text-white rounded-xl text-[14px] font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {paying ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
          {paying ? 'Processing…' : 'Continue (Test Mode — Bypassed)'}
        </button>
      </div>

      <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
        <ChevronLeft size={14} /> Back
      </button>
    </div>
  );
}

// ── Step 6: Download Report ────────────────────────────────────────────────────

function Step6({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const res = await apiFetch<{ html: string; message: string }>(`/cost-seg/projects/${projectId}/report`, {
      method: 'POST',
    });
    setGenerating(false);
    if (res.success) {
      const htmlContent = (res.data as { html?: string; message?: string }).html ??
        (res.data as unknown as { html: string }).html;
      setHtml(htmlContent ?? null);
    } else {
      setError('Failed to generate report. Please try again.');
    }
  };

  const downloadHtml = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-segregation-report.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openPreview = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <div className="max-w-lg space-y-5">
      <div className="bg-white border border-[#e5e7eb] rounded-2xl p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
          <Download size={24} className="text-emerald-600" />
        </div>
        <h3 className="text-[16px] font-bold text-[#1a1a1a] mb-1">Your report is ready</h3>
        <p className="text-[13px] text-[#6b7280] mb-5">
          Generate your IRS MACRS cost segregation report. Download the HTML file to view, print, or share with your tax advisor.
        </p>

        {error && (
          <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!html ? (
          <button
            onClick={generate}
            disabled={generating}
            className="w-full py-3 bg-[#1a1a1a] text-white rounded-xl text-[13px] font-semibold hover:bg-[#333] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <BarChart3 size={15} />}
            {generating ? 'Generating Report…' : 'Generate Report'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[12px] text-emerald-800 flex items-center gap-2">
              <Check size={14} className="shrink-0" />
              Report generated successfully!
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={openPreview}
                className="py-2.5 border border-[#e5e7eb] rounded-xl text-[13px] font-medium text-[#374151] hover:bg-[#f9f9f8] transition-colors">
                Preview
              </button>
              <button onClick={downloadHtml}
                className="py-2.5 bg-[#1a1a1a] text-white rounded-xl text-[13px] font-semibold hover:bg-[#333] transition-colors flex items-center justify-center gap-2">
                <Download size={13} />
                Download HTML
              </button>
            </div>
            <button onClick={generate} disabled={generating}
              className="w-full py-2 text-[12px] text-[#9ca3af] hover:text-[#374151] transition-colors flex items-center justify-center gap-1.5">
              <RefreshCw size={11} /> Regenerate
            </button>
          </div>
        )}
      </div>

      <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
        <ChevronLeft size={14} /> Back
      </button>
    </div>
  );
}

// ── Main Wizard Page ───────────────────────────────────────────────────────────

export default function CostSegWizardPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [property, setProperty] = useState<Partial<Property>>({});
  const [docs, setDocs] = useState<CostSegDoc[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    const [projRes, propRes, docsRes, itemsRes, catsRes] = await Promise.all([
      apiFetch<{ data: Project }>(`/cost-seg/projects/${projectId}`),
      apiFetch<{ data: Property | null }>(`/cost-seg/projects/${projectId}/property`),
      apiFetch<{ data: CostSegDoc[] }>(`/cost-seg/projects/${projectId}/documents`),
      apiFetch<{ data: LineItem[] }>(`/cost-seg/projects/${projectId}/line-items`),
      apiFetch<{ data: Category[] }>('/cost-seg/categories'),
    ]);

    if (!projRes.success) { router.replace('/cost_segregation'); return; }

    const proj = (projRes.data as { data: Project }).data;
    setProject(proj);
    setCurrentStep(STATUS_TO_STEP[proj.status] ?? 1);
    setAnalyzing(proj.status === 'analyzing');

    if (propRes.success) {
      const pd = (propRes.data as { data: Property | null }).data;
      setProperty(pd ?? {});
    }
    if (docsRes.success) {
      setDocs((docsRes.data as { data: CostSegDoc[] }).data ?? []);
    }
    if (itemsRes.success) {
      setItems((itemsRes.data as { data: LineItem[] }).data ?? []);
    }
    if (catsRes.success) {
      setCategories((catsRes.data as { data: Category[] }).data ?? []);
    }
    setLoading(false);
  }, [projectId, router]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll while analyzing
  useEffect(() => {
    if (!analyzing) { if (pollRef.current) clearTimeout(pollRef.current); return; }
    const poll = async () => {
      const res = await apiFetch<{ data: Project }>(`/cost-seg/projects/${projectId}`);
      if (res.success) {
        const proj = (res.data as { data: Project }).data;
        if (proj.status !== 'analyzing') {
          setAnalyzing(false);
          await loadAll();
          return;
        }
      }
      pollRef.current = setTimeout(poll, 4000);
    };
    pollRef.current = setTimeout(poll, 4000);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [analyzing, projectId, loadAll]);

  // ── Step handlers ────────────────────────────────────────────────────────────

  const handleStep1Save = async (name: string, studyDate: string) => {
    setSaving(true);
    const res = await apiFetch<{ data: Project }>(`/cost-seg/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, study_date: studyDate || null }),
    });
    setSaving(false);
    if (res.success) {
      setProject((p) => p ? { ...p, name, study_date: studyDate || null } : p);
      setCurrentStep(2);
    }
  };

  const handleStep2Save = async (data: Property) => {
    setSaving(true);
    const res = await apiFetch<{ data: Property; project_status: string }>(
      `/cost-seg/projects/${projectId}/property`,
      { method: 'POST', body: JSON.stringify(data) }
    );
    setSaving(false);
    if (res.success) {
      setProperty(data);
      setProject((p) => p ? { ...p, status: (res.data as { project_status: string }).project_status ?? p.status } : p);
      setCurrentStep(3);
    }
  };

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/cost-seg/projects/${projectId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` },
        body: formData,
      });
      if (res.ok) {
        const json = await res.json() as { data: CostSegDoc };
        setDocs((prev) => [...prev, json.data]);
      }
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    await apiFetch(`/cost-seg/projects/${projectId}/documents/${docId}`, { method: 'DELETE' });
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleAnalyze = async () => {
    const res = await apiFetch(`/cost-seg/projects/${projectId}/analyze`, { method: 'POST' });
    if (res.success) {
      setAnalyzing(true);
      setProject((p) => p ? { ...p, status: 'analyzing' } : p);
    }
  };

  const handleUpdateItem = async (id: string, data: Partial<LineItem>) => {
    const res = await apiFetch<{ data: LineItem }>(`/cost-seg/projects/${projectId}/line-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (res.success) {
      const updated = (res.data as { data: LineItem }).data;
      setItems((prev) => prev.map((i) => i.id === id ? updated : i));
    }
  };

  const handleDeleteItem = async (id: string) => {
    await apiFetch(`/cost-seg/projects/${projectId}/line-items/${id}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleAddItem = async (data: Pick<LineItem, 'description' | 'amount' | 'category_id'>) => {
    const res = await apiFetch<{ data: LineItem }>(`/cost-seg/projects/${projectId}/line-items`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.success) {
      const newItem = (res.data as { data: LineItem }).data;
      setItems((prev) => [...prev, newItem]);
    }
  };

  const handlePay = async () => {
    setPaying(true);
    const res = await apiFetch(`/cost-seg/projects/${projectId}/payment`, { method: 'POST' });
    setPaying(false);
    if (res.success) {
      setProject((p) => p ? { ...p, status: 'paid' } : p);
      setCurrentStep(6);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
        </div>
      </Layout>
    );
  }

  if (!project) return null;

  const stepContent = () => {
    switch (currentStep) {
      case 1:
        return <Step1 project={project} onSave={handleStep1Save} saving={saving} />;
      case 2:
        return (
          <Step2
            initial={property}
            onSave={handleStep2Save}
            saving={saving}
            onBack={() => setCurrentStep(1)}
          />
        );
      case 3:
        return (
          <Step3
            projectId={projectId}
            docs={docs}
            analyzing={analyzing}
            onUpload={handleUpload}
            onDelete={handleDeleteDoc}
            onAnalyze={handleAnalyze}
            onBack={() => setCurrentStep(2)}
          />
        );
      case 4:
        return (
          <Step4
            items={items}
            categories={categories}
            onUpdate={handleUpdateItem}
            onDelete={handleDeleteItem}
            onAdd={handleAddItem}
            onNext={() => setCurrentStep(5)}
            onBack={() => setCurrentStep(3)}
          />
        );
      case 5:
        return <Step5 onPay={handlePay} paying={paying} onBack={() => setCurrentStep(4)} />;
      case 6:
        return <Step6 projectId={projectId} onBack={() => setCurrentStep(5)} />;
      default:
        return null;
    }
  };

  return (
    <Layout>
      <div className="flex-1 p-8 max-w-5xl mx-auto w-full">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/cost_segregation')}
            className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#374151] hover:bg-[#f3f4f6] transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-[#1a1a1a]">{project.name}</h1>
            <p className="text-[12px] text-[#9ca3af]">
              Step {currentStep} of 6
              {project.study_date && ` · Study date: ${project.study_date}`}
            </p>
          </div>
        </div>

        <StepBar current={currentStep} />

        <div className="bg-white border border-[#e5e7eb] rounded-2xl p-6">
          <div className="mb-5">
            <h2 className="text-[15px] font-bold text-[#1a1a1a] mb-0.5">
              {STEPS[currentStep - 1]?.label}
            </h2>
            {currentStep === 3 && analyzing && (
              <p className="text-[12px] text-amber-700 mt-1 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                AI analysis in progress — the page will update automatically when complete.
              </p>
            )}
            {currentStep === 4 && analyzing && (
              <p className="text-[12px] text-amber-700 mt-1 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Analysis still running… Showing items extracted so far.
              </p>
            )}
          </div>
          {stepContent()}
        </div>
      </div>
    </Layout>
  );
}
