import { useState, useEffect } from 'react'
import { Button } from '../atoms/Button'
import { cn } from '../lib/cn'
import { DEFAULT_OPENROUTER_MODEL_ID, DEFAULT_EVALUATOR_MODEL_ID } from '../lib/types'

interface ModelStepProps {
  onSelectWebLLM: (modelId: string) => Promise<void>
  onSelectOpenRouter: (key: string, model: string, evaluatorModel?: string) => Promise<void>
}

// Display metadata for known WebLLM models
const WEBLLM_META: Record<string, { name: string; size: string }> = {
  'Llama-3.2-1B-Instruct-q4f32_1-MLC': { name: 'Llama 3.2 1B', size: '1.3 GB' },
  'Llama-3.2-3B-Instruct-q4f32_1-MLC': { name: 'Llama 3.2 3B', size: '2.1 GB' },
  'Phi-3.5-mini-instruct-q4f16_1-MLC': { name: 'Phi 3.5 Mini', size: '2.2 GB' },
}

type WebGPUStatus = 'detecting' | 'supported' | 'unsupported'

async function detectBestModel(): Promise<{ status: WebGPUStatus; modelId: string; reason: string }> {
  if (!('gpu' in navigator)) {
    return { status: 'unsupported', modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', reason: '' }
  }
  try {
    const adapter = await (navigator as { gpu: { requestAdapter: () => Promise<GPUAdapter | null> } }).gpu.requestAdapter()
    if (!adapter) {
      return { status: 'unsupported', modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', reason: '' }
    }

    const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? null

    let gpuDesc = ''
    try {
      const info = await (adapter as unknown as { requestAdapterInfo: () => Promise<{ description?: string; vendor?: string }> }).requestAdapterInfo()
      gpuDesc = (info.description ?? info.vendor ?? '').toLowerCase()
    } catch { /* not all browsers support this */ }

    const isLowEnd = /intel|mobile|integrated/i.test(gpuDesc) || (mem !== null && mem < 4)
    const isHighEnd = !isLowEnd && (mem === null || mem >= 8) && !/intel/i.test(gpuDesc)

    if (isLowEnd) {
      return { status: 'supported', modelId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', reason: 'Modelo ligero para tu dispositivo' }
    }
    if (isHighEnd) {
      return { status: 'supported', modelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC', reason: 'Mejor calidad para tu dispositivo' }
    }
    return {
      status: 'supported',
      modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
      reason: mem ? `Recomendado para ${mem} GB de RAM` : 'Modelo equilibrado por defecto',
    }
  } catch {
    return { status: 'supported', modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', reason: 'Modelo equilibrado por defecto' }
  }
}

export function ModelStep({ onSelectWebLLM, onSelectOpenRouter }: ModelStepProps) {
  const [tab, setTab] = useState<'webllm' | 'openrouter'>('webllm')

  // WebLLM state
  const [webGpuStatus, setWebGpuStatus] = useState<WebGPUStatus>('detecting')
  const [detectedReason, setDetectedReason] = useState('')
  const [webllmModel, setWebllmModel] = useState('')

  // OpenRouter state
  const [customOR, setCustomOR] = useState(DEFAULT_OPENROUTER_MODEL_ID)
  const [customEvaluator, setCustomEvaluator] = useState(DEFAULT_EVALUATOR_MODEL_ID)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    detectBestModel().then(({ status, modelId, reason }) => {
      setWebGpuStatus(status)
      setWebllmModel(modelId)
      setDetectedReason(reason)
    })
  }, [])

  const handleContinue = async () => {
    setError('')
    if (tab === 'webllm') {
      const modelId = webllmModel.trim()
      if (!modelId) { setError('Introduce un ID de modelo WebLLM'); return }
      setLoading(true)
      await onSelectWebLLM(modelId)
      return
    }
    if (!apiKey.trim()) { setError('Introduce tu API key de OpenRouter'); return }
    if (!customOR.trim()) { setError('Introduce un ID de modelo de OpenRouter'); return }
    setLoading(true)
    await onSelectOpenRouter(apiKey.trim(), customOR.trim(), customEvaluator.trim() || customOR.trim())
  }

  const detectedMeta = WEBLLM_META[webllmModel]

  return (
    <div className="flex flex-col gap-6 px-6 py-10">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text-primary">Elige un modelo</h2>
        <p className="mt-1 text-sm text-text-secondary">¿Cómo quieres ejecutar el tutor?</p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-xl border border-border bg-surface-input p-1">
        <button
          onClick={() => setTab('webllm')}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
            tab === 'webllm' ? 'bg-surface-user text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          En tu navegador
        </button>
        <button
          onClick={() => setTab('openrouter')}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
            tab === 'openrouter' ? 'bg-surface-user text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          Con API (OpenRouter)
        </button>
      </div>

      {tab === 'webllm' ? (
        <>
          {/* Not supported warning */}
          {webGpuStatus === 'unsupported' && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              ⚠️ WebGPU no está disponible en este navegador. Puede que no funcione. Prueba Chrome 113+ o Edge 113+.
            </div>
          )}

          {/* Detected model card */}
          <div className={cn(
            'flex items-center justify-between rounded-xl border-2 px-4 py-3',
            webGpuStatus === 'detecting' ? 'border-border bg-surface-user opacity-60' : 'border-primary bg-primary-light',
          )}>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-text-primary">
                {webGpuStatus === 'detecting'
                  ? 'Detectando tu dispositivo…'
                  : (detectedMeta?.name ?? webllmModel)}
              </span>
              {webGpuStatus !== 'detecting' && detectedReason && (
                <span className="text-xs text-text-secondary">{detectedReason}</span>
              )}
            </div>
            {detectedMeta && webGpuStatus !== 'detecting' && (
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs font-medium text-text-secondary">{detectedMeta.size}</span>
                <span className="rounded bg-accent-ai-light px-1.5 py-0.5 text-[10px] font-semibold text-accent-ai">
                  Recomendado
                </span>
              </div>
            )}
          </div>

          {/* Free model ID input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">ID del modelo (editable)</label>
            <input
              value={webllmModel}
              onChange={(e) => setWebllmModel(e.target.value)}
              placeholder="Ej: Llama-3.2-3B-Instruct-q4f32_1-MLC"
              disabled={webGpuStatus === 'detecting'}
              className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {/* WebLLM notice */}
          <p className="rounded-lg bg-surface-ai px-3 py-2 text-center text-xs text-text-secondary">
            🔒 Todo funciona en tu navegador, sin enviar datos. Puede ser <strong>más lento</strong> y con <strong>menor calidad</strong> que una API externa.
          </p>
        </>
      ) : (
        <>
          {/* OpenRouter notice */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            ⚡ Más rápido y más capaz. Tus mensajes se envían al proveedor — <strong>no es local</strong>.
          </div>

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
              <p className="mt-1 text-[10px] text-text-tertiary">Vacío = usar el mismo que el de chat</p>
            </div>
          </div>

          <p className="text-center text-xs text-text-tertiary">
            Sin descarga. La clave se guarda solo en tu navegador.
          </p>
        </>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <Button onClick={handleContinue} disabled={loading || webGpuStatus === 'detecting' && tab === 'webllm'} className="w-full py-3">
        {loading
          ? (tab === 'webllm' ? 'Iniciando descarga…' : 'Conectando…')
          : (tab === 'webllm' ? 'Descargar y empezar →' : 'Empezar con OpenRouter →')}
      </Button>
    </div>
  )
}
