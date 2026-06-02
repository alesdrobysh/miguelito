import { useEffect, useState } from 'react'
import { subscribeDownloadProgress, getDownloadProgress } from '../context/DownloadProgress'
import type { InitProgressReport } from '../providers/WebLLMProvider'

export function DownloadStep() {
  const [progress, setProgress] = useState(() => getDownloadProgress().progress)
  const [text, setText] = useState(() => getDownloadProgress().text || 'Iniciando…')

  useEffect(() => {
    const unsub = subscribeDownloadProgress((report: InitProgressReport) => {
      setProgress(report.progress)
      setText(report.text || 'Cargando…')
    })
    return () => { unsub() }
  }, [])

  const pct = Math.round(progress * 100)

  return (
    <div className="flex flex-col items-center gap-8 px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-ai-light">
        <span className="text-4xl">🧠</span>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-text-primary">Descargando modelo</h2>
        <p className="text-sm text-text-secondary max-w-sm">
          Solo la primera vez. Después el modelo queda guardado en tu navegador.
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Progreso</span>
          <span className="font-medium text-text-primary">{pct}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-text-tertiary break-all">{text}</p>
      </div>

      {pct >= 100 && (
        <p className="flex items-center gap-2 text-sm font-medium text-green-600">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          ¡Listo! Iniciando Miguelito…
        </p>
      )}
    </div>
  )
}
