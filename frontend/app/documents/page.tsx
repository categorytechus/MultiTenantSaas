'use client';

import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';

interface Document {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  tags: Record<string, string> | string[] | null;
  status: string;
  created_at: string;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('http://localhost:4000/api/documents', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) setDocuments(data.data);
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setShowUpload(true);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);

    try {
      const token = localStorage.getItem('accessToken');

      // Step 1: Get presigned URL
      const urlRes = await fetch('http://localhost:4000/api/documents/presigned-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type,
          fileSize: selectedFile.size,
          tags: { category: 'general', status: 'active' },
        }),
      });

      const urlData = await urlRes.json();
      if (!urlData.success) throw new Error(urlData.message);

      // Step 2: Upload to S3
      const uploadRes = await fetch(urlData.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });

      if (!uploadRes.ok) throw new Error('Upload to S3 failed');

      // Step 3: Save metadata
      const metadataRes = await fetch('http://localhost:4000/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          filename: selectedFile.name,
          s3Key: urlData.data.s3Key,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
          tags: { category: 'general', status: 'active' },
          description: '',
        }),
      });

      if (!metadataRes.ok) throw new Error('Failed to save document metadata');

      setShowUpload(false);
      setSelectedFile(null);
      fetchDocuments();
    } catch (error: unknown) {
      alert('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (docId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`http://localhost:4000/api/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.data.downloadUrl) {
        window.open(data.data.downloadUrl, '_blank');
      } else {
        alert('Failed to get document URL');
      }
    } catch (_error) {
      alert('Error viewing document');
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`http://localhost:4000/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDocuments(documents.filter(doc => doc.id !== docId));
        alert('Document deleted successfully');
      } else {
        alert('Failed to delete document');
      }
    } catch (_error) {
      alert('Error deleting document');
    }
  };

  const filteredDocs = documents.filter(doc =>
    doc.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <style>{`
        .content {
          padding: 32px;
        }
        .content-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .page-title {
          font-size: 24px;
          font-weight: 700;
          color: #1a1a1a;
          letter-spacing: -0.5px;
        }
        .toolbar {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
        }
        .search-box {
          position: relative;
          flex: 1;
          max-width: 400px;
        }
        .search-input {
          width: 100%;
          padding: 10px 40px 10px 40px;
          border: 1px solid #ebebeb;
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          outline: none;
          transition: all 0.12s;
        }
        .search-input:focus {
          border-color: #1a1a1a;
        }
        .search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #9a9a9a;
          pointer-events: none;
        }
        .search-icon svg {
          width: 16px;
          height: 16px;
        }

        .btn-upload {
          padding: 10px 20px;
          background: #1a1a1a;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s;
        }
        .btn-upload:hover {
          background: #333;
          transform: translateY(-1px);
        }

        .table-container {
          background: white;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          overflow: hidden;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table thead {
          background: #f9f9f9;
          border-bottom: 1px solid #ebebeb;
        }
        .table th {
          padding: 14px 20px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .table td {
          padding: 16px 20px;
          font-size: 14px;
          color: #1a1a1a;
          border-bottom: 1px solid #f5f5f5;
        }
        .table tbody tr:hover {
          background: #fafafa;
        }
        .table tbody tr:last-child td {
          border-bottom: none;
        }

        .file-icon {
          width: 32px;
          height: 32px;
          background: #f5f4f1;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-right: 12px;
          font-size: 16px;
        }
        .filename {
          display: inline-flex;
          align-items: center;
          font-weight: 500;
        }
        .badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .badge-success {
          background: #f0fdf4;
          color: #16a34a;
        }
        .badge-info {
          background: #e0f2fe;
          color: #0284c7;
        }
        .action-btns {
          display: flex;
          gap: 8px;
        }
        .btn-icon {
          background: transparent;
          border: 1px solid #ebebeb;
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s;
        }
        .btn-icon:hover {
          background: #f5f4f1;
          border-color: #d8d8d8;
        }
        .btn-icon svg {
          width: 16px;
          height: 16px;
        }

        .empty-state {
          text-align: center;
          padding: 80px 20px;
          color: #9a9a9a;
        }
        .empty-icon {
          font-size: 64px;
          margin-bottom: 16px;
          opacity: 0.5;
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
          backdrop-filter: blur(4px);
        }
        .modal {
          background: white;
          border-radius: 16px;
          padding: 32px;
          width: 90%;
          max-width: 500px;
        }
        .modal-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 24px;
        }
        .modal-btns {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
        }
        .btn-secondary {
          padding: 10px 20px;
          background: transparent;
          border: 1px solid #ebebeb;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.12s;
        }
        .btn-secondary:hover {
          background: #f5f4f1;
        }
      `}</style>

      <div className="content">
        <div className="content-header">
          <h1 className="page-title">Intelligent Document Processing</h1>
        </div>

        <div className="toolbar">
          <div className="search-box">
            <div className="search-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
            </div>
            <input
              type="text"
              className="search-input"
              placeholder="Search by file name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <label className="btn-upload">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            Choose File
            <input type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
          </label>
        </div>

        <div className="table-container">
          {loading ? (
            <div className="empty-state">
              <div>Loading...</div>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>No documents yet</div>
              <div style={{ fontSize: '14px' }}>Upload your first document to get started</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Category</th>
                  <th>Document Type</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Date Modified</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="filename">{doc.filename}</div>
                    </td>
                    <td>
                      <span className="badge badge-info">
                        {doc.tags && !Array.isArray(doc.tags) ? doc.tags.category || 'General' : 'General'}
                      </span>
                    </td>
                    <td>{doc.mime_type.split('/')[1].toUpperCase()}</td>
                    <td>{formatFileSize(doc.file_size)}</td>
                    <td>
                      <span className="badge badge-success">
                        {doc.status}
                      </span>
                    </td>
                    <td>{formatDate(doc.created_at)}</td>
                    <td>
                      <div className="action-btns">
                        <button className="btn-icon" title="View" onClick={() => handleView(doc.id)}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                          </svg>
                        </button>
                        <button className="btn-icon" title="Delete" onClick={() => handleDelete(doc.id)}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUpload && selectedFile && (
        <div className="modal-overlay" onClick={() => !uploading && setShowUpload(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Upload Document</h2>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: '#f9f9f9', borderRadius: '8px' }}>
                <span style={{ fontSize: '24px' }}>📄</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>{selectedFile.name}</div>
                  <div style={{ fontSize: '12px', color: '#9a9a9a' }}>{formatFileSize(selectedFile.size)}</div>
                </div>
              </div>
            </div>
            <div className="modal-btns">
              <button className="btn-secondary" onClick={() => setShowUpload(false)} disabled={uploading}>
                Cancel
              </button>
              <button className="btn-upload" onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}