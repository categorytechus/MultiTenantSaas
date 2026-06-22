"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../src/lib/api";
import Layout from "../../components/Layout";

interface PromptsMap {
  [workflow: string]: {
    [slot: string]: string;
  };
}

const WORKFLOW_ORDER = ["default", "cost-seg"];
const SLOT_ORDER = ["with-context", "api-tools", "link-instructions", "with-images", "caption-images"];

const SLOT_LABELS: Record<string, string> = {
  "with-context": "Document Context",
  "api-tools": "API Actions",
  "with-images": "Image Handling",
  "caption-images": "Image Captioning",
  "link-instructions": "Link Formatting",
};

function sortedKeys(keys: string[], order: string[]) {
  return [...keys].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
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
  const [orgModules, setOrgModules] = useState<string[]>([]);

  const [selectedWorkflow, setSelectedWorkflow] = useState("default");
  const [selectedSlot, setSelectedSlot] = useState("with-context");
  const [currentText, setCurrentText] = useState("");

  const [hasChanges, setHasChanges] = useState(false);

  const isSectionEnabled = (w: string, s: string) => {
    if (s === "no-context") return false; // Hide Base Instructions
    
    if (w === "cost-seg") {
      return orgModules.includes("cost_seg");
    }
    
    if (s === "with-context" && !orgModules.includes("documents") && !orgModules.includes("web_urls")) return false;
    if (s === "with-images" && (!orgModules.includes("documents") || !orgModules.includes("ai_images"))) return false;
    if (s === "caption-images" && (!orgModules.includes("documents") || !orgModules.includes("ai_images"))) return false;
    if (s === "link-instructions" && !orgModules.includes("ai_links")) return false;
    if (s === "api-tools" && !orgModules.includes("api_calling")) return false;
    return true;
  };

  const loadPromptsForOrg = async (oid: string) => {
    try {
      setLoading(true);
      const [res, modRes] = await Promise.all([
        apiFetch<{ data: PromptsMap }>(`/organizations/${oid}/prompts`),
        apiFetch<{ data: { modules: string[] } }>(`/organizations/${oid}/modules`)
      ]);
      
      let modulesList: string[] = [];
      if (modRes.success && modRes.data.data?.modules) {
        modulesList = modRes.data.data.modules;
        setOrgModules(modulesList);
      }
      
      if (res.success && res.data.data) {
        const loadedPrompts = res.data.data;
        setPrompts(loadedPrompts);
        
        // Find the first enabled slot
        let foundWorkflow = "default";
        let foundSlot = "with-context";
        let found = false;
        
        const sortedW = sortedKeys(Object.keys(loadedPrompts), WORKFLOW_ORDER);
        for (const w of sortedW) {
          const sortedS = sortedKeys(Object.keys(loadedPrompts[w] || {}), SLOT_ORDER);
          for (const s of sortedS) {
             // Local check since state is not updated yet
             let enabled = true;
             if (s === "no-context") enabled = false;
             else if (w === "cost-seg") {
                 if (!modulesList.includes("cost_seg")) enabled = false;
             }
             else if (s === "with-context" && !modulesList.includes("documents") && !modulesList.includes("web_urls")) enabled = false;
             else if (s === "with-images" && (!modulesList.includes("documents") || !modulesList.includes("ai_images"))) enabled = false;
             else if (s === "caption-images" && (!modulesList.includes("documents") || !modulesList.includes("ai_images"))) enabled = false;
             else if (s === "link-instructions" && !modulesList.includes("ai_links")) enabled = false;
             else if (s === "api-tools" && !modulesList.includes("api_calling")) enabled = false;
             
             if (enabled) {
                 foundWorkflow = w;
                 foundSlot = s;
                 found = true;
                 break;
             }
          }
          if (found) break;
        }

        setSelectedWorkflow(foundWorkflow);
        setSelectedSlot(foundSlot);
        setCurrentText(loadedPrompts[foundWorkflow]?.[foundSlot] || "");
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
        <div className="flex h-full items-center justify-center p-6">
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h2 className="text-[15px] font-semibold text-gray-900 mb-1.5">No Organization Selected</h2>
          <p className="text-[13px] text-[#606060]">Please select an org from the top right to manage prompts.</p>
        </div>
      </Layout>
    );
  }

  const workflows = sortedKeys(Object.keys(prompts), WORKFLOW_ORDER);
  const enabled = isSectionEnabled(selectedWorkflow, selectedSlot);
  
  // Check if there are any available slots across all workflows
  const hasAnyAvailableSlots = workflows.some(w => {
    return sortedKeys(Object.keys(prompts[w] || {}), SLOT_ORDER).some(s => isSectionEnabled(w, s));
  });

  if (!hasAnyAvailableSlots) {
    return (
      <Layout>
        <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-6 text-center">
          <svg width="48" height="48" fill="none" stroke="#d1d5db" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-4">
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-[15px] font-semibold text-gray-900 mb-1.5">No Configurable Prompts</h2>
          <p className="text-[13px] text-[#606060]">This organization does not have any AI features enabled that support custom prompts. Please enable modules like AI Assistant or Cost Segregation first.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-full bg-[#f9f9f8]">
      <div className="shrink-0 border-b border-[#ebe9e6] bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a1a]">System Prompts</h1>
            <p className="text-[13px] text-[#606060] mt-1">Customize the AI assistant's personality and behavior. Technical rules are managed automatically.</p>
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
              disabled={!hasChanges || saving || !enabled}
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
              {workflows.map((w) => {
                const availableSlots = sortedKeys(Object.keys(prompts[w] || {}), SLOT_ORDER).filter(s => isSectionEnabled(w, s));
                if (availableSlots.length === 0) return null;
                
                return (
                  <div key={w}>
                    <div className="text-[10px] font-semibold text-[#b0aaa0] uppercase tracking-wider mb-2 px-2">
                      Workflow: {w}
                    </div>
                    <div className="space-y-0.5">
                      {availableSlots.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSelectSlot(w, s)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                            selectedWorkflow === w && selectedSlot === s
                              ? "bg-[#f3f0eb] text-[#1a1a1a]"
                              : "text-[#606060] hover:bg-[#faf9f7] hover:text-[#1a1a1a]"
                          }`}
                        >
                          {SLOT_LABELS[s] || s}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="flex-1 p-8 max-w-4xl">
            <div className="bg-white border border-[#ebe9e6] rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
              <div className="shrink-0 bg-[#faf9f7] border-b border-[#ebe9e6] px-4 py-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#1a1a1a]">
                  {SLOT_LABELS[selectedSlot] || selectedSlot}
                  <span className="text-[#b0aaa0] ml-2 font-normal">({selectedWorkflow})</span>
                </span>
                {hasChanges && <span className="text-[11px] font-semibold text-[#b45309] bg-orange-50 px-2 py-0.5 rounded-full">Unsaved changes</span>}
              </div>
              <div className="flex-1 overflow-auto bg-[#faf9f7] relative">
                <textarea
                  value={currentText}
                  onChange={(e) => {
                    setCurrentText(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="Enter your custom instructions here..."
                  className="w-full h-full min-h-[460px] p-5 bg-transparent border-none outline-none resize-none text-[13px] leading-relaxed text-[#333]"
                  style={{ fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif' }}
                />
              </div>
            </div>
            
            <div className="mt-4 px-1">
              <p className="text-[11px] text-[#b0aaa0]">
                Technical constraints and formatting rules are automatically applied by the system and are not shown here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Layout>
  );
}
