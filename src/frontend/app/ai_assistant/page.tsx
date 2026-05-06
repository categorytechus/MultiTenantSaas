'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch, getWebSocketUrl } from '../../src/lib/api';
import { PERMISSION_MODULE_ENABLED } from '../../src/lib/permissions';
import './ai-assistant.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: Date;
}

interface ChatSessionLite {
  id: string;
  title: string;
  createdAt: Date;
}

export default function AIAssistantPage() {
  const router = useRouter();
  const welcomeMessage: Message = {
    id: 'welcome',
    role: 'assistant',
    content: "Hello! I'm your AI Assistant. Ask anything about your documents and workspace.",
    timestamp: new Date(),
  };
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [sessions, setSessions] = useState<ChatSessionLite[]>([
    { id: 'current', title: 'New chat', createdAt: new Date() },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('current');
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const updateTitleFromInput = (text: string) => {
    const title = text.trim().replace(/\s+/g, ' ').slice(0, 44) || 'New chat';
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId && s.title === 'New chat' ? { ...s, title } : s)),
    );
  };

  // Permission guard: check if user has access to the ai_assistant module
  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem("userModulesUnrestricted");
    if (unrestricted) return;
    const raw = sessionStorage.getItem("userModules");
    if (raw) {
      try {
        const modules: string[] = JSON.parse(raw);
        if (!modules.includes("ai_assistant")) {
          router.replace("/dashboard");
        }
      } catch { /* ignore parse error */ }
    }
  }, [router]);

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
                const { task_id, status, data: payload, error } = data.data;
                
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
    updateTitleFromInput(textToSend);
    if (!overrideInput) setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

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

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  );

  const handleNewChat = () => {
    const newId = `local-${Date.now()}`;
    setSessions((prev) => [{ id: newId, title: 'New chat', createdAt: new Date() }, ...prev]);
    setActiveSessionId(newId);
    setSessionId(null);
    setMessages([welcomeMessage]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  return (
    <Layout>
      <div className="ai-layout">
        <aside className="ai-sidebar">
          <div className="ai-sidebar-header">
            <div className="ai-sidebar-label">Chat History</div>
            <button className="ai-new-btn" onClick={handleNewChat}>
              + New Chat
            </button>
          </div>
          <div className="ai-session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`ai-session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="title">{session.title}</span>
                <span className="time">{formatTime(session.createdAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="chat-container">
          <div className="chat-header">
            <div className="chat-title">
              <div className="chat-title-icon">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                </svg>
              </div>
              {activeSession?.title || 'AI Assistant'}
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
                  ref={textareaRef}
                  className="input-textarea"
                  placeholder="Ask me anything..."
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                  }}
                  onKeyDown={handleKeyPress}
                  rows={1}
                />
                <button
                  className="send-button"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  aria-label="Send message"
                >
                  <svg fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
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
      </div>
    </Layout>
  );
}