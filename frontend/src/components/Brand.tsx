import { Link } from 'react-router-dom'
import { cn } from '../lib/format'

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link to="/" className={cn('group inline-flex items-center gap-2.5', className)} aria-label="StockPulse AI home">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/25 bg-[linear-gradient(145deg,rgba(139,92,246,0.28),rgba(34,211,238,0.08))]">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
          <path
            d="M2.5 14.5h4l2-7 3 12 2.5-9 2 5h5"
            fill="none"
            stroke="url(#brand-grad)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#c4b5fd" />
              <stop offset="0.6" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      {!compact && (
        <span className="display text-[15px] font-semibold tracking-tight text-white">
          StockPulse <span className="text-violet-400">AI</span>
        </span>
      )}
    </Link>
  )
}

export function MonoTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-sm border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-dimx', className)}>
      {children}
    </span>
  )
}
