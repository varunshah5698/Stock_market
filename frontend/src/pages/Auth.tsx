import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, FlaskConical, LockKeyhole, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage, post } from '../lib/api'
import { cn, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useAuth } from '../store/auth'
import { Brand, MonoTag } from '../components/Brand'
import type { Quote } from '../lib/types'

interface Pulse {
  indices: (Quote & { name: string })[]
  provider: { name: string; data_status: string }
}

function AuthVisual() {
  const { data } = useQuery<Pulse>({
    queryKey: ['public-pulse'],
    queryFn: () => api<Pulse>('/api/v1/public/market-pulse'),
    staleTime: 120_000,
    retry: 0,
  })
  return (
    <aside className="relative hidden overflow-hidden border-l border-white/[0.06] lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-10 xl:p-14">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 grid-texture opacity-60" />
        <div className="aurora absolute -right-20 -top-20 h-[700px] w-[700px] opacity-70" />
        <div className="absolute bottom-0 left-0 h-64 w-full bg-gradient-to-t from-ink-950 to-transparent" />
      </div>
      <div className="relative flex items-center justify-between">
        <span className="eyebrow">Research workspace · secure session</span>
        <MonoTag>v0.1</MonoTag>
      </div>

      <div className="relative">
        <div className="relative mx-auto mb-10 h-[300px] w-[300px] xl:h-[360px] xl:w-[360px]" aria-hidden>
          <div className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-white/10" />
          <div className="absolute inset-8 rounded-full border border-violet-400/20" />
          <div className="absolute inset-16 rounded-full border border-cyanx/15" />
          <div className="absolute inset-[5.5rem] rounded-full border border-gain/10" />
          <div className="absolute inset-[6.5rem] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(167,139,250,0.5),rgba(11,8,22,0.95)_62%)] shadow-[0_0_100px_rgba(124,58,237,0.4)] xl:inset-28" />
          <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id="auth-line" x1="0" x2="1">
                <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.1" />
                <stop offset="0.5" stopColor="#22d3ee" stopOpacity="0.7" />
                <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <path d="M20 200 C80 120, 140 260, 200 150 S270 90, 288 120" fill="none" stroke="url(#auth-line)" strokeWidth="1.2" />
            <circle cx="200" cy="150" r="2.5" fill="#34e0a1" />
            <circle cx="90" cy="160" r="1.8" fill="#22d3ee" />
          </svg>
          <div className="absolute left-0 top-10 rounded border border-white/10 bg-ink-850/70 px-2.5 py-2 backdrop-blur-md">
            <div className="font-mono text-[8px] uppercase tracking-wider text-dimx">test window</div>
            <div className="mt-0.5 text-[10px] text-gain">untouched</div>
          </div>
          <div className="absolute bottom-6 right-[-12px] rounded border border-white/10 bg-ink-850/70 px-2.5 py-2 backdrop-blur-md">
            <div className="font-mono text-[8px] uppercase tracking-wider text-dimx">leakage guard</div>
            <div className="mt-0.5 text-[10px] text-white">purged splits</div>
          </div>
        </div>

        <h2 className="display max-w-md text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-white xl:text-[3.2rem]">
          Evidence over conviction.
        </h2>
        <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-mutedx">
          Test the signal before it costs you anything. Every forecast exposes its data cutoff, out-of-sample record and uncertainty.
        </p>
        <div className="mt-6 grid max-w-md grid-cols-1 gap-2.5 sm:grid-cols-3">
          {[
            [FlaskConical, 'Model lab'],
            [ShieldCheck, 'Risk-aware'],
            [LockKeyhole, 'Account-scoped'],
          ].map(([Icon, label]) => {
            const Component = Icon as typeof FlaskConical
            return (
              <div key={label as string} className="flex items-center gap-2 rounded border border-white/[0.07] bg-white/[0.02] px-2.5 py-2 text-[10px] text-mutedx">
                <Component className="h-3 w-3 text-violet-400" />
                {label as string}
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Delayed market context</span>
          <span className="chip chip-warn">{data?.provider?.data_status === 'simulated' ? 'simulated' : 'delayed'}</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.07] pt-3">
          {data?.indices?.slice(0, 3).map((index) => (
            <div key={index.symbol} className="flex items-baseline gap-2">
              <span className="text-[10px] text-dimx">{index.name}</span>
              <span className="num text-[11px] text-white">{fmtNumber(index.price, 2)}</span>
              <span className={cn('num text-[10px]', pctClass(index.change_pct))}>{fmtPct(index.change_pct)}</span>
            </div>
          )) ?? <span className="font-mono text-[10px] text-dimx">Provider context unavailable — no prices fabricated.</span>}
        </div>
        <p className="mt-3 text-[9.5px] leading-relaxed text-dimx">
          Research software. Not investment advice. Paper trading only; live brokerage execution is disabled.
        </p>
      </div>
    </aside>
  )
}

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: ReactNode
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-ink-950">
      <main className="flex w-full flex-col lg:w-[48%]">
        <div className="flex items-center justify-between px-6 py-5 sm:px-10">
          <Brand />
          <Link to="/" className="btn btn-ghost btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10">
          <div className="w-full max-w-[380px]">
            <h1 className="display text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white">{title}</h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mutedx">{subtitle}</p>
            <div className="mt-7">{children}</div>
            <div className="mt-6 border-t border-white/[0.06] pt-5 text-[11.5px] text-mutedx">{footer}</div>
          </div>
        </div>
        <div className="px-6 pb-6 text-center font-mono text-[9px] tracking-wide text-dimx sm:px-10">
          DELAYED DATA · PAPER TRADING ONLY · NO PROFIT GUARANTEE
        </div>
      </main>
      <AuthVisual />
    </div>
  )
}

function PasswordField({
  value,
  onChange,
  label = 'Password',
  autoComplete = 'current-password',
  id = 'password',
  error,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  autoComplete?: string
  id?: string
  error?: string | null
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          className={cn('input pr-10', error && 'border-loss/50')}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-dimx hover:text-white"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <div id={`${id}-error`} className="mt-1.5 text-[11px] text-loss">{error}</div>}
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="flex gap-2 rounded-lg border border-loss/25 bg-loss/[0.06] p-3 text-[11.5px] leading-relaxed text-loss" role="alert">
      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  )
}

export function LoginPage() {
  useDocumentTitle('Sign in')
  const { user, initialized, login, busy } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  if (initialized && user) return <Navigate to="/app/overview" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await login(email.trim(), password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from.startsWith('/app') ? from : '/app/overview', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <AuthShell
      title="Sign in to the terminal"
      subtitle="Sessions are server-side, revocable, and expire after seven days."
      footer={
        <span>
          New here? <Link to="/register" className="link">Create a research account</Link>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            ref={emailRef}
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            placeholder="you@firm.com"
          />
        </div>
        <PasswordField value={password} onChange={setPassword} />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-dimx">Delayed data · paper trading</span>
          <Link to="/forgot-password" className="text-violet-400 hover:text-white">Forgot password?</Link>
        </div>
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <div className="mt-5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-[10.5px] leading-relaxed text-dimx">
        <LockKeyhole className="mr-1.5 inline h-3 w-3 text-violet-400" />
        No OAuth provider is configured in this build. Email and password authentication only.
      </div>
    </AuthShell>
  )
}

const passwordRules = [
  { label: 'At least 10 characters', test: (value: string) => value.length >= 10 },
  { label: 'Contains a letter', test: (value: string) => /[A-Za-z]/.test(value) },
  { label: 'Contains a number', test: (value: string) => /\d/.test(value) },
]

export function RegisterPage() {
  useDocumentTitle('Create account')
  const { user, initialized, register, busy } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  if (initialized && user) return <Navigate to="/app/overview" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setConfirmError(null)
    if (password !== confirm) {
      setConfirmError('Passwords do not match.')
      return
    }
    if (!accepted) {
      setError('You must accept the research terms to continue.')
      return
    }
    try {
      await register(email.trim(), password, displayName.trim())
      navigate('/app/overview', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <AuthShell
      title="Create a research account"
      subtitle="No card, no brokerage connection, no live orders. Just a scoped research workspace."
      footer={<span>Already have an account? <Link to="/login" className="link">Sign in</Link></span>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <div>
          <label className="label" htmlFor="name">Display name</label>
          <input id="name" className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="Ada Lovelace" maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@firm.com" />
        </div>
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" id="new-password" />
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          {passwordRules.map((rule) => {
            const ok = rule.test(password)
            return (
              <div key={rule.label} className={cn('flex items-center gap-1.5 text-[10px]', ok ? 'text-gain' : 'text-dimx')}>
                {ok ? <Check className="h-2.5 w-2.5" /> : <span className="h-1 w-1 rounded-full bg-current" />}
                {rule.label}
              </div>
            )
          })}
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            className={cn('input', confirmError && 'border-loss/50')}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
          {confirmError && <div className="mt-1.5 text-[11px] text-loss">{confirmError}</div>}
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-mutedx">
          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-violet-500" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>
            I understand this is research software, market data is delayed, paper trading is simulated, and nothing here is investment advice.{' '}
            <Link to="/legal/terms" className="text-violet-400 hover:text-white">Terms</Link> · <Link to="/legal/privacy" className="text-violet-400 hover:text-white">Privacy</Link>
          </span>
        </label>
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-4 text-[10.5px] leading-relaxed text-dimx">
        Email verification and password-reset delivery require an email provider, which is not configured. The account is usable,
        but the interface will keep showing that limitation.
      </p>
    </AuthShell>
  )
}

interface ForgotResponse {
  message: string
  email_delivery: string
  note: string
  development_reset_token?: string
}

export function ForgotPasswordPage() {
  useDocumentTitle('Reset password')
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<ForgotResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const response = await post<ForgotResponse>('/api/v1/auth/forgot-password', { email: email.trim() })
      setResult(response)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="If the account exists, a single-use reset token is created. No account existence is revealed."
      footer={<Link to="/login" className="link">Back to sign in</Link>}
    >
      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-gain/20 bg-gain/[0.05] p-3 text-[12px] leading-relaxed text-gain/90">{result.message}</div>
          <div className="rounded-lg border border-warn/20 bg-warn/[0.04] p-3 text-[11px] leading-relaxed text-warn/80">
            <div className="mb-1 font-medium">Email delivery is not configured</div>
            {result.note}
          </div>
          {result.development_reset_token && (
            <div className="rounded-lg border border-white/10 bg-black/25 p-3">
              <div className="eyebrow mb-1.5">Development-only reset token</div>
              <code className="block break-all font-mono text-[10px] leading-relaxed text-cyanx/80">{result.development_reset_token}</code>
              <Link to={`/reset-password?token=${encodeURIComponent(result.development_reset_token)}`} className="btn btn-outline btn-sm mt-3">
                Open reset form
              </Link>
            </div>
          )}
          <button className="btn btn-outline w-full" onClick={() => setResult(null)}>Use another email</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={error} />
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@firm.com" />
          </div>
          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Creating token…' : 'Request reset'} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [token, setToken] = useState(params.get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setConfirmError(null)
    if (password !== confirm) {
      setConfirmError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await post('/api/v1/auth/reset-password', { token: token.trim(), password })
      setSuccess(true)
      window.setTimeout(() => navigate('/login', { replace: true }), 1600)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Resetting revokes every existing session for the account."
      footer={<Link to="/login" className="link">Back to sign in</Link>}
    >
      {success ? (
        <div className="rounded-lg border border-gain/20 bg-gain/[0.05] p-4 text-[12px] leading-relaxed text-gain/90">
          Password updated. Redirecting to sign in…
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={error} />
          {!params.get('token') && (
            <div>
              <label className="label" htmlFor="token">Reset token</label>
              <input id="token" className="input font-mono text-[11px]" value={token} onChange={(event) => setToken(event.target.value)} required />
            </div>
          )}
          <PasswordField value={password} onChange={setPassword} label="New password" autoComplete="new-password" id="new-password" />
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {passwordRules.map((rule) => {
              const ok = rule.test(password)
              return (
                <div key={rule.label} className={cn('flex items-center gap-1.5 text-[10px]', ok ? 'text-gain' : 'text-dimx')}>
                  {ok ? <Check className="h-2.5 w-2.5" /> : <span className="h-1 w-1 rounded-full bg-current" />}
                  {rule.label}
                </div>
              )
            })}
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input id="confirm" className={cn('input', confirmError && 'border-loss/50')} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
            {confirmError && <div className="mt-1.5 text-[11px] text-loss">{confirmError}</div>}
          </div>
          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}
    </AuthShell>
  )
}
