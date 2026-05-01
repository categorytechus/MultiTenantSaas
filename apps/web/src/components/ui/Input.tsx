import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: React.ReactNode
  rightElement?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, leftIcon, rightElement, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-[#1a1a1a]">{label}</label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-[#999] pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            className={[
              'w-full rounded-md border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#1a1a1a]',
              'placeholder:text-[#aaa] outline-none',
              'focus:border-[#1a1a1a] focus:ring-1 focus:ring-[#1a1a1a]',
              'disabled:bg-[#f5f5f5] disabled:cursor-not-allowed',
              leftIcon ? 'pl-9' : '',
              rightElement ? 'pr-10' : '',
              error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : '',
              className,
            ].join(' ')}
            {...props}
          />
          {rightElement && (
            <span className="absolute right-2">{rightElement}</span>
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
