import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Bell,
  BrainCircuit,
  CheckCheck,
  ChartCandlestick,
  ChevronDown,
  CircleDollarSign,
  Database,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Newspaper,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, post } from '../lib/api'
import { cn, relativeTime } from '../lib/format'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { Badge } from './ui'
import { ErrorBoundary } from './ErrorBoundary'
import { Brand } from './Brand'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  match?: string
  tag?: string
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Terminal',
    items: [
      { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/app/screener', label: 'Screener', icon: ScanSearch },
      { to: '/app/compare', label: 'Compare', icon: BarChart3 },
      { to: '/app/research/AAPL', label: 'Research', icon: ChartCandlestick, match: '/app/research' },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/app/prediction', label: 'Prediction lab', icon: BrainCircuit },
      { to: '/app/strategies', label: 'Strategy lab', icon: Gauge },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { to: '/app/portfolios', label: 'Portfolios', icon: Wallet },
      { to: '/app/watchlists', label: 'Watchlists', icon: ListChecks },
      { to: '/app/paper', label: 'Paper trading', icon: CircleDollarSign, tag: 'PAPER' },
    ],
  },
  {
    label: 'Data & system',
    items: [
      { to: '/app/data', label: 'Data studio', icon: Database },
      { to: '/app/news', label: 'News & events', icon: Newspaper },
      { to: '/app/reliability', label: 'Model reliability', icon: ShieldCheck },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
]

interface LayoutStatus {
  provider: { name: string; data_status: string; configured: boolean; notes: string }
  capabilities: Record<string, boolean | string>
  coverage: { approved_models: number; cached_bars: number }
  warnings: string[]
}

interface NotificationItem {
  id: string
  title: string
  body: string
  kind: string
  link: string
  read: boolean
  created_at: string
}

function isActive(pathname: string, item: NavItem) {
  if (item.match) return pathname.startsWith(item.match)
  if (item.to === '/app/overview') return pathname === '/app/overview'
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { data: status } = useQuery<LayoutStatus>({
    queryKey: ['system-status'],
    queryFn: () => api<LayoutStatus>('/api/v1/system/status'),
    staleTime: 120_000,
  })
  const location = useLocation()
  const setPalette = useUi((state) => state.setPalette)
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Brand />
        <span className="rounded border border-white/[0.08] px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-dimx">β</span>
      </div>
      <div className="px-3 pb-3">
        <button
          onClick={() => {
            setPalette(true)
            onNavigate?.()
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-left text-[11px] text-dimx transition hover:border-white/20 hover:text-mutedx"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1">Search or jump to…</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1.5 px-2 font-mono text-[8.5px] uppercase tracking-[0.2em] text-dimx/80">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(location.pathname, item)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] transition',
                      active ? 'bg-white/[0.06] text-white' : 'text-mutedx hover:bg-white/[0.035] hover:text-white',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <item.icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-violet-400' : 'text-dimx group-hover:text-mutedx')} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.tag && <span className="rounded-sm bg-warn/10 px-1 py-0.5 font-mono text-[7.5px] uppercase tracking-wider text-warn/80">{item.tag}</span>}
                    {active && <span className="h-1 w-1 rounded-full bg-violet-400" />}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-dimx">Data provider</span>
            <span className={cn('h-1.5 w-1.5 rounded-full', status?.provider?.data_status === 'simulated' ? 'bg-warn' : 'bg-cyanx')} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-white">{status?.provider?.name ?? '—'}</span>
            <span className="font-mono text-[8px] uppercase text-dimx">{status?.provider?.data_status ?? 'delayed'}</span>
          </div>
          <div className="mt-2 border-t border-white/[0.06] pt-2 text-[9px] leading-relaxed text-dimx">
            Live brokerage execution is disabled. Paper mode only.
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { sidebarOpen, setSidebar, setPalette } = useUi()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const notificationRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  const { data: status } = useQuery<LayoutStatus>({
    queryKey: ['system-status'],
    queryFn: () => api<LayoutStatus>('/api/v1/system/status'),
    staleTime: 120_000,
  })

  const notifications = useQuery<{ notifications: NotificationItem[]; unread: number }>({
    queryKey: ['notifications'],
    queryFn: () => api('/api/v1/notifications'),
    staleTime: 30_000,
  })

  useEffect(() => {
    setSidebar(false)
    setNotificationsOpen(false)
    setUserOpen(false)
  }, [location.pathname, setSidebar])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) setNotificationsOpen(false)
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [])

  const currentTitle = location.pathname.startsWith('/app/experiments/')
    ? 'Experiment report'
    : location.pathname.startsWith('/app/backtests/')
      ? 'Backtest report'
      : NAV_GROUPS.flatMap((group) => group.items).find((item) => isActive(location.pathname, item))?.label ?? 'Terminal'
  const simulated = status?.provider?.data_status === 'simulated' || status?.provider?.name === 'sample'
  const initials = (user?.display_name || user?.email || 'U').slice(0, 2).toUpperCase()
  const unread = notifications.data?.unread ?? 0

  const signOut = async () => {
    await logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-bg min-h-screen bg-ink-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-white/[0.06] bg-ink-950/70 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setSidebar(false)} aria-label="Close navigation" tabIndex={-1} />
          <aside className="relative h-full w-[280px] border-r border-white/10 bg-ink-900">
            <button onClick={() => setSidebar(false)} className="absolute right-3 top-4 z-10 rounded p-1 text-dimx hover:text-white" aria-label="Close navigation">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={() => setSidebar(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button onClick={() => setSidebar(true)} className="rounded-md p-1.5 text-mutedx hover:bg-white/5 hover:text-white lg:hidden" aria-label="Open navigation">
              <Menu className="h-4 w-4" />
            </button>
            <div className="hidden items-center gap-2 text-[11px] sm:flex">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-dimx">Terminal</span>
              <span className="text-white/20">/</span>
              <span className="text-white">{currentTitle}</span>
            </div>
            <div className="flex flex-1 justify-center px-2">
              <button
                onClick={() => setPalette(true)}
                className="group flex w-full max-w-[380px] items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-left text-[11px] text-dimx transition hover:border-white/[0.16] hover:bg-white/[0.035] hover:text-mutedx"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="flex-1 truncate">Search symbol or command</span>
                <span className="kbd hidden sm:inline-flex">⌘K</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="hidden items-center gap-1.5 rounded-full border border-warn/20 bg-warn/[0.06] px-2 py-1 font-mono text-[8.5px] uppercase tracking-wider text-warn/85 sm:flex">
                <span className="h-1 w-1 rounded-full bg-warn" /> paper only
              </span>
              <div className="relative" ref={notificationRef}>
                <button
                  onClick={() => {
                    setNotificationsOpen((open) => !open)
                    void notifications.refetch()
                  }}
                  className="relative rounded-md p-2 text-mutedx transition hover:bg-white/5 hover:text-white"
                  aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                  aria-expanded={notificationsOpen}
                >
                  <Bell className="h-4 w-4" />
                  {unread > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-400 ring-2 ring-ink-950" />}
                </button>
                {notificationsOpen && (
                  <div className="absolute right-0 top-11 w-[340px] overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-card">
                    <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2.5">
                      <span className="text-[11px] font-medium text-white">Notifications</span>
                      <button
                        className="flex items-center gap-1 text-[10px] text-dimx hover:text-white"
                        onClick={async () => {
                          await post('/api/v1/notifications/read-all')
                          await notifications.refetch()
                        }}
                      >
                        <CheckCheck className="h-3 w-3" /> Mark all read
                      </button>
                    </div>
                    <div className="max-h-[340px] overflow-y-auto">
                      {!notifications.data?.notifications.length ? (
                        <div className="px-3 py-8 text-center text-[11px] text-dimx">No notifications. Alerts you create appear here.</div>
                      ) : (
                        notifications.data.notifications.slice(0, 8).map((item) => (
                          <button
                            key={item.id}
                            onClick={async () => {
                              if (!item.read) {
                                await post(`/api/v1/notifications/${item.id}/read`)
                                await notifications.refetch()
                              }
                              setNotificationsOpen(false)
                              if (item.link) navigate(item.link)
                            }}
                            className="flex w-full items-start gap-2.5 border-b border-white/[0.05] px-3 py-3 text-left transition last:border-0 hover:bg-white/[0.03]"
                          >
                            <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', item.read ? 'bg-white/15' : 'bg-violet-400')} />
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] text-white">{item.title}</span>
                              <span className="mt-0.5 block line-clamp-2 text-[10px] leading-relaxed text-mutedx">{item.body}</span>
                              <span className="mt-1 block font-mono text-[8.5px] text-dimx">{relativeTime(item.created_at)}</span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                    <Link to="/app/watchlists" onClick={() => setNotificationsOpen(false)} className="block border-t border-white/[0.07] px-3 py-2 text-center text-[10px] text-violet-400 hover:bg-white/[0.03] hover:text-white">
                      Manage watchlists &amp; alerts
                    </Link>
                  </div>
                )}
              </div>
              <div className="relative" ref={userRef}>
                <button
                  onClick={() => setUserOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 transition hover:bg-white/5"
                  aria-label="Account menu"
                  aria-expanded={userOpen}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-violet-400/25 bg-violet-500/15 font-mono text-[9px] text-violet-300">
                    {initials}
                  </span>
                  <ChevronDown className="hidden h-3 w-3 text-dimx sm:block" />
                </button>
                {userOpen && (
                  <div className="absolute right-0 top-11 w-60 overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-card">
                    <div className="border-b border-white/[0.07] px-3 py-3">
                      <div className="truncate text-[12px] text-white">{user?.display_name || 'Researcher'}</div>
                      <div className="truncate text-[10px] text-dimx">{user?.email}</div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <Badge tone={user?.email_verified ? 'gain' : 'warn'}>{user?.email_verified ? 'verified' : 'email unverified'}</Badge>
                        <Badge>paper only</Badge>
                      </div>
                    </div>
                    <Link to="/app/settings" onClick={() => setUserOpen(false)} className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-mutedx hover:bg-white/[0.04] hover:text-white">
                      <User className="h-3.5 w-3.5" /> Account &amp; preferences
                    </Link>
                    <button onClick={signOut} className="flex w-full items-center gap-2 border-t border-white/[0.06] px-3 py-2.5 text-left text-[11px] text-mutedx hover:bg-white/[0.04] hover:text-loss">
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {simulated && (
          <div className="border-b border-warn/20 bg-warn/[0.06] px-4 py-2 text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-warn/90 sm:px-6">
            Simulated data provider active — every price is synthetic. Switch MARKET_DATA_PROVIDER to yahoo for real delayed data.
          </div>
        )}

        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <div key={location.pathname} className="animate-fade-up">
            <ErrorBoundary
              fallback={
                <div className="panel p-6">
                  <div className="text-[13px] font-medium text-loss">This workspace failed to render</div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-mutedx">
                    The rest of the terminal is still usable. Reload this page, or return to the overview. No financial state was changed by the render error.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button className="btn btn-outline btn-sm" onClick={() => window.location.reload()}>Reload page</button>
                    <a className="btn btn-ghost btn-sm" href="/app/overview">Back to overview</a>
                  </div>
                </div>
              }
            >
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>

        <footer className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-2 px-4 pb-6 font-mono text-[9px] uppercase tracking-[0.1em] text-dimx sm:px-6 lg:px-8">
          <span>Research environment · delayed/end-of-day data · paper trading only</span>
          <span>{status?.coverage?.cached_bars ? `${status.coverage.cached_bars.toLocaleString()} cached bars` : 'provider bootstrap on first request'}</span>
        </footer>
      </div>
    </div>
  )
}
