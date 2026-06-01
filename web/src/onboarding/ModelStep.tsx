import { useState } from 'react'
import { Button } from '../atoms/Button'
import { cn } from '../lib/cn'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, OPENROUTER_MODELS, DEFAULT_OPENROUTER_MODEL_ID } from '../lib/types'

interface ModelStepProps {
  onSelectWebLLM: (modelId: string) => Promise<void>
  onSelectOpenRouter: (key: string, model: string, evaluatorModel?: string) => Promise<void>
}

export function ModelStep({ onSelectWebLLM, onSelectOpenRouter }: ModelStepProps) {
  const [tab, setTab] = useState<'webllm' | 'openrouter'>('webllm')
  const [selectedWebLLM, setSelectedWebLLM] = useState(DEFAULT_MODEL_ID)
  const [customWebLLM, setCustomWebLLM] = useState('')
  const [customOR, setCustomOR] = useState(DEFAULT_OPENROUTER_MODEL_ID)
  const [customEvaluator, setCustomEvaluator] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleContinue = async () => {
    setError('')
    if (tab === 'webllm') {
      const modelId = selectedWebLLM === 'custom' ? customWebLLM.trim() : selectedWebLLM
      if (!modelId) {
        setError('Introduce un ID de modelo WebLLM')
        return
      }
      setLoading(true)
      await onSelectWebLLM(modelId)
      return
    }
    if (!apiKey.trim()) {
      setError('Introduce tu API key de OpenRouter')
      return
    }
    const orModel = customOR.trim()
    if (!orModel) {
      setError('Introduce un ID de modelo de OpenRouter')
      return
    }

    const orEvaluator = customEvaluator.trim() || orModel
    
    setLoading(true)
    await onSelectOpenRouter(apiKey.trim(), orModel, orEvaluator)
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-10">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">Elige un modelo</h2>
        <p className="mt-1 text-sm text-text-secondary">¿Cómo quieres ejecutar el tutor?</p>
      </div>

      <div className="flex rounded-xl border border-border bg-surface-input p-1">
        <button
          onClick={() => setTab('webllm')}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
            tab === 'webllm' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          En tu navegador
        </button>
        <button
          onClick={() => setTab('openrouter')}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
            tab === 'openrouter' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          Con API (OpenRouter)
        </button>
      </div>

      {tab === 'webllm' ? (
        <>
          <div className="flex flex-col gap-2">
            {AVAILABLE_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => setSelectedWebLLM(model.id)}
                className={cn(
                  'flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors',
                  selectedWebLLM === model.id ? 'border-primary bg-primary-light' : 'border-border bg-white hover:bg-slate-50',
                )}
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
            <button
              onClick={() => setSelectedWebLLM('custom')}
              className={cn(
                'flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors',
                selectedWebLLM === 'custom' ? 'border-primary bg-primary-light' : 'border-border bg-white hover:bg-slate-50',
              )}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-text-primary">Otro...</span>
                <span className="text-xs text-text-secondary">Introduce un ID de modelo WebLLM</span>
              </div>
            </button>
            {selectedWebLLM === 'custom' && (
              <input
                value={customWebLLM}
                onChange={(e) => setCustomWebLLM(e.target.value)}
                placeholder="Ej: Llama-3-8B-Instruct-v0.1-q4f16_1-MLC"
                className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>
          <p className="text-center text-xs text-text-tertiary">
            Requiere WebGPU (Chrome 113+ o Edge 113+). Se descarga una vez y queda guardado.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">API Key de OpenRouter</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 pr-10 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary hover:text-text-secondary"
                >
                  {showKey ? 'Ocultar' : 'Ver'}
                </button>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                Obtén una clave gratis en{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-primary underline">
                  openrouter.ai/keys
                </a>
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Modelo de Chat</label>
              <input
                value={customOR}
                onChange={(e) => setCustomOR(e.target.value)}
                placeholder="Ej: google/gemini-2.0-flash-001"
                className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Modelo Evaluador (Post-procesamiento)</label>
              <input
                value={customEvaluator}
                onChange={(e) => setCustomEvaluator(e.target.value)}
                placeholder="Ej: deepseek/deepseek-chat"
                className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-[10px] text-text-tertiary">
                Vacio = usar el mismo que el de chat
              </p>
            </div>
          </div>
          <p className="text-center text-xs text-text-tertiary">
            Sin descarga. La clave se guarda solo en tu navegador.
          </p>
        </>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <Button onClick={handleContinue} disabled={loading} className="w-full py-3">
        {loading
          ? (tab === 'webllm' ? 'Iniciando descarga…' : 'Conectando…')
          : (tab === 'webllm' ? 'Descargar y empezar →' : 'Empezar con OpenRouter →')}
      </Button>
    </div>
  )
}
