import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { isAuthenticated } from '../lib/auth'
import { Spinner } from './ui/Spinner'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: string
  userRole?: string
}

export function ProtectedRoute({ children, requiredRole, userRole }: ProtectedRouteProps) {
  const location = useLocation()

  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Role guard
  if (requiredRole && userRole && requiredRole !== userRole) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[#666]">You don't have permission to view this page.</p>
      </div>
    )
  }

  return <>{children}</>
}

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-white">
      <Spinner size="lg" />
    </div>
  )
}
