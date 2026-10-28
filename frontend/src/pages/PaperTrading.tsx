import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, EmptyState, ErrorState, Field, Input, LoadingPanel, Metric, Modal, PageHeader, SectionTitle, Select, StatusPill, WarningList } from '../components/ui'
import { api, errorMessage, post } from '../lib/api'
import { cn, fmtDateTime, fmtMoney, fmtNumber, fmtPct, pctClass } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { useToasts } from '../store/ui'
import type { Quote } from '../lib/types'

interface PaperAccount {
  id: string
  name: string
  currency: string
  starting_cash: number
  cash: number
  mode: string
  created_at: string
}

interface PaperOrder {
  id: string
  account_id: string
  symbol: string
  side: string
  quantity: number
  order_type: string
  limit_price: number | null
  status: string
  filled_quantity: number
  avg_fill_price: number | null
  fees: number
  reference_price: number | null
  rejection_reason: string | null
  created_at: string
  mode: string
}

interface PaperDetail {
  account: { id: string; name: string; currency: string; starting_cash: number; cash: number; mode: string }
  summary: { cash: number; market_value: number; equity: number; unrealized_pnl: number; realized_pnl: number; total_return_pct: number; positions: number }
  positions: { symbol: string; quantity: number; avg_cost: number; price: number; market_value: number; unrealized_pnl: number; realized_pnl: number; as_of: string | null; data_status: string }[]
  orders: PaperOrder[]
  fills: { id: string; order_id: string; quantity: number; price: number; fees: number; filled_at: string }[]
  warnings: string[]
  costs: { commission_bps: number; slippage_bps: number }
}

