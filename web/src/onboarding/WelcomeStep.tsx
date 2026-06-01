import { Button } from '../atoms/Button'

interface WelcomeStepProps {
  onNext: () => void
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-ai-light text-3xl">
        🌮
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-text-primary">Hola, soy Miguelito</h1>
        <p className="text-base text-text-secondary max-w-sm">
          Tu tutor de español personal que vive completamente en tu navegador — sin servidores, sin datos enviados a ningún lado.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xl">🔒</span>
          <div>
            <p className="text-sm font-medium text-text-primary">Privado por defecto</p>
            <p className="text-xs text-text-secondary">El modelo de IA corre en tu dispositivo</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xl">💬</span>
          <div>
            <p className="text-sm font-medium text-text-primary">Conversación natural</p>
            <p className="text-xs text-text-secondary">Practica español con correcciones contextuales</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left">
          <span className="text-xl">📱</span>
          <div>
            <p className="text-sm font-medium text-text-primary">Sin instalación</p>
            <p className="text-xs text-text-secondary">Funciona directo en el navegador</p>
          </div>
        </div>
      </div>

      <Button onClick={onNext} className="w-full max-w-xs py-3">
        Empezar →
      </Button>
    </div>
  )
}
