import React from 'react'
import { DocumentStatus } from '../../types'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'orange' | 'blue' | 'purple'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[#f5f5f5] text-[#555]',
  success: 'bg-green-50 text-green-700 border border-green-200',
  warning: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  error: 'bg-red-50 text-red-700 border border-red-200',
  orange: 'bg-orange-50 text-orange-700 border border-orange-200',
  blue: 'bg-blue-50 text-blue-700 border border-blue-200',
  purple: 'bg-purple-50 text-purple-700 border border-purple-200',
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        variantStyles[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const map: Record<DocumentStatus, { variant: BadgeVariant; label: string }> = {
    processing: { variant: 'warning', label: 'Processing' },
    ready: { variant: 'success', label: 'Ready' },
    failed: { variant: 'error', label: 'Failed' },
    blocked: { variant: 'orange', label: 'Blocked' },
  }
  const config = map[status] ?? { variant: 'default', label: status }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
