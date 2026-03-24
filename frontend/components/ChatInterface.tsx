'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, getWebSocketUrl } from '../src/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: Date;
}

export default function ChatInterface({ orgId: _orgId }: { orgId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    // Connect to WebSocket
    const ws = new WebSocket(getWebSocketUrl('/ws/task-status'));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Chat WebSocket connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WS Message:', data);

      if (data.type === 'task-status') {
        const { task_id, status, data: payload } = data.data;
        
        setMessages(prev => prev.map(msg => {
          if (msg.id === task_id) {
            return {
              ...msg,
              status: status,
              content: status === 'completed' ? (payload.data.answer || payload.data.message || msg.content) : msg.content
            };
          }
          return msg;
        }));

        if (status === 'completed' || status === 'failed') {
          // If the message was an update for a "pending" message, we transform it
          setMessages(prev => {
            const exists = prev.find(m => m.id === task_id);
            if (exists && status === 'completed') {
                // If it's a completed assistant message, we might need to add it if it's not the user's message
                // Actually, the user message stays user, we need an assistant message
                const assistantMsgId = `asst-${task_id}`;
                if (!prev.find(m => m.id === assistantMsgId)) {
                    return [...prev, {
                        id: assistantMsgId,
                        role: 'assistant',
                        content: payload.data.answer || payload.data.message || "I don't have an answer.",
                        status: 'completed',
                        timestamp: new Date()
                    }];
                }
            }
            return prev;
          });
        }
      }
    };

    ws.onclose = () => setWsConnected(false);

    return () => {
      ws.close();
    };
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Math.random().toString(36),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      interface ChatResponse { sessionId?: string; taskId: string }
      const res = await apiFetch<ChatResponse>('/chat', {
        method: 'POST',
        apiType: 'CHAT',
        body: JSON.stringify({
          prompt: input,
          sessionId: sessionId
        })
      });

      if (!res.success) throw new Error(res.error);
      const data = res.data;
      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        // Subscribe to this session on the WS
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            action: 'subscribe_session',
            session_id: data.sessionId
          }));
        }
      }

      // Add a placeholder for the assistant response tied to the taskId
      const placeholder: Message = {
        id: data.taskId,
        role: 'assistant',
        content: 'thinking...',
        status: 'pending',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, placeholder]);

    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '500px',
      background: 'white',
      borderRadius: '12px',
      border: '1px solid #ebebeb',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #ebebeb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>AI Assistant</span>
        <span style={{ 
          fontSize: '10px', 
          color: wsConnected ? '#16a34a' : '#dc2626',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
          {wsConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {messages.length === 0 && (
          <div style={{ color: '#9a9a9a', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>
            Ask me anything about your organization...
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: '12px',
            fontSize: '14px',
            lineHeight: 1.5,
            background: msg.role === 'user' ? '#f4f4f5' : '#1a1a1a',
            color: msg.role === 'user' ? '#1a1a1a' : 'white',
            border: msg.role === 'user' ? '1px solid #e4e4e7' : 'none',
          }}>
            {msg.content}
            {msg.status && msg.status !== 'completed' && (
              <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px' }}>
                {msg.status}...
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid #ebebeb' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #d4d4d8',
              fontSize: '14px',
              outline: 'none'
            }}
          />
          <button
            onClick={sendMessage}
            style={{
              padding: '8px 16px',
              background: '#1a1a1a',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
