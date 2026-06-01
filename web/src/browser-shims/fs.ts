// Browser shim for Node.js 'fs' module
// - Text files (soul.md, dream memory) stored in memory + localStorage
// - Binary files (SQLite db) stored in memory, async-persisted to IndexedDB

import { openDB } from 'idb'

const _text = new Map<string, string>()
const _binary = new Map<string, Uint8Array>()

// ── Public registration (called before app boots) ───────────────────────────

export function registerText(virtualPath: string, content: string): void {
  _text.set(virtualPath, content)
}

export function registerBinary(virtualPath: string, data: Uint8Array): void {
  _binary.set(virtualPath, data)
}

export function getRegisteredBinary(virtualPath: string): Uint8Array | undefined {
  return _binary.get(virtualPath)
}

// ── fs API ──────────────────────────────────────────────────────────────────

export function existsSync(p: string): boolean {
  if (_text.has(p) || _binary.has(p)) return true
  try { return localStorage.getItem(`fs:${p}`) !== null } catch { return false }
}

export function mkdirSync(_p: string, _opts?: unknown): void {}

export function readFileSync(p: string, encoding?: string): string | Uint8Array {
  if (encoding) {
    return _text.get(p) ?? (() => { try { return localStorage.getItem(`fs:${p}`) ?? '' } catch { return '' } })()
  }
  return _binary.get(p) ?? new Uint8Array(0)
}

export function writeFileSync(p: string, data: string | Uint8Array | Buffer): void {
  if (typeof data === 'string') {
    _text.set(p, data)
    try { localStorage.setItem(`fs:${p}`, data) } catch {}
  } else {
    const u8 = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data as unknown as ArrayBuffer)
    _binary.set(p, u8)
    _persistDbAsync(p, u8)
  }
}

// Dummy stream for pino compat
const _noop = { write: () => true, end: () => {}, on: () => ({} as unknown) }
export const createWriteStream = () => _noop

// ── IndexedDB persistence for SQLite binary ──────────────────────────────────

async function _getIdb() {
  return openDB('miguelito-fs', 1, {
    upgrade(db) { db.createObjectStore('files') },
  })
}

async function _persistDbAsync(p: string, data: Uint8Array) {
  try {
    const db = await _getIdb()
    await db.put('files', data, p)
  } catch (e) {
    console.warn('[fs-shim] failed to persist db:', e)
  }
}

export async function loadDbFromIdb(virtualPath: string): Promise<void> {
  try {
    const db = await _getIdb()
    const data = await db.get('files', virtualPath)
    if (data) _binary.set(virtualPath, data)
  } catch (e) {
    console.warn('[fs-shim] failed to load db from idb:', e)
  }
}

export default { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream }
