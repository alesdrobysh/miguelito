// Creates the real miguelito RuntimeManager for browser use.
// - WebLLM or OpenRouter as LLM provider (selected by ProviderConfig)
// - BuddyDb (sql.js) with IndexedDB persistence via the fs shim
// - Real PromptBuilder, AgentRunner, tools, DreamService

import { getEngine, streamChat } from '../providers/WebLLMProvider'
import { streamChatOpenRouter, makeOpenRouterProvider } from '../providers/OpenRouterProvider'
import { loadDbFromIdb, registerText } from '../browser-shims/fs'
import soulRaw from '../languages/spanish/soul.md?raw'
import { configureSqlJs, BuddyDb } from '../../../src/infrastructure/db.js'
import { RuntimeManager } from '../../../src/runtime.js'
import { PostTurnProcessor } from '../../../src/agent/PostTurnProcessor.js'
import { SpanishLanguage } from '../languages/spanish/index'
import type { LLMProvider, ChatResult, ChatOptions } from '../../../src/providers/interfaces.js'
import type { ChatMessage } from '../../../src/llm.js'
import type { Config } from '../../../src/infrastructure/config.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'

export const DB_PATH = '/virtual/miguelito.db'
export const DREAM_PATH = '/virtual/memory/MEMORY-spanish.md'

const CHAT_ID = 0
const MODEL_HISTORY_LIMIT = 50

// ── Provider config ───────────────────────────────────────────────────────────

export type ProviderConfig =
  | { type: 'webllm' }
  | { type: 'openrouter'; key: string; model: string; evaluatorModel?: string }

let _providerConfig: ProviderConfig = { type: 'webllm' }
export function setProviderConfig(cfg: ProviderConfig) { _providerConfig = cfg }
export function getProviderConfig(): ProviderConfig { return _providerConfig }

// ── Temperature ───────────────────────────────────────────────────────────────

let _temperature = 0.7
export function setProviderTemperature(t: number) { _temperature = t }

// ── LLM Provider (non-streaming, for PostTurnProcessor) ──────────────────────

function makeProvider(modelId?: string): LLMProvider {
  if (_providerConfig.type === 'openrouter') {
    const finalModel = modelId || _providerConfig.model
    return makeOpenRouterProvider(_providerConfig.key, finalModel)
  }
  return {
    async chat(messages: ChatMessage[], _tools?: object[], opts?: ChatOptions): Promise<ChatResult> {
      const engine = getEngine()
      if (!engine) throw new Error('WebLLM engine not initialized')
      const response = await engine.chat.completions.create({
        messages: messages as Parameters<typeof engine.chat.completions.create>[0]['messages'],
        temperature: opts?.temperature ?? _temperature,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: false,
      })
      return { content: response.choices[0]?.message?.content ?? null, toolCalls: [] }
    },
    async complete(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<string> {
      const msgs: ChatMessage[] = []
      if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
      msgs.push({ role: 'user', content: userPrompt })
      const r = await this.chat(msgs, undefined, opts)
      return r.content ?? ''
    },
    async completeJson<T>(systemPrompt: string | null, userPrompt: string, opts?: ChatOptions): Promise<T> {
      const text = await this.complete(systemPrompt, userPrompt, opts)
      try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as T }
      catch { return {} as T }
    },
  }
}

// ── Streaming message handler (used by AppContext) ────────────────────────────

export async function streamingHandleMessage(
  runtime: RuntimeManager,
  text: string,
  onChunk: (delta: string) => void,
): Promise<string> {
  const rt = runtime.runtime('spanish')
  const { db, promptBuilder } = rt

  // 1. Persist user message + load history
  const { session: convState } = await db.getConversationState()
  const history = await db.getSessionTranscript(convState.session_id, MODEL_HISTORY_LIMIT) as ChatMessage[]
  await db.addChatMessage(CHAT_ID, 'user', text, convState.session_id)

  // 2. Build full system prompt
  const systemPrompt = await promptBuilder.build(text, DREAM_PATH)
  const postReminder = promptBuilder.buildPostHistoryReminder()
  const fullSystemPrompt = postReminder ? `${systemPrompt}\n\n${postReminder}` : systemPrompt

  const messages = [
    { role: 'system' as const, content: fullSystemPrompt },
    ...history.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: text },
  ]

  // 3. Stream response
  let fullContent = ''
  if (_providerConfig.type === 'openrouter') {
    await streamChatOpenRouter(messages, _providerConfig.key, _providerConfig.model, _temperature, (delta) => {
      fullContent += delta
      onChunk(delta)
    })
  } else {
    await streamChat(messages, _temperature, (delta) => {
      fullContent += delta
      onChunk(delta)
    })
  }

  // 4. Persist AI response
  await db.addChatMessage(CHAT_ID, 'assistant', fullContent, convState.session_id)
  await db.updateConversationState('conversation')

  // 5. Run PostTurnProcessor in background
  const evaluatorModel = _providerConfig.type === 'openrouter' ? _providerConfig.evaluatorModel : undefined
  const provider = makeProvider(evaluatorModel)
  const postTurn = new PostTurnProcessor({
    provider,
    vocab: db,
    errors: db,
    competency: db,
    session: db,
    learning: db,
    lang: rt.lang,
  })
  postTurn.process({ userMessage: text, assistantText: fullContent, chatHistory: history })
    .catch((e) => console.warn('[post-turn]', e))

  return fullContent
}

// ── Runtime singleton ─────────────────────────────────────────────────────────

let _runtime: RuntimeManager | null = null

export async function createBrowserRuntime(): Promise<RuntimeManager> {
  if (_runtime) return _runtime

  registerText('/virtual/soul.md', soulRaw)
  configureSqlJs({ locateFile: () => sqlWasm })
  await loadDbFromIdb(DB_PATH)

  const sharedDb = await BuddyDb.open(DB_PATH, 'shared', [], [])
  const chatProvider = makeProvider()
  const evaluatorModel = _providerConfig.type === 'openrouter' ? _providerConfig.evaluatorModel : undefined
  const evalProvider = makeProvider(evaluatorModel)

  const config: Partial<Config> = {
    dataDir: '/virtual',
    dbPath: DB_PATH,
    provider: 'openrouter',
    chatModel: _providerConfig.type === 'openrouter' ? _providerConfig.model : 'webllm',
    evaluatorModel: (_providerConfig.type === 'openrouter' && _providerConfig.evaluatorModel) ? _providerConfig.evaluatorModel : 'webllm',
    ollamaModel: '',
    ollamaBaseUrl: '',
    ollamaApiKey: '',
    openrouterApiKey: _providerConfig.type === 'openrouter' ? _providerConfig.key : '',
    openrouterBaseUrl: '',
    telegramToken: '',
    telegramBotTokens: {},
    transport: 'tui',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }

  _runtime = new RuntimeManager(config as Config, chatProvider, evalProvider, sharedDb)
  await _runtime.addLanguageConfig(SpanishLanguage, DREAM_PATH)

  const rawDb = sharedDb.db
  const dbg = {
    query(sql: string, params: unknown[] = []) {
      const stmt = rawDb.prepare(sql)
      stmt.bind(params)
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows
    },
    tables() {
      return dbg.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r['name'])
    },
    dump(table: string) {
      return dbg.query(`SELECT * FROM ${table}`)
    },
  }
  ;(window as Window & { __miguelito?: typeof dbg }).__miguelito = dbg

  return _runtime
}

export function getBrowserRuntime(): RuntimeManager | null { return _runtime }
export function resetBrowserRuntime(): void { _runtime = null }
