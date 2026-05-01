import React, { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import type { User } from './types'
import { ProtectedRoute, LoadingScreen } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

// Pages
import LoginPage from './routes/login'
import SignupPage from './routes/signup'
import DashboardPage from './routes/dashboard'
import DocumentsPage from './routes/documents'
import ChatPage from './routes/chat'
import AgentsPage from './routes/agents'
import UsersPage from './routes/users'
import AdminPage from './routes/admin'
import ProfilePage from './routes/profile'

// ── Auth context ──────────────────────────────────────────────────────────────
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

// ── Protected page wrapper ────────────────────────────────────────────────────
function ProtectedPage({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthContext()

  if (loading) return <LoadingScreen />

  return (
    <ProtectedRoute>
      <Layout user={user}>{children}</Layout>
    </ProtectedRoute>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
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
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedPage>
                <DashboardPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedPage>
                <DocumentsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedPage>
                <ChatPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/agents"
            element={
              <ProtectedPage>
                <AgentsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedPage>
                <UsersPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedPage>
                <AdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedPage>
                <ProfilePage />
              </ProtectedPage>
            }
          />

          {/* Default redirects */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
