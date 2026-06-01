import { useRef, useEffect } from 'react'
import { useChat } from '../context/AppContext'
import { MessageBubble } from '../molecules/MessageBubble'

export function MessagesList() {
  const { messages, searchQuery, highlightedMessageId, scrollToMessageId, clearScrollTarget, isInitialLoading, isSending } = useChat()
  const lastMsg = messages[messages.length - 1]
  const streamingId = isSending && lastMsg?.role === 'ai' ? lastMsg.id : null
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!scrollToMessageId) return
    const el = document.getElementById(`msg-${scrollToMessageId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    clearScrollTarget()
  }, [scrollToMessageId, clearScrollTarget])

  if (isInitialLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-text-tertiary">Cargando…</p>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-ai-light text-2xl">
          🌮
        </div>
        <p className="text-base font-medium text-text-primary">¡Hola! Soy Miguelito</p>
        <p className="text-sm text-text-secondary">Escríbeme algo para empezar a practicar español.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl">
        {messages.map((message) => (
          <div key={message.id} id={`msg-${message.id}`} className={highlightedMessageId === message.id ? 'ring-2 ring-yellow-400 ring-inset rounded-lg' : ''}>
            <MessageBubble message={message} isHighlighted={highlightedMessageId === message.id} searchQuery={searchQuery} isStreaming={message.id === streamingId} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
