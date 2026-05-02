import { ApiResponse, AuthTokens } from '../types'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './auth'

const BASE_URL = '/api'

let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb)
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token))
  refreshSubscribers = []
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) {
      clearTokens()
      return null
    }
    const data: AuthTokens = await res.json()
    setTokens(data.access_token, data.refresh_token)
    return data.access_token
  } catch {
    clearTokens()
    return null
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const accessToken = getAccessToken()

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  // Only set Content-Type to JSON if we're not sending FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  let response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  })

  // 401 → attempt token refresh once
  if (response.status === 401 && accessToken) {
    if (!isRefreshing) {
      isRefreshing = true
      const newToken = await doRefresh()
      isRefreshing = false

      if (newToken) {
        onTokenRefreshed(newToken)
        // Retry with new token
        headers['Authorization'] = `Bearer ${newToken}`
        response = await fetch(`${BASE_URL}${path}`, {
          ...options,
          headers,
        })
      } else {
        // Refresh failed – redirect to login
        window.location.href = '/login'
        return { data: null, error: 'Unauthorized', status: 401 }
      }
    } else {
      // Another request is already refreshing; wait for it
      const newToken = await new Promise<string>((resolve) => {
        subscribeTokenRefresh(resolve)
      })
      headers['Authorization'] = `Bearer ${newToken}`
      response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
      })
    }
  }

  const status = response.status

  if (status === 204) {
    return { data: null, error: null, status }
  }

  let data: T | null = null
  let error: string | null = null

  try {
    const json = await response.json()
    if (response.ok) {
      data = json as T
    } else {
      error = json?.detail ?? json?.message ?? `Error ${status}`
    }
  } catch {
    error = response.ok ? null : `Error ${status}`
  }

  return { data, error, status }
}

// Convenience methods
export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}
