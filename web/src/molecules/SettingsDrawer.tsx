import { useState, useCallback, useEffect } from 'react'
import { subscribeDownloadProgress } from '../context/DownloadProgress'
import type { PerfilData } from '../context/AppContext'
import { Drawer } from '../atoms/Drawer'
import { Button } from '../atoms/Button'
import { cn } from '../lib/cn'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, DEFAULT_OPENROUTER_MODEL_ID, DEFAULT_EVALUATOR_MODEL_ID } from '../lib/types'
import type { Profile } from '../lib/types'
import type { ProviderType } from '../storage/db'

const VOCAB_BAND_LABELS: Record<string, string> = {
  top_1k: 'Top 1k',
  top_3k: 'Top 3k',
  top_6k: 'Top 6k',
  top_10k: 'Top 10k',
  top_50k: 'Top 50k',
  rare_or_unknown: 'Raro',
}

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  modelId: string
  evaluatorModelId: string
  providerType: ProviderType
  openrouterKey: string
  isChangingModel: boolean
  temperature: number
  profile: Profile | null
  perfilData: PerfilData | null
  onUpdateTemperature: (t: number) => void
  onChangeModel: (modelId: string) => Promise<void>
  onChangeProvider: (type: ProviderType, modelId: string, evaluatorModelId?: string, key?: string) => Promise<void>
  onUpdateProfile: (profile: Profile) => Promise<void>
  onClearChat: () => void
  onRefreshPerfilData: () => Promise<void>
  onAddInterest: (interest: string) => Promise<void>
  onRemoveInterest: (interest: string) => Promise<void>
}

