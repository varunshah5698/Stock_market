import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  Download,
  KeyRound,
  Link2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, Modal, PageHeader, SectionTitle, Select, StatusPill, Tabs } from '../components/ui'
import { api, del, errorMessage, post, put } from '../lib/api'
import { cn, fmtDateTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useAuth } from '../store/auth'
import { useToasts } from '../store/ui'

interface SessionInfo {
  id: string
  created_at: string
  expires_at: string
  user_agent: string
  ip: string
  current: boolean
}

interface Integrations {
  market_data: { configured: boolean; provider: string; status: string; requires: string }
  news: { configured: boolean; status: string; requires: string; env: string[] }
  broker: { configured: boolean; status: string; requires: string; env: string[] }
  email: { configured: boolean; status: string; requires: string }
  mfa: { configured: boolean; status: string }
  streaming: { configured: boolean; status: string; requires: string }
}

interface BrokerState {
  connections: { id: string; broker: string; status: string; account_ref: string }[]
  available: boolean
  reason: string
  requirements: string[]
}

interface TradingState {
  modes: { id: string; label: string; available: boolean; reason: string; accounts?: number }[]
  live_trading_enabled: boolean
  paper_only: boolean
  kill_switch: { exists: boolean; reason: string }
  requirements_for_live: string[]
  note: string
}

type Tab = 'profile' | 'security' | 'integrations' | 'data'

