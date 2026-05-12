"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import { apiFetch } from "../../src/lib/api";
import { PERMISSION_MODULE_ENABLED } from "../../src/lib/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WebUrl {
  id: string;
  url: string;
  title: string;
  tags: {
    "doc-type"?: string;
    roles?: string[] | string;
    confidential?: string;
    "user-id"?: string;
    [key: string]: unknown;
  };
  description?: string;
  status: string;
  created_at: string;
  processing_speed?: string;
}

interface UrlMetadata {
  docType: string;
  isConfidential: boolean;
  accessRoles: string[];  // empty = unrestricted (all roles)
  allRoles: boolean;      // "all roles" toggle — overrides accessRoles
  description: string;
}

interface OrgRole {
  id: string;
  name: string;
  is_system: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStatusStyle(status: string) {
  switch (status.toLowerCase()) {
    case "ready":
      return { cls: "bg-green-50 text-green-800", dot: "bg-green-600", label: "Ready", spinning: false };
    case "processing":
      return { cls: "bg-blue-50 text-blue-700", dot: "bg-blue-600", label: "Processing", spinning: true };
    case "pending":
      return { cls: "bg-orange-50 text-orange-700", dot: "bg-orange-500", label: "Pending", spinning: true };
    case "error":
    case "failed":
      return { cls: "bg-red-50 text-red-700", dot: "bg-red-600", label: "Failed", spinning: false };
    default:
      return { cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400", label: status, spinning: false };
  }
}

// ── Shared metadata form ──────────────────────────────────────────────────────

function MetadataFields({
  metadata,
  onChange,
  orgRoles,
  disabled,
}: {
  metadata: UrlMetadata;
  onChange: (m: UrlMetadata) => void;
  orgRoles: OrgRole[];
  disabled?: boolean;
}) {
  const toggleRole = (roleName: string) => {
    const has = metadata.accessRoles.includes(roleName);
    const next = has
      ? metadata.accessRoles.filter((r) => r !== roleName)
      : [...metadata.accessRoles, roleName];
    onChange({ ...metadata, accessRoles: next, allRoles: false });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-gray-800 mb-1.5">
          Document Type <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-[13px] text-gray-900 outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
          value={metadata.docType}
          onChange={(e) => onChange({ ...metadata, docType: e.target.value })}
          placeholder="e.g., article, documentation, resource"
          disabled={disabled}
        />
        <p className="text-[11.5px] text-gray-400 mt-1">Tag: doc-type</p>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-gray-800 mb-1.5">
          Access Roles <span className="text-red-500">*</span>
        </label>

        {/* All roles toggle */}
        <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer select-none mb-2 transition-colors ${
          metadata.allRoles
            ? "border-violet-400 bg-violet-50 text-violet-700"
            : "border-gray-200 bg-white text-gray-600 hover:border-violet-300"
        } ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-violet-600"
            checked={metadata.allRoles}
            onChange={(e) => onChange({ ...metadata, allRoles: e.target.checked, accessRoles: [] })}
            disabled={disabled}
          />
          <span className="text-[13px] font-medium">All roles (unrestricted)</span>
        </label>

        {/* Individual role pills */}
        {!metadata.allRoles && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {orgRoles.length === 0 && (
              <p className="text-[12px] text-gray-400">No roles found — create roles first.</p>
            )}
            {orgRoles.map((r) => {
              const selected = metadata.accessRoles.includes(r.name);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.name)}
                  disabled={disabled}
                  className={`px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    selected
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "bg-white border-gray-300 text-gray-600 hover:border-violet-400"
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
        {!metadata.allRoles && (
          <p className="text-[11.5px] text-gray-400 mt-1.5">
            Select one or more roles that can access this URL.
          </p>
        )}
      </div>

      <div>
        <label className="block text-[13px] font-medium text-gray-800 mb-1.5">Description</label>
        <textarea
          className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-[13px] text-gray-900 outline-none focus:border-violet-500 transition-colors resize-y min-h-[72px] disabled:opacity-50"
          value={metadata.description}
          onChange={(e) => onChange({ ...metadata, description: e.target.value })}
          placeholder="Add a description for this URL..."
          disabled={disabled}
        />
      </div>

      <div>
        <label className={`flex items-center gap-2.5 cursor-pointer select-none ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
          <input
            type="checkbox"
            className="w-4 h-4 accent-violet-600"
            checked={metadata.isConfidential}
            onChange={(e) => onChange({ ...metadata, isConfidential: e.target.checked })}
            disabled={disabled}
          />
          <span className="text-[13px] font-medium text-gray-800">Mark as Confidential</span>
        </label>
        <p className="text-[11.5px] text-gray-400 mt-1 ml-6">
          Confidential URLs are restricted to authorized roles only.
        </p>
      </div>
    </div>
  );
}

// ── Delete Modal ──────────────────────────────────────────────────────────────

function DeleteModal({
  urlItem,
  onClose,
  onConfirm,
}: {
  urlItem: WebUrl | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  if (!urlItem) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]" onClick={() => !deleting && onClose()}>
      <div className="bg-white rounded-xl p-7 w-[90%] max-w-[420px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold text-gray-900 mb-3">Delete URL</h2>
        <p className="text-[13.5px] text-gray-500 mb-6">
          Are you sure you want to delete <strong className="text-gray-900 break-all">{urlItem.url}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button className="px-4 py-2 bg-gray-100 text-gray-800 text-[13.5px] font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="px-4 py-2 bg-red-600 text-white text-[13.5px] font-medium rounded-md hover:bg-red-700 transition-colors disabled:opacity-50" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add/Edit URL Modal ────────────────────────────────────────────────────────

function UrlModal({
  open,
  onClose,
  orgRoles,
  currentUserId,
  editingUrl,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  orgRoles: OrgRole[];
  currentUserId: string;
  editingUrl: WebUrl | null;
  onSuccess: (url: WebUrl) => void;
}) {
  const [inputUrl, setInputUrl] = useState("");
  const [metadata, setMetadata] = useState<UrlMetadata>({
    docType: "",
    isConfidential: false,
    accessRoles: [],
    allRoles: true,
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const isEdit = !!editingUrl;

  // Populate form when editing
  useEffect(() => {
    if (editingUrl) {
      const rolesRaw = editingUrl.tags?.roles;
      const savedRoles: string[] = Array.isArray(rolesRaw)
        ? rolesRaw
        : typeof rolesRaw === "string" && rolesRaw
          ? rolesRaw.split(",").map((r) => r.trim()).filter(Boolean)
          : [];
      setInputUrl(editingUrl.url);
      setMetadata({
        docType: editingUrl.tags?.["doc-type"] || "",
        isConfidential: editingUrl.tags?.confidential === "true",
        accessRoles: savedRoles,
        allRoles: savedRoles.length === 0,
        description: editingUrl.description || "",
      });
    } else {
      setInputUrl("");
      setMetadata({ docType: "", isConfidential: false, accessRoles: [], allRoles: true, description: "" });
    }
    setError(null);
    setSuccess(false);
  }, [editingUrl, open]);

  const handleClose = () => {
    if (!saving) { setError(null); setSuccess(false); onClose(); }
  };

  const handleSave = async () => {
    if (!inputUrl.trim()) { setError("Please enter a URL"); return; }
    try { new URL(inputUrl); } catch { setError("Please enter a valid URL (include https://)"); return; }
    if (!metadata.docType.trim()) { setError("Document Type is required"); return; }
    if (!metadata.allRoles && metadata.accessRoles.length === 0) {
      setError("Select at least one role or choose \"All roles\"");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const roles = metadata.allRoles ? [] : metadata.accessRoles;
      const tags: Record<string, unknown> = {
        "doc-type": metadata.docType.trim(),
        confidential: metadata.isConfidential ? "true" : "false",
        roles,
      };
      if (currentUserId) tags["user-id"] = currentUserId;

      const body = JSON.stringify({ url: inputUrl.trim(), tags, description: metadata.description });
      const res = isEdit
        ? await apiFetch(`/web-urls/${editingUrl!.id}`, { method: "PUT", body })
        : await apiFetch("/web-urls", { method: "POST", body });

      if (!res.success) throw new Error(res.error || "Failed to save URL");
      // Extract the saved URL row from the response and immediately surface it.
      const urlRow = (res.data as { data?: WebUrl })?.data;
      if (urlRow) onSuccess(urlRow);
      setSuccess(true);
      setTimeout(() => handleClose(), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save URL");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]" onClick={handleClose}>
      <div className="bg-white rounded-xl p-7 w-[90%] max-w-[550px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold text-gray-900 mb-1">{isEdit ? "Edit URL" : "Add Web URL"}</h2>

        {success ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✓</div>
            <p className="text-[13.5px] text-green-700 font-medium">
              {isEdit ? "URL updated successfully." : "URL submitted! Fetching and processing..."}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-gray-500 mb-5">
              {isEdit ? "Update the URL and its metadata." : "Paste any public web page URL to add it to your knowledge base."}
            </p>

            <div className="mb-4">
              <label className="block text-[13px] font-medium text-gray-800 mb-1.5">
                URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-[13px] text-gray-900 outline-none focus:border-violet-500 transition-colors"
                value={inputUrl}
                onChange={(e) => { setInputUrl(e.target.value); setError(null); }}
                placeholder="https://example.com/article"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                autoFocus={!isEdit}
              />
            </div>

            <MetadataFields metadata={metadata} onChange={setMetadata} orgRoles={orgRoles} disabled={saving} />

            {error && (
              <div className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <button className="px-4 py-2 bg-gray-100 text-gray-800 text-[13.5px] font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50" onClick={handleClose} disabled={saving}>
                Cancel
              </button>
              <button className="px-4 py-2 bg-violet-600 text-white text-[13.5px] font-medium rounded-md hover:bg-violet-700 transition-colors disabled:opacity-50" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : isEdit ? "Save Changes" : "Add URL"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WebUrlPage() {
  const router = useRouter();
  const [urls, setUrls] = useState<WebUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUrl, setEditingUrl] = useState<WebUrl | null>(null);
  const [deleteItem, setDeleteItem] = useState<WebUrl | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsPerPage = 10;

  // Permission guard
  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem("userModulesUnrestricted");
    if (unrestricted) return;
    const raw = sessionStorage.getItem("userModules");
    if (!raw) { router.replace("/dashboard"); return; }
    try {
      const modules: string[] = JSON.parse(raw);
      if (!modules.includes("web_urls")) router.replace("/dashboard");
    } catch { router.replace("/dashboard"); }
  }, [router]);

  const fetchUrls = useCallback(async (silent = false): Promise<WebUrl[]> => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<{ data: WebUrl[] }>("/web-urls");
      if (res.success) {
        setUrls(res.data.data);
        return res.data.data;
      }
    } catch { /* no-op */ }
    finally { if (!silent) setLoading(false); }
    return [];
  }, []);

  const startPollingIfNeeded = useCallback((list: WebUrl[]) => {
    const inProgress = list.some((u) => u.status === "processing" || u.status === "pending");
    if (inProgress && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const updated = await fetchUrls(true);
        const stillInProgress = updated.some((u) => u.status === "processing" || u.status === "pending");
        if (!stillInProgress && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }, 4000);
    }
  }, [fetchUrls]);

  useEffect(() => {
    const init = async () => {
      const list = await fetchUrls();
      startPollingIfNeeded(list);
      try {
        const meRes = await apiFetch<{ data: { id: string } }>("/auth/me");
        if (meRes.success) setCurrentUserId(meRes.data.data.id);
      } catch { /* no-op */ }
      try {
        const token = localStorage.getItem("accessToken");
        if (token) {
          const { org_id } = JSON.parse(atob(token.split(".")[1])) as { org_id?: string };
          if (org_id) {
            const rolesRes = await apiFetch<{ data: OrgRole[] }>(`/organizations/${org_id}/roles`);
            if (rolesRes.success) setOrgRoles(rolesRes.data.data);
          }
        }
      } catch { /* no-op */ }
    };
    init();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchUrls, startPollingIfNeeded]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, startDate, endDate]);

  const handleDelete = async () => {
    if (!deleteItem) return;
    const res = await apiFetch(`/web-urls/${deleteItem.id}`, { method: "DELETE" });
    if (res.success) {
      setUrls((prev) => prev.filter((u) => u.id !== deleteItem.id));
      setDeleteItem(null);
    }
  };

  const openAdd = () => { setEditingUrl(null); setShowModal(true); };
  const openEdit = (u: WebUrl) => { setEditingUrl(u); setShowModal(true); };
  const handleModalClose = () => { setShowModal(false); setEditingUrl(null); };

  const handleSuccess = (url: WebUrl) => {
    // Immediately show the created/updated row without waiting for a network round-trip.
    setUrls((prev) => {
      const exists = prev.some((u) => u.id === url.id);
      return exists ? prev.map((u) => u.id === url.id ? url : u) : [url, ...prev];
    });
    startPollingIfNeeded([url]);
    // Background sync to pick up any server-side changes (e.g. title extracted).
    fetchUrls(true).then(startPollingIfNeeded);
  };

  const handleRefresh = async () => {
    const list = await fetchUrls();
    startPollingIfNeeded(list);
  };

  // Filter + paginate
  const filteredUrls = urls.filter((u) => {
    const matchesSearch =
      u.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const d = new Date(u.created_at);
    const s = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const e = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    return matchesSearch && (!s || d >= s) && (!e || d <= e);
  });

  const totalPages = Math.max(1, Math.ceil(filteredUrls.length / itemsPerPage));
  const paginatedUrls = filteredUrls.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <Layout>
      <div className="p-8 max-w-[1200px]">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Web URLs</h1>
            <p className="text-[13px] text-gray-500 mt-1">Add and manage web pages in your knowledge base.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="flex items-center gap-1.5 px-3 py-2 bg-white text-gray-800 text-[13px] font-medium rounded-md border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh statuses"
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" className={loading ? "animate-spin" : ""}>
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
              Refresh
            </button>
            <button
              className="flex items-center gap-1.5 px-4 py-2 bg-[#2f3640] text-white text-[13px] font-medium rounded-md hover:bg-[#1a1f28] transition-colors"
              onClick={openAdd}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
              Add URL
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center mb-5 flex-wrap">
          <input
            type="text"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-md text-[13px] text-gray-900 outline-none focus:border-violet-400"
            placeholder="Search by URL or title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <input type="date" className="px-3 py-2 border border-gray-200 rounded-md text-[13px] text-gray-600 outline-none w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="text-[13px] text-gray-400">to</span>
          <input type="date" className="px-3 py-2 border border-gray-200 rounded-md text-[13px] text-gray-600 outline-none w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <span className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-violet-500 animate-spin" />
              <span className="text-[13px]">Loading URLs...</span>
            </div>
          ) : paginatedUrls.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-gray-400">
              No URLs found.{" "}
              <button className="text-violet-600 hover:underline" onClick={openAdd}>Add one now →</button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[700px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {["URL", "Title", "Category", "Status", "Date Added", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedUrls.map((u) => {
                      const badge = getStatusStyle(u.status);
                      const isProcessing = u.status === "processing" || u.status === "pending";
                      const isConfidential = u.tags?.confidential === "true";

                      return (
                        <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                          {/* URL */}
                          <td className="px-4 py-3 max-w-[240px]">
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[13px] text-blue-600 hover:underline block truncate"
                            >
                              {u.url}
                            </a>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {isConfidential && (
                                <span className="inline-block text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Confidential</span>
                              )}
                              {(() => {
                                const rolesRaw = u.tags?.roles;
                                const roles: string[] = Array.isArray(rolesRaw)
                                  ? rolesRaw
                                  : typeof rolesRaw === "string" && rolesRaw
                                    ? rolesRaw.split(",").map((r) => r.trim()).filter(Boolean)
                                    : [];
                                return roles.length > 0
                                  ? roles.map((r) => (
                                      <span key={r} className="inline-block text-[10px] font-medium bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{r}</span>
                                    ))
                                  : (
                                      <span className="inline-block text-[10px] font-medium bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded">All roles</span>
                                    );
                              })()}
                            </div>
                          </td>

                          {/* Title */}
                          <td className="px-4 py-3 text-[13px] text-gray-700 max-w-[200px]">
                            <span className="block truncate">{u.title || "—"}</span>
                          </td>

                          {/* Category */}
                          <td className="px-4 py-3">
                            <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold bg-violet-50 text-violet-700">
                              {u.tags?.["doc-type"] || "General"}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold ${badge.cls}`}>
                              {isProcessing ? (
                                <span className="w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin inline-block" />
                              ) : (
                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              )}
                              {badge.label}
                            </span>
                          </td>

                          {/* Date */}
                          <td className="px-4 py-3 text-[12px] text-gray-400 whitespace-nowrap">{formatDate(u.created_at)}</td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5">
                              <button
                                className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                                title="Visit"
                                onClick={() => window.open(u.url, "_blank")}
                              >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                                </svg>
                              </button>
                              <button
                                className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                                title="Edit"
                                onClick={() => openEdit(u)}
                              >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                                </svg>
                              </button>
                              <button
                                className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
                                title="Delete"
                                onClick={() => setDeleteItem(u)}
                              >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-[12.5px] text-gray-500">
                  {filteredUrls.length > itemsPerPage
                    ? `${(currentPage - 1) * itemsPerPage + 1}–${Math.min(currentPage * itemsPerPage, filteredUrls.length)} of ${filteredUrls.length} URLs`
                    : `${filteredUrls.length} URL${filteredUrls.length !== 1 ? "s" : ""}`}
                </p>
                {totalPages > 1 && (
                  <div className="flex gap-1.5">
                    <button className="px-3 py-1.5 bg-gray-100 text-gray-700 text-[12.5px] rounded-md hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                      Previous
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => Math.abs(p - currentPage) <= 2)
                      .map((p) => (
                        <button key={p} className={`px-3 py-1.5 text-[12.5px] rounded-md transition-colors min-w-[32px] ${p === currentPage ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`} onClick={() => setCurrentPage(p)}>
                          {p}
                        </button>
                      ))}
                    <button className="px-3 py-1.5 bg-gray-100 text-gray-700 text-[12.5px] rounded-md hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                      Next
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <UrlModal
        open={showModal}
        onClose={handleModalClose}
        orgRoles={orgRoles}
        currentUserId={currentUserId}
        editingUrl={editingUrl}
        onSuccess={handleSuccess}
      />
      <DeleteModal
        urlItem={deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
      />
    </Layout>
  );
}
