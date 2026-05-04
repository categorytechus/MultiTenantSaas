import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, MessageSquare, Plus, Edit2, Share2, Trash2,
  Check, X, MoreHorizontal, Zap,
} from 'lucide-react'
import type { ChatMessage, ChatSession } from '../types'
import { api } from '../lib/api'
import { createSSE } from '../lib/sse'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

function generateTitle(msg: string): string {
  const clean = msg.trim().replace(/\s+/g, ' ')
  return clean.length > 52 ? clean.slice(0, 52) + '…' : clean
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

// ── Thinking dots ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
      <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
    </span>
  )
}

// ── Typewriter title (character-by-character reveal) ──────────────────────────

function TypewriterText({ text, speed = 26 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    setDisplayed('')
    if (!text) return
    let i = 0
    const t = setInterval(() => {
      i += 1
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(t)
    }, speed)
    return () => clearInterval(t)
  }, [text, speed])

  return <>{displayed}</>
}

// ── Library title with fade-swap on change ────────────────────────────────────

function FadeTitle({ title }: { title: string }) {
  const [displayed, setDisplayed] = useState(title)
  const [fading, setFading] = useState(false)
  const prevRef = useRef(title)

  useEffect(() => {
    if (title === prevRef.current) return
    setFading(true)
    const t = setTimeout(() => {
      setDisplayed(title)
      prevRef.current = title
      setFading(false)
    }, 140)
    return () => clearTimeout(t)
  }, [title])

  return (
    <span style={{
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.14s ease',
      display: 'block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {displayed}
    </span>
  )
}

// ── Typewriter for streaming assistant messages ───────────────────────────────

function useTypewriter(fullText: string, enabled: boolean, charsPerSec = 50) {
  const fullTextRef = useRef(fullText)
  fullTextRef.current = fullText

  const [pos, setPos] = useState(() => (enabled ? 0 : fullText.length))

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      setPos(p => {
        const len = fullTextRef.current.length
        return p < len ? p + 1 : p
      })
    }, 1000 / charsPerSec)
    return () => clearInterval(id)
  }, [enabled, charsPerSec])

  return fullText.slice(0, pos)
}

function AssistantContent({ content, streaming }: { content: string; streaming?: boolean }) {
  // Capture on mount: was this a live streaming message or a historical one?
  // Historical messages (streaming=false at mount) skip the animation entirely.
  const enabledRef = useRef(!!streaming)
  const displayed = useTypewriter(content, enabledRef.current)
  const showCursor = !!streaming || displayed.length < content.length

  if (!content && streaming) return <ThinkingDots />
  return (
    <>
      {displayed}
      {showCursor && <span style={{ opacity: 0.5, marginLeft: 2 }}>▋</span>}
    </>
  )
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginRight: 8, flexShrink: 0, marginTop: 2,
        }}>
          <MessageSquare size={13} style={{ color: 'white' }} />
        </div>
      )}
      <div style={{ maxWidth: '70%', minWidth: 48 }}>
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          backgroundColor: isUser ? '#f4f4f5' : '#1a1a1a',
          color: isUser ? '#1a1a1a' : '#fff',
          fontSize: 13.5, lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>
          {isUser
            ? message.content
            : <AssistantContent content={message.content} streaming={message.streaming} />}
        </div>
        <div style={{
          fontSize: 10.5, color: '#bbb', marginTop: 4,
          textAlign: isUser ? 'right' : 'left',
          paddingLeft: isUser ? 0 : 4, paddingRight: isUser ? 4 : 0,
        }}>
          {new Date(message.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>
      {isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', backgroundColor: '#1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: 8, flexShrink: 0, marginTop: 2, color: 'white', fontSize: 11, fontWeight: 600,
        }}>U</div>
      )}
    </div>
  )
}

// ── Session item ──────────────────────────────────────────────────────────────

interface SessionItemProps {
  session: ChatSession
  isActive: boolean
  disabled: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onShare: () => void
  onDelete: () => void
}

