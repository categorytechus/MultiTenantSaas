import { useState, useEffect, useCallback } from 'react'
import { User, LoginPayload, RegisterPayload, AuthTokens } from '../types'
import { api } from '../lib/api'
import { setTokens, clearTokens, isAuthenticated } from '../lib/auth'

export interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: isAuthenticated(),
    error: null,
  })

  const fetchMe = useCallback(async () => {
    if (!isAuthenticated()) {
      setState({ user: null, loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    const { data, error } = await api.get<User>('/auth/me')
    if (data) {
      setState({ user: data, loading: false, error: null })
    } else {
      clearTokens()
      setState({ user: null, loading: false, error: error })
    }
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  const login = useCallback(async (payload: LoginPayload) => {
    setState((s) => ({ ...s, loading: true, error: null }))
    const { data, error } = await api.post<AuthTokens>('/auth/login', payload)
    if (data) {
      setTokens(data.access_token, data.refresh_token)
      const { data: user } = await api.get<User>('/auth/me')
      setState({ user, loading: false, error: null })
      return { success: true }
    } else {
      setState((s) => ({ ...s, loading: false, error }))
      return { success: false, error }
    }
  }, [])

  const register = useCallback(async (payload: RegisterPayload) => {
    setState((s) => ({ ...s, loading: true, error: null }))
    const { data, error } = await api.post<AuthTokens>('/auth/register', payload)
    if (data) {
      setTokens(data.access_token, data.refresh_token)
      const { data: user } = await api.get<User>('/auth/me')
      setState({ user, loading: false, error: null })
      return { success: true }
    } else {
      setState((s) => ({ ...s, loading: false, error }))
      return { success: false, error }
    }
  }, [])

  const logout = useCallback(() => {
    clearTokens()
    setState({ user: null, loading: false, error: null })
    window.location.href = '/login'
  }, [])

  return { ...state, login, register, logout, refetch: fetchMe }
}
