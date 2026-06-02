import { Settings } from 'lucide-react'
import { Button } from '../atoms/Button'

interface ChatHeaderProps {
  modelName: string
  isInitializing: boolean
  onSettingsClick: () => void
}

export function ChatHeader({ modelName, isInitializing, onSettingsClick }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <img src="/miguelito-avatar.png" className="h-8 w-8 rounded-full" alt="Miguelito" />
        {isInitializing ? (
          <span className="flex items-center gap-1 text-xs text-text-tertiary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
            cargando…
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-text-tertiary">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            {modelName}
          </span>
        )}
      </div>
      <Button variant="icon" onClick={onSettingsClick} aria-label="Settings">
        <Settings size={20} />
      </Button>
    </header>
  )
}
