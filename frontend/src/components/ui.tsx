import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn, fmtDateTime } from '../lib/format'

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'md' | 'sm'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'outline', size = 'md', loading, icon, children, className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------- badges */

export type BadgeTone = 'neutral' | 'gain' | 'loss' | 'warn' | 'violet' | 'cyan'

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={cn('chip', tone !== 'neutral' && `chip-${tone}`, className)}>{children}</span>
}

const STATUS_TONES: Record<string, BadgeTone> = {
  succeeded: 'gain',
  filled: 'gain',
  running: 'cyan',
  queued: 'violet',
  open: 'cyan',
  new: 'violet',
  failed: 'loss',
  rejected: 'loss',
  cancelled: 'neutral',
  cancelled_by_user: 'neutral',
  simulated: 'warn',
  delayed: 'warn',
  end_of_day: 'neutral',
  approved: 'gain',
  paper: 'warn',
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const normalized = status?.toLowerCase() ?? 'unknown'
  return (
    <Badge tone={STATUS_TONES[normalized] ?? 'neutral'}>
      {normalized === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyanx" />}
      {label ?? status.replace(/_/g, ' ')}
    </Badge>
  )
}

/* ------------------------------------------------------------------ headings */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-hair pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="display text-[26px] font-semibold leading-tight text-white md:text-[32px]">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mutedx">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="display text-base font-semibold text-white">{title}</h2>
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <div className="mt-1.5 text-[11px] leading-snug text-dimx">{hint}</div>}
      {error && <div className="mt-1.5 text-[11px] text-loss">{error}</div>}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('select', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('textarea', className)} {...props} />
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  ariaLabel?: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-mutedx">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label ?? 'Toggle setting'}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full border transition',
          checked ? 'border-violet-400/60 bg-violet-500/70' : 'border-white/10 bg-white/5',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      {label}
    </label>
  )
}

/* --------------------------------------------------------------------- tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-hair', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative whitespace-nowrap px-3 py-2.5 text-[12px] transition',
            value === tab.value ? 'text-white' : 'text-mutedx hover:text-white',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 font-mono text-[10px] text-dimx">{tab.count}</span>}
          {value === tab.value && <span className="absolute inset-x-2 -bottom-px h-px bg-violet-400" />}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => panelRef.current?.focus(), 20)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <button className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="Close dialog" tabIndex={-1} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={cn(
          'relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-ink-850 p-5 shadow-card outline-none sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="display text-lg font-semibold text-white">
              {title}
            </h2>
            {description && <p className="mt-1 text-[12px] leading-relaxed text-mutedx">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-dimx hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-hair pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------- states */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-mutedx" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {label ?? 'Loading'}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function LoadingPanel({ rows = 3, label = 'Loading data' }: { rows?: number; label?: string }) {
  return (
    <div className="panel p-5" aria-busy="true" aria-label={label}>
      <Skeleton className="mb-4 h-3 w-32" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry, title = 'Could not load this view' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div className="panel flex flex-col items-start gap-3 border-loss/20 p-5" role="alert">
      <div className="flex items-center gap-2 text-[13px] font-medium text-loss">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {title}
      </div>
      <p className="text-[12px] leading-relaxed text-mutedx">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-violet-400">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden />}
      </div>
      <div className="display text-sm font-medium text-white">{title}</div>
      <div className="mt-1.5 max-w-md text-[12px] leading-relaxed text-mutedx">{description}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Callout({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode
  tone?: 'info' | 'warn' | 'loss' | 'gain'
  title?: string
}) {
  const styles = {
    info: 'border-white/10 bg-white/[0.025] text-mutedx',
    warn: 'border-warn/20 bg-warn/[0.05] text-warn/90',
    loss: 'border-loss/20 bg-loss/[0.05] text-loss/90',
    gain: 'border-gain/20 bg-gain/[0.05] text-gain/90',
  }
  const Icon = tone === 'info' ? Info : tone === 'gain' ? CheckCircle2 : AlertTriangle
  return (
    <div className={cn('flex gap-2.5 rounded-lg border p-3 text-[11.5px] leading-relaxed', styles[tone])}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>
        {title && <div className="mb-0.5 font-medium">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function WarningList({ warnings, title = 'Warnings' }: { warnings: string[]; title?: string }) {
  if (!warnings?.length) return null
  return (
    <div className="panel-quiet p-3.5">
      <div className="eyebrow mb-2 flex items-center gap-1.5 text-warn/80">
        <AlertTriangle className="h-3 w-3" /> {title}
      </div>
      <ul className="space-y-1.5">
        {warnings.map((warning, index) => (
          <li key={index} className="flex gap-2 text-[11.5px] leading-relaxed text-mutedx">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn/60" />
            {warning}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------- metrics */

export function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
  hint,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'neutral' | 'gain' | 'loss' | 'warn' | 'violet'
  hint?: string
  className?: string
}) {
  const toneClass =
    tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'warn' ? 'text-warn' : tone === 'violet' ? 'text-violet-400' : 'text-white'
  return (
    <div className={cn('min-w-0', className)} title={hint}>
      <div className="eyebrow mb-1.5 truncate">{label}</div>
      <div className={cn('num text-[19px] leading-none', toneClass)}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-dimx">{sub}</div>}
    </div>
  )
}

export function DataStatus({
  provider,
  status,
  fetchedAt,
  compact,
}: {
  provider?: string | null
  status?: string | null
  fetchedAt?: string | null
  compact?: boolean
}) {
  const simulated = status === 'simulated' || provider === 'sample'
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', compact ? 'text-[10px]' : 'text-[11px]')}>
      <Badge tone={simulated ? 'warn' : 'neutral'}>{simulated ? 'simulated data' : (status ?? 'unknown').replace(/_/g, ' ')}</Badge>
      {provider && <span className="font-mono text-[10px] text-dimx">{provider}</span>}
      {fetchedAt && <span className="text-dimx">· {fmtDateTime(fetchedAt)}</span>}
    </span>
  )
}

export function InlineInfo({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle text-dimx" title={text} aria-label={text}>
      <Info className="h-3 w-3" />
    </span>
  )
}

export function ProgressBar({ value, tone = 'violet' }: { value: number; tone?: 'violet' | 'gain' | 'warn' | 'loss' }) {
  const colors = { violet: 'bg-violet-500', gain: 'bg-gain', warn: 'bg-warn', loss: 'bg-loss' }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={cn('h-full rounded-full transition-all', colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider', className)} />
}
