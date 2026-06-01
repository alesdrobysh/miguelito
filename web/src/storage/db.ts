// Lightweight app-state persistence (onboarding status, model choice, temperature).
// All language-learning data (messages, profile, vocab, errors) lives in BuddyDb
// via the browser fs shim → IndexedDB.

import { openDB, type IDBPDatabase } from 'idb'

export type ProviderType = 'webllm' | 'openrouter'

export interface AppStateValue {
  onboardingComplete: boolean
  providerType: ProviderType
  modelId: string
  evaluatorModelId?: string
  openrouterKey: string
  temperature: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = IDBPDatabase<any>
let _db: AnyDB | null = null

async function getDB(): Promise<AnyDB> {
  if (_db) return _db
  _db = await openDB('miguelito-app', 1, {
    upgrade(db) {
      db.createObjectStore('app')
    },
  })
  return _db
}

export async function getAppState(): Promise<AppStateValue | undefined> {
  const db = await getDB()
  return db.get('app', 'state')
}

export async function saveAppState(state: AppStateValue) {
  const db = await getDB()
  await db.put('app', state, 'state')
}
