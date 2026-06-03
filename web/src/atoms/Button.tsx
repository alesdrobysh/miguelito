import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'icon'
  size?: 'sm' | 'md'
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-user disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' &&
          'bg-primary text-white hover:bg-primary-dark active:bg-primary-dark',
        variant === 'ghost' &&
          'text-text-secondary hover:bg-surface-input active:bg-border',
        variant === 'icon' &&
          'h-9 w-9 rounded-full text-text-secondary hover:bg-surface-input active:bg-border',
        variant !== 'icon' && size === 'sm' && 'gap-1.5 px-3 py-1.5 text-sm',
        variant !== 'icon' && size === 'md' && 'gap-2 px-4 py-2 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
