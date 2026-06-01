import { AppProvider, useApp } from './context/AppContext'
import { Chat } from './organisms/Chat'
import { OnboardingFlow } from './onboarding/OnboardingFlow'
import { AVAILABLE_MODELS } from './lib/types'

function AppShell() {
  const { phase, modelId } = useApp()

  if (phase.type === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <span className="text-3xl">🌮</span>
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
        <span className="text-4xl">🌮</span>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-text-primary">Iniciando Miguelito</p>
          <p className="text-sm text-text-secondary">Cargando {model?.name ?? modelId}…</p>
        </div>
        <div className="w-full max-w-xs flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
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
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}
