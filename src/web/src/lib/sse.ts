import { getAccessToken } from './auth'

export interface SSEOptions {
  onToken: (token: string) => void
  onDone: () => void
  onError: (error: Event) => void
}

/**
 * Creates an EventSource connection to an SSE endpoint.
 * Auth token is passed as a query param since EventSource doesn't
 * support custom headers.
 *
 * @returns A cleanup function to close the connection.
 */
export function createSSE(url: string, options: SSEOptions): () => void {
  const token = getAccessToken()
  const separator = url.includes('?') ? '&' : '?'
  const fullUrl = token ? `${url}${separator}token=${encodeURIComponent(token)}` : url

  const source = new EventSource(fullUrl)

  source.onmessage = (event) => {
    if (event.data === '[DONE]') {
      options.onDone()
      source.close()
      return
    }
    options.onToken(event.data)
  }

  source.onerror = (event) => {
    options.onError(event)
    source.close()
  }

  // Return cleanup function
  return () => {
    source.close()
  }
}

/**
 * Creates an SSE connection for agent task streaming.
 * Handles structured JSON events with step progress.
 */
export interface AgentSSEOptions {
  onStep: (step: { name: string; status: string; detail?: string }) => void
  onResult: (result: unknown) => void
  onDone: () => void
  onError: (error: Event) => void
}

export function createAgentSSE(url: string, options: AgentSSEOptions): () => void {
  const token = getAccessToken()
  const separator = url.includes('?') ? '&' : '?'
  const fullUrl = token ? `${url}${separator}token=${encodeURIComponent(token)}` : url

  const source = new EventSource(fullUrl)

  source.onmessage = (event) => {
    if (event.data === '[DONE]') {
      options.onDone()
      source.close()
      return
    }

    try {
      const parsed = JSON.parse(event.data)
      if (parsed.type === 'step') {
        options.onStep(parsed)
      } else if (parsed.type === 'result') {
        options.onResult(parsed.data)
      }
    } catch {
      // Raw token – treat as step detail
      options.onStep({ name: 'progress', status: 'running', detail: event.data })
    }
  }

  source.onerror = (event) => {
    options.onError(event)
    source.close()
  }

  return () => {
    source.close()
  }
}
