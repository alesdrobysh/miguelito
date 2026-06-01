import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import type { Message, Profile } from '../lib/types'
import { DEFAULT_MODEL_ID } from '../lib/types'
import * as appDb from '../storage/db'
import type { ProviderType } from '../storage/db'
import { initEngine, type InitProgressReport } from '../providers/WebLLMProvider'
import {
  createBrowserRuntime,
  getBrowserRuntime,
  resetBrowserRuntime,
  streamingHandleMessage,
  setProviderTemperature,
  setProviderConfig,
  DREAM_PATH,
} from '../runtime/BrowserRuntime'
import type { RuntimeManager } from '../../../src/runtime.js'

// ─── Phase machine ───────────────────────────────────────────────────────────

export type OnboardingStep = 'welcome' | 'profile' | 'model' | 'download'

export type AppPhase =
  | { type: 'loading' }
  | { type: 'onboarding'; step: OnboardingStep }
  | { type: 'initializing'; modelId: string; progress: number; text: string }
  | { type: 'chat' }

// ─── Context value ────────────────────────────────────────────────────────────

interface AppContextValue {
  phase: AppPhase
  messages: Message[]
  profile: Profile | null
  modelId: string
  evaluatorModelId: string
  providerType: ProviderType
  openrouterKey: string
  temperature: number
  searchQuery: string
  searchResults: Message[]
  highlightedMessageId: string | null
  scrollToMessageId: string | null
  isInitialLoading: boolean
  isSending: boolean
  isChangingModel: boolean
  // Onboarding
  advanceToProfile: () => void
  advanceToModel: () => void
  saveProfileAndAdvance: (profile: Profile) => Promise<void>
  downloadAndStart: (modelId: string) => Promise<void>
  startWithOpenRouter: (key: string, model: string, evaluatorModel?: string) => Promise<void>
  // Chat
  sendMessage: (text: string) => Promise<void>
  searchMessages: (query: string) => void
  jumpToMessage: (id: string) => void
  clearScrollTarget: () => void
  clearChat: () => void
  updateTemperature: (t: number) => void
  updateProfile: (profile: Profile) => Promise<void>
  changeModel: (newModelId: string) => Promise<void>
  changeProvider: (type: ProviderType, modelId: string, evaluatorModelId?: string, key?: string) => Promise<void>
  runDream: () => Promise<string>
}

const AppContext = createContext<AppContextValue | null>(null)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadMessagesFromRuntime(runtime: RuntimeManager): Promise<Message[]> {
  const rt = runtime.runtime('spanish')
  const history = await rt.db.getChatHistory(0, 500)
  return history.map((m, i) => ({
    id: `hist-${i}-${m.role}`,
    role: m.role === 'assistant' ? 'ai' : 'user' as 'user' | 'ai',
    content: m.content,
    createdAt: new Date().toISOString(),
  }))
}

async function loadProfileFromRuntime(runtime: RuntimeManager): Promise<Profile | null> {
  const rt = runtime.runtime('spanish')
  const up = await rt.sharedDb.getProfile()
  if (!up?.name && !up?.goal) return null
  return { name: up.name ?? '', goal: up.goal ?? '' }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AppPhase>({ type: 'loading' })
  const [messages, setMessages] = useState<Message[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const [evaluatorModelId, setEvaluatorModelId] = useState(DEFAULT_MODEL_ID)
  const [providerType, setProviderType] = useState<ProviderType>('webllm')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isChangingModel, setIsChangingModel] = useState(false)
  const initRef = useRef(false)

  // ── Boot ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    ;(async () => {
      const appState = await appDb.getAppState()

      if (!appState?.onboardingComplete) {
        if (import.meta.env.DEV && location.hash === '#dev') {
          setIsInitialLoading(false)
          setPhase({ type: 'chat' })
          return
        }
        setIsInitialLoading(false)
        setPhase({ type: 'onboarding', step: 'welcome' })
        return
      }

      const mid = appState.modelId ?? DEFAULT_MODEL_ID
      const emid = appState.evaluatorModelId ?? mid
      const pType = appState.providerType ?? 'webllm'
      const orKey = appState.openrouterKey ?? ''
      setModelId(mid)
      setEvaluatorModelId(emid)
      setProviderType(pType)
      setOpenrouterKey(orKey)
      if (appState.temperature) setTemperature(appState.temperature)
      setProviderTemperature(appState.temperature ?? 0.7)
      if (pType === 'openrouter') {
        setProviderConfig({ type: 'openrouter', key: orKey, model: mid, evaluatorModel: emid })
      }

      if (pType === 'openrouter') {
        // OpenRouter: skip model download, go straight to runtime
        const runtime = await createBrowserRuntime()
        const [msgs, prof] = await Promise.all([
          loadMessagesFromRuntime(runtime),
          loadProfileFromRuntime(runtime),
        ])
        setMessages(msgs)
        setProfile(prof)
        setIsInitialLoading(false)
        setPhase({ type: 'chat' })
        return
      }

      setPhase({ type: 'initializing', modelId: mid, progress: 0, text: 'Cargando modelo…' })

      await initEngine(mid, (report: InitProgressReport) => {
        setPhase({ type: 'initializing', modelId: mid, progress: report.progress, text: report.text })
      })

      const runtime = await createBrowserRuntime()
      const [msgs, prof] = await Promise.all([
        loadMessagesFromRuntime(runtime),
        loadProfileFromRuntime(runtime),
      ])
      setMessages(msgs)
      setProfile(prof)
      setIsInitialLoading(false)
      setPhase({ type: 'chat' })
    })()
  }, [])

  // ── Onboarding ─────────────────────────────────────────────────────────────

  const advanceToProfile = useCallback(() => setPhase({ type: 'onboarding', step: 'profile' }), [])
  const advanceToModel = useCallback(() => setPhase({ type: 'onboarding', step: 'model' }), [])

  const saveProfileAndAdvance = useCallback(async (p: Profile) => {
    setProfile(p)
    // Profile will be saved to BuddyDb after engine + runtime are ready (in downloadAndStart)
    setPhase({ type: 'onboarding', step: 'model' })
  }, [])

  const downloadAndStart = useCallback(async (mid: string) => {
    setModelId(mid)
    setEvaluatorModelId(mid)
    setPhase({ type: 'onboarding', step: 'download' })

    await initEngine(mid, (report: InitProgressReport) => {
      _downloadProgress.progress = report.progress
      _downloadProgress.text = report.text
      _downloadProgressListeners.forEach((fn) => fn(report))
    })

    // Init runtime and save profile to BuddyDb
    const runtime = await createBrowserRuntime()
    if (profile) {
      await runtime.runtime('spanish').sharedDb.setProfile({ name: profile.name, goal: profile.goal })
    }

    await appDb.saveAppState({ onboardingComplete: true, providerType: 'webllm', modelId: mid, evaluatorModelId: mid, openrouterKey: '', temperature })
    setProviderType('webllm')
    setIsInitialLoading(false)
    setPhase({ type: 'chat' })
  }, [profile, temperature])

  const startWithOpenRouter = useCallback(async (key: string, model: string, evaluatorModel?: string) => {
    const emid = evaluatorModel || model
    setProviderConfig({ type: 'openrouter', key, model, evaluatorModel: emid })
    setProviderType('openrouter')
    setOpenrouterKey(key)
    setModelId(model)
    setEvaluatorModelId(emid)

    const runtime = await createBrowserRuntime()
    if (profile) {
      await runtime.runtime('spanish').sharedDb.setProfile({ name: profile.name, goal: profile.goal })
    }

    await appDb.saveAppState({ onboardingComplete: true, providerType: 'openrouter', modelId: model, evaluatorModelId: emid, openrouterKey: key, temperature })
    setIsInitialLoading(false)
    setPhase({ type: 'chat' })
  }, [profile, temperature])

  // ── Chat ───────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const runtime = getBrowserRuntime()
    if (!runtime) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    const aiId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: aiId, role: 'ai', content: '', createdAt: new Date().toISOString() }])
    setIsSending(true)

    let fullContent = ''
    try {
      await streamingHandleMessage(runtime, text, (delta) => {
        fullContent += delta
        setMessages((prev) => prev.map((m) => m.id === aiId ? { ...m, content: fullContent } : m))
      })
    } catch (err) {
      fullContent = `[Error: ${err instanceof Error ? err.message : String(err)}]`
      setMessages((prev) => prev.map((m) => m.id === aiId ? { ...m, content: fullContent } : m))
    } finally {
      setIsSending(false)
    }
  }, [])

  const searchMessages = useCallback((query: string) => setSearchQuery(query), [])

  const jumpToMessage = useCallback((id: string) => {
    setHighlightedMessageId(id)
    setScrollToMessageId(id)
  }, [])

  const clearScrollTarget = useCallback(() => setScrollToMessageId(null), [])

  const clearChat = useCallback(async () => {
    // Start a fresh session in BuddyDb by resetting conversation state
    const runtime = getBrowserRuntime()
    if (runtime) {
      await runtime.runtime('spanish').db.updateConversationState('clear')
    }
    setMessages([])
  }, [])

  const updateTemperature = useCallback(async (t: number) => {
    setTemperature(t)
    setProviderTemperature(t)
    const appState = await appDb.getAppState()
    if (appState) await appDb.saveAppState({ ...appState, temperature: t })
  }, [])

  const updateProfile = useCallback(async (p: Profile) => {
    setProfile(p)
    const runtime = getBrowserRuntime()
    if (runtime) {
      await runtime.runtime('spanish').sharedDb.setProfile({ name: p.name, goal: p.goal })
    }
  }, [])

  const changeModel = useCallback(async (newModelId: string) => {
    setIsChangingModel(true)
    setModelId(newModelId)
    setEvaluatorModelId(newModelId)
    resetBrowserRuntime()
    try {
      await initEngine(newModelId, () => {})
      await createBrowserRuntime()
      const appState = await appDb.getAppState()
      if (appState) await appDb.saveAppState({ ...appState, modelId: newModelId, evaluatorModelId: newModelId })
    } finally {
      setIsChangingModel(false)
    }
  }, [])

  const changeProvider = useCallback(async (type: ProviderType, newModelId: string, newEvaluatorModelId?: string, key = '') => {
    setIsChangingModel(true)
    resetBrowserRuntime()
    const emid = newEvaluatorModelId || newModelId
    try {
      if (type === 'openrouter') {
        setProviderConfig({ type: 'openrouter', key, model: newModelId, evaluatorModel: emid })
      } else {
        setProviderConfig({ type: 'webllm' })
        await initEngine(newModelId, () => {})
      }
      setProviderType(type)
      setOpenrouterKey(key)
      setModelId(newModelId)
      setEvaluatorModelId(emid)
      await createBrowserRuntime()
      const appState = await appDb.getAppState()
      if (appState) {
        await appDb.saveAppState({ 
          ...appState, 
          providerType: type, 
          modelId: newModelId, 
          evaluatorModelId: emid,
          openrouterKey: key 
        })
      }
    } finally {
      setIsChangingModel(false)
    }
  }, [])

  const runDream = useCallback(async (): Promise<string> => {
    const runtime = getBrowserRuntime()
    if (!runtime) return 'No runtime'
    return runtime.runtime('spanish').dreamService.run()
  }, [])

  const searchResults = searchQuery.trim()
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages

  return (
    <AppContext.Provider
      value={{
        phase,
        messages,
        profile,
        modelId,
        providerType,
        openrouterKey,
        temperature,
        searchQuery,
        searchResults,
        highlightedMessageId,
        scrollToMessageId,
        isInitialLoading,
        isSending,
        isChangingModel,
        advanceToProfile,
        advanceToModel,
        saveProfileAndAdvance,
        downloadAndStart,
        startWithOpenRouter,
        sendMessage,
        searchMessages,
        jumpToMessage,
        clearScrollTarget,
        clearChat,
        updateTemperature,
        updateProfile,
        changeModel,
        changeProvider,
        runDream,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

// ── Download progress bus ────────────────────────────────────────────────────
const _downloadProgress = { progress: 0, text: '' }
const _downloadProgressListeners = new Set<(r: InitProgressReport) => void>()

export function subscribeDownloadProgress(fn: (r: InitProgressReport) => void) {
  _downloadProgressListeners.add(fn)
  return () => { _downloadProgressListeners.delete(fn) }
}

export function getDownloadProgress() { return _downloadProgress }

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
export function useChat() { return useApp() }

export { DREAM_PATH }
