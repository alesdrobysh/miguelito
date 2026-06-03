import { AppProvider, useApp } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import { Chat } from './organisms/Chat'
import { OnboardingFlow } from './onboarding/OnboardingFlow'
import { AVAILABLE_MODELS } from './lib/types'

function AppShell() {
  const { phase, modelId } = useApp()

  if (phase.type === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <img src="/SCR-20260603-jsmp.jpeg" className="w-12 h-12 rounded-full" alt="Miguelito" />
        <p className="text-sm text-text-secondary">Iniciando…</p>
      </div>
    )
  }

  if (phase.type === 'onboarding') {
    return <OnboardingFlow step={phase.step} />
  }

  if (phase.type === 'initializing') {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
    const pct = Math.round(phase.progress * 100)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-8 text-center">
        <img src="/SCR-20260603-jsmp.jpeg" className="w-16 h-16 rounded-full" alt="Miguelito" />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-text-primary">Iniciando Miguelito</p>
          <p className="text-sm text-text-secondary">Cargando {model?.name ?? modelId}…</p>
        </div>
        <div className="w-full max-w-xs flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-input">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-text-tertiary line-clamp-1">{phase.text}</p>
        </div>
      </div>
    )
  }

  return <Chat />
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </ThemeProvider>
  )
}