export function SettingsDrawer({
  open,
  onClose,
  modelId,
  providerType,
  openrouterKey,
  isChangingModel,
  temperature,
  profile,
  perfilData,
  evaluatorModelId,
  onUpdateTemperature,
  onChangeModel,
  onChangeProvider,
  onUpdateProfile,
  onClearChat,
  onRefreshPerfilData,
  onAddInterest,
  onRemoveInterest,
}: SettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<'ia' | 'perfil'>('ia')
  const [loadProgress, setLoadProgress] = useState({ progress: 0, text: '' })
  const [confirmClear, setConfirmClear] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [nameInput, setNameInput] = useState(profile?.name ?? '')
  const [goalInput, setGoalInput] = useState(profile?.goal ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [newInterestInput, setNewInterestInput] = useState('')
  const [orKeyInput, setOrKeyInput] = useState(openrouterKey)
  const [showOrKey, setShowOrKey] = useState(false)
  const [editingProvider, setEditingProvider] = useState(false)
  const [providerTab, setProviderTab] = useState<ProviderType>(providerType)
  const [customOrModel, setCustomOrModel] = useState(
    providerType === 'openrouter' ? modelId : DEFAULT_OPENROUTER_MODEL_ID
  )
  const [customWebLLMModel, setCustomWebLLMModel] = useState(
    providerType === 'webllm' && !AVAILABLE_MODELS.find(m => m.id === modelId) ? modelId : ''
  )
  const [customEvaluatorModel, setCustomEvaluatorModel] = useState(
    providerType === 'openrouter' && evaluatorModelId !== modelId ? evaluatorModelId : DEFAULT_EVALUATOR_MODEL_ID
  )
  const [selectedWebLLMModelId, setSelectedWebLLMModelId] = useState<string>(
    providerType === 'webllm'
      ? (AVAILABLE_MODELS.find((m) => m.id === modelId) ? modelId : 'custom')
      : DEFAULT_MODEL_ID
  )

  useEffect(() => {
    if (open && activeTab === 'perfil') {
      onRefreshPerfilData()
    }
  }, [open, activeTab, onRefreshPerfilData])

  useEffect(() => {
    if (!isChangingModel) return
    setLoadProgress({ progress: 0, text: '' })
    return subscribeDownloadProgress((r) => setLoadProgress({ progress: r.progress, text: r.text }))
  }, [isChangingModel])

  const handleClearClick = useCallback(() => {
    if (confirmClear) {
      onClearChat()
      setConfirmClear(false)
      onClose()
    } else {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
    }
  }, [confirmClear, onClearChat, onClose])

  const handleEditProfile = useCallback(() => {
    setNameInput(profile?.name ?? '')
    setGoalInput(profile?.goal ?? '')
    setEditingProfile(true)
  }, [profile])

  const handleSaveProfile = useCallback(async () => {
    if (!nameInput.trim()) return
    setSavingProfile(true)
    await onUpdateProfile({ name: nameInput.trim(), goal: goalInput })
    setSavingProfile(false)
    setEditingProfile(false)
  }, [nameInput, goalInput, onUpdateProfile])

  return (
    <Drawer open={open} onClose={onClose} title="Ajustes">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('ia')}
            className={cn(
              'flex-1 border-b-2 py-2 text-sm font-medium transition-colors',
              activeTab === 'ia'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            )}
          >
            IA
          </button>
          <button
            onClick={() => setActiveTab('perfil')}
            className={cn(
              'flex-1 border-b-2 py-2 text-sm font-medium transition-colors',
              activeTab === 'perfil'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            )}
          >
            Perfil
          </button>
        </div>

        {activeTab === 'ia' ? (
          <div className="flex flex-col gap-6">
            {/* Proveedor */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Proveedor</p>
                {!editingProvider && (
                  <button onClick={() => setEditingProvider(true)} className="text-xs text-primary hover:underline">
                    Cambiar
                  </button>
                )}
              </div>

              {!editingProvider ? (
                <div className="rounded-lg bg-surface-ai px-3 py-2 text-sm">
                  {providerType === 'webllm' ? (
                    <p className="font-medium text-text-primary">En tu navegador (WebLLM)</p>
                  ) : (
                    <>
                      <p className="font-medium text-text-primary">OpenRouter</p>
                      <p className="text-xs text-text-secondary">{modelId}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex rounded-xl border border-border bg-surface-input p-1">
                    <button
                      onClick={() => setProviderTab('webllm')}
                      className={cn(
                        'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
                        providerTab === 'webllm' ? 'bg-surface-user text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      WebLLM
                    </button>
                    <button
                      onClick={() => setProviderTab('openrouter')}
                      className={cn(
                        'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
                        providerTab === 'openrouter' ? 'bg-surface-user text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      OpenRouter
                    </button>
                  </div>

                  {providerTab === 'webllm' && (
                    <div className="flex flex-col gap-2">
                      {AVAILABLE_MODELS.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedWebLLMModelId(m.id)}
                          className={cn(
                            'flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                            selectedWebLLMModelId === m.id ? 'border-primary bg-primary-light' : 'border-border bg-surface-user hover:bg-surface-ai',
                          )}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold text-text-primary">{m.name}</span>
                            <span className="text-xs text-text-secondary">{m.description}</span>
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs text-text-tertiary">{m.size}</span>
                            {m.id === DEFAULT_MODEL_ID && (
                              <span className="rounded bg-accent-ai-light px-1.5 py-0.5 text-[10px] font-semibold text-accent-ai">
                                Recomendado
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                      <button
                        onClick={() => setSelectedWebLLMModelId('custom')}
                        className={cn(
                          'flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                          selectedWebLLMModelId === 'custom' ? 'border-primary bg-primary-light' : 'border-border bg-surface-user hover:bg-surface-ai',
                        )}
                      >
                        <span className="text-xs font-semibold text-text-primary">Otro...</span>
                      </button>
                      {selectedWebLLMModelId === 'custom' && (
                        <input
                          value={customWebLLMModel}
                          onChange={(e) => setCustomWebLLMModel(e.target.value)}
                          placeholder="Ej: Llama-3-8B-Instruct-v0.1-q4f16_1-MLC"
                          className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      )}
                    </div>
                  )}

                  {providerTab === 'openrouter' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-text-secondary">API Key de OpenRouter</label>
                      <div className="relative">
                        <input
                          type={showOrKey ? 'text' : 'password'}
                          value={orKeyInput}
                          onChange={(e) => setOrKeyInput(e.target.value)}
                          placeholder="sk-or-v1-..."
                          className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 pr-14 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOrKey((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary hover:text-text-secondary"
                        >
                          {showOrKey ? 'Ocultar' : 'Ver'}
                        </button>
                      </div>
                    </div>
                  )}

                  {providerTab === 'openrouter' && (
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-text-secondary">Modelo de Chat</label>
                        <input
                          value={customOrModel}
                          onChange={(e) => setCustomOrModel(e.target.value)}
                          placeholder="Ej: google/gemini-2.0-flash-001"
                          className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-text-secondary">Modelo Evaluador</label>
                        <input
                          value={customEvaluatorModel}
                          onChange={(e) => setCustomEvaluatorModel(e.target.value)}
                          placeholder="Vacío = usar el mismo que chat"
                          className="w-full rounded-lg border border-border-input bg-surface-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={isChangingModel}
                      onClick={async () => {
                        if (providerTab === 'openrouter') {
                          const finalModel = customOrModel.trim()
                          const finalEvaluator = customEvaluatorModel.trim() || finalModel
                          if (finalModel) {
                            await onChangeProvider('openrouter', finalModel, finalEvaluator, orKeyInput.trim())
                          }
                        } else {
                          const webllmModel = selectedWebLLMModelId === 'custom' ? customWebLLMModel.trim() : selectedWebLLMModelId
                          if (webllmModel) {
                            await onChangeProvider('webllm', webllmModel)
                          }
                        }
                        setEditingProvider(false)
                      }}
                      className="flex-1"
                    >
                      {isChangingModel ? 'Cambiando…' : 'Guardar'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingProvider(false)} disabled={isChangingModel} className="flex-1">
                      Cancelar
                    </Button>
                  </div>
                  {isChangingModel && providerTab === 'webllm' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-xs text-text-secondary">
                        <span>Descargando modelo…</span>
                        <span className="font-medium text-text-primary">{Math.round(loadProgress.progress * 100)}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-input">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.round(loadProgress.progress * 100)}%` }}
                        />
                      </div>
                      {loadProgress.text ? (
                        <p className="text-[11px] text-text-tertiary break-all">{loadProgress.text}</p>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modelo (WebLLM only) */}
            {providerType === 'webllm' && !editingProvider && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Modelo local</p>
                <div className="flex flex-col gap-1.5">
                  {AVAILABLE_MODELS.map((m) => {
                    const isActive = m.id === modelId
                    return (
                      <button
                        key={m.id}
                        onClick={() => !isActive && !isChangingModel && onChangeModel(m.id)}
                        disabled={isChangingModel}
                        className={cn(
                          'flex items-center justify-between rounded-lg border-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                          isActive
                            ? 'border-primary bg-primary-light'
                            : 'border-border bg-surface-user hover:bg-surface-ai',
                        )}
                      >
                        <span className={cn('font-medium', isActive ? 'text-primary' : 'text-text-primary')}>
                          {m.name}
                        </span>
                        <span className="text-xs text-text-tertiary">{m.size}</span>
                      </button>
                    )
                  })}

                  {/* Custom WebLLM model button */}
                  {(() => {
                    const isCustomActive = !AVAILABLE_MODELS.find(m => m.id === modelId)
                    return (
                      <>
                        <button
                          onClick={() => !isCustomActive && !isChangingModel && customWebLLMModel && onChangeModel(customWebLLMModel)}
                          disabled={isChangingModel}
                          className={cn(
                            'flex items-center justify-between rounded-lg border-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                            isCustomActive
                              ? 'border-primary bg-primary-light'
                              : 'border-border bg-surface-user hover:bg-surface-ai',
                          )}
                        >
                          <span className={cn('font-medium', isCustomActive ? 'text-primary' : 'text-text-primary')}>
                            Otro... {isCustomActive && `(${modelId})`}
                          </span>
                        </button>
                        <div className="mt-1 flex gap-2">
                          <input
                            value={customWebLLMModel}
                            onChange={(e) => setCustomWebLLMModel(e.target.value)}
                            placeholder="ID de modelo WebLLM"
                            className="flex-1 rounded-lg border border-border-input bg-surface-input px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <Button
                            size="sm"
                            onClick={() => onChangeModel(customWebLLMModel.trim())}
                            disabled={isChangingModel || !customWebLLMModel.trim() || customWebLLMModel.trim() === modelId}
                          >
                            Cargar
                          </Button>
                        </div>
                      </>
                    )
                  })()}
                </div>
                {isChangingModel && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex justify-between text-xs text-text-secondary">
                      <span>Cargando modelo…</span>
                      <span className="font-medium text-text-primary">{Math.round(loadProgress.progress * 100)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-input">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.round(loadProgress.progress * 100)}%` }}
                      />
                    </div>
                    {loadProgress.text ? (
                      <p className="text-[11px] text-text-tertiary break-all">{loadProgress.text}</p>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            <hr className="border-border" />

            {/* Temperatura */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-text-secondary">Temperatura</label>
                <span className="text-xs text-text-tertiary">{temperature.toFixed(1)}</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.1"
                value={temperature}
                onChange={(e) => onUpdateTemperature(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="mt-1 flex justify-between text-[11px] text-text-tertiary">
                <span>Preciso</span>
                <span>Creativo</span>
              </div>
            </div>

          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {!perfilData ? (
              <div className="flex flex-col items-center justify-center py-10 text-text-tertiary">
                <div className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-xs">Cargando datos del perfil…</p>
              </div>
            ) : (
              <>
                {/* Perfil */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Tu Perfil</p>
                  {editingProfile ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Tu nombre"
                        autoFocus
                        className="rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        value={goalInput}
                        onChange={(e) => setGoalInput(e.target.value)}
                        placeholder="Objetivo (viajes, trabajo, charla, cultura…)"
                        className="rounded-lg border border-border-input bg-surface-input px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveProfile} disabled={!nameInput.trim() || savingProfile} className="flex-1">
                          {savingProfile ? 'Guardando…' : 'Guardar'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingProfile(false)} className="flex-1">
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : profile ? (
                    <button
                      onClick={handleEditProfile}
                      className="group w-full rounded-lg bg-surface-ai px-3 py-2 text-left text-sm hover:bg-surface-input transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-text-primary">{profile.name}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.79 2.115a.75.75 0 0 0 .96.96l2.115-.79a2.75 2.75 0 0 0 .892-.596l4.262-4.263a1.75 1.75 0 0 0 0-2.475ZM4.5 13.25a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Z" />
                        </svg>
                      </div>
                      <p className="text-xs text-text-secondary">{profile.goal}</p>
                    </button>
                  ) : (
                    <p className="text-sm text-text-tertiary">Sin perfil configurado</p>
                  )}
                </div>

                {/* Intereses */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Intereses</p>
                  <div className="flex flex-wrap gap-1.5">
                    {perfilData?.interests?.map((int, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-full bg-surface-input pl-2.5 pr-1.5 py-1 text-xs text-text-secondary">
                        {int}
                        <button
                          onClick={() => onRemoveInterest(int)}
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-tertiary hover:bg-border-input hover:text-text-primary"
                          aria-label={`Eliminar ${int}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5">
                            <path d="M2.22 2.22a.75.75 0 0 1 1.06 0L6 4.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L7.06 6l2.72 2.72a.75.75 0 1 1-1.06 1.06L6 7.06 3.28 9.78a.75.75 0 0 1-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 0 1 0-1.06Z" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newInterestInput}
                      onChange={(e) => setNewInterestInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newInterestInput.trim()) {
                          onAddInterest(newInterestInput.trim())
                          setNewInterestInput('')
                        }
                      }}
                      placeholder="Añadir interés…"
                      className="flex-1 rounded-lg border border-border-input bg-surface-input px-3 py-1.5 text-xs text-text-primary placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (newInterestInput.trim()) {
                          onAddInterest(newInterestInput.trim())
                          setNewInterestInput('')
                        }
                      }}
                      disabled={!newInterestInput.trim()}
                    >
                      +
                    </Button>
                  </div>
                </div>

                {/* Vocabulario */}
                {'vocabBand' in (perfilData ?? {}) && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Progreso</p>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] font-bold uppercase tracking-tight text-text-tertiary">Vocabulario</p>
                      <p className="text-lg font-semibold text-text-primary">
                        {VOCAB_BAND_LABELS[perfilData!.vocabBand ?? ''] ?? '—'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Errores */}
                {perfilData?.errors && perfilData.errors.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Errores Recientes</p>
                    <div className="flex flex-col gap-2">
                      {perfilData.errors.map((err, i) => (
                        <div key={i} className="rounded-lg border border-red-100 bg-red-50/50 p-2 text-xs">
                          <p className="font-medium text-red-800">" {err.user_text} "</p>
                          <p className="mt-0.5 text-red-600">→ {err.correct_form}</p>
                          {err.note && <p className="mt-1 text-[10px] italic text-red-500/80">{err.note}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Memoria (Soul) */}
                {perfilData?.soul && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Lo que sé de ti</p>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-ai p-3 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
                      {perfilData.soul}
                    </div>
                  </div>
                )}

                <hr className="border-border" />

                {/* Acciones */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Acciones</p>
                  <Button
                    variant={confirmClear ? 'primary' : 'ghost'}
                    onClick={handleClearClick}
                    className={cn('w-full text-sm', confirmClear && 'bg-red-600 hover:bg-red-700')}
                  >
                    {confirmClear ? 'Confirmar borrado' : 'Borrar conversación'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
