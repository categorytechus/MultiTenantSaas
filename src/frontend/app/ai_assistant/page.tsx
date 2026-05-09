'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';
import { PERMISSION_MODULE_ENABLED } from '../../src/lib/permissions';

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
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };

  const updateTitleFromInput = (text: string) => {
    const title = text.trim().replace(/\s+/g, ' ').slice(0, 44) || 'New chat';
    setSessions((prev) => prev.map((s) => (s.id === activeSessionId && s.title === 'New chat' ? { ...s, title } : s)));
  };

  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem("userModulesUnrestricted");
    if (unrestricted) return;
    const raw = sessionStorage.getItem("userModules");
    if (raw) {
      try {
        const modules: string[] = JSON.parse(raw);
        if (!modules.includes("ai_assistant")) router.replace("/dashboard");
      } catch { /* ignore */ }
    }
  }, [router]);

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const token = localStorage.getItem('accessToken');
    if (!token) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Authentication required. Please sign in.', timestamp: new Date() }]);
      return;
    }

    const userMessage: Message = { id: Math.random().toString(36), role: 'user', content: textToSend, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    updateTitleFromInput(textToSend);
    if (!overrideInput) setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      let chatSessionId = sessionId;
      if (!chatSessionId) {
        const sessionRes = await apiFetch<{ id: string }>('/chat/sessions', {
          method: 'POST',
          body: JSON.stringify({ chat_id: null, title: activeSession?.title || 'New chat' }),
        });
        if (!sessionRes.success) throw new Error(sessionRes.error);
        chatSessionId = sessionRes.data.id;
        setSessionId(chatSessionId);
      }

      const assistantId = `assistant-${Date.now()}`;
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: 'thinking...', status: 'pending', timestamp: new Date() }]);

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const streamUrl = `${window.location.origin}/api/chat/sessions/${chatSessionId}/stream?message=${encodeURIComponent(textToSend)}&token=${encodeURIComponent(token)}`;
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;
      setWsConnected(true);

      es.onmessage = (event) => {
        const data = event.data;
        if (data === '[DONE]') {
          setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, status: 'completed' } : msg));
          es.close();
          setWsConnected(false);
          return;
        }

        if (data.startsWith('[ERROR]')) {
          const errorText = data.replace(/\[ERROR\]\s*/i, '');
          setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, content: `Sorry, I encountered an error: ${errorText}`, status: 'failed' } : msg));
          es.close();
          setWsConnected(false);
          return;
        }

        setMessages(prev => prev.map(msg => {
          if (msg.id === assistantId) {
            return { ...msg, content: (msg.content === 'thinking...' ? '' : msg.content) + data };
          }
          return msg;
        }));
      };

      es.onerror = () => {
        setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, status: 'failed', content: `${msg.content}\n
[Connection error]` } : msg));
        es.close();
        setWsConnected(false);
      };
    } catch (err: unknown) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Sorry, I encountered an error: ${(err as Error).message}`, timestamp: new Date() }]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (date: Date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId) || sessions[0], [sessions, activeSessionId]);

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
      <div className="flex flex-1 h-full overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 flex flex-col bg-[#faf9f7] border-r border-[#ebe9e6] hidden md:flex">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#ebe9e6]">
            <span className="text-[13px] font-semibold text-[#1a1a1a]">Chat History</span>
            <button
              onClick={handleNewChat}
              className="text-[12px] font-medium px-2.5 py-1 bg-white border border-[#ebe9e6] rounded-lg hover:bg-[#f0eeeb] transition-colors text-[#1a1a1a]"
            >
              + New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`w-full flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 ${
                  session.id === activeSessionId ? 'bg-white shadow-sm' : 'hover:bg-white'
                }`}
              >
                <span className="text-[13px] font-medium text-[#1a1a1a] truncate">{session.title}</span>
                <span className="text-[11px] text-[#9a9a9a]">{formatTime(session.createdAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#ebe9e6] bg-white shrink-0">
            <div className="flex items-center gap-2.5 text-[15px] font-semibold text-[#1a1a1a]">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white shrink-0">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                </svg>
              </div>
              {activeSession?.title || 'AI Assistant'}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#9a9a9a]">
              <div className="w-2 h-2 rounded-full" style={{ background: wsConnected ? '#10b981' : '#ef4444' }} />
              {wsConnected ? 'System Online' : 'Connecting…'}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                  message.role === 'assistant'
                    ? 'bg-gradient-to-br from-violet-100 to-blue-100 text-violet-600'
                    : 'bg-[#1a1a1a] text-white text-[12px] font-bold'
                }`}>
                  {message.role === 'assistant' ? '✨' : 'U'}
                </div>
                <div className={`flex flex-col gap-1 max-w-[75%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-[#1a1a1a] text-white rounded-br-sm'
                      : 'bg-[#f5f4f1] text-[#1a1a1a] rounded-bl-sm'
                  }`}>
                    {message.content}
                    {message.status === 'pending' && <span className="inline-block animate-pulse ml-1">...</span>}
                  </div>
                  <div className="text-[11px] text-[#9a9a9a]">
                    {formatTime(message.timestamp)}
                    {message.status && message.status !== 'completed' && ` · ${message.status}`}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[#ebe9e6] p-4 shrink-0 bg-white">
            <div className="flex items-end gap-2 bg-white border border-[#ebe9e6] rounded-2xl px-4 py-3 focus-within:border-[#1a1a1a] transition-colors">
              <textarea
                ref={textareaRef}
                placeholder="Ask me anything…"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                }}
                onKeyDown={handleKeyPress}
                rows={1}
                className="flex-1 resize-none text-[14px] outline-none bg-transparent text-[#1a1a1a] placeholder-[#9a9a9a] max-h-[150px]"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                aria-label="Send message"
                className="w-8 h-8 bg-[#1a1a1a] text-white rounded-xl flex items-center justify-center hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {[
                { label: '📄 Recent documents', q: 'What are my recent documents?' },
                { label: '📝 Summarize features', q: 'Summarize the platform features' },
                { label: '💡 Get help', q: 'Help me find something' },
              ].map(({ label, q }) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-[12px] px-3 py-1.5 bg-white border border-[#ebe9e6] rounded-full hover:bg-[#faf9f7] transition-colors text-[#555]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
