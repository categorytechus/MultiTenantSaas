'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';
import {
  Plus, Pencil, Trash2, Loader2, X, Check, ChevronDown,
  Zap, Play, AlertCircle, CheckCircle2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ApiModule {
  id: string;
  name: string;
  description: string;
  base_url: string;
  method: string;
  endpoint_path: string;
  auth_type: string;
  auth_configured: boolean;
  headers: Record<string, string>;
  request_schema: Record<string, string>;
  enabled: boolean;
  ask_permission: boolean;
  created_at: string;
  updated_at: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES = ['none', 'bearer', 'basic', 'api_key'];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700',
  POST: 'bg-blue-100 text-blue-700',
  PUT: 'bg-amber-100 text-amber-700',
  PATCH: 'bg-purple-100 text-purple-700',
  DELETE: 'bg-red-100 text-red-700',
};

// ── Schema editor (key: type pairs) ───────────────────────────────────────────

function SchemaEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  const update = (idx: number, k: string, v: string) => {
    const next = [...entries];
    next[idx] = [k, v];
    onChange(Object.fromEntries(next));
  };
  const remove = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    onChange(Object.fromEntries(next));
  };
  const add = () => onChange({ ...value, '': 'string' });

  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            value={k}
            onChange={(e) => update(i, e.target.value, v)}
            placeholder="field_name"
            className="flex-1 px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-md outline-none focus:border-violet-400"
          />
          <select
            value={v}
            onChange={(e) => update(i, k, e.target.value)}
            className="w-28 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md outline-none focus:border-violet-400 bg-white"
          >
            {['string', 'integer', 'number', 'boolean', 'object', 'array'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-500">
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-[12px] text-violet-600 hover:text-violet-700 flex items-center gap-1"
      >
        <Plus size={11} /> Add field
      </button>
    </div>
  );
}

// ── Module form (create / edit) ────────────────────────────────────────────────

interface ModuleFormState {
  name: string;
  description: string;
  base_url: string;
  method: string;
  endpoint_path: string;
  auth_type: string;
  auth_bearer_token: string;
  auth_basic_username: string;
  auth_basic_password: string;
  auth_apikey_header: string;
  auth_apikey_value: string;
  request_schema: Record<string, string>;
  enabled: boolean;
  ask_permission: boolean;
}

const defaultForm = (): ModuleFormState => ({
  name: '',
  description: '',
  base_url: 'https://',
  method: 'POST',
  endpoint_path: '/',
  auth_type: 'none',
  auth_bearer_token: '',
  auth_basic_username: '',
  auth_basic_password: '',
  auth_apikey_header: 'X-API-Key',
  auth_apikey_value: '',
  request_schema: {},
  enabled: true,
  ask_permission: true,
});

function buildAuthConfig(form: ModuleFormState): Record<string, string> | null {
  if (form.auth_type === 'bearer' && form.auth_bearer_token) return { token: form.auth_bearer_token };
  if (form.auth_type === 'basic') return { username: form.auth_basic_username, password: form.auth_basic_password };
  if (form.auth_type === 'api_key') return { header_name: form.auth_apikey_header, key: form.auth_apikey_value };
  return null;
}

