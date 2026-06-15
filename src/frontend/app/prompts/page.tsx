"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../src/lib/api";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import Layout from "../../components/Layout";
import "prismjs/components/prism-core";
import "prismjs/themes/prism.css";

// Basic grammar to highlight {variables}
Prism.languages.custom = {
  variable: /\{[^}]+\}/,
};

interface PromptsMap {
  [workflow: string]: {
    [slot: string]: string;
  };
}

export default function PromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PromptsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [orgId, setOrgId] = useState<string>("");
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [selectedWorkflow, setSelectedWorkflow] = useState("default");
  const [selectedSlot, setSelectedSlot] = useState("with-context");
  const [currentText, setCurrentText] = useState("");

  const [hasChanges, setHasChanges] = useState(false);

  const loadPromptsForOrg = async (oid: string) => {
    try {
      setLoading(true);
      const res = await apiFetch<{ data: PromptsMap }>(`/organizations/${oid}/prompts`);
      if (res.success && res.data.data) {
        setPrompts(res.data.data);
        const val = res.data.data[selectedWorkflow]?.[selectedSlot] || "";
        setCurrentText(val);
        setHasChanges(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) {
        router.push("/auth/signin");
        return;
      }
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        let oid = payload.org_id;

        const uRes = await apiFetch<{ data: { user_type?: string } }>("/auth/me");
        const isSA = uRes.data?.data?.user_type === "super_admin" || uRes.data?.data?.user_type === "superadmin" || payload.role === "super_admin" || payload.roles?.includes("super_admin");
        setIsSuperAdmin(isSA);

        if (isSA) {
          const oRes = await apiFetch<{ data: { id: string; name: string }[] }>("/admin/organizations");
          if (oRes.success) {
            setOrgs(oRes.data.data);
          }
        }

        if (!oid) {
          setLoading(false);
          return;
        }

        setOrgId(oid);
        await loadPromptsForOrg(oid);
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    })();
  }, [router]);

  const handleSelectSlot = (workflow: string, slot: string) => {
    setSelectedWorkflow(workflow);
    setSelectedSlot(slot);
    setCurrentText(prompts[workflow]?.[slot] || "");
    setHasChanges(false);
  };

  const handleSave = async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      const updatedPrompts = { ...prompts };
      if (!updatedPrompts[selectedWorkflow]) updatedPrompts[selectedWorkflow] = {};
      updatedPrompts[selectedWorkflow][selectedSlot] = currentText;

      const res = await apiFetch(`/organizations/${orgId}/prompts`, {
        method: "PUT",
        body: JSON.stringify({ prompts: updatedPrompts }),
      });
      if (res.success) {
        setPrompts(updatedPrompts);
        setHasChanges(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!orgId) return;
    if (!confirm("Are you sure you want to reset all prompts to defaults? This cannot be undone.")) return;
    setResetting(true);
    try {
      const res = await apiFetch<{ data: PromptsMap }>(`/organizations/${orgId}/prompts/reset`, {
        method: "POST",
      });
      if (res.success && res.data.data) {
        setPrompts(res.data.data);
        setCurrentText(res.data.data[selectedWorkflow]?.[selectedSlot] || "");
        setHasChanges(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setResetting(false);
    }
  };

  const handleResetCurrentTab = async () => {
    if (!orgId) return;
    if (!confirm(`Are you sure you want to reset the current prompt (${selectedWorkflow}/${selectedSlot}) to its default? This cannot be undone.`)) return;
    setResetting(true);
    try {
      const qs = `?workflow=${encodeURIComponent(selectedWorkflow)}&slot=${encodeURIComponent(selectedSlot)}`;
      const res = await apiFetch<{ data: PromptsMap }>(`/organizations/${orgId}/prompts/reset${qs}`, {
        method: "POST",
      });
      if (res.success && res.data.data) {
        setPrompts(res.data.data);
        setCurrentText(res.data.data[selectedWorkflow]?.[selectedSlot] || "");
        setHasChanges(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex h-full min-h-[50vh] items-center justify-center p-6">
          <div className="w-6 h-6 border-[2.5px] border-[#e5e5e5] border-t-[#1a1a1a] rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!orgId) {
    return (
      <Layout>
        <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-6 text-center">
          <svg width="48" height="48" fill="none" stroke="#d1d5db" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
          </svg>
          <h2 className="text-[15px] font-semibold text-gray-900 mb-1.5">No Organization Selected</h2>
          <p className="text-[13px] text-[#606060]">Please select an org from the top right to manage prompts.</p>
        </div>
      </Layout>
    );
  }

  const workflows = Object.keys(prompts);
  const slots = Object.keys(prompts[selectedWorkflow] || {});

  return (
    <Layout>
      <div className="flex flex-col h-full bg-[#f9f9f8]">
        <style dangerouslySetInnerHTML={{ __html: `
        .editor-container .token.variable { color: #2563eb; font-weight: bold; background: #eff6ff; padding: 0 2px; border-radius: 4px; }
        .editor-container textarea { outline: none !important; }
      `}} />
      <div className="shrink-0 border-b border-[#ebe9e6] bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a1a]">System Prompts</h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-[13px] text-[#606060]">Configure and override system prompts for AI agents.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleResetAll}
              disabled={resetting}
              className="px-4 py-2 text-[13px] font-medium text-[#c0392b] border border-[#fca5a5] hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            >
              Reset All
            </button>
            <button
              onClick={handleResetCurrentTab}
              disabled={resetting}
              className="px-4 py-2 text-[13px] font-medium text-[#c0392b] bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Reset Current Tab
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-4 py-2 text-[13px] font-medium text-white bg-[#1a1a1a] hover:bg-black rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 shrink-0 bg-white border-r border-[#ebe9e6] overflow-y-auto">
          <div className="p-4">
            <div className="space-y-6">
              {workflows.map((w) => (
                <div key={w}>
                  <div className="text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider mb-2 px-2">
                    Workflow: {w}
                  </div>
                  <div className="space-y-0.5">
                    {Object.keys(prompts[w] || {}).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSelectSlot(w, s)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                          selectedWorkflow === w && selectedSlot === s
                            ? "bg-[#f3f0eb] text-[#1a1a1a]"
                            : "text-[#606060] hover:bg-[#faf9f7] hover:text-[#1a1a1a]"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="flex-1 p-8 max-w-4xl">
            <div className="bg-white border border-[#ebe9e6] rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
              <div className="shrink-0 bg-[#faf9f7] border-b border-[#ebe9e6] px-4 py-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#1a1a1a] font-mono">
                  {selectedWorkflow}/{selectedSlot}
                </span>
                {hasChanges && <span className="text-[11px] font-semibold text-[#b45309] bg-orange-50 px-2 py-0.5 rounded-full">Unsaved changes</span>}
              </div>
              <div className="flex-1 overflow-auto bg-[#faf9f7] relative">
                <Editor
                  value={currentText}
                  onValueChange={(code) => {
                    setCurrentText(code);
                    setHasChanges(true);
                  }}
                  highlight={(code) => Prism.highlight(code, Prism.languages.custom, 'custom')}
                  padding={20}
                  style={{
                    fontFamily: '"Fira Code", "JetBrains Mono", monospace',
                    fontSize: 13,
                    minHeight: '100%',
                    backgroundColor: 'transparent',
                    lineHeight: 1.6,
                    color: '#333'
                  }}
                  className="editor-container"
                />
              </div>
            </div>

            {/* Parameter Legend */}
            <div className="mt-6 bg-white border border-[#ebe9e6] rounded-xl shadow-sm p-5 mb-8">
              <h3 className="text-[13px] font-bold text-[#1a1a1a] mb-3">Parameter Legend</h3>
              <p className="text-[12px] text-[#606060] mb-4">
                You can use the following dynamic variables in your prompts. They will be replaced at runtime.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <code className="text-[11px] font-bold text-[#2563eb] bg-blue-50 px-1.5 py-0.5 rounded w-fit">{'{context}'}</code>
                  <span className="text-[12px] text-[#606060]">Retrieved document context chunks.</span>
                </div>
                <div className="flex flex-col gap-1">
                  <code className="text-[11px] font-bold text-[#2563eb] bg-blue-50 px-1.5 py-0.5 rounded w-fit">{'{modules_json}'}</code>
                  <span className="text-[12px] text-[#606060]">Available API actions schema list.</span>
                </div>
                <div className="flex flex-col gap-1">
                  <code className="text-[11px] font-bold text-[#2563eb] bg-blue-50 px-1.5 py-0.5 rounded w-fit">{'{n}'}</code>
                  <span className="text-[12px] text-[#606060]">Number of images (for captioning).</span>
                </div>
                <div className="flex flex-col gap-1">
                  <code className="text-[11px] font-bold text-[#2563eb] bg-blue-50 px-1.5 py-0.5 rounded w-fit">{'{s}'}</code>
                  <span className="text-[12px] text-[#606060]">Plural suffix for images (e.g., 's').</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Layout>
  );
}
