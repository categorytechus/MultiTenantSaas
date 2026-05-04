import React, { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import type { User } from './types'
import { ProtectedRoute, LoadingScreen } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

import LoginPage from './routes/login'
import SignupPage from './routes/signup'
import DashboardPage from './routes/dashboard'
import DocumentsPage from './routes/documents'
import ChatPage from './routes/chat'
import UsersPage from './routes/users'
import CreateUserPage from './routes/users/create'
import InviteUserPage from './routes/users/invite'
import EditUserPage from './routes/users/edit'
import AdminOrgsPage from './routes/admin/organizations'
import ProfilePage from './routes/profile'

interface AuthContextValue {
  user: User | null
  loading: boolean
  error: string | null
  logout: () => void
  refetch: () => void
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  error: null,
  logout: () => {},
  refetch: () => {},
})

export function useAuthContext() {
  return useContext(AuthContext)
}

function ProtectedPage({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()
  if (loading) return <LoadingScreen />
  return (
    <ProtectedRoute>
      <Layout user={user}>{children}</Layout>
    </ProtectedRoute>
  )
}

export default function App() {
  const auth = useAuth()
  if (auth.loading) return <LoadingScreen />

  return (
    <AuthContext.Provider
      value={{
        user: auth.user,
        loading: auth.loading,
        error: auth.error,
        logout: auth.logout,
        refetch: auth.refetch,
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
          <Route path="/documents" element={<ProtectedPage><DocumentsPage /></ProtectedPage>} />
          <Route path="/ai_assistant" element={<ProtectedPage><ChatPage /></ProtectedPage>} />
          <Route path="/chat" element={<Navigate to="/ai_assistant" replace />} />
          <Route path="/users" element={<ProtectedPage><UsersPage /></ProtectedPage>} />
          <Route path="/users/create" element={<ProtectedPage><CreateUserPage /></ProtectedPage>} />
          <Route path="/users/invite" element={<ProtectedPage><InviteUserPage /></ProtectedPage>} />
          <Route path="/users/:id/edit" element={<ProtectedPage><EditUserPage /></ProtectedPage>} />
          <Route path="/admin/organizations" element={<ProtectedPage><AdminOrgsPage /></ProtectedPage>} />
          <Route path="/profile" element={<ProtectedPage><ProfilePage /></ProtectedPage>} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
