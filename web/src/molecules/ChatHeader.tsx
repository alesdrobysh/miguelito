import { Settings, Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '../atoms/Button'
import { useTheme } from '../context/ThemeContext'
import type { Theme } from '../lib/theme'

interface ChatHeaderProps {
  modelName: string
  isInitializing: boolean
  onSettingsClick: () => void
}

const THEME_CYCLE: Theme[] = ['light', 'dark', 'system']
const THEME_ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

export function ChatHeader({ modelName, isInitializing, onSettingsClick }: ChatHeaderProps) {
  const { theme, setTheme } = useTheme()
  const ThemeIcon = THEME_ICONS[theme]

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]
    setTheme(next)
  }

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-user px-4 py-3">
      <div className="flex items-center gap-2">
        <img src={import.meta.env.BASE_URL + "miguelito-avatar.png"} className="h-8 w-8 rounded-full" alt="Miguelito" />
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
      <div className="flex items-center gap-1">
        <Button variant="icon" onClick={cycleTheme} aria-label={`Tema: ${theme}`}>
          <ThemeIcon size={18} />
        </Button>
        <Button variant="icon" onClick={onSettingsClick} aria-label="Settings">
          <Settings size={20} />
        </Button>
      </div>
    </header>
  )
}