function ModuleDrawer({
  module,
  onClose,
  onSaved,
}: {
  module: ApiModule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!module;
  const [form, setForm] = useState<ModuleFormState>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (module) {
      setForm({
        name: module.name,
        description: module.description,
        base_url: module.base_url,
        method: module.method,
        endpoint_path: module.endpoint_path,
        auth_type: module.auth_type,
        auth_bearer_token: '',
        auth_basic_username: '',
        auth_basic_password: '',
        auth_apikey_header: 'X-API-Key',
        auth_apikey_value: '',
        request_schema: module.request_schema || {},
        enabled: module.enabled,
        ask_permission: module.ask_permission ?? true,
      });
    } else {
      setForm(defaultForm());
    }
    setError('');
  }, [module]);

  const set = (key: keyof ModuleFormState, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.base_url.trim()) { setError('Base URL is required'); return; }
    setSaving(true);
    setError('');
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      base_url: form.base_url.trim(),
      method: form.method,
      endpoint_path: form.endpoint_path || '/',
      auth_type: form.auth_type,
      auth_config: buildAuthConfig(form),
      request_schema: form.request_schema,
      enabled: form.enabled,
      ask_permission: form.ask_permission,
    };
    const res = isEdit
      ? await apiFetch(`/api-modules/${module!.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await apiFetch('/api-modules', { method: 'POST', body: JSON.stringify(body) });
    setSaving(false);
    if (res.success) { onSaved(); onClose(); }
    else setError((res as { error?: string }).error || 'Save failed');
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">
            {isEdit ? 'Edit API Module' : 'New API Module'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-[13px] px-3 py-2 rounded-lg border border-red-200">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Basic info */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-medium text-gray-600 mb-1 block">Name *</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Create Support Ticket"
                className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-gray-600 mb-1 block">Description</span>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)}
                rows={2} placeholder="Use when the user wants to create a support ticket."
                className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400 resize-none" />
            </label>
          </div>

          {/* Endpoint */}
          <div>
            <span className="text-[12px] font-medium text-gray-600 mb-2 block">Endpoint</span>
            <div className="flex gap-2">
              <select value={form.method} onChange={(e) => set('method', e.target.value)}
                className="w-28 px-2 py-2 text-[13px] border border-gray-200 rounded-lg bg-white outline-none focus:border-violet-400">
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input value={form.base_url} onChange={(e) => set('base_url', e.target.value)}
                placeholder="https://api.example.com"
                className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
            </div>
            <input value={form.endpoint_path} onChange={(e) => set('endpoint_path', e.target.value)}
              placeholder="/v1/tickets"
              className="w-full mt-2 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
          </div>

          {/* Auth */}
          <div>
            <span className="text-[12px] font-medium text-gray-600 mb-2 block">Authentication</span>
            <select value={form.auth_type} onChange={(e) => set('auth_type', e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg bg-white outline-none focus:border-violet-400 mb-2">
              {AUTH_TYPES.map((t) => <option key={t} value={t}>{t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : t === 'basic' ? 'HTTP Basic' : 'API Key (Header)'}</option>)}
            </select>
            {form.auth_type === 'bearer' && (
              <input type="password" value={form.auth_bearer_token} onChange={(e) => set('auth_bearer_token', e.target.value)}
                placeholder="Bearer token"
                className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
            )}
            {form.auth_type === 'basic' && (
              <div className="flex gap-2">
                <input value={form.auth_basic_username} onChange={(e) => set('auth_basic_username', e.target.value)}
                  placeholder="Username"
                  className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
                <input type="password" value={form.auth_basic_password} onChange={(e) => set('auth_basic_password', e.target.value)}
                  placeholder="Password"
                  className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
              </div>
            )}
            {form.auth_type === 'api_key' && (
              <div className="flex gap-2">
                <input value={form.auth_apikey_header} onChange={(e) => set('auth_apikey_header', e.target.value)}
                  placeholder="X-API-Key"
                  className="w-36 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
                <input type="password" value={form.auth_apikey_value} onChange={(e) => set('auth_apikey_value', e.target.value)}
                  placeholder="Key value"
                  className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-violet-400" />
              </div>
            )}
          </div>

          {/* Request schema */}
          <div>
            <span className="text-[12px] font-medium text-gray-600 mb-2 block">
              Request Schema <span className="text-gray-400 font-normal">(fields the LLM must fill)</span>
            </span>
            <SchemaEditor value={form.request_schema} onChange={(v) => set('request_schema', v)} />
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-4 border-t border-gray-100 pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => set('enabled', !form.enabled)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${form.enabled ? 'bg-violet-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-[13px] text-gray-700 font-medium">Enabled</span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <div
                onClick={() => set('ask_permission', !form.ask_permission)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${form.ask_permission ? 'bg-violet-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.ask_permission ? 'translate-x-4' : ''}`} />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] text-gray-700 font-medium">Ask for Permission</span>
                <span className="text-[11.5px] text-gray-400 leading-normal">
                  Ask the user for confirmation before executing this API. If unchecked, the AI will execute it automatically.
                </span>
              </div>
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-[13px] text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {isEdit ? 'Save changes' : 'Create module'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Test panel ─────────────────────────────────────────────────────────────────

function TestPanel({ module, onClose }: { module: ApiModule; onClose: () => void }) {
  const [payload, setPayload] = useState('{}');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ http_status?: number; response_preview?: string; error?: string } | null>(null);

  useEffect(() => {
    if (module && module.request_schema) {
      const template: Record<string, any> = {};
      Object.entries(module.request_schema).forEach(([k, type]) => {
        if (type === 'integer' || type === 'number') {
          template[k] = 0;
        } else if (type === 'boolean') {
          template[k] = false;
        } else if (type === 'array') {
          template[k] = [];
        } else if (type === 'object') {
          template[k] = {};
        } else {
          template[k] = "value";
        }
      });
      setPayload(JSON.stringify(template, null, 2));
    } else {
      setPayload('{}');
    }
  }, [module]);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const parsed = JSON.parse(payload);
      const res = await apiFetch<{ data: typeof result }>(`/api-modules/${module.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ input_payload: parsed }),
      });
      setResult(res.success ? (res.data as { data: typeof result }).data ?? null : { error: 'Request failed' });
    } catch {
      setResult({ error: 'Invalid JSON payload. Please verify syntax (e.g. check for missing commas between lines).' });
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-gray-900 flex items-center gap-2">
            <Play size={14} className="text-violet-600" /> Test: {module.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <span className="text-[12px] font-medium text-gray-600 mb-1 block">Input payload (JSON)</span>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 text-[12px] font-mono border border-gray-200 rounded-lg outline-none focus:border-violet-400 resize-none"
            />
          </div>
          {result && (
            <div className={`text-[12px] rounded-lg p-3 border font-mono whitespace-pre-wrap break-all ${result.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
              {result.error ?? `HTTP ${result.http_status}\n\n${result.response_preview}`}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
          <button onClick={handleTest} disabled={testing} className="px-4 py-2 text-[13px] text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2">
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run test
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ApiModulesPage() {
  const router = useRouter();
  const [modules, setModules] = useState<ApiModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerModule, setDrawerModule] = useState<ApiModule | null | 'new'>('new' as never);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [testModule, setTestModule] = useState<ApiModule | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<{ data: ApiModule[] }>('/api-modules');
    if (res.success) setModules((res.data as { data: ApiModule[] }).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setDrawerModule(null); setDrawerOpen(true); };
  const openEdit = (m: ApiModule) => { setDrawerModule(m); setDrawerOpen(true); };
  const closeDrawer = () => setDrawerOpen(false);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await apiFetch(`/api-modules/${id}`, { method: 'DELETE' });
    setDeleting(null);
    load();
  };

  return (
    <Layout>
      <div className="flex-1 flex flex-col bg-[#fafaf9] min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#e8e6e2] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap size={15} fill="white" className="text-white" />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold text-gray-900">API Modules</h1>
              <p className="text-[12px] text-gray-500">Configure APIs the AI assistant can propose actions for</p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-[13px] font-medium rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus size={14} /> New module
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="flex justify-center pt-16">
              <Loader2 size={22} className="animate-spin text-gray-300" />
            </div>
          ) : modules.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-24 gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center">
                <Zap size={20} className="text-violet-400" />
              </div>
              <p className="text-[15px] font-medium text-gray-700">No API modules yet</p>
              <p className="text-[13px] text-gray-400 max-w-xs">
                Add an API module so the AI assistant can propose actions like creating tickets or sending notifications.
              </p>
              <button onClick={openNew} className="mt-2 px-4 py-2 bg-violet-600 text-white text-[13px] rounded-lg hover:bg-violet-700">
                Add your first module
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[800px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Name & Description", "Method & Path", "Auth Type", "Permissions", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((m) => (
                      <tr key={m.id} className="border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                        {/* Name & Description */}
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-gray-900">{m.name}</p>
                            <p className="text-[12px] text-gray-400 mt-0.5 max-w-[280px] truncate" title={m.description}>
                              {m.description || "No description provided."}
                            </p>
                            {Object.keys(m.request_schema || {}).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {Object.keys(m.request_schema).map((f) => (
                                  <span key={f} className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-medium">
                                    {f}: {m.request_schema[f]}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Method & Path */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${METHOD_COLORS[m.method] ?? 'bg-gray-100 text-gray-600'}`}>
                              {m.method}
                            </span>
                            <span className="text-[12px] font-mono text-gray-500 truncate max-w-[200px]" title={`${m.base_url}${m.endpoint_path}`}>
                              {m.endpoint_path}
                            </span>
                          </div>
                        </td>

                        {/* Auth Type */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] text-gray-600">
                              {m.auth_type === 'none' ? 'None' : m.auth_type === 'bearer' ? 'Bearer Token' : m.auth_type === 'basic' ? 'Basic Auth' : 'API Key'}
                            </span>
                            {m.auth_configured && (
                              <span className="inline-flex items-center text-[10px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                                Auth ✓
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Permissions */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                            m.ask_permission
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : "bg-green-50 text-green-800 border border-green-200"
                          }`}>
                            {m.ask_permission ? "Ask User" : "Auto Run"}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            m.enabled
                              ? "bg-green-50 text-green-800"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${m.enabled ? 'bg-green-600' : 'bg-gray-400'}`} />
                            {m.enabled ? "Active" : "Disabled"}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5 items-center">
                            <button
                              onClick={() => setTestModule(m)}
                              title="Test API"
                              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-violet-600 hover:border-violet-200 transition-colors"
                            >
                              <Play size={13} />
                            </button>
                            <button
                              onClick={() => openEdit(m)}
                              title="Edit API"
                              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(m.id)}
                              disabled={deleting === m.id}
                              title="Delete API"
                              className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-40"
                            >
                              {deleting === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {drawerOpen && (
        <ModuleDrawer
          module={drawerModule as ApiModule | null}
          onClose={closeDrawer}
          onSaved={load}
        />
      )}
      {testModule && <TestPanel module={testModule} onClose={() => setTestModule(null)} />}
    </Layout>
  );
}
