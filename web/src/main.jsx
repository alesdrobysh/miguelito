import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const FALLBACK_LANGUAGE = 'spanish';
const QUICK_ACTIONS = [
  { label: 'Chat', prompt: '' },
  { label: 'Correct', prompt: 'Correct this and explain briefly: ' },
  { label: 'Explain', prompt: 'Explain this word or grammar point: ' },
  { label: 'Practice', prompt: 'Give me a short practice drill for: ' },
  { label: 'Review', prompt: 'Review what I should revisit today.' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c]));
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html.replace(/\n/g, '<br />');
}

function languageLabel(languages, id) {
  return languages.find((l) => l.id === id)?.name ?? id;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function getInitialTheme() {
  const saved = localStorage.getItem('miguelito.theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function App() {
  const [languages, setLanguages] = useState([]);
  const [language, setLanguage] = useState(() => localStorage.getItem('miguelito.language') || FALLBACK_LANGUAGE);
  const [theme, setTheme] = useState(getInitialTheme);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const currentLanguageName = useMemo(() => languageLabel(languages, language), [languages, language]);
  const nextThemeLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('miguelito.theme', theme);
    const themeColor = theme === 'dark' ? '#08111f' : '#eaf4ff';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    api('/api/languages')
      .then((data) => {
        if (cancelled) return;
        const nextLanguages = data.languages ?? [];
        const nextLanguage = nextLanguages.some((l) => l.id === language) ? language : (nextLanguages[0]?.id || FALLBACK_LANGUAGE);
        setLanguages(nextLanguages);
        setLanguage(nextLanguage);
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    let intervalId;
    localStorage.setItem('miguelito.language', language);
    setLoading(true);
    setError('');

    async function loadConversation({ showLoading = false } = {}) {
      if (showLoading) setLoading(true);
      try {
        const data = await api('/api/chat?language=' + encodeURIComponent(language));
        if (!cancelled) setMessages(data.messages ?? []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    }

    loadConversation({ showLoading: true });
    intervalId = window.setInterval(() => {
      if (!sending) loadConversation();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [language, sending]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [draft]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    setError('');
    setMessages((items) => [...items, { role: 'user', content: text }, { role: 'assistant', content: '…', pending: true }]);
    try {
      const data = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, text }),
      });
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err.message);
      setMessages((items) => items.filter((m) => !m.pending));
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function applyQuickAction(action) {
    if (!action.prompt) {
      inputRef.current?.focus();
      return;
    }
    setDraft((value) => value.trim() ? `${action.prompt}${value.trim()}` : action.prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Miguelito chat">
        <header className="chat-header">
          <button className="icon-button ghost" type="button" aria-label="Open menu" onClick={() => setMenuOpen((v) => !v)}>
            <span />
            <span />
          </button>
          <div className="identity">
            <div className="avatar" aria-hidden="true">M</div>
            <div>
              <div className="title-row"><h1>Miguelito</h1><span className="online-dot" /></div>
              <p>{currentLanguageName} tutor</p>
            </div>
          </div>
          <label className="language-chip">
            <span>Language</span>
            <select aria-label="Conversation language" value={language} onChange={(e) => { setLanguage(e.target.value); setMenuOpen(false); }}>
              {languages.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button
            className="theme-toggle"
            type="button"
            aria-label={nextThemeLabel}
            title={nextThemeLabel}
            onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </header>

        <div className={menuOpen ? 'drawer open' : 'drawer'}>
          <div className="drawer-card">
            <p className="drawer-kicker">Local web UI</p>
            <p className="drawer-copy">A focused mobile-first chat. History stays available here; model context remains bounded for cost.</p>
          </div>
        </div>

        <section className="messages" ref={scrollRef} aria-live="polite">
          {loading && <div className="empty-card">Loading conversation…</div>}
          {!loading && messages.length === 0 && (
            <div className="welcome-card">
              <p className="eyebrow">Start gently</p>
              <h2>Write one sentence in {currentLanguageName}.</h2>
              <p>Miguelito will keep the conversation natural and adapt vocabulary practice in the background.</p>
            </div>
          )}
          {messages.map((message, index) => <MessageBubble message={message} key={`${index}-${message.role}-${message.content}`} />)}
        </section>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <div className="quick-actions" aria-label="Tutor tools">
          {QUICK_ACTIONS.map((action) => (
            <button type="button" key={action.label} onClick={() => applyQuickAction(action)} disabled={sending}>
              {action.label}
            </button>
          ))}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            ref={inputRef}
            aria-label="Message Miguelito"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={1}
            placeholder={`Message in ${currentLanguageName}…`}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !draft.trim()}>{sending ? '…' : 'Send'}</button>
        </form>
      </section>
    </main>
  );
}

function MessageBubble({ message }) {
  const mine = message.role === 'user';
  return (
    <article className={`bubble ${mine ? 'mine' : 'theirs'} ${message.pending ? 'pending' : ''}`}>
      <div className="bubble-content" dangerouslySetInnerHTML={{ __html: inlineMarkdown(message.content) }} />
    </article>
  );
}

createRoot(document.getElementById('root')).render(<App />);
