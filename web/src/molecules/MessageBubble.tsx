import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/cn'
import type { Message } from '../lib/types'

interface MessageBubbleProps {
  message: Message
  isHighlighted?: boolean
  searchQuery?: string
  isStreaming?: boolean
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5">{part}</mark>
    ) : part,
  )
}

export function MessageBubble({ message, isHighlighted, searchQuery, isStreaming }: MessageBubbleProps) {
  const isAi = message.role === 'ai'
  const isEmpty = !message.content && isAi
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3 transition-colors',
        isAi ? 'flex-row' : 'flex-row-reverse',
        isHighlighted && 'bg-yellow-50',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white h-8 w-8',
          isAi ? 'bg-accent-ai' : 'bg-primary',
        )}
      >
        {isAi ? 'M' : 'ME'}
      </div>
      <div className={cn('flex min-w-0 max-w-[75%] flex-col', isAi ? 'items-start' : 'items-end')}>
        <div
          className={cn(
            'max-w-full rounded-2xl px-4 py-2.5',
            isAi
              ? 'rounded-tl-sm bg-surface-ai ring-1 ring-border/50'
              : 'rounded-tr-sm bg-primary text-white',
          )}
        >
          {isAi && (
            <p className="mb-1 text-xs font-semibold text-accent-ai">Miguelito</p>
          )}
          {isEmpty ? (
            <span className="flex gap-1 py-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-text-tertiary [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-text-tertiary [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-text-tertiary [animation-delay:300ms]" />
            </span>
          ) : isAi ? (
            <div className="prose prose-sm max-w-none text-text-primary [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:rounded-lg [&_pre]:bg-slate-100 [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent-ai [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary">
              {searchQuery ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {highlightText(message.content, searchQuery)}
                </p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              )}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent-ai align-middle" />
              )}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {searchQuery ? highlightText(message.content, searchQuery) : message.content}
            </p>
          )}
        </div>
        <span className="mt-1 px-1 text-[11px] text-text-tertiary">{time}</span>
      </div>
    </div>
  )
}