export default function Settings() {
  useDocumentTitle('Settings')
  const { user, preferences, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)
  const [tab, setTab] = useState<Tab>('profile')
  const [baseCurrency, setBaseCurrency] = useState('USD')
  const [defaultMarket, setDefaultMarket] = useState('US')
  const [defaultHorizon, setDefaultHorizon] = useState('5')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')

  useEffect(() => {
    if (!preferences) return
    setBaseCurrency(preferences.base_currency)
    setDefaultMarket(preferences.default_market)
    setDefaultHorizon(String(preferences.default_horizon))
  }, [preferences])

  const sessions = useQuery<{ sessions: SessionInfo[] }>({
    queryKey: ['sessions'],
    queryFn: () => api('/api/v1/settings/sessions'),
  })

  const audit = useQuery<{ events: { id: string; action: string; target: string; ip: string; created_at: string }[] }>({
    queryKey: ['audit-log'],
    queryFn: () => api('/api/v1/settings/audit?limit=40'),
  })

  const integrations = useQuery<Integrations>({
    queryKey: ['integrations'],
    queryFn: () => api('/api/v1/settings/integrations'),
  })

  const brokers = useQuery<BrokerState>({
    queryKey: ['broker-connections'],
    queryFn: () => api('/api/v1/broker-connections'),
  })

  const trading = useQuery<TradingState>({
    queryKey: ['trading-status'],
    queryFn: () => api('/api/v1/trading/status'),
  })

  const savePreferences = useMutation({
    mutationFn: () =>
      put('/api/v1/settings/preferences', {
        base_currency: baseCurrency.toUpperCase(),
        default_market: defaultMarket.toUpperCase(),
        default_horizon: Number(defaultHorizon),
        theme: 'dark',
        chart_defaults: {},
        notifications: { in_app: true },
      }),
    onSuccess: async () => {
      toast('Preferences saved', 'success')
      await refresh()
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const changePassword = useMutation({
    mutationFn: () => post('/api/v1/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
    onSuccess: async () => {
      toast('Password changed. Other sessions were revoked.', 'success')
      setCurrentPassword('')
      setNewPassword('')
      await sessions.refetch()
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const revokeSession = useMutation({
    mutationFn: (id: string) => del(`/api/v1/settings/sessions/${id}`),
    onSuccess: () => {
      toast('Session revoked', 'success')
      void sessions.refetch()
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const revokeOthers = useMutation({
    mutationFn: () => post<{ revoked: number }>('/api/v1/settings/sessions/revoke-others'),
    onSuccess: (data) => {
      toast(`${data.revoked} other session(s) revoked`, 'success')
      void sessions.refetch()
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const deleteAccount = useMutation({
    mutationFn: async () => {
      await api('/api/v1/settings/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword, confirm: deleteConfirm }),
      })
    },
    onSuccess: async () => {
      toast('Account deleted', 'success')
      useAuth.getState().markUnauthorized()
      queryClient.clear()
      navigate('/', { replace: true })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const signOut = async () => {
    await logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Account preferences, session control, integration truth, exports and deletion. No secret is ever displayed after storage."
        actions={<Button size="sm" variant="outline" onClick={signOut} icon={<LogOut className="h-3.5 w-3.5" />}>Sign out</Button>}
      />

      <Tabs
        tabs={[
          { value: 'profile', label: 'Profile & preferences' },
          { value: 'security', label: 'Security & sessions' },
          { value: 'integrations', label: 'Integrations & trading' },
          { value: 'data', label: 'Data & account' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'profile' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <section className="panel p-5">
            <SectionTitle eyebrow="Account" title="Profile" />
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/10 font-mono text-[15px] text-violet-300">
                  {(user?.display_name || user?.email || 'U').slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="text-[14px] text-white">{user?.display_name || 'Researcher'}</div>
                  <div className="text-[11px] text-dimx">{user?.email}</div>
                </div>
              </div>
              <div className="grid gap-2 border-t border-white/[0.06] pt-3 text-[10.5px]">
                <div className="flex justify-between"><span className="text-dimx">Email verification</span><Badge tone={user?.email_verified ? 'gain' : 'warn'}>{user?.email_verified ? 'verified' : 'not verified'}</Badge></div>
                <div className="flex justify-between"><span className="text-dimx">Account created</span><span className="text-mutedx">{user?.created_at ? fmtDateTime(user.created_at) : '—'}</span></div>
                <div className="flex justify-between"><span className="text-dimx">MFA</span><Badge tone="warn">not implemented</Badge></div>
              </div>
              <Callout tone="info">Display name changes are not implemented in this build. Email verification requires an email provider. These limitations are not hidden.</Callout>
            </div>
          </section>

          <section className="panel p-5">
            <SectionTitle eyebrow="Defaults" title="Research preferences" />
            <div className="space-y-3">
              <Field label="Base currency" hint="Display preference for portfolio summaries; no FX conversion is performed.">
                <Input value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())} maxLength={8} className="font-mono" />
              </Field>
              <Field label="Default market">
                <Select value={defaultMarket} onChange={(event) => setDefaultMarket(event.target.value)}>
                  <option value="US">United States</option>
                  <option value="IN">India (NSE)</option>
                </Select>
              </Field>
              <Field label="Default prediction horizon" hint="Sessions ahead (1–60). Used as a default in the prediction lab.">
                <Input type="number" min="1" max="60" value={defaultHorizon} onChange={(event) => setDefaultHorizon(event.target.value)} />
              </Field>
              <Field label="Theme">
                <Input value="Dark (fixed in this build)" disabled />
              </Field>
              <Button variant="primary" loading={savePreferences.isPending} onClick={() => savePreferences.mutate()}>Save preferences</Button>
            </div>
          </section>

          <section className="panel p-5 xl:col-span-2">
            <SectionTitle eyebrow="Notifications" title="Delivery channels" />
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['In-app', true, 'Alert events and notifications appear in the bell menu.'],
                ['Email', false, 'No email provider is configured; delivery is not implemented.'],
                ['Webhooks / WebSocket', false, 'Not implemented. Alerts are evaluated periodically.'],
              ].map(([label, enabled, note]) => (
                <div key={label as string} className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
                  <div className="flex items-center justify-between"><span className="text-[11px] text-white">{label as string}</span><Badge tone={enabled ? 'gain' : 'warn'}>{enabled ? 'available' : 'off'}</Badge></div>
                  <div className="mt-1.5 text-[9.5px] leading-relaxed text-dimx">{note as string}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <SectionTitle eyebrow="Credentials" title="Change password" />
              <div className="space-y-3">
                <Field label="Current password"><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></Field>
                <Field label="New password" hint="At least 10 characters with a letter and a number. Other sessions will be revoked."><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></Field>
                <Button variant="outline" loading={changePassword.isPending} disabled={!currentPassword || !newPassword} onClick={() => changePassword.mutate()} icon={<KeyRound className="h-3.5 w-3.5" />}>Update password</Button>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 text-[9.5px] leading-relaxed text-dimx">
                <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" /> Passwords are hashed with Argon2id. Sessions are opaque random tokens stored as SHA-256 hashes.
              </div>
            </section>

            <section className="panel p-5">
              <SectionTitle eyebrow="Sessions" title="Active sign-ins" action={<Button size="sm" variant="outline" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Revoke others</Button>} />
              {sessions.isLoading ? (
                <LoadingPanel rows={3} />
              ) : sessions.isError ? (
                <ErrorState message={sessions.error instanceof Error ? sessions.error.message : 'Sessions unavailable'} onRetry={() => void sessions.refetch()} />
              ) : !sessions.data?.sessions.length ? (
                <EmptyState title="No active sessions" description="Sign in again to create a session." />
              ) : (
                <div className="space-y-1.5">
                  {sessions.data.sessions.map((session) => (
                    <div key={session.id} className="rounded-lg border border-white/[0.06] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[10px] text-white">
                            {session.current && <Badge tone="gain">this session</Badge>}
                            <span className="font-mono text-[8.5px] text-dimx">{session.ip || 'unknown ip'}</span>
                          </div>
                          <div className="mt-1 truncate text-[9px] text-dimx">{session.user_agent || 'unknown user agent'}</div>
                          <div className="mt-0.5 font-mono text-[8px] text-dimx">created {fmtDateTime(session.created_at)} · expires {fmtDateTime(session.expires_at)}</div>
                        </div>
                        {!session.current && (
                          <button onClick={() => revokeSession.mutate(session.id)} className="rounded p-1 text-dimx hover:text-loss" aria-label="Revoke session"><Trash2 className="h-3 w-3" /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow mb-0.5">Audit trail</div>
                <div className="text-[13px] text-white">Recent sensitive actions</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => void audit.refetch()}><RefreshCw className="h-3 w-3" /> Refresh</button>
            </div>
            {audit.isLoading ? (
              <div className="p-4"><LoadingPanel rows={4} /></div>
            ) : !audit.data?.events.length ? (
              <EmptyState title="No audit events" description="Authentication, research, dataset and trading actions appear here." />
            ) : (
              <div className="max-h-[360px] overflow-auto">
                <table className="data-table">
                  <thead><tr><th>Action</th><th>Target</th><th>IP</th><th className="text-right">When</th></tr></thead>
                  <tbody>
                    {audit.data.events.map((event) => (
                      <tr key={event.id}>
                        <td className="font-mono text-[9.5px] text-white">{event.action}</td>
                        <td className="max-w-[260px] truncate font-mono text-[9px] text-dimx">{event.target || '—'}</td>
                        <td className="font-mono text-[9px] text-dimx">{event.ip || '—'}</td>
                        <td className="text-right font-mono text-[8.5px] text-dimx">{fmtDateTime(event.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-4">
          {integrations.isLoading ? (
            <LoadingPanel rows={5} />
          ) : integrations.isError ? (
            <ErrorState message={integrations.error instanceof Error ? integrations.error.message : 'Integrations unavailable'} onRetry={() => void integrations.refetch()} />
          ) : integrations.data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                { key: 'Market data', icon: Database, state: integrations.data.market_data, extra: integrations.data.market_data.provider },
                { key: 'Streaming market data', icon: Server, state: integrations.data.streaming },
                { key: 'News & events', icon: Link2, state: integrations.data.news },
                { key: 'Brokerage', icon: Link2, state: integrations.data.broker },
                { key: 'Email delivery', icon: KeyRound, state: integrations.data.email },
                { key: 'Multi-factor auth', icon: ShieldCheck, state: integrations.data.mfa },
              ].map((item) => (
                <div key={item.key} className="panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-violet-400"><item.icon className="h-3.5 w-3.5" /></span>
                    <Badge tone={item.state.configured ? 'gain' : 'warn'}>{item.state.configured ? 'configured' : 'setup required'}</Badge>
                  </div>
                  <div className="mt-3 text-[12px] text-white">{item.key}</div>
                  {item.extra && <div className="mt-0.5 font-mono text-[9px] text-cyanx/80">{item.extra}</div>}
                  <div className="mt-1.5 text-[9.5px] leading-relaxed text-dimx">{'requires' in item.state ? item.state.requires : 'Not implemented in this build.'}</div>
                  {'env' in item.state && Array.isArray(item.state.env) && item.state.env.length > 0 && (
                    <div className="mt-2 rounded border border-white/[0.05] bg-black/25 p-2 font-mono text-[8.5px] text-dimx">{item.state.env.join(' · ')}</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <SectionTitle eyebrow="Brokerage" title="Live connection state" action={<Badge tone="loss">disabled</Badge>} />
              {brokers.data?.connections.length ? (
                <div className="space-y-1.5">
                  {brokers.data.connections.map((connection) => (
                    <div key={connection.id} className="flex items-center justify-between rounded border border-white/[0.06] p-2 text-[10.5px]">
                      <span className="text-white">{connection.broker} {connection.account_ref}</span>
                      <StatusPill status={connection.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 text-[10.5px] leading-relaxed text-mutedx">{brokers.data?.reason ?? 'No broker adapter is configured.'}</div>
              )}
              <div className="mt-3 space-y-1.5">
                {(brokers.data?.requirements ?? []).map((requirement) => (
                  <div key={requirement} className="flex gap-2 text-[9.5px] leading-relaxed text-dimx"><span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warn/50" />{requirement}</div>
                ))}
              </div>
              <Callout tone="warn" title="No simulated connection">
                Creating a fake "connected" state is prohibited in this build. Live order submission returns an explicit disabled error; the paper ledger is separate.
              </Callout>
            </section>

            <section className="panel p-5">
              <SectionTitle eyebrow="Execution modes" title="What is actually available" />
              {trading.isLoading ? (
                <LoadingPanel rows={3} />
              ) : trading.data ? (
                <div className="space-y-2">
                  {trading.data.modes.map((mode) => (
                    <div key={mode.id} className={cn('rounded-lg border p-2.5', mode.available ? 'border-gain/15 bg-gain/[0.03]' : 'border-white/[0.06] bg-white/[0.015]')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] text-white">{mode.label}</span>
                        <Badge tone={mode.available ? 'gain' : 'loss'}>{mode.available ? 'available' : 'disabled'}</Badge>
                      </div>
                      <div className="mt-1 text-[9px] leading-relaxed text-dimx">{mode.reason}</div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-loss/20 bg-loss/[0.04] p-2.5 text-[9px] leading-relaxed text-loss/80">
                    Live trading: {trading.data.live_trading_enabled ? 'enabled' : 'hard-disabled'} · kill switch: {trading.data.kill_switch.exists ? 'present' : 'not applicable (no live path)'}
                  </div>
                </div>
              ) : (
                <div className="text-[10.5px] text-dimx">Trading state unavailable.</div>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel p-5">
            <SectionTitle eyebrow="Your data" title="Export & manage" />
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3">
                <div>
                  <div className="text-[11px] text-white">Account export</div>
                  <div className="mt-0.5 text-[9.5px] text-dimx">JSON of preferences, watchlists, strategies, experiments, backtests, predictions, paper ledger and audit events. Excludes password hashes and session tokens.</div>
                </div>
                <a href="/api/v1/settings/export" download className="btn btn-outline btn-sm"><Download className="h-3 w-3" /> Export</a>
              </div>
              <Link to="/app/data" className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3 transition hover:border-white/15">
                <div>
                  <div className="text-[11px] text-white">Uploaded datasets</div>
                  <div className="mt-0.5 text-[9.5px] text-dimx">Inspect, export or delete files stored under your account.</div>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-dimx" />
              </Link>
              <div className="rounded-lg border border-white/[0.06] p-3 text-[9.5px] leading-relaxed text-dimx">
                Model artifacts created by your experiments are stored server-side and deleted with the experiment account. Dataset files use generated identifiers and are never served by a path supplied by the user.
              </div>
            </div>
          </section>

          <section className="panel border-loss/20 p-5">
            <SectionTitle eyebrow="Destructive action" title="Delete account" action={<Badge tone="loss">irreversible</Badge>} />
            <p className="text-[10.5px] leading-relaxed text-mutedx">
              Deletes the account and owned rows: watchlists, alerts, portfolios, datasets, experiments, backtests, predictions, paper accounts and
              sessions. Uploaded dataset files and trusted model artifacts are removed. Audit entries are anonymized by foreign-key policy.
            </p>
            <Callout tone="warn" title="Backups">
              If the deployment keeps database backups, deletion propagation depends on the documented backup retention policy. Export anything you need first.
            </Callout>
            <button className="btn btn-danger mt-4" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" /> Delete account</button>
          </section>
        </div>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete account"
        description="Password confirmation and an explicit typed confirmation are required. This is not reversible through the app."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>Cancel</button>
            <Button
              variant="danger"
              loading={deleteAccount.isPending}
              disabled={!deletePassword || deleteConfirm !== 'DELETE'}
              onClick={() => deleteAccount.mutate()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Callout tone="loss" title="Export first">
            All owned research, datasets and paper records will be removed. Backups may retain copies for the deployment's retention period.
          </Callout>
          <Field label="Current password"><Input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" /></Field>
          <Field label="Type DELETE to confirm"><Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" className="font-mono" /></Field>
        </div>
      </Modal>
    </div>
  )
}
