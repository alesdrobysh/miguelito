import { useState, useCallback } from 'react'
import { Button } from '../atoms/Button'
import type { Profile } from '../lib/types'

const GOALS = [
  { value: 'viajes', label: '✈️ Viajes', desc: 'Comunicarme cuando viajo' },
  { value: 'trabajo', label: '💼 Trabajo', desc: 'Usar el español profesionalmente' },
  { value: 'charla', label: '💬 Conversar', desc: 'Hablar con amigos o familia' },
  { value: 'cultura', label: '📚 Cultura', desc: 'Series, libros, música' },
]

interface ProfileStepProps {
  onSave: (profile: Profile) => Promise<void>
}

export function ProfileStep({ onSave }: ProfileStepProps) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [customGoal, setCustomGoal] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)

  const effectiveGoal = showCustom ? customGoal.trim() : goal
  const canSubmit = name.trim() && effectiveGoal

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSaving(true)
    await onSave({ name: name.trim(), goal: effectiveGoal })
  }, [name, effectiveGoal, canSubmit, onSave])

  const handleSelectGoal = (value: string) => {
    setGoal(value)
    setShowCustom(false)
  }

  const handleSelectCustom = () => {
    setGoal('')
    setShowCustom(true)
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-10">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">Cuéntame sobre ti</h2>
        <p className="mt-2 text-sm text-text-secondary">Solo dos preguntas rápidas</p>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-text-secondary" htmlFor="name">
            ¿Cómo te llamas?
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre…"
            autoFocus
            className="rounded-xl border border-border-input bg-surface-input px-4 py-3 text-sm text-text-primary placeholder-text-tertiary transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text-secondary">¿Por qué aprendes español?</p>
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map((g) => (
              <button
                key={g.value}
                onClick={() => handleSelectGoal(g.value)}
                className={`flex flex-col gap-0.5 rounded-xl border-2 px-3 py-3 text-left transition-colors ${
                  !showCustom && goal === g.value
                    ? 'border-primary bg-primary-light'
                    : 'border-border bg-white hover:bg-slate-50'
                }`}
              >
                <span className="text-base">{g.label}</span>
                <span className="text-xs text-text-secondary">{g.desc}</span>
              </button>
            ))}
            <button
              onClick={handleSelectCustom}
              className={`col-span-2 flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-left transition-colors ${
                showCustom
                  ? 'border-primary bg-primary-light'
                  : 'border-border bg-white hover:bg-slate-50'
              }`}
            >
              <span className="text-base">✏️</span>
              <span className="text-sm text-text-secondary">Otro objetivo…</span>
            </button>
          </div>
          {showCustom && (
            <input
              type="text"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="Escribe tu objetivo…"
              autoFocus
              className="rounded-xl border border-border-input bg-surface-input px-4 py-3 text-sm text-text-primary placeholder-text-tertiary transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit || saving}
        className="w-full py-3"
      >
        {saving ? 'Guardando…' : 'Continuar →'}
      </Button>
    </div>
  )
}
