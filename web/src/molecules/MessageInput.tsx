import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { Button } from '../atoms/Button'

interface MessageInputProps {
  onSend: (text: string) => Promise<void>
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  useEffect(() => { autoResize() }, [text, autoResize])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await onSend(trimmed)
  }, [text, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex items-end gap-2 border-t border-border bg-white px-4 py-3">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe un mensaje…"
        disabled={disabled}
        rows={1}
        className="max-h-[200px] min-h-[42px] flex-1 resize-none rounded-xl border border-border-input bg-surface-input px-4 py-2.5 text-sm text-text-primary placeholder-text-tertiary transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        aria-label="Enviar mensaje"
        className="mb-0.5 shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
        Enviar
      </Button>
    </div>
  )
}
