import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '../lib/cn'
import type { Message } from '../lib/types'

interface SearchBarProps {
  searchQuery: string
  searchResults: Message[]
  onSearch: (query: string) => void
  onJumpToMessage: (messageId: string) => void
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5">{part}</mark>
    ) : <span key={i}>{part}</span>,
  )
}

export function SearchBar({ searchQuery, searchResults, onSearch, onJumpToMessage }: SearchBarProps) {
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = searchQuery.trim() ? searchResults : []

  useEffect(() => { setSelectedIndex(-1) }, [searchQuery])

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIndex] as HTMLElement
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!filtered.length) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1))
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault()
        onJumpToMessage(filtered[selectedIndex].id)
        onSearch('')
        inputRef.current?.blur()
      } else if (e.key === 'Escape') {
        inputRef.current?.blur()
      }
    },
    [filtered, selectedIndex, onJumpToMessage, onSearch],
  )

  return (
    <div className="relative border-b border-border px-4 py-2">
      <div className="relative">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar mensajes…"
          className="w-full rounded-lg border border-border-input bg-surface-input py-2 pl-9 pr-3 text-sm text-text-primary placeholder-text-tertiary transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searchQuery && (
          <button onClick={() => onSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary" aria-label="Clear search">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
      {focused && searchQuery.trim() && filtered.length > 0 && (
        <ul ref={listRef} className="absolute left-4 right-4 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
          {filtered.map((msg, i) => (
            <li
              key={msg.id}
              onMouseDown={() => { onJumpToMessage(msg.id); onSearch('') }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn('cursor-pointer border-b border-border/50 px-4 py-2.5 last:border-0', i === selectedIndex ? 'bg-gray-50' : 'hover:bg-gray-50')}
            >
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span className={cn('rounded px-1 py-0.5 text-[10px] font-semibold text-white', msg.role === 'ai' ? 'bg-accent-ai' : 'bg-primary')}>
                  {msg.role === 'ai' ? 'MI' : 'TÚ'}
                </span>
                <span>{new Date(msg.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-text-primary">{highlightMatch(msg.content, searchQuery)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
