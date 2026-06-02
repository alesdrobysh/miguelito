import { useState } from 'react'
import { useChat } from '../context/AppContext'
import { ChatHeader } from '../molecules/ChatHeader'
import { SettingsDrawer } from '../molecules/SettingsDrawer'
import { MessageInput } from '../molecules/MessageInput'
import { MessagesList } from './MessagesList'
import { AVAILABLE_MODELS, OPENROUTER_MODELS } from '../lib/types'

export function Chat() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    modelId,
    evaluatorModelId,
    providerType,
    openrouterKey,
    isChangingModel,
    temperature,
    profile,
    isSending,
    sendMessage,
    updateTemperature,
    changeModel,
    changeProvider,
    updateProfile,
    clearChat,
    perfilData,
    refreshPerfilData,
  } = useChat()

  const modelName = providerType === 'openrouter'
    ? (OPENROUTER_MODELS.find((m) => m.id === modelId)?.name ?? modelId)
    : (AVAILABLE_MODELS.find((m) => m.id === modelId)?.name ?? modelId)

  return (
    <div className="flex h-screen flex-col bg-white">
      <ChatHeader
        modelName={modelName}
        isInitializing={isChangingModel}
        onSettingsClick={() => setSettingsOpen(true)}
      />
      <MessagesList />
      <MessageInput onSend={sendMessage} disabled={isSending || isChangingModel} />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        modelId={modelId}
        evaluatorModelId={evaluatorModelId}
        providerType={providerType}
        openrouterKey={openrouterKey}
        isChangingModel={isChangingModel}
        temperature={temperature}
        profile={profile}
        perfilData={perfilData}
        onUpdateTemperature={updateTemperature}
        onChangeModel={changeModel}
        onChangeProvider={changeProvider}
        onUpdateProfile={updateProfile}
        onClearChat={clearChat}
        onRefreshPerfilData={refreshPerfilData}
      />
    </div>
  )
}
