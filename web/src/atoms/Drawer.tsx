import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button } from './Button'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 transition-opacity"
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-surface-user shadow-xl transition-transform duration-300 sm:w-[90vw] md:w-[80vw] lg:w-[70vw]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <Button variant="icon" onClick={onClose} aria-label="Close drawer">
            <X size={20} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  )
}
