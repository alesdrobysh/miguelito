import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'

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

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

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
    <div className="border-t border-border bg-white px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje…"
          disabled={disabled}
          rows={1}
          className="max-h-50 min-h-10.5 flex-1 resize-none rounded-xl border border-border-input bg-surface-input px-4 py-2.5 text-sm text-text-primary placeholder-text-tertiary transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>
  )
}
