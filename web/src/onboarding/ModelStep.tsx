import { useState } from 'react'
import { Button } from '../atoms/Button'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from '../lib/types'

interface ModelStepProps {
  onSelect: (modelId: string) => Promise<void>
}

export function ModelStep({ onSelect }: ModelStepProps) {
  const [selected, setSelected] = useState(DEFAULT_MODEL_ID)
  const [loading, setLoading] = useState(false)

  const handleContinue = async () => {
    setLoading(true)
    await onSelect(selected)
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-10">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">Elige un modelo</h2>
        <p className="mt-2 text-sm text-text-secondary">
          El modelo se descargará una vez y se guardará en tu navegador
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {AVAILABLE_MODELS.map((model) => (
          <button
            key={model.id}
            onClick={() => setSelected(model.id)}
            className={`flex items-center justify-between rounded-xl border-2 px-4 py-4 text-left transition-colors ${
              selected === model.id
                ? 'border-primary bg-primary-light'
                : 'border-border bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-text-primary">{model.name}</span>
              <span className="text-xs text-text-secondary">{model.description}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs font-medium text-text-secondary">{model.size}</span>
              {model.id === DEFAULT_MODEL_ID && (
                <span className="rounded bg-accent-ai-light px-1.5 py-0.5 text-[10px] font-semibold text-accent-ai">
                  Recomendado
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-text-tertiary">
        Necesitas WebGPU en tu navegador (Chrome 113+ o Edge 113+)
      </p>

      <Button onClick={handleContinue} disabled={loading} className="w-full py-3">
        {loading ? 'Iniciando descarga…' : 'Descargar y empezar →'}
      </Button>
    </div>
  )
}
