import { useState, useCallback } from 'react'
import { Drawer } from '../atoms/Drawer'
import { Button } from '../atoms/Button'
import { cn } from '../lib/cn'
import { AVAILABLE_MODELS, OPENROUTER_MODELS, DEFAULT_OPENROUTER_MODEL_ID } from '../lib/types'
import type { Profile } from '../lib/types'
import type { ProviderType } from '../storage/db'

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
  onUpdateTemperature: (t: number) => void
  onChangeModel: (modelId: string) => Promise<void>
  onChangeProvider: (type: ProviderType, modelId: string, evaluatorModelId?: string, key?: string) => Promise<void>
  onUpdateProfile: (profile: Profile) => Promise<void>
  onClearChat: () => void
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
  evaluatorModelId,
  onUpdateTemperature,
  onChangeModel,
  onChangeProvider,
  onUpdateProfile,
  onClearChat,
}: SettingsDrawerProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [nameInput, setNameInput] = useState(profile?.name ?? '')
  const [goalInput, setGoalInput] = useState(profile?.goal ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [orKeyInput, setOrKeyInput] = useState(openrouterKey)
  const [showOrKey, setShowOrKey] = useState(false)
  const [editingProvider, setEditingProvider] = useState(false)
  const [providerTab, setProviderTab] = useState<ProviderType>(providerType)
  const [customOrModel, setCustomOrModel] = useState(modelId)
  const [customWebLLMModel, setCustomWebLLMModel] = useState(
    providerType === 'webllm' && !AVAILABLE_MODELS.find(m => m.id === modelId) ? modelId : ''
  )
  const [customEvaluatorModel, setCustomEvaluatorModel] = useState(
    evaluatorModelId === modelId ? '' : evaluatorModelId
  )

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
      <div className="flex flex-col gap-6">

        {/* Perfil */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Perfil</p>
            {!editingProfile && (
              <button onClick={handleEditProfile} className="text-xs text-primary hover:underline">
                Editar
              </button>
            )}
          </div>
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
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-text-primary">{profile.name}</p>
              <p className="text-xs text-text-secondary">{profile.goal}</p>
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">Sin perfil configurado</p>
          )}
        </div>

        <hr className="border-border" />

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
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
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
                    providerTab === 'webllm' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  WebLLM
                </button>
                <button
                  onClick={() => setProviderTab('openrouter')}
                  className={cn(
                    'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
                    providerTab === 'openrouter' ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  OpenRouter
                </button>
              </div>

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
                      await onChangeProvider('webllm', AVAILABLE_MODELS[0].id)
                    }
                    setEditingProvider(false)
                  }}
                  className="flex-1"
                >
                  {isChangingModel ? 'Cambiando…' : 'Guardar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingProvider(false)} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Modelo (WebLLM only) */}
        {providerType === 'webllm' && (
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
                      : 'border-border bg-white hover:bg-slate-50',
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
                        : 'border-border bg-white hover:bg-slate-50',
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
            <p className="mt-2 text-xs text-text-tertiary">Cargando modelo…</p>
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

        <hr className="border-border" />

        <Button
          variant={confirmClear ? 'primary' : 'ghost'}
          onClick={handleClearClick}
          className={cn('w-full', confirmClear && 'bg-red-600 hover:bg-red-700')}
        >
          {confirmClear ? 'Confirmar borrado' : 'Borrar conversación'}
        </Button>
      </div>
    </Drawer>
  )
}
