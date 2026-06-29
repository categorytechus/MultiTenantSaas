'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Layout from '../../../components/Layout';
import { apiFetch } from '../../../src/lib/api';
import {
  ChevronLeft, ChevronRight, Check, Upload, Loader2, Trash2,
  Download, Briefcase, FileText, CreditCard, RefreshCw,
  FileSearch, HelpCircle
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DueDiligenceStudy {
  id: string;
  title: string;
  offering_category: string;
  offering_type: string;
  status: string;
}


interface Document {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  created_at: string;
}

interface RuleResult {
  rule_id: string;
  rule_name: string;
  description: string;
  evaluation: 'PASS' | 'FAIL' | 'REVIEW';
  reason: string;
}

interface Scorecard {
  results: RuleResult[];
  overall: 'PASS' | 'FAIL' | 'REVIEW';
  summary: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Study Info', icon: Briefcase },
  { id: 2, label: 'Deal Details', icon: Briefcase },
  { id: 3, label: 'Upload Docs', icon: Upload },
  { id: 4, label: 'Analysis & Scorecard', icon: FileSearch },
  { id: 5, label: 'Payment', icon: CreditCard },
  { id: 6, label: 'Download Report', icon: Download },
];

const STATUS_TO_STEP: Record<string, number> = {
  draft: 1,
  details_added: 3,
  documents_uploaded: 3,
  analyzing: 4,
  analysis_complete: 4,
  paid: 6,        // after payment, always show the report/download screen
  report_ready: 6,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(n: number | null) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-2">
      {STEPS.map((step, idx) => {
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all shrink-0 ${
              done ? 'bg-blue-50 text-blue-700' :
              active ? 'bg-[#1a1a1a] text-white' :
              'text-[#9ca3af]'
            }`}>
              {done ? (
                <Check size={12} className="text-blue-600" />
              ) : (
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                  active ? 'border-white/40 text-white' : 'border-[#d1d5db] text-[#9ca3af]'
                }`}>{step.id}</span>
              )}
              <span className="hidden sm:block">{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`w-4 sm:w-6 h-px mx-1 ${done ? 'bg-blue-300' : 'bg-[#e5e7eb]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Study Info ─────────────────────────────────────────────────────────

function Step1({
  study,
  onSave,
  saving,
}: {
  study: DueDiligenceStudy;
  onSave: (title: string) => Promise<void>;
  saving: boolean;
}) {
  const [title, setTitle] = useState(study.title);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-5">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Study Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[14px] outline-none focus:border-[#1a1a1a] transition-colors"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Offering Category & Type</label>
          <div className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[14px] bg-[#f9f9f8] text-[#6b7280]">
            <span className="capitalize">{study.offering_category.replace('_', ' ')}</span> &rarr;{" "}
            <span className="capitalize font-medium text-[#374151]">{study.offering_type.replace('_', ' ')}</span>
          </div>
          <p className="text-[11px] text-[#9ca3af] mt-1.5">Category and type cannot be changed after creation.</p>
        </div>
      </div>
      <div className="pt-2">
        <button
          onClick={() => onSave(title)}
          disabled={saving || !title.trim()}
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

// ── Step 2: Deal Details ───────────────────────────────────────────────────────

function Step2({
  category,
  initial,
  onSave,
  saving,
  onBack,
}: {
  category: string;
  initial: any;
  onSave: (data: any) => Promise<void>;
  saving: boolean;
  onBack: () => void;
}) {
  const [form, setForm] = useState<any>(initial || {});

  const set = (k: string, v: any) => {
    setForm((prev: any) => ({ ...prev, [k]: v }));
  };

  const handleSave = () => {
    onSave(form);
  };

  const renderRealEstate = () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Property Name / Deal Name</label>
        <input type="text" value={form.property_name || ''} onChange={(e) => set('property_name', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>
      
      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Property Address</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Street Address</label>
            <input type="text" value={form.address_street || ''} onChange={(e) => set('address_street', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">City</label>
            <input type="text" value={form.address_city || ''} onChange={(e) => set('address_city', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">State/Region/Province</label>
            <input type="text" value={form.address_state || ''} onChange={(e) => set('address_state', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Postal / Zip Code</label>
            <input type="text" value={form.address_zip || ''} onChange={(e) => set('address_zip', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Country</label>
            <input type="text" value={form.address_country || ''} onChange={(e) => set('address_country', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Property Type</label>
        <select value={form.property_type || ''} onChange={(e) => set('property_type', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="Multifamily">Multifamily</option>
          <option value="Self Storage">Self Storage</option>
          <option value="Industrial Flex">Industrial Flex</option>
          <option value="Medical Retail">Medical Retail</option>
          <option value="Consumer Retail">Consumer Retail</option>
          <option value="Office Space">Office Space</option>
          <option value="Hospitality">Hospitality</option>
        </select>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Investor Type</label>
        <select value={form.investor_type || ''} onChange={(e) => set('investor_type', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="506b">506b</option>
          <option value="506c">506c</option>
          <option value="Qualified">Qualified</option>
        </select>
      </div>

      <div className="col-span-2 sm:col-span-1 flex items-center mt-6">
        <input type="checkbox" id="historical_property" checked={form.historical_property || false} onChange={(e) => set('historical_property', e.target.checked)} className="mr-2 h-4 w-4 rounded border-[#e5e7eb]" />
        <label htmlFor="historical_property" className="text-[13px] text-[#4b5563]">Is Historical Property?</label>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Tax Depreciation (%)</label>
        <input type="number" value={form.tax_depreciation || ''} onChange={(e) => set('tax_depreciation', e.target.value ? parseFloat(e.target.value) : undefined)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" min="0" max="100" />
      </div>

      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Investor Returns</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">IRR</label>
            <input type="number" value={form.investor_returns_irr || ''} onChange={(e) => set('investor_returns_irr', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Equity Multiple</label>
            <input type="number" value={form.investor_returns_em || ''} onChange={(e) => set('investor_returns_em', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Cash on Cash</label>
            <input type="number" value={form.investor_returns_coc || ''} onChange={(e) => set('investor_returns_coc', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Preferred Return</label>
            <input type="number" value={form.investor_returns_pref || ''} onChange={(e) => set('investor_returns_pref', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
      </div>

      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Fund Manager Returns</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">IRR</label>
            <input type="number" value={form.fund_manager_returns_irr || ''} onChange={(e) => set('fund_manager_returns_irr', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Equity Multiple</label>
            <input type="number" value={form.fund_manager_returns_em || ''} onChange={(e) => set('fund_manager_returns_em', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Cash on Cash</label>
            <input type="number" value={form.fund_manager_returns_coc || ''} onChange={(e) => set('fund_manager_returns_coc', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Preferred Return</label>
            <input type="number" value={form.fund_manager_returns_pref || ''} onChange={(e) => set('fund_manager_returns_pref', e.target.value ? parseFloat(e.target.value) : undefined)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Deal Room Link</label>
        <input type="url" value={form.deal_room_link || ''} onChange={(e) => set('deal_room_link', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" placeholder="https://" />
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Close Date</label>
        <input type="date" value={form.close_date || ''} onChange={(e) => set('close_date', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Close Date</label>
        <input type="date" value={form.close_date || ''} onChange={(e) => set('close_date', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>

      <div className="col-span-2">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Additional Notes</label>
        <textarea value={form.additional_details || ''} onChange={(e) => set('additional_details', e.target.value)}
          rows={3} className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" placeholder="Enter any extra details or notes about the deal here..." />
      </div>
    </div>
  );

  const renderStartup = () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">First Name</label>
        <input type="text" value={form.first_name || ''} onChange={(e) => set('first_name', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Last Name</label>
        <input type="text" value={form.last_name || ''} onChange={(e) => set('last_name', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Email</label>
        <input type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Company Name</label>
        <input type="text" value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Website</label>
        <input type="url" value={form.website || ''} onChange={(e) => set('website', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" placeholder="https://" />
      </div>
      
      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Company Address</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Street Address</label>
            <input type="text" value={form.company_address_street || ''} onChange={(e) => set('company_address_street', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">City</label>
            <input type="text" value={form.company_address_city || ''} onChange={(e) => set('company_address_city', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">State/Region/Province</label>
            <input type="text" value={form.company_address_state || ''} onChange={(e) => set('company_address_state', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Postal / Zip Code</label>
            <input type="text" value={form.company_address_zip || ''} onChange={(e) => set('company_address_zip', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Country</label>
            <input type="text" value={form.company_address_country || ''} onChange={(e) => set('company_address_country', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Stage</label>
        <select value={form.stage || ''} onChange={(e) => set('stage', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="Pre-Seed">Pre-Seed</option>
          <option value="Seed">Seed</option>
          <option value="Series A">Series A</option>
          <option value="Series B">Series B</option>
          <option value="Series C+">Series C+</option>
        </select>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Business Model</label>
        <select value={form.business_model || ''} onChange={(e) => set('business_model', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="B2B">B2B</option>
          <option value="B2C">B2C</option>
          <option value="Marketplace">Marketplace</option>
          <option value="D2C">D2C</option>
          <option value="Saas">Saas</option>
        </select>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Industry</label>
        <select value={form.industry || ''} onChange={(e) => set('industry', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="Healthcare">Healthcare</option>
          <option value="Financial Services">Financial Services</option>
          <option value="AI Hardware">AI Hardware</option>
          <option value="AI/ML Software">AI/ML Software</option>
          <option value="Manufacturing">Manufacturing</option>
          <option value="Retail">Retail</option>
          <option value="Supply Chain & Logistic">Supply Chain & Logistic</option>
          <option value="Telecommunication">Telecommunication</option>
        </select>
      </div>

      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Capital (USD)</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Total Raise Target</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.total_raise_target || ''} onChange={(e) => set('total_raise_target', e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Target Valuation (Pre)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-[13px]">$</span>
              <input type="number" value={form.target_valuation_pre || ''} onChange={(e) => set('target_valuation_pre', e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full pl-7 pr-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
            </div>
          </div>
        </div>
      </div>
      
      <div className="col-span-2">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Deal Room Link</label>
        <input type="url" value={form.deal_room_link || ''} onChange={(e) => set('deal_room_link', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" placeholder="https://" />
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">VC Introductions</label>
        <select value={form.vc_introductions || ''} onChange={(e) => set('vc_introductions', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Customer Introductions</label>
        <select value={form.customer_introductions || ''} onChange={(e) => set('customer_introductions', e.target.value)}
          className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a] bg-white">
          <option value="">Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>

      <div className="border-t border-[#f3f4f6] pt-4 col-span-2">
        <h3 className="text-[12px] font-semibold text-[#6b7280] mb-3 uppercase tracking-wider">Internal Tags</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Deal Type</label>
            <input type="text" value={form.deal_type || ''} onChange={(e) => set('deal_type', e.target.value)}
              className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" />
          </div>
        </div>
      </div>

      <div className="col-span-2">
        <label className="block text-[12px] font-semibold text-[#6b7280] mb-1.5">Additional Notes</label>
        <textarea value={form.additional_details || ''} onChange={(e) => set('additional_details', e.target.value)}
          rows={3} className="w-full px-3 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] outline-none focus:border-[#1a1a1a]" placeholder="Enter any extra details or notes about the deal here..." />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {category === 'real_estate' ? renderRealEstate() : renderStartup()}

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
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
  studyId,
  docs,
  analyzing,
  onUpload,
  onDelete,
  onAnalyze,
  onBack,
}: {
  studyId: string;
  docs: Document[];
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
    try {
      await onUpload(files);
    } catch (e: any) {
      alert(`Error during upload: ${e.message || e}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-[#6b7280]">
        Upload pitch decks, term sheets, financial proformas, T12 rent rolls, or any other relevant documents for AI analysis.
      </p>

      <div className="grid grid-cols-2 gap-6">
        <div className="col-span-2 md:col-span-1 space-y-4">
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
            <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.csv,.xlsx,.pptx" className="hidden"
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
                <p className="text-[11px] text-[#9ca3af] mt-1">PDF, DOCX, XLSX, PPTX, TXT · Up to 50MB each</p>
              </>
            )}
          </div>

          {docs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[12px] font-semibold text-[#6b7280] uppercase tracking-wider">Uploaded ({docs.length})</h3>
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 p-3 bg-[#f9f9f8] border border-[#e5e7eb] rounded-lg">
                  <FileText size={16} className="text-[#6b7280] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#1a1a1a] truncate">{doc.filename}</div>
                    <div className="text-[11px] text-[#9ca3af]">{fmtBytes(doc.size_bytes)}</div>
                  </div>
                  <button onClick={() => onDelete(doc.id)}
                    className="p-1 rounded text-[#9ca3af] hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-2 md:col-span-1 flex flex-col gap-4">
          <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl shadow-sm space-y-3">
            <h4 className="text-[14px] font-bold text-blue-900">Ready for Analysis</h4>
            <p className="text-[12px] text-blue-800">
              Once you've uploaded all relevant documents, click the button below to start the AI analysis pipeline. The AI will perform market research, evaluate your rules, and prepare a comprehensive report.
            </p>
            {docs.length === 0 && (
              <p className="text-[12px] text-amber-700 font-medium">Please upload at least one document to proceed.</p>
            )}
            <button
              onClick={onAnalyze}
              disabled={analyzing || docs.length === 0}
              className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {analyzing ? 'Starting Analysis...' : 'Start AI Analysis'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Analysis & Scorecard ───────────────────────────────────────────────

function Step4({
  analyzing,
  scorecard,
  onNext,
}: {
  analyzing: boolean;
  scorecard: Scorecard | null;
  onNext: () => void;
}) {
  if (analyzing || !scorecard) {
    return (
      <div className="py-20 text-center space-y-4">
        <Loader2 size={32} className="mx-auto animate-spin text-blue-600" />
        <h3 className="text-[16px] font-bold text-[#1a1a1a]">AI is Analyzing the Deal</h3>
        <p className="text-[13px] text-[#6b7280] max-w-sm mx-auto">
          The AI agents are currently researching the market, evaluating the documents against your configured rules, and preparing the diligence report. This may take a few minutes.
        </p>
      </div>
    );
  }

  const overallColors = {
    PASS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    FAIL: 'bg-red-100 text-red-800 border-red-200',
    REVIEW: 'bg-amber-100 text-amber-800 border-amber-200',
  };

  return (
    <div className="space-y-6">
      <div className={`p-5 rounded-xl border ${overallColors[scorecard.overall]} flex items-start gap-4`}>
        <div className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center shrink-0">
          <FileSearch size={20} className="opacity-80" />
        </div>
        <div>
          <h3 className="text-[16px] font-bold">Overall Verdict: {scorecard.overall}</h3>
          <p className="text-[13px] mt-1 opacity-90">{scorecard.summary}</p>
        </div>
      </div>

      <div>
        <h3 className="text-[14px] font-bold text-[#1a1a1a] mb-3">Rule Evaluation Results</h3>
        <div className="space-y-3">
          {scorecard.results.map((r, i) => (
            <div key={i} className="bg-white border border-[#e5e7eb] rounded-xl p-4 flex gap-4">
              <div className="shrink-0 mt-0.5">
                {r.evaluation === 'PASS' && <Check size={18} className="text-emerald-600" />}
                {r.evaluation === 'FAIL' && <Trash2 size={18} className="text-red-600" />}
                {r.evaluation === 'REVIEW' && <HelpCircle size={18} className="text-amber-500" />}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-[14px] font-semibold text-[#1a1a1a]">{r.rule_name}</h4>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    r.evaluation === 'PASS' ? 'bg-emerald-100 text-emerald-700' :
                    r.evaluation === 'FAIL' ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>{r.evaluation}</span>
                </div>
                <p className="text-[12px] text-[#6b7280] mb-2">{r.description}</p>
                <div className="text-[13px] text-[#374151] p-3 bg-[#f9f9f8] rounded-lg border border-[#e5e7eb]">
                  {r.reason}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onNext}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1a1a1a] text-white rounded-lg text-[13px] font-medium hover:bg-[#333] transition-colors">
          Continue to Report <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Payment ────────────────────────────────────────────────────────────

function Step5({
  onPay,
  paying,
  canCheckout,
  onBack,
}: {
  onPay: () => Promise<void>;
  paying: boolean;
  canCheckout: boolean;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-6">
        <div className="col-span-2 md:col-span-1 bg-[#f9f9f8] border border-[#e5e7eb] rounded-2xl p-6 space-y-4">
          <h3 className="text-[14px] font-bold text-[#1a1a1a]">What's included</h3>
          <div className="space-y-3">
            {[
              ['Comprehensive Market Research', 'AI-driven data collection and competitive analysis'],
              ['Financial Proforma Evaluation', 'Stress-testing assumptions against current market data'],
              ['Rule Scorecard', 'Automated checks against your organization\'s investment criteria'],
              ['Detailed PDF Report', 'Presentation-ready findings for your investment committee'],
            ].map(([title, desc]) => (
              <div key={title} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={11} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[#1a1a1a]">{title}</p>
                  <p className="text-[11.5px] text-[#9ca3af]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 md:col-span-1 bg-white border border-[#e5e7eb] rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <CreditCard size={20} className="text-blue-600" />
              </div>
              <div>
                <div className="text-[15px] font-bold text-[#1a1a1a]">Due Diligence Report</div>
                <div className="text-[12px] text-[#9ca3af]">Unlock full access</div>
              </div>
            </div>
            <div className="border-t border-[#f3f4f6] py-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#6b7280]">Study fee</span>
                {!canCheckout ? (
                  <span className="font-medium text-[#1a1a1a] text-[14px]">Contact administrator</span>
                ) : (
                  <span className="font-medium text-[#1a1a1a] text-[14px]">Determined at checkout</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onPay}
            disabled={paying || !canCheckout}
            className="w-full py-3 bg-blue-600 text-white rounded-xl text-[14px] font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {paying ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
            {paying ? 'Processing…' : 'Pay with Stripe'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
      </div>
    </div>
  );
}

// ── Step 6: Download Report ────────────────────────────────────────────────────

export function Step6({
  studyId,
  onBack,
}: {
  studyId: string;
  onBack: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  
  const openPreview = () => {
    const token = localStorage.getItem('accessToken');
    window.open(`/api/due-diligence/studies/${studyId}/report/preview?token=${token ?? ''}`, '_blank');
  };

  const downloadHtml = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `due-diligence-report.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Enqueue job once (fallback for missing webhook) and poll for report
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const pollReport = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        const res = await fetch(`/api/due-diligence/studies/${studyId}/report`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        
        if (res.ok) {
          const data = await res.json();
          const htmlContent = data?.data?.html ?? data?.html;
          if (htmlContent) {
            setHtml(htmlContent);
            return; // Stop polling
          }
        } else if (res.status !== 404) {
          console.error("Failed to fetch existing report, status:", res.status);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
      
      // If we haven't stopped polling, check again in 5 seconds
      timeoutId = setTimeout(pollReport, 5000);
    };

    const triggerAndPoll = async () => {
      // Fire-and-forget the fallback POST /report to ensure job is enqueued
      const token = localStorage.getItem('accessToken');
      fetch(`/api/due-diligence/studies/${studyId}/report`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(err => console.error("Failed to trigger fallback generation:", err));

      pollReport();
    };

    triggerAndPoll();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [studyId]);

  return (
    <div className="space-y-5">
      <div className="max-w-2xl mx-auto text-center space-y-6 py-10">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FileText size={32} />
        </div>
        
        {html ? (
          <>
            <h2 className="text-[20px] font-bold text-[#1a1a1a]">Report is Ready</h2>
            <p className="text-[14px] text-[#6b7280]">
              The due diligence report has been compiled successfully. You can preview it in your browser or download the HTML.
            </p>
            <div className="flex justify-center gap-4">
              <button onClick={openPreview}
                className="px-6 py-3 bg-white border border-[#e5e7eb] rounded-xl text-[14px] font-medium text-[#374151] hover:bg-[#f9f9f8] transition-colors">
                Preview Report
              </button>
              <button onClick={downloadHtml}
                className="px-6 py-3 bg-[#1a1a1a] text-white rounded-xl text-[14px] font-semibold hover:bg-[#333] transition-colors flex items-center justify-center gap-2">
                <Download size={16} />
                Download HTML
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[20px] font-bold text-[#1a1a1a]">Generating Report...</h2>
            <p className="text-[14px] text-[#6b7280]">
              We are compiling your due diligence report in the background. This typically takes 30-60 seconds.
            </p>
            <div className="flex justify-center py-6">
              <Loader2 size={32} className="animate-spin text-blue-600" />
            </div>
          </>
        )}
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2.5 border border-[#e5e7eb] rounded-lg text-[13px] font-medium text-[#6b7280] hover:bg-[#f9f9f8] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
      </div>
    </div>
  );
}

// ── Main Wizard Page ───────────────────────────────────────────────────────────

export default function DueDiligenceWizardPage() {
  return (
    <Suspense fallback={<div />}>
      <DueDiligenceWizardContent />
    </Suspense>
  );
}

function DueDiligenceWizardContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const studyId = params.id as string;

  const [study, setStudy] = useState<DueDiligenceStudy | null>(null);
  const [details, setDetails] = useState<any>({});
  const [docs, setDocs] = useState<Document[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [canCheckout, setCanCheckout] = useState(true);

  const loadAll = useCallback(async () => {
    const [studyRes, docsRes] = await Promise.all([
      apiFetch<{ data: DueDiligenceStudy; details: any; can_checkout: boolean; scorecard: Scorecard | null }>(`/due-diligence/studies/${studyId}`),
      apiFetch<{ data: Document[] }>(`/due-diligence/studies/${studyId}/documents`),
    ]);

    if (!studyRes.success) { router.replace('/due_diligence'); return; }

    const data = studyRes.data as any;
    const st = data.data;
    setStudy(st);
    setDetails(data.details || {});
    setCanCheckout(data.can_checkout ?? true);
    setScorecard(data.scorecard || null);
    
    setCurrentStep(STATUS_TO_STEP[st.status] ?? 1);
    setAnalyzing(st.status === 'analyzing');

    if (docsRes.success) {
      setDocs((docsRes.data as any).data || []);
    }
    setLoading(false);
  }, [studyId, router]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Polling for analysis completion
  useEffect(() => {
    if (!analyzing) return;
    const interval = setInterval(async () => {
      const res = await apiFetch<{ data: DueDiligenceStudy }>(`/due-diligence/studies/${studyId}`);
      if (res.success) {
        const st = (res.data as any).data;
        if (st.status !== 'analyzing') {
          setAnalyzing(false);
          loadAll(); // reload to get scorecard and advanced status
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [analyzing, studyId, loadAll]);

  // Handle Payment success redirect
  useEffect(() => {
    if (searchParams.get('payment_success') === '1' && study?.status !== 'paid') {
      setCurrentStep(6);
      setStudy(s => s ? { ...s, status: 'paid' } : s);
    }
  }, [searchParams, study?.status]);


  const handleStep1Save = async (title: string) => {
    setSaving(true);
    const res = await apiFetch(`/due-diligence/studies/${studyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    setSaving(false);
    if (res.success) {
      setStudy(s => s ? { ...s, title } : s);
      setCurrentStep(2);
    }
  };

  const handleStep2Save = async (data: any) => {
    setSaving(true);
    const res = await apiFetch<{ study_status: string }>(`/due-diligence/studies/${studyId}/details`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (res.success) {
      setDetails(data);
      const newStatus = (res.data as any).study_status;
      setStudy(s => s ? { ...s, status: newStatus || s.status } : s);
      setCurrentStep(3);
    }
  };

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch<{ data: Document }>(`/due-diligence/studies/${studyId}/documents`, {
        method: 'POST',
        body: formData,
      });
      if (res.success) {
        setDocs((prev) => [...prev, (res.data as any).data || res.data]);
      } else {
        alert(`Failed to upload ${file.name}: ${res.error || 'Unknown error'}`);
      }
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    await apiFetch(`/due-diligence/studies/${studyId}/documents/${docId}`, { method: 'DELETE' });
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setCurrentStep(4);
    const res = await apiFetch(`/due-diligence/studies/${studyId}/analyze`, { method: 'POST' });
    if (!res.success) {
      setAnalyzing(false);
      alert('Failed to start analysis.');
    }
  };

  const handlePay = async () => {
    setPaying(true);
    const res = await apiFetch<{ checkout_url: string }>(`/due-diligence/studies/${studyId}/checkout-session`, { method: 'POST' });
    setPaying(false);
    if (res.success) {
      const url = (res.data as any).checkout_url;
      if (url) window.location.href = url;
    } else {
      alert('Failed to start checkout session.');
    }
  };


  if (loading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[#9ca3af]" />
        </div>
      </Layout>
    );
  }

  if (!study) return null;

  const stepContent = () => {
    switch (currentStep) {
      case 1:
        return <Step1 study={study} onSave={handleStep1Save} saving={saving} />;
      case 2:
        return <Step2 category={study.offering_category} initial={details} onSave={handleStep2Save} saving={saving} onBack={() => setCurrentStep(1)} />;
      case 3:
        return <Step3 studyId={studyId} docs={docs} analyzing={analyzing} onUpload={handleUpload} onDelete={handleDeleteDoc} onAnalyze={handleAnalyze} onBack={() => setCurrentStep(2)} />;
      case 4:
        return <Step4 analyzing={analyzing} scorecard={scorecard} onNext={() => setCurrentStep(5)} />;
      case 5:
        return <Step5 onPay={handlePay} paying={paying} canCheckout={canCheckout} onBack={() => setCurrentStep(4)} />;
      case 6:
        return <Step6 studyId={studyId} onBack={() => setCurrentStep(5)} />;
      default:
        return null;
    }
  };

  return (
    <Layout>
      <div className="flex-1 p-8 max-w-4xl mx-auto w-full">
        {/* Page header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/due_diligence')}
            className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#374151] hover:bg-[#f3f4f6] transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-[#1a1a1a]">{study.title}</h1>
            <p className="text-[12px] text-[#9ca3af]">
              Step {currentStep} of 6
              <span className="capitalize ml-2 px-2 py-0.5 bg-[#f3f4f6] rounded text-[#6b7280]">
                {study.offering_category.replace('_', ' ')}
              </span>
            </p>
          </div>
        </div>

        <StepBar current={currentStep} />

        <div className="bg-white border border-[#e5e7eb] rounded-2xl p-6">
          <div className="mb-5">
            <h2 className="text-[15px] font-bold text-[#1a1a1a] mb-0.5">
              {STEPS[currentStep - 1]?.label}
            </h2>
          </div>
          {stepContent()}
        </div>
      </div>
    </Layout>
  );
}
