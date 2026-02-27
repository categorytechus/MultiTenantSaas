'use client';

import { useState, useRef, ChangeEvent, DragEvent } from 'react';

interface UploadProps {
  onUploadComplete?: (document: any) => void;
}

export default function DocumentUpload({ onUploadComplete }: UploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  // Tags state
  const [tags, setTags] = useState({
    owner: '',
    category: 'general',
    status: 'active',
    role: '',
  });
  const [description, setDescription] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    setError('');
    
    // Validate file size (50MB)
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return;
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'image/jpeg',
      'image/png',
    ];

    if (!allowedTypes.includes(selectedFile.type)) {
      setError('Invalid file type. Allowed: PDF, DOC, DOCX, TXT, CSV, JPG, PNG');
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setError('');

    try {
      const token = localStorage.getItem('accessToken');

      // Step 1: Get presigned URL
      const presignedRes = await fetch('http://localhost:4000/api/documents/presigned-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          tags,
        }),
      });

      const presignedData = await presignedRes.json();

      if (!presignedData.success) {
        throw new Error(presignedData.message);
      }

      const { uploadUrl, s3Key } = presignedData.data;

      // Step 2: Upload to S3 using presigned URL
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', async () => {
        if (xhr.status === 200) {
          // Step 3: Save metadata to database
          const metadataRes = await fetch('http://localhost:4000/api/documents', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              filename: file.name,
              s3Key,
              fileSize: file.size,
              mimeType: file.type,
              tags,
              description,
            }),
          });

          const metadataData = await metadataRes.json();

          if (metadataData.success) {
            setProgress(100);
            setTimeout(() => {
              setFile(null);
              setProgress(0);
              setDescription('');
              setUploading(false);
              onUploadComplete?.(metadataData.data);
            }, 500);
          } else {
            throw new Error(metadataData.message);
          }
        } else {
          throw new Error('Upload failed');
        }
      });

      xhr.addEventListener('error', () => {
        throw new Error('Upload failed');
      });

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);

    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
        
        .upload-container {
          font-family: 'DM Sans', sans-serif;
          max-width: 600px;
          margin: 0 auto;
        }

        .upload-zone {
          border: 2px dashed #ebebeb;
          border-radius: 12px;
          padding: 48px 24px;
          text-align: center;
          transition: all 0.2s;
          cursor: pointer;
          background: white;
        }
        .upload-zone:hover {
          border-color: #1a1a1a;
          background: #fafafa;
        }
        .upload-zone.dragging {
          border-color: #1a1a1a;
          background: #f5f4f1;
          transform: scale(1.02);
        }

        .upload-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.6;
        }
        .upload-title {
          font-size: 16px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 8px;
        }
        .upload-desc {
          font-size: 13px;
          color: #9a9a9a;
          margin-bottom: 16px;
        }
        .upload-btn {
          padding: 10px 20px;
          background: #1a1a1a;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .upload-btn:hover {
          background: #333;
        }

        .file-selected {
          background: #f5f4f1;
          border: 1px solid #ebebeb;
          border-radius: 12px;
          padding: 20px;
          margin-top: 20px;
        }
        .file-name {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 8px;
        }
        .file-size {
          font-size: 13px;
          color: #9a9a9a;
        }

        .form-section {
          margin-top: 24px;
        }
        .form-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #555;
          margin-bottom: 8px;
        }
        .form-input, .form-select, .form-textarea {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #ebebeb;
          border-radius: 8px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          color: #1a1a1a;
          outline: none;
          transition: all 0.13s;
        }
        .form-input:focus, .form-select:focus, .form-textarea:focus {
          border-color: #1a1a1a;
          box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
        }
        .form-textarea {
          resize: vertical;
          min-height: 80px;
        }

        .tags-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #ebebeb;
          border-radius: 4px;
          overflow: hidden;
          margin: 20px 0;
        }
        .progress-fill {
          height: 100%;
          background: #1a1a1a;
          transition: width 0.3s ease;
        }
        .progress-text {
          text-align: center;
          font-size: 13px;
          color: #9a9a9a;
          margin-top: 8px;
        }

        .error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          margin-top: 16px;
        }

        .submit-btn {
          width: 100%;
          padding: 12px;
          background: #1a1a1a;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 20px;
        }
        .submit-btn:hover {
          background: #333;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .submit-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
          transform: none;
        }
      `}</style>

      <div className="upload-container">
        {/* Upload Zone */}
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-icon">📄</div>
          <div className="upload-title">
            {file ? 'File Selected' : 'Drag & drop file here'}
          </div>
          <div className="upload-desc">
            or click to browse (PDF, DOC, DOCX, TXT, CSV, JPG, PNG - Max 50MB)
          </div>
          <button className="upload-btn" type="button">
            Choose File
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileInput}
          accept=".pdf,.doc,.docx,.txt,.csv,.jpg,.jpeg,.png"
        />

        {/* File Selected */}
        {file && (
          <div className="file-selected">
            <div className="file-name">📎 {file.name}</div>
            <div className="file-size">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
        )}

        {/* Upload Form */}
        {file && !uploading && (
          <div className="form-section">
            <div className="tags-grid">
              <div>
                <label className="form-label">Owner</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g., admin, finance"
                  value={tags.owner}
                  onChange={(e) => setTags({ ...tags, owner: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={tags.category}
                  onChange={(e) => setTags({ ...tags, category: e.target.value })}
                >
                  <option value="general">General</option>
                  <option value="guide">Guide</option>
                  <option value="policy">Policy</option>
                  <option value="report">Report</option>
                  <option value="contract">Contract</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={tags.status}
                  onChange={(e) => setTags({ ...tags, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div>
                <label className="form-label">Role (Optional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g., finance, hr"
                  value={tags.role}
                  onChange={(e) => setTags({ ...tags, role: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="form-label">Description (Optional)</label>
              <textarea
                className="form-textarea"
                placeholder="Add notes or description for this document..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <button
              className="submit-btn"
              onClick={handleUpload}
              disabled={!file}
            >
              Upload Document
            </button>
          </div>
        )}

        {/* Progress */}
        {uploading && (
          <div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-text">
              Uploading... {progress}%
            </div>
          </div>
        )}

        {/* Error */}
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}