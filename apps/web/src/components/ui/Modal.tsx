import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={[
          'relative bg-white rounded-lg shadow-lg w-full',
          sizeStyles[size],
        ].join(' ')}
        style={{ border: '1px solid #ebebeb' }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0]">
            <h2 className="text-sm font-semibold text-[#1a1a1a]">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#f5f5f5] text-[#888] hover:text-[#1a1a1a] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {/* Body */}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
