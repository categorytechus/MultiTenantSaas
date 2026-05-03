import { useState, useCallback, useRef } from 'react'
import { ChatMessage, ChatSession } from '../types'
import { api } from '../lib/api'
import { createSSE } from '../lib/sse'

function generateId() {
  return Math.random().toString(36).slice(2)
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const initSession = useCallback(async () => {
    const { data, error: err } = await api.post<ChatSession>('/chat/sessions', {})
    if (err || !data) {
      setError(err ?? 'Failed to create chat session')
      return null
    }
    setSessionId(data.id)
    setConnected(true)
    return data.id
  }, [])

  const sendMessage = useCallback(
    async (content: string) => {
      if (streaming) return
      setError(null)

      // Ensure we have a session
      let currentSessionId = sessionId
      if (!currentSessionId) {
        currentSessionId = await initSession()
        if (!currentSessionId) return
      }

      // Add user message
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }

      // Add placeholder for assistant streaming message
      const assistantMsgId = generateId()
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        streaming: true,
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setStreaming(true)

      const url = `/api/chat/sessions/${currentSessionId}/stream?message=${encodeURIComponent(content)}`

      const cleanup = createSSE(url, {
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + token } : m
            )
          )
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, streaming: false } : m
            )
          )
          setStreaming(false)
          cleanupRef.current = null
        },
        onError: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content || 'Sorry, an error occurred. Please try again.', streaming: false }
                : m
            )
          )
          setStreaming(false)
          setError('Connection error. Please try again.')
          cleanupRef.current = null
        },
      })

      cleanupRef.current = cleanup
    },
    [sessionId, streaming, initSession]
  )

  const clearMessages = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
    setMessages([])
    setSessionId(null)
    setStreaming(false)
    setConnected(false)
    setError(null)
  }, [])

  return {
    messages,
    sessionId,
    streaming,
    connected,
    error,
    sendMessage,
    clearMessages,
    initSession,
  }
}
