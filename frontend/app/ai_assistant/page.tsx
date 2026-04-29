'use client';

import { useState, useRef, useEffect } from 'react';
import Layout from '../../components/Layout';
import { apiFetch, getWebSocketUrl } from '../../src/lib/api';
import './ai-assistant.css';

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