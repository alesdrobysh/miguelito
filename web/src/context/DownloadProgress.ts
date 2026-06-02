import { type InitProgressReport } from '../providers/WebLLMProvider'

const _downloadProgress = { progress: 0, text: '' }
const _downloadProgressListeners = new Set<(r: InitProgressReport) => void>()

export function subscribeDownloadProgress(fn: (r: InitProgressReport) => void) {
  _downloadProgressListeners.add(fn)
  return () => { _downloadProgressListeners.delete(fn) }
}

export function getDownloadProgress() { return _downloadProgress }

export function emitDownloadProgress(report: InitProgressReport) {
    _downloadProgress.progress = report.progress
    _downloadProgress.text = report.text
    _downloadProgressListeners.forEach((fn) => fn(report))
}
