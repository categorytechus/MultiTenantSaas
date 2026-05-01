import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, MessageSquare, Trash2, Wifi, WifiOff, Zap } from 'lucide-react'
import { useChat } from '../hooks/useChat'
import { ChatMessage } from '../types'
import { Button } from '../components/ui/Button'

// ── Thinking animation ────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </span>
  )
}

// ── Single chat bubble ────────────────────────────────────────────────────────
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 14,
      }}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 8,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <MessageSquare size={13} style={{ color: 'white' }} />
        </div>
      )}

      <div
        style={{
          maxWidth: '70%',
          minWidth: 48,
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
            backgroundColor: isUser ? '#f4f4f5' : '#1a1a1a',
            color: isUser ? '#1a1a1a' : '#ffffff',
            fontSize: 13.5,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.streaming && !message.content ? (
            <ThinkingDots />
          ) : (
            <>
              {message.content}
              {message.streaming && <span style={{ opacity: 0.5, marginLeft: 2 }}>▋</span>}
            </>
          )}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: '#bbb',
            marginTop: 4,
            textAlign: isUser ? 'right' : 'left',
            paddingLeft: isUser ? 0 : 4,
            paddingRight: isUser ? 4 : 0,
          }}
        >
          {new Date(message.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>

      {/* User avatar */}
      {isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 8,
            flexShrink: 0,
            marginTop: 2,
            color: 'white',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          U
        </div>
      )}
    </div>
  )
}

// ── Quick action buttons ──────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Recent documents', icon: '📄' },
  { label: 'Summarize features', icon: '✨' },
  { label: 'Get help', icon: '❓' },
]

// ── Main chat page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { messages, streaming, connected, error, sendMessage, clearMessages } = useChat()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const adjustTextarea = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await sendMessage(text)
  }, [input, streaming, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleQuickAction = (label: string) => {
    setInput(label)
    textareaRef.current?.focus()
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: "'DM Sans', sans-serif",
        backgroundColor: '#fff',
      }}
    >
      {/* Chat header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MessageSquare size={15} style={{ color: 'white' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>AI Assistant</h1>
            <p style={{ fontSize: 11.5, color: '#aaa' }}>Ask anything about your documents</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Connection indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {connected ? (
              <>
                <Wifi size={13} style={{ color: '#16a34a' }} />
                <span style={{ fontSize: 11.5, color: '#16a34a' }}>Connected</span>
              </>
            ) : (
              <>
                <WifiOff size={13} style={{ color: '#aaa' }} />
                <span style={{ fontSize: 11.5, color: '#aaa' }}>Not connected</span>
              </>
            )}
          </div>

          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              title="Clear conversation"
              style={{
                padding: '5px 8px',
                border: '1px solid #e5e5e5',
                borderRadius: 6,
                backgroundColor: 'white',
                cursor: 'pointer',
                color: '#888',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
        }}
      >
        {messages.length === 0 ? (
          // Empty state
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              <Zap size={24} style={{ color: 'white' }} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>
              How can I help you today?
            </h2>
            <p style={{ fontSize: 13, color: '#888', textAlign: 'center', maxWidth: 360 }}>
              Ask me anything about your documents. I'll search through your knowledge base and provide accurate answers.
            </p>

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => handleQuickAction(qa.label)}
                  style={{
                    padding: '8px 14px',
                    border: '1px solid #e5e5e5',
                    borderRadius: 20,
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    color: '#555',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'background-color 0.12s',
                  }}
                  onMouseEnter={(e) => { ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f5f5f5' }}
                  onMouseLeave={(e) => { ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'white' }}
                >
                  <span>{qa.icon}</span>
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error bar */}
      {error && (
        <div
          style={{
            margin: '0 24px 12px',
            padding: '8px 14px',
            backgroundColor: '#fff5f5',
            border: '1px solid #fed7d7',
            borderRadius: 7,
            fontSize: 12.5,
            color: '#e53e3e',
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* Input area */}
      <div
        style={{
          padding: '14px 24px 20px',
          borderTop: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
            backgroundColor: '#fafafa',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: '10px 12px',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              adjustTextarea()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents... (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={streaming}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 13.5,
              lineHeight: 1.5,
              backgroundColor: 'transparent',
              color: '#1a1a1a',
              fontFamily: "'DM Sans', sans-serif",
              maxHeight: 160,
              overflowY: 'auto',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: 'none',
              backgroundColor: !input.trim() || streaming ? '#e5e5e5' : '#1a1a1a',
              cursor: !input.trim() || streaming ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: !input.trim() || streaming ? '#aaa' : 'white',
              flexShrink: 0,
              transition: 'background-color 0.12s',
            }}
          >
            {streaming ? (
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: '2px solid #aaa',
                  borderTopColor: 'transparent',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#ccc', textAlign: 'center', marginTop: 8 }}>
          Responses are generated from your document knowledge base via RAG.
        </p>
      </div>
    </div>
  )
}