export default function PaperTrading() {
  useDocumentTitle('Paper trading')
  const queryClient = useQueryClient()
  const toast = useToasts((state) => state.push)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [accountName, setAccountName] = useState('Research paper account')
  const [startingCash, setStartingCash] = useState('100000')
  const [symbol, setSymbol] = useState('AAPL')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [quantity, setQuantity] = useState('10')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [limitPrice, setLimitPrice] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const accounts = useQuery<{ accounts: PaperAccount[]; note: string }>({
    queryKey: ['paper-accounts'],
    queryFn: () => api('/api/v1/paper-trading/accounts'),
  })

  useEffect(() => {
    if (!selectedId && accounts.data?.accounts.length) setSelectedId(accounts.data.accounts[0].id)
  }, [accounts.data, selectedId])

  const detail = useQuery<PaperDetail>({
    queryKey: ['paper-account', selectedId],
    queryFn: () => api(`/api/v1/paper-trading/accounts/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: 20_000,
  })

  const quote = useQuery<{ quotes: Quote[] }>({
    queryKey: ['paper-quote', symbol],
    queryFn: () => api(`/api/v1/markets/quotes?symbols=${encodeURIComponent(symbol)}`),
    enabled: symbol.trim().length > 0 && reviewOpen,
    staleTime: 30_000,
  })

  const referenceQuote = quote.data?.quotes[0]
  const estimate = useMemo(() => {
    const price = referenceQuote?.price
    const qty = Number(quantity)
    const notional = price && qty > 0 ? price * qty : 0
    const commission = detail.data ? notional * (detail.data.costs.commission_bps / 10_000) : 0
    const slippage = detail.data ? notional * (detail.data.costs.slippage_bps / 10_000) : 0
    return {
      notional,
      commission,
      slippage,
      total: side === 'buy' ? notional + commission + slippage : notional - commission - slippage,
      price,
    }
  }, [referenceQuote, quantity, detail.data, side])

  const createAccount = useMutation({
    mutationFn: () => post<{ account: PaperAccount }>('/api/v1/paper-trading/accounts', { name: accountName, starting_cash: Number(startingCash) }),
    onSuccess: (data) => {
      toast('Paper account created', 'success')
      setCreateOpen(false)
      setSelectedId(data.account.id)
      void queryClient.invalidateQueries({ queryKey: ['paper-accounts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const submitOrder = useMutation({
    mutationFn: () =>
      post<{ order: PaperOrder; accepted: boolean; duplicate?: boolean; message?: string }>('/api/v1/paper-trading/orders', {
        account_id: selectedId,
        symbol: symbol.toUpperCase(),
        side,
        quantity: Number(quantity),
        order_type: orderType,
        limit_price: orderType === 'limit' ? Number(limitPrice) : null,
        idempotency_key: idempotencyKey,
      }),
    onSuccess: (data) => {
      if (!data.accepted) {
        toast('Paper order rejected', 'warning', data.order.rejection_reason ?? 'Order rejected')
      } else if (data.duplicate) {
        toast('Duplicate submission prevented', 'info', 'The existing simulated order was returned.')
      } else if (data.order.status === 'OPEN') {
        toast('Limit order rests in the paper book', 'info', data.message)
      } else {
        toast('Simulated order filled', 'success', `${data.order.side} ${data.order.quantity} ${data.order.symbol} @ ${data.order.avg_fill_price ?? '—'}`)
      }
      setReviewOpen(false)
      setIdempotencyKey('')
      void queryClient.invalidateQueries({ queryKey: ['paper-account', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['paper-accounts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const cancelOrder = useMutation({
    mutationFn: (order: PaperOrder) => post(`/api/v1/paper-trading/accounts/${selectedId}/orders/${order.id}/cancel`),
    onSuccess: () => {
      toast('Paper order cancelled', 'success')
      void queryClient.invalidateQueries({ queryKey: ['paper-account', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['paper-accounts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const processOrders = useMutation({
    mutationFn: () => post<{ evaluated: number }>(`/api/v1/paper-trading/accounts/${selectedId}/process-orders`),
    onSuccess: (data) => {
      toast(`${data.evaluated} open order(s) evaluated`, 'info', 'Resting limits are checked against the latest delayed quote.')
      void queryClient.invalidateQueries({ queryKey: ['paper-account', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['paper-accounts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const resetAccount = useMutation({
    mutationFn: () => post(`/api/v1/paper-trading/accounts/${selectedId}/reset`),
    onSuccess: () => {
      toast('Paper account reset', 'success', 'Orders, fills and positions were cleared; cash was restored.')
      void queryClient.invalidateQueries({ queryKey: ['paper-account', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['paper-accounts'] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
  })

  const startReview = () => {
    if (!selectedId || !symbol.trim() || Number(quantity) <= 0) return
    if (orderType === 'limit' && Number(limitPrice) <= 0) {
      toast('Enter a positive limit price', 'warning')
      return
    }
    setIdempotencyKey(crypto.randomUUID())
    setReviewOpen(true)
  }

  const position = detail.data?.positions.find((item) => item.symbol === symbol.toUpperCase())

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Simulated execution"
        title="Paper trading"
        description="A local ledger with Decimal accounting, explicit costs and idempotent order submission. No order is sent to a broker or exchange."
        actions={
          <>
            <Badge tone="warn">PAPER ONLY</Badge>
            <button className="btn btn-outline btn-sm" onClick={() => void detail.refetch()} disabled={detail.isFetching}><RefreshCw className={cn('h-3.5 w-3.5', detail.isFetching && 'animate-spin')} /> Refresh</button>
            <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New paper account</button>
          </>
        }
      />

      <Callout tone="warn" title="Simulation boundary">
        Fills use delayed provider prices, configured slippage and commission. Limit orders do not reserve cash. This ledger is not a brokerage
        account, and no live order endpoint is enabled in this build.
      </Callout>

      {accounts.isLoading ? (
        <LoadingPanel rows={6} />
      ) : accounts.isError ? (
        <ErrorState message={accounts.error instanceof Error ? accounts.error.message : 'Paper accounts unavailable'} onRetry={() => void accounts.refetch()} />
      ) : !accounts.data?.accounts.length ? (
        <div className="panel">
          <EmptyState
            title="No paper account"
            description="Create a simulated account to practise order entry and inspect accounting. Starting cash is fictional."
            icon={<Wallet className="h-5 w-5" />}
            action={<Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>Create paper account</Button>}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] pb-3">
            {accounts.data.accounts.map((account) => (
              <button
                key={account.id}
                onClick={() => setSelectedId(account.id)}
                className={cn('rounded-lg border px-3 py-1.5 text-left text-[10.5px] transition', selectedId === account.id ? 'border-warn/30 bg-warn/[0.06] text-white' : 'border-white/[0.06] text-mutedx hover:border-white/15')}
              >
                <div className="flex items-center gap-2">{account.name} <span className="chip chip-warn">PAPER</span></div>
                <div className="font-mono text-[8px] text-dimx">{fmtMoney(account.cash, account.currency)} cash · start {fmtMoney(account.starting_cash, account.currency, { compact: true })}</div>
              </button>
            ))}
          </div>

          {detail.isLoading ? (
            <LoadingPanel rows={8} />
          ) : detail.isError ? (
            <ErrorState message={detail.error instanceof Error ? detail.error.message : 'Paper account unavailable'} onRetry={() => void detail.refetch()} />
          ) : detail.data ? (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                <MetricCard label="Simulated equity" value={fmtMoney(detail.data.summary.equity)} sub="cash + marked positions" />
                <MetricCard label="Cash" value={fmtMoney(detail.data.summary.cash)} sub="available simulated cash" />
                <MetricCard label="Market value" value={fmtMoney(detail.data.summary.market_value)} sub={`${detail.data.summary.positions} position${detail.data.summary.positions === 1 ? '' : 's'}`} />
                <MetricCard label="Unrealized P/L" value={fmtMoney(detail.data.summary.unrealized_pnl)} sub="delayed marks" tone={detail.data.summary.unrealized_pnl >= 0 ? 'gain' : 'loss'} />
                <MetricCard label="Total return" value={fmtPct(detail.data.summary.total_return_pct)} sub={`realized ${fmtMoney(detail.data.summary.realized_pnl)}`} tone={detail.data.summary.total_return_pct >= 0 ? 'gain' : 'loss'} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_1.45fr]">
                <section className="panel p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle eyebrow="Order ticket" title="Simulated order" />
                    <Badge tone="warn">PAPER</Badge>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Symbol"><Input value={symbol} onChange={(event) => { setSymbol(event.target.value.toUpperCase()); setIdempotencyKey('') }} className="font-mono" /></Field>
                      <Field label="Side">
                        <Select value={side} onChange={(event) => { setSide(event.target.value as 'buy' | 'sell'); setIdempotencyKey('') }}>
                          <option value="buy">Buy</option>
                          <option value="sell">Sell</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Quantity"><Input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => { setQuantity(event.target.value); setIdempotencyKey('') }} /></Field>
                      <Field label="Order type">
                        <Select value={orderType} onChange={(event) => { setOrderType(event.target.value as 'market' | 'limit'); setIdempotencyKey('') }}>
                          <option value="market">Market</option>
                          <option value="limit">Limit</option>
                        </Select>
                      </Field>
                    </div>
                    {orderType === 'limit' && (
                      <Field label="Limit price" hint="Rests until the delayed quote crosses the limit."><Input type="number" min="0.01" step="0.01" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value); setIdempotencyKey('') }} /></Field>
                    )}
                    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                      <div className="flex items-center justify-between text-[10px]"><span className="text-dimx">Position</span><span className="font-mono text-white">{position ? `${fmtNumber(position.quantity, 2)} @ ${fmtNumber(position.avg_cost, 2)}` : 'none'}</span></div>
                      <div className="mt-1 flex items-center justify-between text-[10px]"><span className="text-dimx">Commission</span><span className="font-mono text-mutedx">{detail.data.costs.commission_bps} bps</span></div>
                      <div className="mt-1 flex items-center justify-between text-[10px]"><span className="text-dimx">Slippage</span><span className="font-mono text-mutedx">{detail.data.costs.slippage_bps} bps</span></div>
                    </div>
                    <Button className="w-full" variant="primary" disabled={!selectedId || !symbol.trim() || Number(quantity) <= 0} onClick={startReview}>
                      Review {side} order <ArrowUpRight className="h-3.5 w-3.5" />
                    </Button>
                    <p className="text-center font-mono text-[8.5px] text-dimx">SIMULATED · NO BROKER CONNECTION · NO REAL MONEY</p>
                  </div>
                </section>

                <section className="panel overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
                    <div>
                      <div className="eyebrow mb-0.5">Positions</div>
                      <div className="text-[13px] text-white">Paper holdings</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" loading={processOrders.isPending} onClick={() => processOrders.mutate()} icon={<Play className="h-3 w-3" />}>Process limits</Button>
                      <button className="btn btn-ghost btn-sm text-dimx hover:text-warn" onClick={() => { if (window.confirm('Reset the paper account? All simulated orders, fills and positions will be deleted.')) resetAccount.mutate() }} aria-label="Reset paper account"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  {!detail.data.positions.length ? (
                    <EmptyState title="No paper positions" description="Submit a simulated market order to populate the ledger." icon={<CircleDollarSign className="h-5 w-5" />} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead><tr><th>Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Mark</th><th className="text-right">Value</th><th className="text-right">Unrealized</th></tr></thead>
                        <tbody>
                          {detail.data.positions.map((position) => (
                            <tr key={position.symbol}>
                              <td><Link to={`/app/research/${position.symbol}`} className="font-mono text-[11px] text-white hover:text-violet-300">{position.symbol}</Link><div className="font-mono text-[8px] text-dimx">{position.as_of ?? position.data_status}</div></td>
                              <td className="num text-right text-mutedx">{fmtNumber(position.quantity, 4)}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(position.avg_cost, 2)}</td>
                              <td className="num text-right text-white">{fmtNumber(position.price, 2)}</td>
                              <td className="num text-right text-white">{fmtMoney(position.market_value)}</td>
                              <td className={cn('num text-right', pctClass(position.unrealized_pnl))}>{fmtMoney(position.unrealized_pnl)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="border-t border-white/[0.05] px-4 py-2 text-[9px] text-dimx">Positions are marked at delayed/end-of-day prices; values can differ from a real broker statement.</div>
                </section>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
                <section className="panel overflow-hidden">
                  <div className="border-b border-white/[0.06] px-4 py-3">
                    <div className="eyebrow mb-0.5">Order log</div>
                    <div className="text-[13px] text-white">Simulated lifecycle</div>
                  </div>
                  {!detail.data.orders.length ? (
                    <EmptyState title="No orders" description="Every simulated order, fill, rejection and cancellation appears here." />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table min-w-[760px]">
                        <thead><tr><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th>Type</th><th className="text-right">Fill</th><th className="text-right">Fees</th><th>Status</th><th className="text-right">Created</th><th /></tr></thead>
                        <tbody>
                          {detail.data.orders.map((order) => (
                            <tr key={order.id}>
                              <td className="font-mono text-[10.5px] text-white">{order.symbol}</td>
                              <td className={cn('text-[10px] uppercase', order.side === 'buy' ? 'text-gain' : 'text-loss')}>{order.side}</td>
                              <td className="num text-right text-mutedx">{fmtNumber(order.quantity, 4)}</td>
                              <td className="text-[10px] text-mutedx">{order.order_type}{order.limit_price ? ` @ ${fmtNumber(order.limit_price, 2)}` : ''}</td>
                              <td className="num text-right text-white">{order.avg_fill_price !== null ? fmtNumber(order.avg_fill_price, 2) : '—'}</td>
                              <td className="num text-right text-dimx">{fmtNumber(order.fees, 4)}</td>
                              <td>
                                <StatusPill status={order.status} />
                                {order.rejection_reason && <div className="mt-1 max-w-[160px] text-[8.5px] text-loss">{order.rejection_reason}</div>}
                              </td>
                              <td className="text-right font-mono text-[8.5px] text-dimx">{fmtDateTime(order.created_at)}</td>
                              <td className="text-right">
                                {order.status === 'OPEN' && (
                                  <button onClick={() => cancelOrder.mutate(order)} className="btn btn-ghost btn-sm text-dimx hover:text-loss">Cancel</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <div className="space-y-4">
                  <section className="panel p-4">
                    <SectionTitle eyebrow="Executions" title="Simulated fills" />
                    {detail.data.fills.length ? (
                      <div className="space-y-1.5">
                        {detail.data.fills.slice(0, 10).map((fill) => (
                          <div key={fill.id} className="flex items-center justify-between border-b border-white/[0.04] pb-1.5 text-[10px] last:border-0">
                            <span className="num text-mutedx">{fmtNumber(fill.quantity, 2)} @ {fmtNumber(fill.price, 2)}</span>
                            <span className="font-mono text-[8.5px] text-dimx">{fmtDateTime(fill.filled_at)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-[10.5px] text-dimx">No fills yet.</div>
                    )}
                  </section>

                  <section className="panel p-4">
                    <SectionTitle eyebrow="Accounting" title="How this ledger works" />
                    <ul className="space-y-2 text-[10px] leading-relaxed text-dimx">
                      <li>· Cash and quantities use Decimal arithmetic with 4/6-decimal quantization.</li>
                      <li>· Commission and slippage are charged on both sides.</li>
                      <li>· Average cost includes buy-side fees; realized P/L is net of exit fees.</li>
                      <li>· Short selling, leverage and fractional-share assumptions beyond the entered quantity are not supported.</li>
                      <li>· Idempotency keys prevent duplicate submissions from retries.</li>
                    </ul>
                  </section>
                </div>
              </div>

              <WarningList warnings={detail.data.warnings} title="Paper ledger warnings" />
            </>
          ) : null}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create paper account"
        description="Starting cash is fictional. No brokerage account is created or linked."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            <Button variant="primary" loading={createAccount.isPending} disabled={!accountName.trim() || Number(startingCash) < 1000} onClick={() => createAccount.mutate()}>Create account</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Account name"><Input value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={80} /></Field>
          <Field label="Starting cash (USD)" hint="1,000 – 10,000,000"><Input type="number" min="1000" max="10000000" value={startingCash} onChange={(event) => setStartingCash(event.target.value)} /></Field>
        </div>
      </Modal>

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Confirm simulated order"
        description="Review the order, costs and cash impact. This is a paper order."
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setReviewOpen(false)}>Back</button>
            <Button variant="primary" loading={submitOrder.isPending} disabled={!referenceQuote} onClick={() => submitOrder.mutate()} icon={side === 'buy' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}>
              Submit paper {side}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-warn/25 bg-warn/[0.05] p-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-warn">PAPER TRADING · NOT A REAL ORDER</div>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            {[
              ['Instrument', `${symbol.toUpperCase()} · ${referenceQuote?.currency ?? 'USD'}`],
              ['Side', side.toUpperCase()],
              ['Quantity', fmtNumber(Number(quantity), 4)],
              ['Order type', orderType === 'market' ? 'Market' : `Limit @ ${fmtNumber(Number(limitPrice), 2)}`],
              ['Reference price', referenceQuote ? fmtNumber(referenceQuote.price, 2) : 'loading…'],
              ['Reference status', referenceQuote?.data_status ?? 'loading…'],
              ['Estimated notional', fmtMoney(estimate.notional)],
              ['Commission + slippage', fmtMoney(estimate.commission + estimate.slippage)],
              [side === 'buy' ? 'Estimated debit' : 'Estimated proceeds', fmtMoney(estimate.total)],
              ['Available paper cash', detail.data ? fmtMoney(detail.data.summary.cash) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col border-b border-white/[0.05] pb-1.5">
                <span className="text-[9px] text-dimx">{label}</span>
                <span className="num text-white">{value}</span>
              </div>
            ))}
          </div>
          {side === 'sell' && (
            <div className="text-[10px] text-dimx">Available position: {position ? fmtNumber(position.quantity, 4) : '0'} {symbol.toUpperCase()}. Short selling is rejected.</div>
          )}
          <Callout tone="info">The reference quote is delayed. A simulated fill is not an achievable live fill, and limit prices may never trade.</Callout>
        </div>
      </Modal>
    </div>
  )
}

function MetricCard({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'gain' | 'loss' }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={cn('num text-[19px] leading-none', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-white')}>{value}</div>
      <div className="mt-1.5 font-mono text-[8.5px] text-dimx">{sub}</div>
    </div>
  )
}