function SessionItem({ session, isActive, disabled, onSelect, onRename, onShare, onDelete }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title || 'New Chat')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) setDraft(session.title || 'New Chat')
  }, [session.title, editing])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const confirmRename = () => {
    const t = draft.trim()
    if (t && t !== (session.title || 'New Chat')) onRename(t)
    setEditing(false)
  }
  const cancelRename = () => { setDraft(session.title || 'New Chat'); setEditing(false) }

  return (
    <div
      onClick={() => !editing && !disabled && onSelect()}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f0f0f0' }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent' }}
      style={{
        padding: '9px 10px', borderRadius: 7, marginBottom: 2,
        backgroundColor: isActive ? '#ede9fe' : 'transparent',
        border: `1px solid ${isActive ? '#c4b5fd' : 'transparent'}`,
        cursor: editing || disabled ? 'default' : 'pointer',
        transition: 'background-color 0.1s', position: 'relative',
      }}
    >
      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename() }}
            onBlur={confirmRename}
            autoFocus
            style={{
              flex: 1, border: '1px solid #c4b5fd', borderRadius: 4,
              padding: '2px 6px', fontSize: 12.5, outline: 'none',
              fontFamily: "'DM Sans', sans-serif", backgroundColor: 'white',
            }}
          />
          <button onClick={confirmRename} style={iconBtn('#16a34a')}><Check size={12} /></button>
          <button onClick={cancelRename} style={iconBtn('#999')}><X size={12} /></button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: isActive ? 500 : 400, color: '#1a1a1a', lineHeight: 1.4 }}>
              <FadeTitle title={session.title || 'New Chat'} />
            </div>
            <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 1 }}>{timeAgo(session.created_at)}</div>
          </div>
          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }} style={iconBtn('#bbb')} title="Options">
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                backgroundColor: 'white', border: '1px solid #ebebeb',
                borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                zIndex: 200, width: 140, overflow: 'hidden',
              }}>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(false); setEditing(true) }} style={dropItem()}>
                  <Edit2 size={12} /><span>Rename</span>
                </button>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onShare() }} style={dropItem()}>
                  <Share2 size={12} /><span>Share link</span>
                </button>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }} style={dropItem('#e53e3e')}>
                  <Trash2 size={12} /><span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const iconBtn = (color: string): React.CSSProperties => ({
  border: 'none', background: 'none', cursor: 'pointer', color,
  padding: '2px 3px', borderRadius: 4, display: 'flex', alignItems: 'center',
})

const dropItem = (color = '#333'): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '8px 12px', border: 'none', background: 'none',
  cursor: 'pointer', fontSize: 12.5, color, textAlign: 'left',
  fontFamily: "'DM Sans', sans-serif",
})

