'use client';

import { useState, useRef, useEffect } from 'react';
import Layout from '../../components/Layout';
import { apiFetch, getWebSocketUrl } from '../../src/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: Date;
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI Assistant. I can help you with documents, answer questions, and guide you through the platform. How can I assist you today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // WebSocket Connection
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    try {
        const ws = new WebSocket(getWebSocketUrl('/ws/task-status'));
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('AI Assistant WebSocket connected');
            setWsConnected(true);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('WS Message:', data);

            if (data.type === 'task-status') {
                const { task_id, status, data: payload, error, session_id: _session_id } = data.data;
                
                // Update existing message or add new one
                setMessages(prev => {
                    const existing = prev.find(m => m.id === task_id);
                    if (existing) {
                        return prev.map(msg => {
                            if (msg.id === task_id) {
                                const nextContent =
                                    status === 'completed'
                                        ? (payload?.answer || payload?.message || msg.content)
                                        : status === 'failed'
                                            ? `Sorry, I encountered an error: ${error || payload?.error || 'Task failed.'}`
                                            : msg.content;
                                return {
                                    ...msg,
                                    status: status as 'pending' | 'running' | 'completed' | 'failed',
                                    content: nextContent
                                };
                            }
                            return msg;
                        });
                    } else if (status === 'completed' || status === 'running' || status === 'failed') {
                        // Check if we maybe need to add it (though usually we add placeholder on send)
                        return prev; 
                    }
                    return prev;
                });
            }
        };

        ws.onclose = () => setWsConnected(false);

        return () => {
            ws.close();
        };
    } catch (err) {
        console.error('WebSocket connection error:', err);
    }
  }, []);

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMessage: Message = {
      id: Math.random().toString(36),
      role: 'user',
      content: textToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    if (!overrideInput) setInput('');

    try {
      const res = await apiFetch<{ task_id: string; session_id?: string }>('/chat', {
        method: 'POST',
        apiType: 'CHAT',
        body: JSON.stringify({
          prompt: textToSend,
          sessionId: sessionId
        })
      });

      if (!res.success) throw new Error(res.error);
      
      const { task_id, session_id } = res.data;
      if (session_id && !sessionId) {
        setSessionId(session_id);
        // Suscribe to session if needed (backend usually handles auto-subscribe for connected user)
      }

      // Add thinking placeholder
      const aiPlaceholder: Message = {
        id: task_id,
        role: 'assistant',
        content: 'thinking...',
        status: 'pending',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiPlaceholder]);

    } catch (err: unknown) {
       console.error('Chat error:', err);
       const errorMsg: Message = {
         id: Date.now().toString(),
         role: 'assistant',
         content: `Sorry, I encountered an error: ${(err as Error).message}`,
         timestamp: new Date()
       };
       setMessages(prev => [...prev, errorMsg]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <Layout>
      <style>{`
        .chat-container {
          height: calc(100vh - 60px);
          display: flex;
          flex-direction: column;
          background: #faf9f7;
        }

        .chat-header {
          padding: 20px 32px;
          background: white;
          border-bottom: 1px solid #ebebeb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chat-title {
          font-size: 20px;
          font-weight: 700;
          color: #1a1a1a;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .chat-title-icon {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .ws-status {
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #666;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .message {
          display: flex;
          gap: 12px;
          max-width: 75%;
          animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .message.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .message-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 18px;
        }
        .message.assistant .message-avatar {
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          color: white;
        }
        .message.user .message-avatar {
          background: #1a1a1a;
          color: white;
          font-size: 12px;
          font-weight: 600;
        }

        .message-content {
          flex: 1;
        }
        .message-bubble {
          padding: 12px 16px;
          border-radius: 14px;
          font-size: 14.5px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .message.assistant .message-bubble {
          background: white;
          border: 1px solid #ebebeb;
          color: #1a1a1a;
          border-bottom-left-radius: 4px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .message.user .message-bubble {
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          color: white;
          border-bottom-right-radius: 4px;
        }
        .message-time {
          font-size: 11px;
          color: #9a9a9a;
          margin-top: 4px;
          padding: 0 4px;
        }
        .message.user .message-time {
          text-align: right;
        }

        .typing-indicator {
          display: flex;
          gap: 12px;
          max-width: 70%;
        }

        .input-container {
          padding: 20px 32px 28px;
          background: white;
          border-top: 1px solid #ebebeb;
        }
        .input-wrapper {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          max-width: 1000px;
          margin: 0 auto;
        }
        .input-box {
          flex: 1;
          position: relative;
        }
        .input-textarea {
          width: 100%;
          padding: 14px 18px;
          border: 1.5px solid #e5e7eb;
          border-radius: 14px;
          font-family: inherit;
          font-size: 14.5px;
          color: #1a1a1a;
          resize: none;
          outline: none;
          transition: all 0.2s;
          line-height: 1.5;
          max-height: 150px;
          background: #fcfcfb;
        }
        .input-textarea:focus {
          border-color: #8b5cf6;
          background: white;
          box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.08);
        }

        .send-button {
          width: 50px;
          height: 50px;
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          border: none;
          border-radius: 14px;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .send-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(139, 92, 246, 0.35);
        }
        .send-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .quick-actions {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .quick-action {
          padding: 7px 16px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 99px;
          font-size: 12.5px;
          color: #4b5563;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: 500;
        }
        .quick-action:hover {
          border-color: #8b5cf6;
          color: #8b5cf6;
          background: #f5f3ff;
        }

        @media (max-width: 768px) {
          .chat-header { padding: 16px 20px; }
          .message { max-width: 85%; }
          .messages-container { padding: 20px; }
          .input-container { padding: 16px; }
        }
      `}</style>

      <div className="chat-container">
        <div className="chat-header">
          <div className="chat-title">
            <div className="chat-title-icon">
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
              </svg>
            </div>
            AI Assistant
          </div>
          <div className="ws-status">
             <div className="status-dot" style={{ background: wsConnected ? '#10b981' : '#ef4444' }}></div>
             {wsConnected ? 'System Online' : 'Connecting to AI...'}
          </div>
        </div>

        <div className="messages-container">
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="message-avatar">
                {message.role === 'assistant' ? '✨' : 'U'}
              </div>
              <div className="message-content">
                <div className="message-bubble">
                    {message.content}
                    {message.status === 'pending' && <span className="loading-dots">...</span>}
                </div>
                <div className="message-time">
                    {formatTime(message.timestamp)}
                    {message.status && message.status !== 'completed' && ` • ${message.status}`}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <div className="input-wrapper">
            <div className="input-box">
              <textarea
                className="input-textarea"
                placeholder="Ask me anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                rows={1}
              />
            </div>
            <button
              className="send-button"
              onClick={() => handleSend()}
              disabled={!input.trim()}
            >
              <svg fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>

          <div className="quick-actions">
            <button className="quick-action" onClick={() => handleSend('What are my recent documents?')}>
              📄 Recent documents
            </button>
            <button className="quick-action" onClick={() => handleSend('Summarize the platform features')}>
              📝 Summarize features
            </button>
            <button className="quick-action" onClick={() => handleSend('Help me find something')}>
              💡 Get help
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
