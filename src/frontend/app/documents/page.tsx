"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import { apiFetch } from "../../src/lib/api";
import { PERMISSION_MODULE_ENABLED } from "../../src/lib/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  tags: {
    "doc-type"?: string;
    roles?: string[];
    confidential?: string;
    "user-id"?: string;
    [key: string]: string | string[] | undefined;
  };
  description?: string;
  status: string;
  created_at: string;
  updated_at?: string;
  upload_source?: string;
}

interface OrgRole {
  id: string;
  name: string;
  is_system: boolean;
}

type FileStatus = "pending" | "uploading" | "done" | "error";

interface PerFileMeta {
  docType: string;
  accessRoles: string[];   // empty = unrestricted (all roles)
  allRoles: boolean;       // "all roles" toggle — overrides accessRoles
  description: string;
  isConfidential: boolean;
}

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
  meta: PerFileMeta;
  open: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

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
      return { bg: "bg-green-50 text-green-800", dot: "bg-green-600", label: "Ready" };
    case "processing":
      return { bg: "bg-blue-50 text-blue-700", dot: "bg-blue-600", label: "Processing", spinning: true };
    case "pending":
      return { bg: "bg-orange-50 text-orange-700", dot: "bg-orange-500", label: "Pending", spinning: true };
    case "error":
    case "failed":
      return { bg: "bg-red-50 text-red-700", dot: "bg-red-600", label: "Error" };
    default:
      return { bg: "bg-gray-100 text-gray-600", dot: "bg-gray-400", label: status };
  }
}

function getFileTypeLabel(mimeType: string) {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  };
  return map[mimeType] || mimeType?.split("/")?.[1]?.toUpperCase() || "FILE";
}

const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const MAX_FILE_SIZE = 15 * 1024 * 1024;

function defaultMeta(): PerFileMeta {
  return { docType: "", accessRoles: [], allRoles: true, description: "", isConfidential: false };
}

// ── File Accordion Item ───────────────────────────────────────────────────────

