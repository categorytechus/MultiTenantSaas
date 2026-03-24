'use client';

import { useState } from 'react';
import { apiFetch } from '../src/lib/api';

interface SyncJob {
  ingestion_job_id: string;
  status: string;
  triggered_by: string;
  created_at: string;
  updated_at: string;
}

export default function KnowledgeBaseSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      interface SyncResponse { data: { ingestionJobId: string; status: string } }
      const res = await apiFetch<SyncResponse>('/knowledge-base/sync', {
        method: 'POST'
      });

      if (res.success) {
        const data = res.data;
        setLastSync({
          ingestion_job_id: data.data.ingestionJobId,
          status: data.data.status,
          triggered_by: 'You',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        alert('Knowledge base sync started successfully!');
      } else {
        setError(res.error || 'Unknown error');
      }
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETE': return '#16a34a';
      case 'IN_PROGRESS': return '#3b82f6';
      case 'STARTING': return '#8b5cf6';
      case 'FAILED': return '#ef4444';
      default: return '#9a9a9a';
    }
  };

  return (
    <div style={{
      background: 'white',
      border: '1px solid #ebebeb',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: lastSync ? '16px' : '0'
      }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px', color: '#1a1a1a' }}>
            Knowledge Base Sync
          </h3>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
            Sync documents to vector store for AI search
          </p>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '10px 20px',
            background: syncing ? '#9a9a9a' : 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: syncing ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {syncing ? (
            <>
              <div style={{
                width: '14px',
                height: '14px',
                border: '2px solid white',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite'
              }} />
              Syncing...
            </>
          ) : (
            <>
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
              </svg>
              Sync Now
            </>
          )}
        </button>
      </div>

      {lastSync && (
        <div style={{
          background: '#f9f9f9',
          borderRadius: '6px',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: '12px', color: '#666' }}>
            Last sync: {new Date(lastSync.created_at).toLocaleString()}
          </div>
          <div style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            background: `${getStatusColor(lastSync.status)}22`,
            color: getStatusColor(lastSync.status)
          }}>
            {lastSync.status}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          marginTop: '12px',
          padding: '10px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#c00'
        }}>
          {error}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