interface ApiMsg { id: string; role: string; content: string; created_at: string }

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [shareToast, setShareToast] = useState(false)
  // Tracks the title currently being type-written in the chat header
  const [animatingTitle, setAnimatingTitle] = useState<{ id: string; title: string } | null>(null)

  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  // Prevents the messages-load effect from overwriting optimistic messages on new-session create
  const skipNextMsgLoadRef = useRef(false)

  // ── Load sessions on mount ──────────────────────────────────────────────────
  useEffect(() => {
    api.get<ChatSession[]>('/chat/sessions').then(({ data }) => {
      if (data) {
        setSessions(data)
        if (data.length > 0) setActiveId(data[0].id)
      }
      setLoadingSessions(false)
    })
  }, [])

  // ── Reload messages when switching sessions ─────────────────────────────────
  useEffect(() => {
    if (!activeId) { setMessages([]); return }

    // Skip reload when we just created the session and added messages optimistically
    if (skipNextMsgLoadRef.current) {
      skipNextMsgLoadRef.current = false
      return
    }

    setLoadingMsgs(true)
    api.get<ApiMsg[]>(`/chat/sessions/${activeId}/messages`).then(({ data }) => {
      if (data) {
        setMessages(data.map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.created_at,
        })))
      }
      setLoadingMsgs(false)
    })
  }, [activeId])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    cleanupRef.current?.(); cleanupRef.current = null
    setActiveId(null)
    setMessages([])
    setStreaming(false)
    setError(null)
    setInput('')
    setAnimatingTitle(null)
    if (taRef.current) taRef.current.style.height = 'auto'
  }, [])

  const selectSession = useCallback((id: string) => {
    if (streaming || id === activeId) return
    cleanupRef.current?.(); cleanupRef.current = null
    setActiveId(id)
    setStreaming(false)
    setError(null)
    setAnimatingTitle(null)
  }, [streaming, activeId])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setError(null)

    let sid = activeId

    if (!sid) {
      // Create session with placeholder title — real title arrives asynchronously below
      const { data, error: err } = await api.post<ChatSession>('/chat/sessions', { title: 'New Chat' })
      if (err || !data) { setError(err ?? 'Failed to start chat'); return }

      sid = data.id
      // Mark: skip the next messages-load triggered by setActiveId so optimistic bubbles survive
      skipNextMsgLoadRef.current = true
      setActiveId(data.id)
      setSessions(prev => [data, ...prev])

      // Simulate async AI title generation (~1 s delay)
      const capturedSid = data.id
      const capturedText = text
      const delay = 900 + Math.random() * 400
      setTimeout(async () => {
        const aiTitle = generateTitle(capturedText)
        const { error: titleErr } = await api.patch<ChatSession>(`/chat/sessions/${capturedSid}`, { title: aiTitle })
        if (!titleErr) {
          setSessions(prev => prev.map(s => s.id === capturedSid ? { ...s, title: aiTitle } : s))
          // Trigger typewriter animation in the header
          setAnimatingTitle({ id: capturedSid, title: aiTitle })
          setTimeout(() => setAnimatingTitle(null), aiTitle.length * 28 + 400)
        }
      }, delay)
    }

    const userMsgId = uid()
    const asstMsgId = uid()
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user' as const, content: text, timestamp: new Date().toISOString() },
      { id: asstMsgId, role: 'assistant' as const, content: '', timestamp: new Date().toISOString(), streaming: true },
    ])
    setStreaming(true)

    cleanupRef.current = createSSE(
      `/api/chat/sessions/${sid}/stream?message=${encodeURIComponent(text)}`,
      {
        onToken: t => setMessages(prev =>
          prev.map(m => m.id === asstMsgId ? { ...m, content: m.content + t } : m)),
        onDone: () => {
          setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, streaming: false } : m))
          setStreaming(false); cleanupRef.current = null
        },
        onError: () => {
          setMessages(prev => prev.map(m =>
            m.id === asstMsgId ? { ...m, content: m.content || 'Sorry, an error occurred. Please try again.', streaming: false } : m))
          setStreaming(false)
          setError('Connection error. Please try again.')
          cleanupRef.current = null
        },
      },
    )
  }, [input, streaming, activeId])

  const handleRename = useCallback(async (sessionId: string, title: string) => {
    const { error: err } = await api.patch(`/chat/sessions/${sessionId}`, { title })
    if (!err) setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s))
  }, [])

  const handleShare = useCallback((sessionId: string) => {
    const url = `${window.location.origin}/ai_assistant?session=${sessionId}`
    navigator.clipboard.writeText(url).catch(() => {})
    setShareToast(true)
    setTimeout(() => setShareToast(false), 2500)
  }, [])

  const handleDelete = useCallback(async (sessionId: string) => {
    const { error: err } = await api.delete<null>(`/chat/sessions/${sessionId}`)
    if (!err) {
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeId === sessionId) startNewChat()
    }
  }, [activeId, startNewChat])

  const activeSession = sessions.find(s => s.id === activeId) ?? null

  // ── Derived header title ────────────────────────────────────────────────────
  const headerTitleNode = (() => {
    if (animatingTitle?.id === activeId) {
      return <TypewriterText text={animatingTitle.title} speed={26} />
    }
    if (activeSession?.title && activeSession.title !== 'New Chat') {
      return <>{activeSession.title}</>
    }
    if (activeId) return <>New Chat</>
    return <>AI Assistant</>
  })()

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: "'DM Sans', sans-serif", backgroundColor: '#fff' }}>

      {/* ════════════ Library panel ════════════ */}
      <div style={{
        width: 252, flexShrink: 0, display: 'flex', flexDirection: 'column',
        height: '100%', borderRight: '1px solid #f0f0f0', backgroundColor: '#fafafa',
      }}>
        <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <div style={{
            fontSize: 10.5, fontWeight: 700, color: '#aaa',
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10,
          }}>Chat History</div>
          <button
            onClick={startNewChat}
            onMouseEnter={e => { const b = e.currentTarget; b.style.borderColor = '#7c3aed'; b.style.color = '#7c3aed' }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.borderColor = '#ddd'; b.style.color = '#666' }}
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 7,
              border: '1.5px dashed #ddd', backgroundColor: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
              fontSize: 12.5, color: '#666', fontFamily: "'DM Sans', sans-serif",
              transition: 'border-color 0.12s, color 0.12s',
            }}
          >
            <Plus size={13} style={{ flexShrink: 0 }} />
            New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {loadingSessions ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #eee', borderTopColor: '#7c3aed', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#ccc', fontSize: 12.5, paddingTop: 24 }}>No chats yet</div>
          ) : sessions.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              disabled={streaming}
              onSelect={() => selectSession(s.id)}
              onRename={title => handleRename(s.id, title)}
              onShare={() => handleShare(s.id)}
              onDelete={() => handleDelete(s.id)}
            />
          ))}
        </div>
      </div>

      {/* ════════════ Chat panel ════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '11px 22px', borderBottom: '1px solid #f0f0f0',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <MessageSquare size={14} style={{ color: 'white' }} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.3 }}>
              {headerTitleNode}
            </div>
            <div style={{ fontSize: 11, color: '#aaa' }}>
              {activeSession
                ? `Started ${timeAgo(activeSession.created_at)}`
                : 'Start a new conversation below'}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loadingMsgs ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #eee', borderTopColor: '#7c3aed', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={20} style={{ color: 'white' }} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>How can I help you?</p>
              <p style={{ fontSize: 13, color: '#888', textAlign: 'center', maxWidth: 340, margin: 0 }}>
                Ask anything about your documents.
              </p>
            </div>
          ) : (
            <>
              {messages.map(m => <ChatBubble key={m.id} message={m} />)}
              <div ref={endRef} />
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '0 24px 10px', padding: '7px 12px', backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 7, fontSize: 12.5, color: '#e53e3e', flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: '10px 22px 16px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            backgroundColor: '#f8f8f8', border: '1.5px solid #e5e5e5',
            borderRadius: 12, padding: '0 6px 0 14px',
            transition: 'border-color 0.15s',
          }}
            onFocusCapture={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#7c3aed'}
            onBlurCapture={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e5e5'}
          >
            <textarea
              ref={taRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                const ta = e.target
                ta.style.height = 'auto'
                ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={streaming}
              style={{
                flex: 1, border: 'none', outline: 'none', resize: 'none',
                padding: '10px 0', margin: 0,
                fontSize: 13.5, lineHeight: 1.5, backgroundColor: 'transparent',
                color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif",
                maxHeight: 160, overflowY: 'auto',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || streaming}
              style={{
                width: 32, height: 32, borderRadius: 8, border: 'none', flexShrink: 0,
                backgroundColor: !input.trim() || streaming ? '#e8e8e8' : '#1a1a1a',
                cursor: !input.trim() || streaming ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: !input.trim() || streaming ? '#aaa' : 'white',
                transition: 'background-color 0.12s',
              }}
            >
              {streaming
                ? <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid #bbb', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                : <Send size={13} />}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#ccc', textAlign: 'center', marginTop: 6 }}>
            Responses are generated from your document knowledge base.
          </p>
        </div>
      </div>

      {/* Share toast */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#1a1a1a', color: 'white', padding: '9px 18px',
          borderRadius: 8, fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', zIndex: 9999, pointerEvents: 'none',
        }}>
          Link copied to clipboard!
        </div>
      )}
    </div>
  )
}
