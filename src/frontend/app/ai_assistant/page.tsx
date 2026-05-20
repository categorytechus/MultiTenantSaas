'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Layout from '../../components/Layout';
import { apiFetch } from '../../src/lib/api';
import { PERMISSION_MODULE_ENABLED } from '../../src/lib/permissions';
import {
  Plus, Search, Pencil, Trash2, Check, X, MessageSquare,
  SendHorizonal, Loader2, Zap, CheckCircle2, XCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  title: string | null;
  created_at: string;
  isLocal?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  isNew?: boolean; // true only for messages created in this session (not loaded from history)
  proposal?: ApiProposal; // If present, this message needs a permission decision
}

interface ApiProposal {
  proposal_id: string;
  title: string;
  description?: string;
  api_module_name: string;
  input_payload: Record<string, unknown>;
}

// ── Typewriter hook ────────────────────────────────────────────────────────────

function useTypewriter(target: string, speed = 28) {
  const [displayed, setDisplayed] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    if (target === prevRef.current) return;
    prevRef.current = target;
    setDisplayed('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [target, speed]);

  return displayed;
}

// ── SessionItem ────────────────────────────────────────────────────────────────

function SessionItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = useTypewriter(session.title || 'New chat');

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditVal(session.title || '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = async () => {
    const v = editVal.trim();
    if (!v || v === (session.title || '')) { setEditing(false); return; }
    setSaving(true);
    await onRename(v);
    setSaving(false);
    setEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors mb-0.5 ${
        active ? 'bg-white shadow-sm' : 'hover:bg-white/70'
      }`}
    >
      <MessageSquare size={13} className="shrink-0 text-gray-400" />

      {editing ? (
        <input
          ref={inputRef}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 text-[12.5px] bg-transparent outline-none border-b border-violet-400 text-gray-900"
          disabled={saving}
          autoFocus
        />
      ) : (
        <span className="flex-1 min-w-0 text-[12.5px] text-gray-800 truncate leading-tight">
          {title}
        </span>
      )}

      {editing ? (
        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={commitEdit}
            disabled={saving}
            className="p-0.5 text-green-600 hover:text-green-700"
          >
            <Check size={12} />
          </button>
          <button onClick={() => setEditing(false)} className="p-0.5 text-gray-400 hover:text-gray-600">
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={startEdit}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Rename"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Delete"
          >
            {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Markdown message content ───────────────────────────────────────────────────

function MarkdownContent({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {streaming && (
        <span className="inline-block w-1.5 h-4 bg-gray-500 rounded-sm ml-0.5 animate-pulse align-text-bottom" />
      )}
    </div>
  );
}

// ── Streaming typewriter wrapper ───────────────────────────────────────────────

function StreamingMarkdown({
  content,
  streaming,
  isNew,
}: {
  content: string;
  streaming?: boolean;
  isNew?: boolean;
}) {
  // History messages (isNew=false) start fully revealed.
  // Live messages (isNew=true) always start at 0 — even if React batched the
  // state updates so that the component mounts with streaming already false.
  const [pos, setPos] = useState(() => (isNew ? 0 : content.length));
  const contentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  contentRef.current = content;

  const startDrainRef = useRef((charsPerTick: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setPos((p) => {
        const target = contentRef.current.length;
        if (p >= target) return p;
        return Math.min(p + charsPerTick, target);
      });
    }, 16);
  });

  // Single interval on mount — idles while content is empty, advances as tokens arrive.
  useEffect(() => {
    if (!isNew) return;
    startDrainRef.current(3);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When streaming ends, speed up the remaining drain so it finishes quickly.
  useEffect(() => {
    if (!isNew || streaming) return;
    startDrainRef.current(6);
  }, [streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MarkdownContent
      content={content.slice(0, pos)}
      streaming={!!isNew && !!streaming && pos < content.length}
    />
  );
}

// ── Thinking indicator ─────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center px-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}



// ── Main Page ──────────────────────────────────────────────────────────────────

const LOCAL_SESSION_ID = '__local__';
const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content: "Hello! I'm your AI assistant. Ask me anything about your documents and workspace.",
};

export default function AIAssistantPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>(LOCAL_SESSION_ID);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState('');

  // API proposal state
  const [proposalLoadingId, setProposalLoadingId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const esRef = useRef<EventSource | null>(null);
  // Track the assistantId for the current stream so SSE handlers can close over it
  const assistantIdRef = useRef<string>('');

  // Permission guard
  useEffect(() => {
    if (!PERMISSION_MODULE_ENABLED) return;
    const unrestricted = sessionStorage.getItem('userModulesUnrestricted');
    if (unrestricted) return;
    const raw = sessionStorage.getItem('userModules');
    if (raw) {
      try {
        const modules: string[] = JSON.parse(raw);
        if (!modules.includes('ai_assistant')) router.replace('/dashboard');
      } catch (err) {
        console.warn('Failed to parse userModules from sessionStorage', err);
      }
    }
  }, [router]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    const res = await apiFetch<Session[]>('/chat/sessions');
    if (res.success) {
      const list = Array.isArray(res.data) ? res.data : (res.data as { data?: Session[] })?.data ?? [];
      setSessions(list);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Load messages for a real session
  const loadMessages = useCallback(async (sessionId: string) => {
    if (sessionId === LOCAL_SESSION_ID) {
      setMessages([WELCOME]);
      return;
    }
    setLoadingMessages(true);
    const res = await apiFetch<Message[]>(`/chat/sessions/${sessionId}/messages`);
    if (res.success) {
      const raw = Array.isArray(res.data) ? res.data : (res.data as { data?: Message[] })?.data ?? [];
      setMessages(raw.length > 0 ? raw : [WELCOME]);
    }
    setLoadingMessages(false);
  }, []);

  const switchSession = useCallback((id: string) => {
    esRef.current?.close();
    setStreaming(false);
    setActiveId(id);
    loadMessages(id);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [loadMessages]);

  const handleNewChat = () => {
    esRef.current?.close();
    setStreaming(false);
    setActiveId(LOCAL_SESSION_ID);
    setMessages([WELCOME]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleRename = async (sessionId: string, title: string) => {
    const res = await apiFetch(`/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    if (res.success) {
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
    }
  };

  const handleDelete = async (sessionId: string) => {
    const res = await apiFetch(`/chat/sessions/${sessionId}`, { method: 'DELETE' });
    if (res.success) {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeId === sessionId) handleNewChat();
    }
  };

  const generateTitle = (text: string) =>
    text.trim().replace(/\s+/g, ' ').slice(0, 52) || 'New chat';

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev.filter((m) => m.id !== 'welcome'), userMsg]);

    // Create session if needed
    let sessionId = activeId === LOCAL_SESSION_ID ? null : activeId;
    const isFirstMessage = !sessionId;

    if (!sessionId) {
      const res = await apiFetch<{ id: string; title: string | null; created_at: string }>(
        '/chat/sessions',
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (!res.success) {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'assistant', content: 'Failed to start session.' },
        ]);
        return;
      }
      // apiFetch normalizes: response obj without 'data' key gets data: obj added
      const d = res.data as { id: string; title: string | null; created_at: string };
      sessionId = d.id;
      setActiveId(sessionId);

      const title = generateTitle(text);
      const newSession: Session = { id: sessionId, title, created_at: d.created_at };
      setSessions((prev) => [newSession, ...prev]);

      // Update title on server in background
      apiFetch(`/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    }

    // Add placeholder assistant message
    const assistantId = `a-${Date.now()}`;
    assistantIdRef.current = assistantId;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', streaming: true, isNew: true },
    ]);
    setStreaming(true);

    // Open SSE stream
    const token = localStorage.getItem('accessToken');
    const url = `/api/chat/sessions/${sessionId}/stream?message=${encodeURIComponent(text)}&token=${token ?? ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    // ── Default message event (tokens) ───────────────────────────────────────
    es.onmessage = (event) => {
      const data = event.data as string;

      if (data === '[DONE]') {
        es.close();
        esRef.current = null;
        setStreaming(false);
        setMessages((prev) =>
          prev
            .map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
            .filter((m) => m.id !== assistantId || m.content.trim() !== ''),
        );
        return;
      }

      if (data.startsWith('[ERROR]')) {
        es.close();
        esRef.current = null;
        setStreaming(false);
        const errText = data.replace('[ERROR]', '').trim() || 'An error occurred.';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Sorry, something went wrong: ${errText}`, streaming: false }
              : m,
          ),
        );
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + data } : m,
        ),
      );
    };

    // ── Named SSE: api_task_proposal ──────────────────────────────────────────
    es.addEventListener('api_task_proposal', (event) => {
      try {
        const proposal = JSON.parse((event as MessageEvent).data) as ApiProposal;
        // Stop the streaming state and attach the proposal to the current assistant message
        setStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantIdRef.current
              ? {
                  ...m,
                  streaming: false,
                  content: `I need your permission to proceed: **${proposal.description || proposal.title}**`,
                  proposal,
                }
              : m,
          ),
        );
      } catch (err) {
        console.warn('[SSE] Failed to parse api_task_proposal event:', err, (event as MessageEvent).data);
        setStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `proposal-parse-err-${Date.now()}`,
            role: 'assistant' as const,
            content: '⚠️ An API action was proposed but could not be displayed. Please try again.',
            isNew: true,
          },
        ]);
      }
    });

    // ── Named SSE: api_execution_completed ────────────────────────────────────
    es.addEventListener('api_execution_completed', (event) => {
      try {
        const ev = JSON.parse((event as MessageEvent).data) as {
          execution_id: string; summary?: string;
        };
        setMessages((prev) => {
          const hasEmptyPlaceholder = prev.some(
            (m) => m.id === assistantIdRef.current && m.content.trim() === ''
          );
          if (hasEmptyPlaceholder) {
            return prev.map((m) =>
              m.id === assistantIdRef.current
                ? {
                    ...m,
                    id: `exec-ok-${ev.execution_id}`,
                    streaming: false,
                    content: ev.summary || '✅ API action completed.',
                  }
                : m
            );
          } else {
            return [
              ...prev,
              {
                id: `exec-ok-${ev.execution_id}`,
                role: 'assistant' as const,
                content: ev.summary || '✅ API action completed.',
                isNew: true,
              },
            ];
          }
        });
      } catch (err) {
        console.warn('[SSE] Failed to parse api_execution_completed event:', err, (event as MessageEvent).data);
        setMessages((prev) => {
          const hasEmptyPlaceholder = prev.some(
            (m) => m.id === assistantIdRef.current && m.content.trim() === ''
          );
          if (hasEmptyPlaceholder) {
            return prev.map((m) =>
              m.id === assistantIdRef.current
                ? {
                    ...m,
                    id: `exec-ok-parse-err-${Date.now()}`,
                    streaming: false,
                    content: '✅ API action completed (result unavailable).',
                  }
                : m
            );
          } else {
            return [
              ...prev,
              {
                id: `exec-ok-parse-err-${Date.now()}`,
                role: 'assistant' as const,
                content: '✅ API action completed (result unavailable).',
                isNew: true,
              },
            ];
          }
        });
      }
    });

    // ── Named SSE: api_execution_failed ───────────────────────────────────────
    es.addEventListener('api_execution_failed', (event) => {
      try {
        const ev = JSON.parse((event as MessageEvent).data) as {
          execution_id: string; error?: string;
        };
        setMessages((prev) => {
          const hasEmptyPlaceholder = prev.some(
            (m) => m.id === assistantIdRef.current && m.content.trim() === ''
          );
          if (hasEmptyPlaceholder) {
            return prev.map((m) =>
              m.id === assistantIdRef.current
                ? {
                    ...m,
                    id: `exec-err-${ev.execution_id}`,
                    streaming: false,
                    content: `❌ API action failed: ${ev.error || 'Unknown error'}`,
                  }
                : m
            );
          } else {
            return [
              ...prev,
              {
                id: `exec-err-${ev.execution_id}`,
                role: 'assistant' as const,
                content: `❌ API action failed: ${ev.error || 'Unknown error'}`,
                isNew: true,
              },
            ];
          }
        });
      } catch (err) {
        console.warn('[SSE] Failed to parse api_execution_failed event:', err, (event as MessageEvent).data);
        setMessages((prev) => {
          const hasEmptyPlaceholder = prev.some(
            (m) => m.id === assistantIdRef.current && m.content.trim() === ''
          );
          if (hasEmptyPlaceholder) {
            return prev.map((m) =>
              m.id === assistantIdRef.current
                ? {
                    ...m,
                    id: `exec-err-parse-err-${Date.now()}`,
                    streaming: false,
                    content: '❌ API action failed (details unavailable).',
                  }
                : m
            );
          } else {
            return [
              ...prev,
              {
                id: `exec-err-parse-err-${Date.now()}`,
                role: 'assistant' as const,
                content: '❌ API action failed (details unavailable).',
                isNew: true,
              },
            ];
          }
        });
      }
    });

    // ── Named SSE: api_execution_declined ─────────────────────────────────────
    es.addEventListener('api_execution_declined', (event) => {
      try {
        const ev = JSON.parse((event as MessageEvent).data) as { title: string };
        setMessages((prev) => [
          ...prev,
          {
            id: `exec-declined-${Date.now()}`,
            role: 'assistant' as const,
            content: `The API action **"${ev.title}"** was declined. Let me know if you need anything else.`,
            isNew: true,
          },
        ]);
      } catch (err) {
        console.warn('[SSE] Failed to parse api_execution_declined event:', err, (event as MessageEvent).data);
      }
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setStreaming(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantIdRef.current && m.streaming
            ? { ...m, content: m.content || 'Connection lost. Please try again.', streaming: false }
            : m,
        ),
      );
    };
  };

  // ── Proposal accept / decline ───────────────────────────────────────────────

  const handleAcceptProposal = async (proposalId: string, messageId: string) => {
    setProposalLoadingId(proposalId);
    const res = await apiFetch(
      `/api-task-proposals/${proposalId}/accept`,
      {
        method: 'POST',
      },
    );
    setProposalLoadingId(null);
    if (res.success) {
      // Clear the proposal from the message so the buttons disappear
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, proposal: undefined } : m));
    } else {
      setMessages((prev) => [
        ...prev,
        { id: `accept-err-${Date.now()}`, role: 'assistant', content: '❌ Failed to accept the API action. Please try again.' },
      ]);
    }
  };

  const handleDeclineProposal = async (proposalId: string, messageId: string) => {
    setProposalLoadingId(proposalId);
    const res = await apiFetch(
      `/api-task-proposals/${proposalId}/decline`,
      { method: 'POST' },
    );
    setProposalLoadingId(null);
    if (res.success) {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, proposal: undefined } : m));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredSessions = sessions.filter((s) =>
    (s.title || 'New chat').toLowerCase().includes(search.toLowerCase()),
  );

  const activeSession = sessions.find((s) => s.id === activeId);
  const chatTitle = activeId === LOCAL_SESSION_ID ? 'New chat' : (activeSession?.title || 'Chat');

  // Cleanup on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <Layout>
      <div className="flex flex-1 h-full overflow-hidden bg-[#fafaf9]">


        {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
        <aside className="w-60 shrink-0 flex flex-col bg-[#f4f3f0] border-r border-[#e8e6e2] hidden md:flex">
          {/* Sidebar header */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search chats…"
                  className="w-full pl-7 pr-3 py-1.5 text-[12px] bg-white border border-[#e8e6e2] rounded-md outline-none focus:border-violet-400 transition-colors placeholder-gray-400"
                />
              </div>
              <button
                onClick={handleNewChat}
                title="New chat"
                className="w-7 h-7 rounded-full bg-gray-900 text-white flex items-center justify-center hover:bg-gray-700 transition-colors shrink-0"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Active local chat */}
          {activeId === LOCAL_SESSION_ID && (
            <div className="px-3 pb-1">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-white shadow-sm rounded-lg">
                <MessageSquare size={13} className="shrink-0 text-gray-400" />
                <span className="flex-1 min-w-0 text-[12.5px] text-gray-800 truncate">New chat</span>
              </div>
            </div>
          )}

          {/* Session list */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {filteredSessions.length === 0 && search && (
              <p className="text-[12px] text-gray-400 text-center mt-4">No results</p>
            )}
            {filteredSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={activeId === session.id}
                onSelect={() => switchSession(session.id)}
                onRename={(title) => handleRename(session.id, title)}
                onDelete={() => handleDelete(session.id)}
              />
            ))}
          </div>
        </aside>

        {/* ── Chat area ────────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center gap-2.5 px-6 py-3 border-b border-[#e8e6e2] bg-white shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
              <svg width="14" height="14" fill="white" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-[14px] font-semibold text-gray-900 truncate">{chatTitle}</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {loadingMessages ? (
              <div className="flex justify-center pt-10">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  {msg.role === 'assistant' ? (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                      <svg width="13" height="13" fill="#7c3aed" viewBox="0 0 24 24">
                        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center shrink-0 mt-0.5 text-white text-[11px] font-bold">
                      U
                    </div>
                  )}

                  {/* Bubble */}
                  <div className={`flex flex-col gap-1 max-w-[78%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {msg.role === 'user' ? (
                      <div className="px-4 py-2.5 bg-gray-900 text-white rounded-2xl rounded-tr-sm text-[14px] leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="px-4 py-3 bg-white border border-[#e8e6e2] rounded-2xl rounded-tl-sm shadow-xs">
                        {msg.streaming && !msg.content ? (
                          <ThinkingDots />
                        ) : (
                          <>
                            <StreamingMarkdown content={msg.content} streaming={msg.streaming} isNew={msg.isNew} />
                            {msg.proposal && (
                              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                                <button
                                  onClick={() => handleAcceptProposal(msg.proposal!.proposal_id, msg.id)}
                                  disabled={proposalLoadingId === msg.proposal.proposal_id}
                                  className="px-3.5 py-1.5 bg-gray-900 text-white rounded-lg text-[12.5px] font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                >
                                  {proposalLoadingId === msg.proposal.proposal_id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                  Accept
                                </button>
                                <button
                                  onClick={() => handleDeclineProposal(msg.proposal!.proposal_id, msg.id)}
                                  disabled={proposalLoadingId === msg.proposal.proposal_id}
                                  className="px-3.5 py-1.5 bg-white text-gray-600 border border-gray-200 rounded-lg text-[12.5px] font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-[#e8e6e2] px-4 py-3.5 shrink-0 bg-white">
            <div className={`flex items-end gap-2.5 bg-[#fafaf9] border rounded-xl px-3.5 py-2.5 transition-all ${
              streaming ? 'border-gray-200' : 'border-gray-200 focus-within:border-violet-400 focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]'
            }`}>
              <textarea
                ref={textareaRef}
                placeholder="Message AI assistant…"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={streaming}
                className="flex-1 resize-none text-[14px] outline-none bg-transparent text-gray-900 placeholder-gray-400 max-h-[160px] disabled:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                className="w-8 h-8 bg-gray-900 text-white rounded-lg flex items-center justify-center hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0 mb-0.5"
              >
                {streaming ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <SendHorizonal size={14} />
                )}
              </button>
            </div>
            <p className="text-[11.5px] text-gray-400 mt-1.5 px-1">
              Press <kbd className="font-mono bg-gray-100 px-1 rounded text-[10.5px]">Enter</kbd> to send · <kbd className="font-mono bg-gray-100 px-1 rounded text-[10.5px]">Shift+Enter</kbd> for new line
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
