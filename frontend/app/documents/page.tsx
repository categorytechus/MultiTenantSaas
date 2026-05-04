"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Layout from "../../components/Layout";
import KnowledgeBaseSync from "../../components/KnowledgeBaseSync";
import { apiFetch } from "../../src/lib/api";
import { PERMISSION_MODULE_ENABLED } from "../../src/lib/permissions";
import './documents.css';

interface Document {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  tags: Record<string, string>;
  description?: string;
  status: string;
  created_at: string;
  upload_source?: string;
  processing_speed?: string;
}

interface UploadMetadata {
  docType: string;
  isConfidential: boolean;
  role?: string;
  description: string;
}

interface CurrentUser {
  id: string;
}

interface OrgRole {
  id: string;
  name: string;
  is_system: boolean;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [metadata, setMetadata] = useState<UploadMetadata>({
    docType: "",
    isConfidential: false,
    role: "",
    description: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editMetadata, setEditMetadata] = useState<UploadMetadata>({
    docType: "",
    isConfidential: false,
    role: "",
    description: "",
  });

  // Permission guard: check if user has access to the documents module
  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem("userModulesUnrestricted");
    if (unrestricted) return; // super_admin / org_admin — always allowed
    const raw = sessionStorage.getItem("userModules");
    if (raw) {
      try {
        const modules: string[] = JSON.parse(raw);
        if (!modules.includes("documents")) {
          router.replace("/dashboard");
        }
      } catch { /* ignore parse error */ }
    }
    // If sessionStorage not yet populated, Layout.tsx will handle redirect via sidebar
  }, [router]);

  useEffect(() => {
    fetchDocuments();
    fetchCurrentUser();
    fetchOrgRoles();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchTerm, startDate, endDate]);

  const fetchCurrentUser = async () => {
    try {
      const meRes = await apiFetch<{ data: CurrentUser }>("/auth/me");
      if (meRes.success) {
        setCurrentUserId(meRes.data.data.id);
      }
    } catch {
      // No-op: upload validation will handle missing user context
    }
  };

  const fetchOrgRoles = async () => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return;
      const payload = JSON.parse(atob(token.split(".")[1]));
      const orgId = payload.org_id;
      if (!orgId) return;

      const rolesRes = await apiFetch<{ data: OrgRole[] }>(
        `/organizations/${orgId}/roles`,
      );
      if (rolesRes.success) {
        // Include both system and organization roles (e.g. org_admin).
        setOrgRoles(rolesRes.data.data);
      }
    } catch {
      // No-op: role dropdown will stay empty.
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await apiFetch<{ data: Document[] }>("/documents");
      if (res.success) {
        setDocuments(res.data.data);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (
    eOrFile: React.ChangeEvent<HTMLInputElement> | File,
  ) => {
    const file = eOrFile instanceof File ? eOrFile : eOrFile.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];

    if (!allowedTypes.includes(file.type)) {
      alert("Only PDF, DOC, DOCX, PPT, and PPTX files are allowed");
      return;
    }

    // Validate file size (15MB)
    if (file.size > 15 * 1024 * 1024) {
      alert("File size must be less than 15MB");
      return;
    }

    setSelectedFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRemoveSelectedFile = () => {
    if (uploading) return;
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!currentUserId) {
      alert("Unable to detect logged-in user. Please sign in again.");
      return;
    }

    const docType = metadata.docType.trim();
    const role = (metadata.role || "").trim();
    const description = metadata.description.trim();

    if (!docType) {
      alert("Document Type is required");
      return;
    }

    if (!role) {
      alert("Please select a Role");
      return;
    }

    setUploading(true);

    try {
      const s3Tags = {
        "user-id": currentUserId,
        "doc-type": docType,
        confidential: metadata.isConfidential ? "true" : "false",
        ...(role && { role }),
      };

      // Temporary bypass: skip presigned URL + S3 upload, store file in local backend.
      // TODO: Restore /documents/presigned-url + S3 PUT flow when AWS credentials are configured.
      // const tempS3Key = `local-bypass/${Date.now()}-${selectedFile.name.replace(/\s+/g, "_")}`;
      const token = localStorage.getItem("accessToken");
      const uploadRes = await fetch(
        `/api/documents/local-upload?filename=${encodeURIComponent(selectedFile.name)}`,
        {
          method: "POST",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "Content-Type": selectedFile.type,
          },
          body: selectedFile,
        },
      );
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData?.success || !uploadData?.data?.s3Key) {
        throw new Error(uploadData?.message || "Local upload failed");
      }
      const localS3Key = uploadData.data.s3Key as string;

      // Save metadata directly
      const metadataRes = await apiFetch("/documents", {
        method: "POST",
        body: JSON.stringify({
          filename: selectedFile.name,
          s3Key: localS3Key,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
          tags: s3Tags,
          description,
        }),
      });

      if (!metadataRes.success) throw new Error(metadataRes.error);

      setShowUploadModal(false);
      setSelectedFile(null);
      setIsDragging(false);
      setMetadata({
        docType: "",
        isConfidential: false,
        role: "",
        description: "",
      });
      fetchDocuments();
      alert("Document uploaded successfully!");
    } catch (error: unknown) {
      const e = error as Error;
      alert("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (doc: Document) => {
    try {
      const res = await apiFetch<{ data: { downloadUrl: string | null } }>(
        `/documents/${doc.id}`,
      );
      if (res.success && res.data.data.downloadUrl) {
        window.open(res.data.data.downloadUrl, "_blank");
      } else {
        // Temporary bypass for local/dev documents that don't have S3 objects.
        const token = localStorage.getItem("accessToken");
        const fileRes = await fetch(`/api/documents/${doc.id}/local-file`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });
        if (!fileRes.ok) {
          throw new Error("Unable to open local file");
        }
        const blob = await fileRes.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        window.open(blobUrl, "_blank");
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error viewing document";
      alert(message);
    }
  };

  const handleEdit = (doc: Document) => {
    setEditingDoc(doc);
    setEditMetadata({
      docType: doc.tags?.["doc-type"] || "",
      isConfidential: doc.tags?.confidential === "true",
      role: doc.tags?.role || "",
      description: doc.description || "",
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;

    if (!editMetadata.docType) {
      alert("Document Type is required");
      return;
    }
    if (!editMetadata.role) {
      alert("Please select a Role");
      return;
    }

    setSavingEdit(true);
    try {
      const updatedTags = {
        ...(editingDoc.tags || {}),
        "doc-type": editMetadata.docType,
        confidential: editMetadata.isConfidential ? "true" : "false",
        role: editMetadata.role,
      };
      const res = await apiFetch(`/documents/${editingDoc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tags: updatedTags,
          description: editMetadata.description,
        }),
      });
      if (res.success) {
        setShowEditModal(false);
        setEditingDoc(null);
        fetchDocuments();
        alert("Document updated successfully");
      } else {
        alert(res.error || "Error updating document");
      }
    } catch {
      alert("Error updating document");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      const res = await apiFetch(`/documents/${docId}`, {
        method: "DELETE",
      });
      if (res.success) {
        setDocuments(documents.filter((doc) => doc.id !== docId));
        alert("Document deleted successfully");
      }
    } catch {
      alert("Error deleting document");
    }
  };

  // Filter and paginate
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.filename
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const docDate = new Date(doc.created_at);
    const startDateObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const endDateObj = endDate ? new Date(`${endDate}T23:59:59.999`) : null;
    const matchesStartDate = !startDateObj || docDate >= startDateObj;
    const matchesEndDate = !endDateObj || docDate <= endDateObj;
    return matchesSearch && matchesStartDate && matchesEndDate;
  });

  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / itemsPerPage));
  const paginatedDocs = filteredDocs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  return (
    <Layout>
      

      <div className="content">
        <div className="page-header">Data Extracted Files</div>

        <KnowledgeBaseSync />

        <div className="toolbar">
          <input
            type="text"
            className="search-input"
            placeholder="Search by file name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <input
            type="date"
            className="date-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="date-sep">to</span>
          <input
            type="date"
            className="date-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <button className="btn-upload" onClick={() => setShowUploadModal(true)}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Choose file
          </button>
          <button className="btn-download">
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        </div>

        <div className="table-container">
          {loading ? (
            <div
              style={{ padding: "60px", textAlign: "center", color: "#9a9a9a" }}
            >
              Loading...
            </div>
          ) : paginatedDocs.length === 0 ? (
            <div
              style={{ padding: "60px", textAlign: "center", color: "#9a9a9a" }}
            >
              No documents found
            </div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Category</th>
                    <th>Document Type</th>
                    <th>Size</th>
                    <th>Processing Speed</th>
                    <th>Upload From</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Date Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDocs.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <span className="filename">{doc.filename}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            doc.mime_type.includes("image")
                              ? "badge-image"
                              : "badge-document"
                          }`}
                        >
                          {doc.mime_type.includes("image")
                            ? "Image"
                            : "Document"}
                        </span>
                      </td>
                      <td>{doc.mime_type.split("/")[1].toUpperCase()}</td>
                      <td>{formatFileSize(doc.file_size)}</td>
                      <td>{doc.processing_speed || "-"}</td>
                      <td>{doc.upload_source || "Web Upload"}</td>
                      <td>
                        <div className="action-btns">
                          <button
                            className="btn-icon"
                            title="View"
                            onClick={() => handleView(doc)}
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                            </svg>
                          </button>
                          <button
                            className="btn-icon"
                            title="Edit"
                            onClick={() => handleEdit(doc)}
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                            </svg>
                          </button>
                          <button
                            className="btn-icon"
                            title="Delete"
                            onClick={() => handleDelete(doc.id)}
                          >
                            <svg
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-success">
                          {doc.status}
                        </span>
                      </td>
                      <td>{formatDate(doc.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pagination">
                <div className="page-info">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="page-btns">
                  <button
                    className="page-btn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    className="page-btn"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!uploading) {
              setShowUploadModal(false);
              setIsDragging(false);
            }
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Upload Document - Metadata</h2>

            <div
              className="file-preview"
              style={{
                border: isDragging ? "2px dashed #8b5cf6" : "1px solid #e5e5e5",
                background: isDragging ? "#f5f3ff" : "#f9f9f9",
                transition: "all 0.2s",
                cursor: "pointer",
                textAlign: "center",
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="selected-file-card">
                  <div className="selected-file-main">
                    <div className="selected-file-icon" aria-hidden="true">
                      {selectedFile.type === "application/pdf" ? "PDF" : "DOC"}
                    </div>
                    <div className="selected-file-meta">
                      <div className="file-preview-name">{selectedFile.name}</div>
                      <div className="file-preview-size">
                        {formatFileSize(selectedFile.size)}
                      </div>
                      <div className="form-hint">
                        Click to choose a different file or drag and drop another
                        file.
                      </div>
                    </div>
                  </div>
                  {!uploading && (
                    <button
                      type="button"
                      className="remove-file-btn"
                      title="Remove selected file"
                      aria-label="Remove selected file"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSelectedFile();
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <div className="empty-upload-state">
                  <div className="empty-upload-icon-wrap" aria-hidden="true">
                    <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M12 16V8M12 8L8.5 11.5M12 8L15.5 11.5M4 15.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="file-preview-name">Click to upload or drag and drop</div>
                  <div className="file-preview-size">
                    PDF, DOC, DOCX, PPT, PPTX (max. 15MB)
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginTop: 14 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Browse files
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.ppt,.pptx"
            />

            <div className="form-group">
              <label className="form-label">
                Document Type <span className="required">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={metadata.docType}
                onChange={(e) =>
                  setMetadata({ ...metadata, docType: e.target.value })
                }
                placeholder="e.g., student_guide, invoice, report"
                disabled={uploading}
              />
              <div className="form-hint">S3 Tag: doc-type</div>
            </div>

            <div className="form-group">
              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={metadata.isConfidential}
                  onChange={(e) =>
                    setMetadata({
                      ...metadata,
                      isConfidential: e.target.checked,
                    })
                  }
                  disabled={uploading}
                />
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Mark as Confidential
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Role <span className="required">*</span>
              </label>
              <select
                className="form-select"
                value={metadata.role}
                onChange={(e) =>
                  setMetadata({ ...metadata, role: e.target.value })
                }
                disabled={uploading}
              >
                <option value="">Select a role</option>
                {orgRoles.map((role) => (
                  <option key={role.id} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
              <div className="form-hint">
                {orgRoles.length > 0
                  ? "Showing all available organization roles."
                  : "No roles found. Create roles from the Roles screen first."}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={metadata.description}
                onChange={(e) =>
                  setMetadata({ ...metadata, description: e.target.value })
                }
                placeholder="Add a description for this document..."
                disabled={uploading}
              />
            </div>

            <div className="modal-btns">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowUploadModal(false);
                  setIsDragging(false);
                }}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
              >
                {uploading ? "Uploading..." : "Upload Document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingDoc && (
        <div
          className="modal-overlay"
          onClick={() => !savingEdit && setShowEditModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Edit Document - Metadata</h2>

            <div className="file-preview">
              <div className="file-preview-name">{editingDoc.filename}</div>
              <div className="file-preview-size">
                {formatFileSize(editingDoc.file_size)}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Document Type <span className="required">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={editMetadata.docType}
                onChange={(e) =>
                  setEditMetadata({ ...editMetadata, docType: e.target.value })
                }
                placeholder="e.g., student_guide, invoice, report"
              />
              <div className="form-hint">S3 Tag: doc-type</div>
            </div>

            <div className="form-group">
              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={editMetadata.isConfidential}
                  onChange={(e) =>
                    setEditMetadata({
                      ...editMetadata,
                      isConfidential: e.target.checked,
                    })
                  }
                />
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Mark as Confidential
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Role <span className="required">*</span>
              </label>
              <select
                className="form-select"
                value={editMetadata.role}
                onChange={(e) =>
                  setEditMetadata({ ...editMetadata, role: e.target.value })
                }
              >
                <option value="">Select a role</option>
                {orgRoles.map((role) => (
                  <option key={role.id} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
              <div className="form-hint">
                {orgRoles.length > 0
                  ? "Showing all available organization roles."
                  : "No roles found. Create roles from the Roles screen first."}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={editMetadata.description}
                onChange={(e) =>
                  setEditMetadata({
                    ...editMetadata,
                    description: e.target.value,
                  })
                }
                placeholder="Add a description for this document..."
              />
            </div>

            <div className="modal-btns">
              <button
                className="btn-secondary"
                onClick={() => setShowEditModal(false)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}