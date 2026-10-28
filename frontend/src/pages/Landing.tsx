import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Check,
  CircleDollarSign,
  Database,
  FlaskConical,
  Gauge,
  Globe2,
  Layers,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn, fmtNumber, fmtPct, pctClass } from '../lib/format'
import type { ProviderInfo, Quote } from '../lib/types'
import { Brand, MonoTag } from '../components/Brand'
import { ErrorBoundary } from '../components/ErrorBoundary'

const Hero3D = lazy(() => import('../components/Hero3D'))

interface Pulse {
  indices: (Quote & { name: string })[]
  provider: ProviderInfo
  note: string
}

function usePulse() {
  return useQuery<Pulse>({
    queryKey: ['public-pulse'],
    queryFn: () => api<Pulse>('/api/v1/public/market-pulse'),
    staleTime: 120_000,
    retry: 0,
  })
}

function SectionHead({
  index,
  eyebrow,
  title,
  copy,
  align = 'left',
}: {
  index: string
  eyebrow: string
  title: string
  copy: string
  align?: 'left' | 'center'
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-[10px] text-violet-400">{index}</span>
        <span className="h-px w-10 bg-white/15" />
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <h2 className="display text-[clamp(1.9rem,4vw,3.4rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-white balance">{title}</h2>
      <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-mutedx md:text-[15px]">{copy}</p>
    </div>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition duration-300',
        scrolled ? 'border-b border-white/[0.07] bg-ink-950/80 backdrop-blur-xl' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 px-5 lg:px-8">
        <Brand />
        <nav className="hidden items-center gap-7 text-[12px] text-mutedx md:flex" aria-label="Landing navigation">
          <a href="#market" className="transition hover:text-white">Market</a>
          <a href="#models" className="transition hover:text-white">Model lab</a>
          <a href="#strategies" className="transition hover:text-white">Strategies</a>
          <a href="#portfolio" className="transition hover:text-white">Portfolio</a>
          <a href="#trust" className="transition hover:text-white">Data &amp; trust</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">Sign in</Link>
          <Link to="/app/overview" className="btn btn-primary btn-sm">
            Open terminal <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  )
}

function PulseStrip({ pulse, loading, error }: { pulse?: Pulse; loading: boolean; error: boolean }) {
  if (loading) {
    return (
      <div className="border-y border-white/[0.06] bg-black/20">
        <div className="mx-auto flex h-11 max-w-[1280px] items-center gap-6 overflow-hidden px-5 lg:px-8">
          {[1, 2, 3].map((item) => (
            <div key={item} className="skeleton h-3 w-36" />
          ))}
        </div>
      </div>
    )
  }
  if (error || !pulse) {
    return (
      <div className="border-y border-white/[0.06] bg-black/20">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 font-mono text-[10px] text-dimx lg:px-8">
          <span className="text-warn">Market context unavailable.</span>
          <span>No prices are fabricated. The provider may be rate-limited; data appears once a configured source responds.</span>
        </div>
      </div>
    )
  }
  return (
    <div className="border-y border-white/[0.06] bg-black/20">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 gap-y-2 px-5 py-2.5 lg:px-8">
        <span className="eyebrow hidden text-violet-400/80 sm:inline">Market pulse</span>
        <div className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-2">
          {pulse.indices.map((index) => (
            <div key={index.symbol} className="flex items-baseline gap-2">
              <span className="text-[10px] text-dimx">{index.name}</span>
              <span className="num text-[11px] text-white">{fmtNumber(index.price, 2)}</span>
              <span className={cn('num text-[10px]', pctClass(index.change_pct))}>{fmtPct(index.change_pct, 2)}</span>
            </div>
          ))}
        </div>
        <span className="chip-warn chip">
          {pulse.provider.name === 'sample' ? 'SIMULATED · NOT MARKET DATA' : 'DELAYED · NOT REAL-TIME'}
        </span>
      </div>
    </div>
  )
}

