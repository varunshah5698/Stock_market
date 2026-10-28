import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../lib/format'
import { useToasts } from '../store/ui'

const TONES = {
  success: { icon: CheckCircle2, className: 'border-gain/25 text-gain' },
  error: { icon: AlertTriangle, className: 'border-loss/25 text-loss' },
  warning: { icon: AlertTriangle, className: 'border-warn/25 text-warn' },
  info: { icon: Info, className: 'border-violet-400/25 text-violet-300' },
}

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const tone = TONES[toast.tone]
        const Icon = tone.icon
        return (
          <div
            key={toast.id}
            className={cn('pointer-events-auto flex items-start gap-3 rounded-lg border bg-ink-850/95 p-3 shadow-card backdrop-blur-xl', tone.className)}
            role="status"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-white">{toast.title}</div>
              {toast.description && <div className="mt-0.5 text-[11px] leading-relaxed text-mutedx">{toast.description}</div>}
            </div>
            <button onClick={() => dismiss(toast.id)} className="rounded p-0.5 text-dimx hover:text-white" aria-label="Dismiss notification">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
