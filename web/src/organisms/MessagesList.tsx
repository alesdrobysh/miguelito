import { useRef, useEffect, useState } from 'react'
import { useChat } from '../context/AppContext'
import { MessageBubble } from '../molecules/MessageBubble'

export function MessagesList() {
  const { messages, isInitialLoading, isSending } = useChat()
  const lastMsg = messages[messages.length - 1]
  const streamingId = isSending && lastMsg?.role === 'ai' ? lastMsg.id : null
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const initializedRef = useRef(false)

  // On first render with messages: instant-scroll to bottom, then fade in
  useEffect(() => {
    if (initializedRef.current || isInitialLoading || messages.length === 0) return
    initializedRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    requestAnimationFrame(() => setVisible(true))
  }, [isInitialLoading, messages.length])

  // Smooth scroll for each new message after initial reveal
  useEffect(() => {
    if (!initializedRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!streamingId) return
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [streamingId, lastMsg?.content])

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
        <img src={import.meta.env.BASE_URL + "SCR-20260603-jsmp.jpeg"} className="h-14 w-14 rounded-full" alt="Miguelito" />
        <p className="text-base font-medium text-text-primary">¡Hola! Soy Miguelito</p>
        <p className="text-sm text-text-secondary">Escríbeme algo para empezar a practicar español.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`flex-1 overflow-y-auto transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="mx-auto w-full max-w-3xl">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} isStreaming={message.id === streamingId} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
