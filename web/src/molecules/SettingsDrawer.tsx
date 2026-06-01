import { useState, useCallback } from 'react'
import { Drawer } from '../atoms/Drawer'
import { Button } from '../atoms/Button'
import { cn } from '../lib/cn'
import { AVAILABLE_MODELS } from '../lib/types'
import type { Profile } from '../lib/types'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  modelId: string
  isChangingModel: boolean
  temperature: number
  profile: Profile | null
  onUpdateTemperature: (t: number) => void
  onChangeModel: (modelId: string) => Promise<void>
  onUpdateProfile: (profile: Profile) => Promise<void>
  onClearChat: () => void
}

export function SettingsDrawer({
  open,
  onClose,
  modelId,
  isChangingModel,
  temperature,
  profile,
  onUpdateTemperature,
  onChangeModel,
  onUpdateProfile,
  onClearChat,
}: SettingsDrawerProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [nameInput, setNameInput] = useState(profile?.name ?? '')
  const [goalInput, setGoalInput] = useState(profile?.goal ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

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

        {/* Modelo */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">Modelo</p>
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
          </div>
          {isChangingModel && (
            <p className="mt-2 text-xs text-text-tertiary">Cargando modelo…</p>
          )}
        </div>

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