function FileAccordion({
  qf,
  orgRoles,
  uploading,
  onRemove,
  onMetaChange,
  onToggle,
}: {
  qf: QueuedFile;
  orgRoles: OrgRole[];
  uploading: boolean;
  onRemove: (id: string) => void;
  onMetaChange: (id: string, meta: PerFileMeta) => void;
  onToggle: (id: string) => void;
}) {
  const typeLabel = getFileTypeLabel(qf.file.type);
  const canEdit = !uploading && qf.status === "pending";
  const rolesSummary = qf.meta.allRoles
    ? "All roles"
    : qf.meta.accessRoles.length > 0
      ? qf.meta.accessRoles.join(", ")
      : "—";

  const headerBg =
    qf.status === "done" ? "border-green-200 bg-green-50/40"
    : qf.status === "error" ? "border-red-200 bg-red-50/40"
    : qf.status === "uploading" ? "border-blue-200 bg-blue-50/40"
    : "border-gray-200 bg-white";

  const toggleRole = (roleName: string) => {
    const has = qf.meta.accessRoles.includes(roleName);
    const next = has
      ? qf.meta.accessRoles.filter((r) => r !== roleName)
      : [...qf.meta.accessRoles, roleName];
    onMetaChange(qf.id, { ...qf.meta, accessRoles: next, allRoles: false });
  };

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${headerBg}`}>
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => canEdit && onToggle(qf.id)}
      >
        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
          qf.status === "done" ? "bg-green-100 text-green-700"
          : qf.status === "error" ? "bg-red-100 text-red-700"
          : qf.status === "uploading" ? "bg-blue-100 text-blue-700"
          : "bg-violet-50 text-violet-700"
        }`}>
          {qf.status === "uploading" ? (
            <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : qf.status === "done" ? (
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : qf.status === "error" ? "✗" : typeLabel}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-medium text-gray-900 truncate leading-tight">{qf.file.name}</p>
          <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
            {formatFileSize(qf.file.size)}
            {qf.meta.docType && <> · <span className="text-violet-600">{qf.meta.docType}</span></>}
            {" · "}<span className="text-gray-500">{rolesSummary}</span>
          </p>
        </div>

        {qf.status === "error" && (
          <span className="text-[11px] text-red-600 shrink-0 max-w-[120px] truncate">{qf.error}</span>
        )}
        {qf.status === "done" && (
          <span className="text-[11px] text-green-600 shrink-0">Processing…</span>
        )}
        {qf.status === "uploading" && (
          <span className="text-[11px] text-blue-600 shrink-0">Uploading…</span>
        )}

        {canEdit && (
          <>
            <svg
              width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
              viewBox="0 0 24 24"
              className={`shrink-0 text-gray-400 transition-transform ${qf.open ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <button
              className="w-5 h-5 rounded-full border border-gray-300 text-gray-400 hover:border-red-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-sm shrink-0 transition-colors"
              onClick={(e) => { e.stopPropagation(); onRemove(qf.id); }}
              title="Remove"
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Expanded metadata fields */}
      {qf.open && canEdit && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-100 space-y-3">
          {/* Doc type */}
          <div>
            <label className="block text-[11.5px] font-medium text-gray-700 mb-1">
              Doc Type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-[12px] text-gray-900 outline-none focus:border-violet-500 transition-colors"
              value={qf.meta.docType}
              onChange={(e) => onMetaChange(qf.id, { ...qf.meta, docType: e.target.value })}
              placeholder="e.g. invoice, report, guide"
            />
          </div>

          {/* Access roles */}
          <div>
            <label className="block text-[11.5px] font-medium text-gray-700 mb-1.5">
              Access Roles <span className="text-red-500">*</span>
            </label>

            {/* All roles toggle */}
            <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer select-none mb-2 transition-colors ${
              qf.meta.allRoles
                ? "border-violet-400 bg-violet-50 text-violet-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-violet-300"
            }`}>
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-violet-600"
                checked={qf.meta.allRoles}
                onChange={(e) => onMetaChange(qf.id, { ...qf.meta, allRoles: e.target.checked, accessRoles: [] })}
              />
              <span className="text-[12px] font-medium">All roles (unrestricted)</span>
            </label>

            {/* Individual role pills */}
            {!qf.meta.allRoles && (
              <div className="flex flex-wrap gap-1.5">
                {orgRoles.length === 0 && (
                  <p className="text-[11.5px] text-gray-400">No roles found — create roles first.</p>
                )}
                {orgRoles.map((r) => {
                  const selected = qf.meta.accessRoles.includes(r.name);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRole(r.name)}
                      className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
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
            {!qf.meta.allRoles && (
              <p className="text-[11px] text-gray-400 mt-1">
                Select one or more roles that can access this document.
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11.5px] font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-[12px] text-gray-900 outline-none focus:border-violet-500 transition-colors"
              value={qf.meta.description}
              onChange={(e) => onMetaChange(qf.id, { ...qf.meta, description: e.target.value })}
              placeholder="Optional description…"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-violet-600"
              checked={qf.meta.isConfidential}
              onChange={(e) => onMetaChange(qf.id, { ...qf.meta, isConfidential: e.target.checked })}
            />
            <span className="text-[11.5px] text-gray-700">Confidential</span>
          </label>
        </div>
      )}
    </div>
  );
}

// ── Delete Modal ──────────────────────────────────────────────────────────────

function DeleteModal({
  doc,
  onClose,
  onConfirm,
}: {
  doc: Document | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  if (!doc) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]"
      onClick={() => !deleting && onClose()}
    >
      <div
        className="bg-white rounded-xl p-7 w-[90%] max-w-[420px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold text-gray-900 mb-3">Delete document</h2>
        <p className="text-[13.5px] text-gray-500 mb-6">
          Are you sure you want to delete{" "}
          <strong className="text-gray-900">{doc.filename}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            className="px-4 py-2 bg-gray-100 text-gray-800 text-[13.5px] font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-red-600 text-white text-[13.5px] font-medium rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({
  open,
  onClose,
  orgRoles,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  orgRoles: OrgRole[];
  onSuccess: () => void;
}) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setQueue([]);
    setError(null);
    setAllDone(false);
  };

  const handleClose = () => {
    if (!uploading) { reset(); onClose(); }
  };

  const addFiles = (files: File[]) => {
    const valid: QueuedFile[] = [];
    const errs: string[] = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errs.push(`"${file.name}" — unsupported type (PDF, DOC, DOCX, PPT, PPTX only)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errs.push(`"${file.name}" — exceeds 15MB limit`);
        continue;
      }
      valid.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        status: "pending",
        meta: defaultMeta(),
        open: true,
      });
    }
    if (errs.length > 0) setError(errs[0]);
    else setError(null);
    if (valid.length > 0) setQueue((prev) => [...prev, ...valid]);
  };

  const removeFile = (id: string) => setQueue((prev) => prev.filter((f) => f.id !== id));
  const toggleAccordion = (id: string) =>
    setQueue((prev) => prev.map((f) => f.id === id ? { ...f, open: !f.open } : f));
  const updateMeta = (id: string, meta: PerFileMeta) =>
    setQueue((prev) => prev.map((f) => f.id === id ? { ...f, meta } : f));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const uploadSingle = async (qf: QueuedFile) => {
    setQueue((prev) => prev.map((f) => f.id === qf.id ? { ...f, status: "uploading", open: false } : f));
    try {
      const token = localStorage.getItem("accessToken");
      const formData = new FormData();
      formData.append("file", qf.file);
      formData.append("doc_type", qf.meta.docType.trim());
      // Send comma-separated roles; empty string = unrestricted
      const rolesValue = qf.meta.allRoles ? "" : qf.meta.accessRoles.join(",");
      formData.append("access_roles", rolesValue);
      formData.append("description", qf.meta.description);
      formData.append("is_confidential", qf.meta.isConfidential ? "true" : "false");

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.message || "Upload failed");
      setQueue((prev) => prev.map((f) => f.id === qf.id ? { ...f, status: "done" } : f));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setQueue((prev) => prev.map((f) => f.id === qf.id ? { ...f, status: "error", error: msg } : f));
    }
  };

  const handleUploadAll = async () => {
    const pending = queue.filter((f) => f.status === "pending");
    if (pending.length === 0) { setError("Please add at least one file"); return; }

    const invalid = pending.find((f) => !f.meta.docType.trim());
    if (invalid) {
      setError(`"${invalid.file.name}" — Document Type is required`);
      setQueue((prev) => prev.map((f) => f.id === invalid.id ? { ...f, open: true } : f));
      return;
    }
    // Roles are valid when allRoles=true OR at least one role is selected
    const noRole = pending.find((f) => !f.meta.allRoles && f.meta.accessRoles.length === 0);
    if (noRole) {
      setError(`"${noRole.file.name}" — Select at least one role or choose "All roles"`);
      setQueue((prev) => prev.map((f) => f.id === noRole.id ? { ...f, open: true } : f));
      return;
    }

    setError(null);
    setUploading(true);
    for (const qf of pending) {
      await uploadSingle(qf);
    }
    setUploading(false);
    setAllDone(true);
    onSuccess();
    setTimeout(() => { reset(); onClose(); }, 2500);
  };

  if (!open) return null;

  const pendingCount = queue.filter((f) => f.status === "pending").length;
  const doneCount = queue.filter((f) => f.status === "done").length;
  const errorCount = queue.filter((f) => f.status === "error").length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]" onClick={handleClose}>
      <div className="bg-white rounded-xl p-6 w-[90%] max-w-[580px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-semibold text-gray-900 mb-4">Upload Documents</h2>

        {allDone ? (
          <div className="text-center py-10">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${errorCount === 0 ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-600"}`}>
              {errorCount === 0 ? (
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : "⚠"}
            </div>
            <p className={`text-[14px] font-semibold ${errorCount === 0 ? "text-green-700" : "text-orange-600"}`}>
              {doneCount} uploaded{errorCount > 0 ? `, ${errorCount} failed` : ""}
            </p>
            <p className="text-[12.5px] text-gray-400 mt-1">Documents are being embedded in the background.</p>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all mb-4 ${isDragging ? "border-violet-500 bg-violet-50" : "border-gray-200 bg-gray-50 hover:border-violet-400 hover:bg-violet-50/40"}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.ppt,.pptx"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
              />
              <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mx-auto mb-2.5 text-violet-600 shadow-sm">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M12 16V8M12 8L8.5 11.5M12 8L15.5 11.5M4 15.5V17a2 2 0 002 2h12a2 2 0 002-2v-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-gray-600">
                Drop files here or <span className="text-violet-600 underline">browse</span>
              </p>
              <p className="text-[11.5px] text-gray-400 mt-1">PDF, DOC, DOCX, PPT, PPTX · max 15MB</p>
            </div>

            {/* File accordions */}
            {queue.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {queue.map((qf) => (
                  <FileAccordion
                    key={qf.id}
                    qf={qf}
                    orgRoles={orgRoles}
                    uploading={uploading}
                    onRemove={removeFile}
                    onMetaChange={updateMeta}
                    onToggle={toggleAccordion}
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="mb-4 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-800 text-[13.5px] font-medium rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
                onClick={handleClose}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-violet-600 text-white text-[13.5px] font-medium rounded-md hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUploadAll}
                disabled={uploading || pendingCount === 0}
              >
                {uploading
                  ? `Uploading ${doneCount + errorCount} / ${queue.length}…`
                  : `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [reembedding, setReembedding] = useState<Set<string>>(new Set());
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
      if (!modules.includes("documents")) router.replace("/dashboard");
    } catch { router.replace("/dashboard"); }
  }, [router]);

  const fetchDocuments = useCallback(async (silent = false): Promise<Document[]> => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await apiFetch<Document[] | { data?: Document[] }>("/documents");
      if (res.success) {
        const payload = res.data;
        const docs = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { data?: Document[] })?.data)
            ? (payload as { data: Document[] }).data
            : [];
        setDocuments(docs);
        return docs;
      }
    } catch (e) { console.error("Error fetching documents:", e); }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
    return [];
  }, []);

  const startPollingIfNeeded = useCallback((docs: Document[]) => {
    const hasInProgress = docs.some((d) => d.status === "processing" || d.status === "pending");
    if (hasInProgress && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const updated = await fetchDocuments(true);
        const stillInProgress = updated.some((d) => d.status === "processing" || d.status === "pending");
        if (!stillInProgress && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }, 5000);
    }
  }, [fetchDocuments]);

  useEffect(() => {
    const init = async () => {
      const docs = await fetchDocuments();
      startPollingIfNeeded(docs);
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
  }, [fetchDocuments, startPollingIfNeeded]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, startDate, endDate]);

  const handleRefresh = async () => {
    const docs = await fetchDocuments(true);
    startPollingIfNeeded(docs);
  };

  const handleUploadSuccess = async () => {
    const docs = await fetchDocuments(true);
    startPollingIfNeeded(docs);
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    const res = await apiFetch(`/documents/${deleteDoc.id}`, { method: "DELETE" });
    if (res.success) {
      setDocuments((prev) => prev.filter((d) => d.id !== deleteDoc.id));
      setDeleteDoc(null);
    }
  };

  const handleReembed = async (docId: string) => {
    setReembedding((prev) => new Set(prev).add(docId));
    try {
      await apiFetch(`/documents/${docId}/re-embed`, { method: "POST" });
      const docs = await fetchDocuments(true);
      startPollingIfNeeded(docs);
    } finally {
      setReembedding((prev) => { const n = new Set(prev); n.delete(docId); return n; });
    }
  };

  const handleView = async (doc: Document) => {
    try {
      const res = await apiFetch<{ data: { downloadUrl: string | null } }>(`/documents/${doc.id}`);
      if (res.success && res.data.data.downloadUrl) {
        window.open(res.data.data.downloadUrl, "_blank");
      } else {
        const token = localStorage.getItem("accessToken");
        const fileRes = await fetch(`/api/documents/${doc.id}/local-file`, {
          headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        if (!fileRes.ok) throw new Error("Unable to open file");
        const blob = await fileRes.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error viewing document");
    }
  };

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.filename.toLowerCase().includes(searchTerm.toLowerCase());
    const docDate = new Date(doc.created_at);
    const s = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const e = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    return matchesSearch && (!s || docDate >= s) && (!e || docDate <= e);
  });

  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / itemsPerPage));
  const paginatedDocs = filteredDocs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <Layout>
      <div className="p-8 max-w-[1200px]">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Documents</h1>
            <p className="text-[13px] text-gray-500 mt-1">Manage and search your knowledge base documents.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="flex items-center gap-1.5 px-3 py-2 bg-white text-gray-800 text-[13px] font-medium rounded-md border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh document statuses"
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" className={refreshing ? "animate-spin" : ""}>
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
              Refresh
            </button>
            <button
              className="flex items-center gap-1.5 px-4 py-2 bg-[#2f3640] text-white text-[13px] font-medium rounded-md hover:bg-[#1a1f28] transition-colors"
              onClick={() => setShowUploadModal(true)}
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
              Upload Document
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 items-center mb-5 flex-wrap">
          <input
            type="text"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-md text-[13px] text-gray-900 outline-none focus:border-violet-400"
            placeholder="Search by file name..."
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
              <span className="text-[13px]">Loading documents...</span>
            </div>
          ) : paginatedDocs.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-gray-400">No documents found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[700px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {["File Name", "Category", "Type", "Size", "Status", "Date Modified", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDocs.map((doc) => {
                      const badge = getStatusStyle(doc.status);
                      const isProcessing = doc.status === "processing" || doc.status === "pending";
                      const isUrl = doc.upload_source === "url" || doc.mime_type === "text/html";
                      const isConfidential = doc.tags?.confidential === "true";

                      return (
                        <tr key={doc.id} className="border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                          {/* Filename */}
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2">
                              {isUrl ? (
                                <svg width="14" height="14" fill="none" stroke="#6366f1" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
                                  <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              ) : (
                                <svg width="14" height="14" fill="none" stroke="#9ca3af" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
                                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              )}
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-gray-900 max-w-[200px] truncate">{doc.filename}</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {isConfidential && (
                                    <span className="inline-block text-[10px] font-semibold bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                                      Confidential
                                    </span>
                                  )}
                                  {Array.isArray(doc.tags?.roles) && doc.tags.roles.length > 0
                                    ? doc.tags.roles.map((r) => (
                                        <span key={r} className="inline-block text-[10px] font-medium bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                          {r}
                                        </span>
                                      ))
                                    : (
                                        <span className="inline-block text-[10px] font-medium bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded">
                                          All roles
                                        </span>
                                      )
                                  }
                                  {doc.tags?.["doc-type"] && (
                                    <span className="inline-block text-[10px] font-medium bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
                                      {doc.tags["doc-type"]}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold ${isUrl ? "bg-violet-50 text-violet-700" : doc.mime_type?.includes("image") ? "bg-blue-50 text-blue-700" : "bg-pink-50 text-pink-700"}`}>
                              {isUrl ? "Web" : doc.mime_type?.includes("image") ? "Image" : "Document"}
                            </span>
                          </td>

                          {/* Type */}
                          <td className="px-4 py-3 text-[12px] text-gray-400">{getFileTypeLabel(doc.mime_type)}</td>

                          {/* Size */}
                          <td className="px-4 py-3 text-[12px] text-gray-400">{formatFileSize(doc.file_size)}</td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold ${badge.bg}`}>
                              {isProcessing ? (
                                <span className="w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin inline-block" />
                              ) : (
                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                              )}
                              {badge.label}
                            </span>
                          </td>

                          {/* Date */}
                          <td className="px-4 py-3 text-[12px] text-gray-400">
                            {formatDate(doc.updated_at || doc.created_at)}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5 items-center">
                              <button
                                className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                                title="View"
                                onClick={() => handleView(doc)}
                              >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                                </svg>
                              </button>
                              <button
                                className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-500 hover:text-violet-600 hover:border-violet-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Re-embed"
                                disabled={reembedding.has(doc.id)}
                                onClick={() => handleReembed(doc.id)}
                              >
                                {reembedding.has(doc.id) ? (
                                  <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />
                                ) : (
                                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                                  </svg>
                                )}
                                Re-embed
                              </button>
                              <button
                                className="p-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
                                title="Delete"
                                onClick={() => setDeleteDoc(doc)}
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
                  {filteredDocs.length > itemsPerPage
                    ? `${(currentPage - 1) * itemsPerPage + 1}–${Math.min(currentPage * itemsPerPage, filteredDocs.length)} of ${filteredDocs.length} documents`
                    : `${filteredDocs.length} document${filteredDocs.length !== 1 ? "s" : ""}`}
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

      <UploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        orgRoles={orgRoles}
        onSuccess={handleUploadSuccess}
      />
      <DeleteModal doc={deleteDoc} onClose={() => setDeleteDoc(null)} onConfirm={handleDelete} />
    </Layout>
  );
}
