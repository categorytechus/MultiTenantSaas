"use client";

import { useState, useEffect } from "react";
import Layout from "../../components/Layout";
import KnowledgeBaseSync from "../../components/KnowledgeBaseSync";
import { apiFetch } from "../../src/lib/api";

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
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
  const [editMetadata, setEditMetadata] = useState<UploadMetadata>({
    docType: "",
    isConfidential: false,
    role: "",
    description: "",
  });

  useEffect(() => {
    fetchDocuments();
    fetchCurrentUser();
    fetchOrgRoles();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    setShowUploadModal(true);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!currentUserId) {
      alert("Unable to detect logged-in user. Please sign in again.");
      return;
    }

    if (!metadata.docType) {
      alert("Document Type is required");
      return;
    }

    if (!metadata.role) {
      alert("Please select a Role");
      return;
    }

    setUploading(true);

    try {
      const s3Tags = {
        "user-id": currentUserId,
        "doc-type": metadata.docType,
        confidential: metadata.isConfidential ? "true" : "false",
        ...(metadata.role && { role: metadata.role }),
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
          description: metadata.description,
        }),
      });

      if (!metadataRes.success) throw new Error(metadataRes.error);

      setShowUploadModal(false);
      setSelectedFile(null);
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
      <style>{`
        .content {
          padding: 32px;
        }
        .page-header {
          font-size: 18px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 24px;
        }
        
        .toolbar {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .search-input {
          flex: 1;
          min-width: 250px;
          padding: 9px 14px;
          border: 1px solid #ebebeb;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          color: #1a1a1a;
        }
        .date-input {
          padding: 9px 14px;
          border: 1px solid #ebebeb;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          width: 160px;
          color: #1a1a1a;
        }
        .date-sep {
          font-size: 13px;
          color: #1a1a1a;
        }
        .btn-upload {
          padding: 9px 18px;
          background: #2f3640;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s;
        }
        .btn-upload:hover {
          background: #1a1f28;
        }
        .btn-download {
          padding: 9px 14px;
          background: white;
          color: #2f3640;
          border: 1px solid #ebebeb;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .table-container {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 8px;
          overflow: hidden;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table thead {
          background: #fafafa;
        }
        .table th {
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: #666;
        }
        .table td {
          padding: 14px 16px;
          font-size: 13px;
          color: #1a1a1a;
          border-top: 1px solid #f5f5f5;
        }
        .table tbody tr:hover {
          background: #fafafa;
        }

        .filename {
          font-weight: 500;
          color: #1a1a1a;
        }
        .badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-success {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .badge-image {
          background: #e3f2fd;
          color: #1976d2;
        }
        .badge-document {
          background: #fce4ec;
          color: #c2185b;
        }

        .action-btns {
          display: flex;
          gap: 8px;
        }
        .btn-icon {
          background: transparent;
          border: none;
          padding: 6px;
          cursor: pointer;
          color: #9a9a9a;
          transition: color 0.2s;
        }
        .btn-icon:hover {
          color: #1a1a1a;
        }

        .pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-top: 1px solid #f5f5f5;
        }
        .page-info {
          font-size: 13px;
          color: #666;
        }
        .page-btns {
          display: flex;
          gap: 8px;
        }
        .page-btn {
          padding: 8px 16px;
          background: #f5f5f5;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          color: #1a1a1a;
        }
        .page-btn:hover:not(:disabled) {
          background: #e0e0e0;
        }
        .page-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
        }
        .modal {
          background: white;
          border-radius: 12px;
          padding: 28px;
          width: 90%;
          max-width: 550px;
          max-height: 90vh;
          overflow-y: auto;
        }
        .modal-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 20px;
          color: #1a1a1a;
        }
        .form-group {
          margin-bottom: 18px;
        }
        .form-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #1a1a1a;
          margin-bottom: 6px;
        }
        .form-label .required {
          color: #ef4444;
          margin-left: 2px;
        }
        .form-input, .form-select, .form-textarea {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 13px;
          color: #1a1a1a;
          outline: none;
          transition: border 0.2s;
        }
        .form-input:focus, .form-select:focus, .form-textarea:focus {
          border-color: #8b5cf6;
        }
        .form-textarea {
          resize: vertical;
          min-height: 80px;
        }
        .form-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .form-checkbox input {
          width: 18px;
          height: 18px;
        }
        .form-checkbox label {
          color: #1a1a1a;
        }
        .form-hint {
          font-size: 12px;
          color: #666;
          margin-top: 4px;
        }
        .file-preview {
          background: #f9f9f9;
          border: 1px solid #e5e5e5;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .file-preview-name {
          font-size: 14px;
          font-weight: 500;
          color: #1a1a1a;
          margin-bottom: 4px;
        }
        .file-preview-size {
          font-size: 12px;
          color: #666;
        }
        .modal-btns {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
        }
        .btn-secondary {
          padding: 10px 20px;
          background: #f5f5f5;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          color: #1a1a1a;
        }
        .btn-primary {
          padding: 10px 20px;
          background: #8b5cf6;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

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
          <label className="btn-upload">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Choose file
            <input
              type="file"
              style={{ display: "none" }}
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.ppt,.pptx"
            />
          </label>
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
      {showUploadModal && selectedFile && (
        <div
          className="modal-overlay"
          onClick={() => !uploading && setShowUploadModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Upload Document - Metadata</h2>

            <div className="file-preview">
              <div className="file-preview-name">{selectedFile.name}</div>
              <div className="file-preview-size">
                {formatFileSize(selectedFile.size)}
              </div>
            </div>

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
              />
            </div>

            <div className="modal-btns">
              <button
                className="btn-secondary"
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleUpload}
                disabled={uploading}
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