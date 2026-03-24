'use client';

import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';

interface WebUrl {
  id: string;
  url: string;
  title: string;
  tags: Record<string, string>;
  status: string;
  created_at: string;
  processing_speed?: string;
}

interface UrlMetadata {
  userId: string;
  docType: string;
  isConfidential: boolean;
  role?: string;
  specificUser?: string;
  description: string;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WebUrlPage() {
  const [urls, setUrls] = useState<WebUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [metadata, setMetadata] = useState<UrlMetadata>({
    userId: '',
    docType: '',
    isConfidential: false,
    role: '',
    specificUser: '',
    description: ''
  });

  useEffect(() => {
    // Fetch URLs from backend (mock for now)
    setLoading(false);
    setUrls([]);
  }, []);

  const handleUrlSubmit = () => {
    if (!inputUrl.trim()) {
      alert('Please enter a URL');
      return;
    }

    // Validate URL format
    try {
      new URL(inputUrl);
    } catch {
      alert('Please enter a valid URL');
      return;
    }

    setShowUploadModal(true);
  };

  const handleUpload = async () => {
    // Validate metadata
    if (!metadata.userId || !metadata.docType) {
      alert('User ID and Document Type are required');
      return;
    }

    if (!metadata.role && !metadata.specificUser) {
      alert('Please select either a Role or a Specific User');
      return;
    }

    setUploading(true);

    try {
      // Prepare tags
      const tags = {
        'user-id': metadata.userId,
        'doc-type': metadata.docType,
        'confidential': metadata.isConfidential ? 'true' : 'false',
        ...(metadata.role && { role: metadata.role }),
        ...(metadata.specificUser && { 'specific-user': metadata.specificUser })
      };

      // Save URL with metadata
      const res = await apiFetch('/web-urls', {
        method: 'POST',
        body: JSON.stringify({
          url: inputUrl,
          tags,
          description: metadata.description,
        }),
      });

      if (!res.success) throw new Error(res.error);

      setShowUploadModal(false);
      setInputUrl('');
      setMetadata({
        userId: '',
        docType: '',
        isConfidential: false,
        role: '',
        specificUser: '',
        description: ''
      });
      alert('URL saved successfully!');
    } catch (error: unknown) {
      const e = error as Error;
      alert('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleView = (url: string) => {
    window.open(url, '_blank');
  };

  const handleDelete = async (urlId: string) => {
    if (!confirm('Are you sure you want to delete this URL?')) return;
    
    try {
      const res = await apiFetch(`/web-urls/${urlId}`, {
        method: 'DELETE'
      });
      if (res.success) {
        setUrls(urls.filter(u => u.id !== urlId));
        alert('URL deleted successfully');
      }
    } catch (error) {
      alert('Error deleting URL');
    }
  };

  // Filter and paginate
  const filteredUrls = urls.filter(url => {
    const matchesSearch = url.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         url.title?.toLowerCase().includes(searchTerm.toLowerCase());
    const urlDate = new Date(url.created_at);
    const matchesStartDate = !startDate || urlDate >= new Date(startDate);
    const matchesEndDate = !endDate || urlDate <= new Date(endDate);
    return matchesSearch && matchesStartDate && matchesEndDate;
  });

  const totalPages = Math.ceil(filteredUrls.length / itemsPerPage);
  const paginatedUrls = filteredUrls.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
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
          color: #9a9a9a;
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

        .url-link {
          color: #3b82f6;
          text-decoration: none;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: inline-block;
        }
        .url-link:hover {
          text-decoration: underline;
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
        .url-preview {
          background: #f9f9f9;
          border: 1px solid #e5e5e5;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          word-break: break-all;
          font-size: 13px;
          color: #1a1a1a;
          font-weight: 500;
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
        <div className="page-header">Web URLs</div>

        <div className="toolbar">
          <input
            type="text"
            className="search-input"
            placeholder="Search by URL or title..."
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
          <button className="btn-upload" onClick={handleUrlSubmit}>
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Add URL
          </button>
          <button className="btn-download">
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </button>
        </div>

        {/* URL Input */}
        <div style={{ marginBottom: '20px' }}>
          <input
            type="url"
            className="search-input"
            placeholder="Enter URL (e.g., https://example.com)"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        <div className="table-container">
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#9a9a9a' }}>Loading...</div>
          ) : paginatedUrls.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#9a9a9a' }}>
              No URLs found. Add a URL above to get started.
            </div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Processing Speed</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Date Added</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUrls.map((url) => (
                    <tr key={url.id}>
                      <td>
                        <a href={url.url} target="_blank" rel="noopener noreferrer" className="url-link">
                          {url.url}
                        </a>
                      </td>
                      <td>{url.title || '-'}</td>
                      <td>
                        <span className="badge badge-success">
                          {url.tags?.['doc-type'] || 'General'}
                        </span>
                      </td>
                      <td>{url.processing_speed || '-'}</td>
                      <td>
                        <div className="action-btns">
                          <button className="btn-icon" title="Visit" onClick={() => handleView(url.url)}>
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                            </svg>
                          </button>
                          <button className="btn-icon" title="Edit">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-success">{url.status}</span>
                      </td>
                      <td>{formatDate(url.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pagination">
                <div className="page-info">Page {currentPage} of {totalPages || 1}</div>
                <div className="page-btns">
                  <button
                    className="page-btn"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <button
                    className="page-btn"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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
      {showUploadModal && inputUrl && (
        <div className="modal-overlay" onClick={() => !uploading && setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add URL - Metadata</h2>

            <div className="url-preview">
              {inputUrl}
            </div>

            <div className="form-group">
              <label className="form-label">
                User ID <span className="required">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={metadata.userId}
                onChange={(e) => setMetadata({ ...metadata, userId: e.target.value })}
                placeholder="e.g., admin, user123"
              />
              <div className="form-hint">Tag: user-id</div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Document Type <span className="required">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={metadata.docType}
                onChange={(e) => setMetadata({ ...metadata, docType: e.target.value })}
                placeholder="e.g., article, documentation, resource"
              />
              <div className="form-hint">Tag: doc-type</div>
            </div>

            <div className="form-group">
              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={metadata.isConfidential}
                  onChange={(e) => setMetadata({ ...metadata, isConfidential: e.target.checked })}
                />
                <label className="form-label" style={{ marginBottom: 0 }}>Mark as Confidential</label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Role <span className="required">*</span>
              </label>
              <select
                className="form-select"
                value={metadata.role}
                onChange={(e) => setMetadata({ ...metadata, role: e.target.value, specificUser: '' })}
              >
                <option value="">Select a role</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
                <option value="guest">Guest</option>
              </select>
              <div className="form-hint">OR assign to specific user below</div>
            </div>

            <div className="form-group">
              <label className="form-label">Specific User</label>
              <input
                type="text"
                className="form-input"
                value={metadata.specificUser}
                onChange={(e) => setMetadata({ ...metadata, specificUser: e.target.value, role: '' })}
                placeholder="Enter user email or ID"
                disabled={!!metadata.role}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-textarea"
                value={metadata.description}
                onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                placeholder="Add a description for this URL..."
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
                {uploading ? 'Saving...' : 'Save URL'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}