import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  BrainCircuit,
  CircleDollarSign,
  Database,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  ListChecks,
  Newspaper,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/format'
import { useDebounced } from '../lib/hooks'
import { useUi } from '../store/ui'
import type { InstrumentSummary } from '../lib/types'

const COMMANDS = [
  { label: 'Overview', sub: 'Market command center', href: '/app/overview', icon: LayoutDashboard, keywords: 'home dashboard market watchlist' },
  { label: 'Screener', sub: 'Filter the instrument universe', href: '/app/screener', icon: ScanSearch, keywords: 'screen filter scan rsi momentum' },
  { label: 'Research terminal', sub: 'Candles, indicators, notes', href: '/app/research/AAPL', icon: BarChart3, keywords: 'stock chart candles research' },
  { label: 'Compare instruments', sub: 'Normalized performance and correlation', href: '/app/compare', icon: BarChart3, keywords: 'correlation comparison relative' },
  { label: 'Prediction laboratory', sub: 'Train and compare models', href: '/app/prediction', icon: BrainCircuit, keywords: 'ml model train forecast experiment' },
  { label: 'Experiments', sub: 'Browse stored research runs', href: '/app/prediction?tab=experiments', icon: FlaskConical, keywords: 'experiments results history' },
  { label: 'Strategies', sub: 'Rule builder and signal preview', href: '/app/strategies', icon: Gauge, keywords: 'strategy rules backtest signals' },
  { label: 'Backtests', sub: 'Historical simulated performance', href: '/app/strategies?tab=backtests', icon: History, keywords: 'backtest equity curve trades' },
  { label: 'Portfolios', sub: 'Exposure, risk contribution, scenarios', href: '/app/portfolios', icon: Wallet, keywords: 'portfolio positions risk allocation' },
  { label: 'Watchlists & alerts', sub: 'Monitor symbols and thresholds', href: '/app/watchlists', icon: ListChecks, keywords: 'watchlist alert notify' },
  { label: 'Paper trading', sub: 'Simulated orders and ledger', href: '/app/paper', icon: CircleDollarSign, keywords: 'paper trade order buy sell simulated' },
  { label: 'Data Studio', sub: 'Upload and validate CSV history', href: '/app/data', icon: Database, keywords: 'dataset upload csv import' },
  { label: 'News & events', sub: 'Provider configuration state', href: '/app/news', icon: Newspaper, keywords: 'news headlines events sentiment' },
  { label: 'Model reliability', sub: 'Promotion state and matured outcomes', href: '/app/reliability', icon: ShieldCheck, keywords: 'health drift monitoring approval' },
  { label: 'Settings', sub: 'Preferences, sessions, integrations', href: '/app/settings', icon: Settings, keywords: 'account security broker connections' },
]

export function CommandPalette() {
  const { paletteOpen, setPalette } = useUi()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const debounced = useDebounced(query, 220)

  const { data: symbols, isFetching } = useQuery<{ results: InstrumentSummary[] }>({
    queryKey: ['symbol-search', debounced],
    queryFn: () => api<{ results: InstrumentSummary[] }>(`/api/v1/instruments/search?q=${encodeURIComponent(debounced)}&limit=6`),
    enabled: paletteOpen && debounced.trim().length > 0,
    staleTime: 60_000,
  })

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return COMMANDS
    return COMMANDS.filter((command) => `${command.label} ${command.sub} ${command.keywords}`.toLowerCase().includes(normalized))
  }, [query])

  const items = useMemo(
    () => [
      ...filteredCommands.map((command) => ({
        key: command.href,
        label: command.label,
        sub: command.sub,
        icon: command.icon,
        run: () => navigate(command.href),
      })),
      ...(symbols?.results ?? []).map((symbol) => ({
        key: `symbol-${symbol.symbol}`,
        label: symbol.symbol,
        sub: `${symbol.name} · ${symbol.exchange}`,
        icon: BarChart3,
        run: () => navigate(`/app/research/${encodeURIComponent(symbol.symbol)}`),
      })),
    ],
    [filteredCommands, symbols, navigate],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(!paletteOpen)
      }
      if (event.key === 'Escape' && paletteOpen) setPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, setPalette])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [paletteOpen])

  useEffect(() => setIndex(0), [query])

  if (!paletteOpen) return null

  const choose = (item: (typeof items)[number] | undefined) => {
    if (!item) return
    item.run()
    setPalette(false)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Command palette">
      <button className="absolute inset-0 cursor-default" onClick={() => setPalette(false)} aria-label="Close command palette" tabIndex={-1} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-white/[0.12] bg-ink-850 shadow-card">
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4">
          <Search className="h-4 w-4 text-dimx" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((current) => Math.min(items.length - 1, current + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((current) => Math.max(0, current - 1))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                choose(items[index])
              }
            }}
            placeholder="Search symbols, pages and actions…"
            className="h-12 w-full bg-transparent text-[13px] text-white outline-none placeholder:text-dimx"
            aria-label="Command search"
          />
          <button onClick={() => setPalette(false)} className="rounded p-1 text-dimx hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {query.trim() && (
            <div className="px-2 pb-1 pt-2">
              <div className="eyebrow flex items-center gap-2">
                Symbol search {isFetching && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />}
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-mutedx">No matches. Try a ticker like AAPL or MSFT.</div>
          ) : (
            items.map((item, itemIndex) => (
              <button
                key={item.key}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => choose(item)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                  itemIndex === index ? 'bg-white/[0.06]' : 'hover:bg-white/[0.035]',
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.025] text-violet-400">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-white">{item.label}</span>
                  <span className="block truncate text-[10.5px] text-dimx">{item.sub}</span>
                </span>
                {item.key.startsWith('symbol-') && <span className="chip">open</span>}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 font-mono text-[9px] text-dimx">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>
  )
}