function Hero() {
  const { data: pulse, isLoading, isError } = usePulse()
  return (
    <section className="relative overflow-hidden pt-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 grid-texture opacity-70" />
        <div className="aurora absolute -right-40 -top-40 h-[720px] w-[820px] opacity-70" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>
      <div className="relative mx-auto grid max-w-[1280px] gap-8 px-5 pb-10 pt-14 lg:grid-cols-[1.06fr_0.94fr] lg:items-center lg:px-8 lg:pb-16 lg:pt-20">
        <div className="relative z-10">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="chip chip-violet"><Sparkles className="h-3 w-3" /> Quantitative research terminal</span>
            <span className="chip">v0.1 · research build</span>
          </div>
          <h1 className="display max-w-[700px] text-[clamp(2.75rem,6.2vw,5.3rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-white balance">
            Understand the market.
            <br />
            Test the signal.
            <br />
            <span className="bg-[linear-gradient(110deg,#c4b5fd,#8b5cf6_40%,#22d3ee_78%,#34e0a1)] bg-clip-text text-transparent">Own the decision.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-mutedx md:text-[15px]">
            A working research environment for equities: point-in-time features, model comparisons against real baselines,
            cost-aware backtests and portfolio risk. One untouched test window. No promise that any of it prints money.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/app/overview" className="btn btn-primary px-5 py-2.5">
              Explore the terminal <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/register" className="btn btn-outline px-5 py-2.5">
              Create a research account
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] text-dimx">
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-gain" /> delayed data labelled</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-gain" /> paper trading only</span>
            <span className="flex items-center gap-1.5"><Check className="h-3 w-3 text-gain" /> no profit guarantees</span>
          </div>
        </div>

        <div className="relative h-[380px] sm:h-[460px] lg:h-[580px]">
          <div className="absolute inset-0 -left-4 sm:-left-10 lg:-left-16">
            <ErrorBoundary fallback={<div className="flex h-full items-center justify-center text-[11px] text-dimx">3D view unavailable — content remains usable.</div>}>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center" aria-hidden>
                    <div className="h-56 w-56 animate-pulse-soft rounded-full border border-violet-400/20 bg-violet-600/5" />
                  </div>
                }
              >
                <Hero3D />
              </Suspense>
            </ErrorBoundary>
          </div>
          <div className="pointer-events-none absolute left-0 top-8 hidden animate-float rounded-lg border border-white/10 bg-ink-850/75 px-3 py-2 backdrop-blur-md sm:block">
            <div className="eyebrow mb-1">Evaluation protocol</div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-gain" /> untouched test window
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-16 right-0 hidden rounded-lg border border-white/10 bg-ink-850/75 px-3 py-2 backdrop-blur-md sm:block">
            <div className="eyebrow mb-1">Feature store</div>
            <div className="num text-[13px] text-white">28 causal features</div>
            <div className="mt-0.5 font-mono text-[9px] text-dimx">version 2026-10-v1</div>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 hidden items-center gap-2 rounded-full border border-white/10 bg-ink-850/70 px-3 py-1.5 backdrop-blur-md sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyanx" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-mutedx">cost model active</span>
          </div>
        </div>
      </div>
      <PulseStrip pulse={pulse} loading={isLoading} error={isError} />
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 divide-x divide-white/[0.06] border-b border-white/[0.06] px-5 md:grid-cols-4 lg:px-8">
        {[
          ['28', 'causal features'],
          ['7 + 2', 'models + baselines'],
          ['60/20/20', 'chronological split'],
          ['0', 'live-trade buttons'],
        ].map(([value, label]) => (
          <div key={label} className="px-4 py-5 first:pl-0">
            <div className="num text-lg text-white">{value}</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.15em] text-dimx">{label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function MarketSection() {
  const { data: pulse, isLoading } = usePulse()
  return (
    <section id="market" className="relative mx-auto max-w-[1280px] px-5 py-20 lg:px-8 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
        <div>
          <SectionHead
            index="01"
            eyebrow="Market intelligence"
            title="A market view you can audit."
            copy="Every observation carries its provider, timestamp, currency and data status. When the provider is delayed, the interface says so. When it fails, it shows a failure state."
          />
          <ul className="mt-8 space-y-4">
            {[
              ['Delayed is labelled delayed.', 'Daily bars and quotes are end-of-day or provider-delayed, never dressed up as an exchange feed.'],
              ['Indicators are computed, not drawn.', 'RSI, MACD, Bollinger position, ATR, realized volatility and breadth use causal windows over real OHLCV.'],
              ['Failures stay visible.', 'No silent substitution of old prices for fresh ones; cached data carries its age.'],
            ].map(([title, copy]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gain/30 bg-gain/10">
                  <Check className="h-2.5 w-2.5 text-gain" />
                </span>
                <div>
                  <div className="text-[13px] font-medium text-white">{title}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-mutedx">{copy}</div>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/app/screener" className="btn btn-outline mt-8">
            Open the screener <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="panel relative overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-loss/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-warn/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-gain/70" />
              </span>
              <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.16em] text-dimx">market command / delayed</span>
            </div>
            <span className="chip chip-warn">end-of-day</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
              {isLoading
                ? [0, 1, 2].map((item) => <div key={item} className="bg-ink-850 p-3"><div className="skeleton h-8 w-full" /></div>)
                : (pulse?.indices ?? []).slice(0, 3).map((index) => (
                    <div key={index.symbol} className="bg-ink-850 p-3">
                      <div className="truncate text-[10px] text-dimx">{index.name}</div>
                      <div className="mt-1 num text-[15px] text-white">{fmtNumber(index.price, 2)}</div>
                      <div className={cn('mt-0.5 flex items-center gap-1 num text-[10px]', pctClass(index.change_pct))}>
                        {index.change_pct && index.change_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {fmtPct(index.change_pct)}
                      </div>
                    </div>
                  ))}
            </div>
            <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow">Cross-sectional surface</span>
                <MonoTag>schematic</MonoTag>
              </div>
              <svg viewBox="0 0 560 150" className="h-[150px] w-full" aria-label="Schematic market surface illustration">
                <defs>
                  <linearGradient id="surface-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.3" />
                    <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="surface-line" x1="0" x2="1">
                    <stop offset="0" stopColor="#a78bfa" />
                    <stop offset="0.65" stopColor="#22d3ee" />
                    <stop offset="1" stopColor="#34e0a1" />
                  </linearGradient>
                </defs>
                {[30, 60, 90, 120].map((y) => (
                  <line key={y} x1="0" y1={y} x2="560" y2={y} stroke="rgba(255,255,255,0.05)" />
                ))}
                <path d="M0 120 L40 112 L80 118 L120 96 L160 102 L200 82 L240 88 L280 64 L320 72 L360 52 L400 60 L440 38 L480 46 L520 28 L560 34 L560 150 L0 150 Z" fill="url(#surface-fill)" />
                <path d="M0 120 L40 112 L80 118 L120 96 L160 102 L200 82 L240 88 L280 64 L320 72 L360 52 L400 60 L440 38 L480 46 L520 28 L560 34" fill="none" stroke="url(#surface-line)" strokeWidth="1.6" />
                <circle cx="440" cy="38" r="3" fill="#34e0a1" />
                <circle cx="440" cy="38" r="7" fill="none" stroke="#34e0a1" strokeOpacity="0.3" />
              </svg>
              <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[9px] text-dimx">
                <span>MOMENTUM</span>
                <span className="text-center">VOLATILITY</span>
                <span className="text-right">RELATIVE STRENGTH</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[10.5px] text-mutedx sm:grid-cols-4">
              {['Price', '1M return', 'RSI(14)', 'SMA distance', 'Realized vol', 'Volume ratio', 'ATR%', 'Breadth'].map((label) => (
                <div key={label} className="rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1.5 font-mono text-[9px] text-dimx">
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ModelSection() {
  return (
    <section id="models" className="relative border-y border-white/[0.06] bg-[#07070d] py-20 lg:py-28">
      <div className="pointer-events-none absolute inset-0 grid-texture opacity-40" />
      <div className="relative mx-auto max-w-[1280px] px-5 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div>
            <SectionHead
              index="02"
              eyebrow="AI model laboratory"
              title="Models don't get to grade their own homework."
              copy="Train, validate and test are chronological and separate. The final window is scored once. A random-walk baseline is always in the room."
            />
            <div className="mt-9 space-y-3">
              {[
                ['01', 'Point-in-time features', 'Every feature at row t uses data available at row t. Targets look forward; features never do.'],
                ['02', 'Select on validation', 'The best candidate is chosen on the validation block, not on the test block.'],
                ['03', 'Freeze, then score', 'The chosen pipeline is refit on train + validation and evaluated once on the untouched test window.'],
                ['04', 'Report uncertainty', 'Residual quantiles and calibration are measured on unseen observations — not invented confidence scores.'],
              ].map(([step, title, copy]) => (
                <div key={step} className="group flex gap-4 border-b border-white/[0.06] py-4 last:border-0">
                  <span className="mt-0.5 font-mono text-[10px] text-violet-400/70">{step}</span>
                  <div>
                    <div className="text-[13px] font-medium text-white">{title}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-mutedx">{copy}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="eyebrow">Default chronological split</span>
                <MonoTag>purged</MonoTag>
              </div>
              <div className="relative flex h-16 overflow-hidden rounded-lg border border-white/[0.07]">
                <div className="flex w-[60%] items-center justify-center border-r border-dashed border-white/20 bg-violet-500/15">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-violet-300">train 60%</span>
                </div>
                <div className="w-[4%] bg-warn/10" title="Purge gap for overlapping labels" />
                <div className="flex w-[17%] items-center justify-center bg-cyanx/[0.07]">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-cyanx/80">val 20%</span>
                </div>
                <div className="w-[1%] bg-warn/10" />
                <div className="flex w-[18%] items-center justify-center border-l border-dashed border-gain/40 bg-gain/[0.09]">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-gain">test</span>
                </div>
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9px] text-dimx">
                <span>features → target h</span>
                <span className="text-warn/70">purge h sessions</span>
                <span>scored once</span>
              </div>
            </div>

            <div className="panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="eyebrow">Candidate families</span>
                <span className="font-mono text-[9px] text-dimx">registry</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['Linear', 'Ridge', 'Lasso', 'Random Forest', 'Hist Gradient Boosting', 'Logistic', 'Persistence', 'Historical mean'].map((model) => (
                  <span key={model} className="rounded border border-white/[0.08] bg-white/[0.025] px-2 py-1 font-mono text-[9.5px] text-mutedx">
                    {model}
                  </span>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-warn/20 bg-warn/[0.04] p-3 text-[11px] leading-relaxed text-warn/80">
                A low price error is not an edge. The system reports when a model fails to beat the baseline — including on the test window.
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ['MAE', 'mean absolute error'],
                ['Dir. accuracy', 'sign agreement'],
                ['Coverage', 'interval hit rate'],
              ].map(([label, sub]) => (
                <div key={label} className="panel-quiet p-3">
                  <div className="font-mono text-[10px] text-white">{label}</div>
                  <div className="mt-1 text-[9px] leading-snug text-dimx">{sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StrategySection() {
  return (
    <section id="strategies" className="mx-auto max-w-[1280px] px-5 py-20 lg:px-8 lg:py-28">
      <SectionHead
        index="03"
        eyebrow="Quantitative strategy laboratory"
        title="Rules first. Returns second."
        copy="Strategies are explicit conditions, not vibes. Signals are evaluated at the close and execute at the next open. Costs are charged on both sides."
      />
      <div className="mt-10 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-[12px] text-white">Trend following — SMA 200 filter</span>
            </div>
            <MonoTag>template</MonoTag>
          </div>
          <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2">
            {[
              ['ENTRY', ['price_vs_sma(200) > 0', 'momentum(63) > 2%']],
              ['EXIT', ['price_vs_sma(50) < −2%', 'stop loss 10%']],
              ['SIZING', ['long only', '100% notional', 'integer shares']],
              ['COSTS', ['2 bps commission', '5 bps slippage', 'next-open execution']],
            ].map(([label, rules]) => (
              <div key={label as string} className="bg-ink-850 p-4">
                <div className="eyebrow mb-2 text-violet-400/80">{label}</div>
                <div className="space-y-1.5 font-mono text-[11px] text-mutedx">
                  {(rules as string[]).map((rule) => (
                    <div key={rule} className="flex gap-2">
                      <span className="text-dimx">›</span>
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] px-4 py-3 text-[10px] text-dimx">
            <span className="text-gain">✓ no same-close fills</span>
            <span className="text-gain">✓ transaction log</span>
            <span className="text-gain">✓ benchmark comparison</span>
            <span className="text-gain">✓ costs disclosed</span>
          </div>
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-4">What the report refuses to hide</div>
          <ul className="space-y-3.5">
            {[
              ['Negative results', 'If costs turn the edge negative, the equity curve and conclusion stay visible.'],
              ['Selection count', 'A sweep records how many configurations were tried, so you can discount the winner.'],
              ['Execution assumptions', 'Signal timing, commission, slippage, spread and share granularity are printed with every run.'],
              ['Simulation boundaries', 'Historical simulation is never labelled live performance or a forecast.'],
            ].map(([title, copy]) => (
              <li key={title} className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyanx/70" />
                <div>
                  <div className="text-[12px] text-white">{title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-mutedx">{copy}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-lg border border-white/[0.07] bg-black/20 p-3 font-mono text-[9.5px] leading-relaxed text-dimx">
            <span className="text-violet-400/80">report =</span> equity + drawdown + trades + costs + turnover + benchmark + warnings
          </div>
        </div>
      </div>
    </section>
  )
}

function PortfolioSection() {
  return (
    <section id="portfolio" className="relative overflow-hidden border-y border-white/[0.06] bg-[#07070d] py-20 lg:py-28">
      <div className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-violet-600/[0.07] blur-3xl" />
      <div className="relative mx-auto grid max-w-[1280px] gap-12 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
        <div>
          <SectionHead
            index="04"
            eyebrow="Portfolio intelligence"
            title="Risk is a position, not a footnote."
            copy="See where return comes from and where the risk hides: weights, concentration, volatility, drawdown, correlation and contribution to variance."
          />
          <div className="mt-8 grid grid-cols-2 gap-3">
            {[
              ['Concentration', 'Herfindahl index + top weight'],
              ['Risk contribution', 'variance share by holding'],
              ['Correlation', 'aligned daily returns'],
              ['Scenarios', 'hypothetical re-weighting'],
            ].map(([title, copy]) => (
              <div key={title} className="border-l border-white/10 pl-3">
                <div className="text-[12px] text-white">{title}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-dimx">{copy}</div>
              </div>
            ))}
          </div>
          <Link to="/app/portfolios" className="btn btn-outline mt-8">
            Open portfolio lab <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="panel p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="eyebrow mb-1">Allocation illustration</div>
              <div className="display text-[13px] text-white">Concentration view</div>
            </div>
            <MonoTag>example only</MonoTag>
          </div>
          <div className="grid items-center gap-6 sm:grid-cols-[180px_1fr]">
            <div className="relative mx-auto h-[170px] w-[170px]">
              <div
                className="h-full w-full rounded-full"
                style={{
                  background:
                    'conic-gradient(#8b5cf6 0 32%, #22d3ee 32% 56%, #34e0a1 56% 74%, #fbbf24 74% 88%, rgba(255,255,255,0.12) 88% 100%)',
                  mask: 'radial-gradient(circle, transparent 55%, black 56%)',
                  WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="num text-lg text-white">HHI</div>
                <div className="font-mono text-[9px] text-dimx">concentration</div>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                ['Technology', '#8b5cf6', '32%'],
                ['Financials', '#22d3ee', '24%'],
                ['Health care', '#34e0a1', '18%'],
                ['Energy', '#fbbf24', '14%'],
                ['Cash', 'rgba(255,255,255,0.12)', '12%'],
              ].map(([label, color, weight]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2 text-[11px] last:border-0">
                  <span className="flex items-center gap-2 text-mutedx">
                    <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
                    {label}
                  </span>
                  <span className="num text-white">{weight}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-md border border-white/[0.06] bg-black/20 p-3 text-[10px] leading-relaxed text-dimx">
            Illustrative allocation for interface context. It is not a recommendation, a live portfolio, or historical performance.
          </div>
        </div>
      </div>
    </section>
  )
}

function PipelineSection() {
  const steps = [
    { icon: Globe2, title: 'Provider', copy: 'Delayed market data or a clearly labelled simulated source.' },
    { icon: Database, title: 'Normalize + cache', copy: 'OHLCV validation, deduplication and provenance stitching.' },
    { icon: Layers, title: 'Features', copy: '28 versioned, causal features shared by models and backtests.' },
    { icon: FlaskConical, title: 'Validate', copy: 'Chronological splits, purged labels, untouched final window.' },
    { icon: Activity, title: 'Decide + audit', copy: 'Forecast, uncertainty, risk checks, provenance and a recorded decision.' },
  ]
  return (
    <section className="mx-auto max-w-[1280px] px-5 py-20 lg:px-8 lg:py-28">
      <SectionHead
        index="05"
        eyebrow="Data-to-decision workflow"
        title="The pipeline is the product."
        copy="One path from provider response to a recorded research decision. The same feature definitions feed training, inference and strategy evaluation."
      />
      <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.06] lg:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step.title} className="relative bg-ink-850 p-5">
            <div className="mb-5 flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-violet-400">
                <step.icon className="h-4 w-4" />
              </span>
              <span className="font-mono text-[9px] text-dimx">0{index + 1}</span>
            </div>
            <div className="text-[13px] font-medium text-white">{step.title}</div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-mutedx">{step.copy}</div>
            {index < steps.length - 1 && (
              <ArrowRight className="absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-ink-850 p-0.5 text-dimx lg:block" />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function Capabilities() {
  const cards = [
    { icon: ScanSearch, title: 'Market screener', copy: 'Filter a real universe on computed price, momentum, volatility, RSI and volume rules.', to: '/app/screener', span: true },
    { icon: BarChart3, title: 'Research terminal', copy: 'Candles, volume, overlays, drawdown and notes.', to: '/app/research/AAPL' },
    { icon: BrainCircuit, title: 'Prediction lab', copy: 'Train and compare models with honest metrics.', to: '/app/prediction' },
    { icon: Gauge, title: 'Strategy lab', copy: 'Compose rules and preview signals.', to: '/app/strategies' },
    { icon: Wallet, title: 'Portfolio lab', copy: 'Positions, exposure and risk contribution.', to: '/app/portfolios' },
    { icon: Database, title: 'Data studio', copy: 'Validate and inspect your own CSV history.', to: '/app/data' },
    { icon: CircleDollarSign, title: 'Paper trading', copy: 'A simulated ledger with real accounting.', to: '/app/paper' },
    { icon: ShieldCheck, title: 'Model reliability', copy: 'Promotion gates and matured outcomes.', to: '/app/reliability' },
  ]
  return (
    <section className="border-y border-white/[0.06] bg-[#07070d] py-20 lg:py-28">
      <div className="mx-auto max-w-[1280px] px-5 lg:px-8">
        <SectionHead index="06" eyebrow="Platform capabilities" title="Twelve modules. One evidence trail." copy="Each workspace has a distinct job. None of them are a wall of decorative cards." />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card, index) => (
            <Link
              key={card.title}
              to={card.to}
              className={cn(
                'panel-interactive group flex min-h-[160px] flex-col justify-between p-4',
                card.span && 'sm:col-span-2 lg:col-span-2',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-violet-400">
                  <card.icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-[9px] text-dimx">0{index + 1}</span>
              </div>
              <div className="mt-6">
                <div className="flex items-center gap-2 text-[13px] font-medium text-white">
                  {card.title}
                  <ArrowUpRight className="h-3 w-3 text-dimx transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-400" />
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-mutedx">{card.copy}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function TrustSection() {
  return (
    <section id="trust" className="mx-auto max-w-[1280px] px-5 py-20 lg:px-8 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <SectionHead
            index="07"
            eyebrow="Trust and transparency"
            title="The limitations are part of the interface."
            copy="This is a research environment, not a promise. It is built to show failure states, provenance and uncertainty — including when the answer is 'no validated edge'."
          />
          <div className="mt-8 rounded-lg border border-warn/20 bg-warn/[0.04] p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-warn">
              <ShieldCheck className="h-3.5 w-3.5" /> Risk disclosure
            </div>
            <p className="text-[11px] leading-relaxed text-warn/75">
              Nothing here is investment advice. Historical simulations and model forecasts do not predict future returns.
              Market data may be delayed, incomplete or provider-limited. Paper trading is simulated. Live brokerage execution is
              not enabled in this build.
            </p>
          </div>
        </div>
        <div className="grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-2">
          {[
            { icon: Globe2, title: 'Data provenance', points: ['Provider, timestamp and currency shown', 'Delayed/end-of-day labelled', 'Simulated mode visually distinct', 'Failures never replaced with fake prices'] },
            { icon: BrainCircuit, title: 'Model honesty', points: ['Chronological splits with purge', 'Baseline-relative metrics', 'Test window scored once', 'Negative results retained'] },
            { icon: LockKeyhole, title: 'Account security', points: ['Argon2id password hashing', 'Opaque, revocable sessions', 'Per-user ownership checks', 'Login, reset and upload rate limits'] },
            { icon: TerminalSquare, title: 'Execution boundary', points: ['Paper ledger is clearly labelled', 'No broker adapter is faked', 'Live order endpoint hard-disabled', 'Idempotent paper orders'] },
          ].map((block) => (
            <div key={block.title} className="bg-ink-850 p-5">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-white">
                <block.icon className="h-3.5 w-3.5 text-cyanx/70" />
                {block.title}
              </div>
              <ul className="space-y-1.5">
                {block.points.map((point) => (
                  <li key={point} className="flex gap-2 text-[10.5px] leading-relaxed text-mutedx">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-white/20" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-[1280px] px-5 pb-20 lg:px-8 lg:pb-28">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(120deg,rgba(139,92,246,0.14),rgba(10,10,18,0.7)_45%,rgba(34,211,238,0.08))] px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
        <div className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full border border-white/[0.05]" />
        <div className="pointer-events-none absolute -right-10 -top-16 h-[260px] w-[260px] rounded-full border border-violet-400/10" />
        <div className="relative max-w-2xl">
          <div className="eyebrow mb-3 text-violet-300/80">Bring a hypothesis</div>
          <h2 className="display text-[clamp(2rem,4.5vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">
            Leave with evidence, <span className="text-violet-400">not a hunch.</span>
          </h2>
          <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-mutedx">
            Create an account, pick an instrument, and run a real comparison. If the signal is weak, the terminal will say so.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className="btn btn-primary px-5 py-2.5">
              Start researching <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn btn-outline px-5 py-2.5">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.07] bg-black/25">
      <div className="mx-auto max-w-[1280px] px-5 py-12 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-3 max-w-xs text-[11px] leading-relaxed text-mutedx">
              A quantitative research terminal for equities. Delayed data, validated experiments, simulated execution.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="chip">delayed data</span>
              <span className="chip-warn chip">paper only</span>
            </div>
          </div>
          {[
            { title: 'Product', links: [['Overview', '/app/overview'], ['Screener', '/app/screener'], ['Prediction lab', '/app/prediction'], ['Paper trading', '/app/paper']] },
            { title: 'Research', links: [['Methodology', '/#models'], ['Model reliability', '/app/reliability'], ['API docs', '/api/docs'], ['Data & trust', '/#trust']] },
            { title: 'Disclosures', links: [['Risk disclosure', '/#trust'], ['Privacy', '/legal/privacy'], ['Terms', '/legal/terms'], ['Data sources', '/legal/data-sources']] },
          ].map((column) => (
            <div key={column.title}>
              <div className="eyebrow mb-3">{column.title}</div>
              <ul className="space-y-2">
                {column.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('/app') || href.startsWith('/legal') ? (
                      <Link to={href} className="text-[11.5px] text-mutedx transition hover:text-white">{label}</Link>
                    ) : (
                      <a href={href} className="text-[11.5px] text-mutedx transition hover:text-white">{label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col justify-between gap-3 border-t border-white/[0.06] pt-5 text-[10px] leading-relaxed text-dimx md:flex-row">
          <p>© 2026 StockPulse AI. Research software. Not investment advice. No regulatory approval is claimed.</p>
          <p>Yahoo Finance data is delayed and subject to its own terms. No market-data redistribution is claimed.</p>
        </div>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <Nav />
      <main>
        <Hero />
        <MarketSection />
        <ModelSection />
        <StrategySection />
        <PortfolioSection />
        <PipelineSection />
        <Capabilities />
        <TrustSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
