export type Tone = 'neutral' | 'gain' | 'loss' | 'warn' | 'violet' | 'cyan'

export interface User {
  id: string
  email: string
  display_name: string
  email_verified: boolean
  created_at: string
}

export interface Preferences {
  base_currency: string
  default_market: string
  default_horizon: number
  theme: string
  chart_defaults: Record<string, unknown>
  notifications: Record<string, unknown>
}

export interface ProviderInfo {
  name: string
  configured: boolean
  data_status: string
  notes: string
}

export interface Quote {
  symbol: string
  price: number
  previous_close: number
  change_pct: number | null
  as_of?: string | null
  currency?: string
  data_status?: string
  provider?: string
  name?: string
  market?: string
}

export interface MarketStatus {
  status: string
  source: string
  exchange_time: string
  timezone: string
  note: string
}

export interface InstrumentSummary {
  symbol: string
  name: string
  exchange: string
  market: string
  currency: string
  sector: string
  type: string
}

export interface Bar {
  date: string
  open: number
  high: number
  low: number
  close: number
  adj_close: number
  volume: number
}

export interface IndicatorSeries {
  dates: string[]
  values: (number | null)[]
}

export interface InstrumentHistory {
  symbol: string
  instrument: { name: string; exchange: string; currency: string; sector: string; type: string }
  meta: {
    provider: string
    data_status: string
    fetched_at: string
    currency: string
    exchange: string
    warnings: string[]
    observation_end: string | null
  }
  market_status: MarketStatus
  bars: Bar[]
}

export interface IndicatorPayload {
  symbol: string
  meta: InstrumentHistory['meta']
  self: { dates: string[]; close: (number | null)[] }
  series: Record<string, IndicatorSeries>
  latest: Record<string, number | string | null>
}

export interface OverviewPayload {
  generated_at: string
  provider: ProviderInfo
  market_status: MarketStatus
  indices: Quote[]
  watchlist: { id: string | null; name: string | null; symbols: Quote[] }
  market_movers: Quote[]
  sectors: { sector: string; avg_return_1m_pct: number; count: number }[]
  portfolios: {
    id: string
    name: string
    market_value: number
    unrealized_pnl: number
    positions: number
    currency: string
    valuation: string
  }[]
  recent_experiments: {
    id: string
    symbol: string
    status: string
    target: string | null
    horizon: number | null
    created_at: string
  }[]
  recent_backtests: {
    id: string
    symbol: string
    strategy_id: string
    status: string
    total_return: number | null
    created_at: string
  }[]
  alerts: { active: number; unread_notifications: number }
  coverage: { instruments: number; cached_bars: number; sector_metrics: string }
  warnings: string[]
}

export interface ScreenerRow {
  symbol: string
  name: string
  exchange: string
  market: string
  currency: string
  sector: string
  industry: string
  price: number
  change_1d_pct: number | null
  return_1m_pct: number | null
  return_3m_pct: number | null
  return_6m_pct: number | null
  return_5d_pct: number | null
  volatility_20d_pct: number
  rsi_14: number | null
  sma_50_distance_pct: number | null
  above_sma_50: boolean
  atr_14_pct: number | null
  volume_ratio_20d: number | null
  avg_volume_20d: number | null
  as_of: string
  observations: number
}

export interface ScreenerPayload {
  rows: ScreenerRow[]
  sectors: { sector: string; avg_return_1m_pct: number; positive: number; count: number }[]
  meta: {
    market: string
    provider: string
    data_status: string
    as_of: string | null
    universe_size: number
    fetched_at: string | null
    failed_symbols: string[]
    generated_at: string
    note: string
  }
  pagination: { page: number; page_size: number; total: number; pages: number }
  warnings: string[]
}

export interface WatchlistItem {
  id?: number
  symbol: string
  note: string
  sort_order: number
  added_at?: string
  quote?: Quote
}

export interface Watchlist {
  id: string
  name: string
  is_default: boolean
  created_at: string
  items: WatchlistItem[]
}

export interface ExperimentSummary {
  id: string
  symbol: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  config: Record<string, unknown>
  created_at: string
  started_at: string | null
  finished_at: string | null
  error: string | null
  sweep_id: string | null
  selected_model: string | null
  validation: MetricRecord | null
  test: MetricRecord | null
  data: Record<string, unknown> | null
  warnings: string[]
}

export type MetricRecord = Record<string, number | string | null | undefined>

export interface ModelComparison {
  key: string
  name: string
  complexity?: string
  notes?: string
  validation: MetricRecord | null
  error: string | null
  seconds: number | null
}

export interface ExperimentMetrics {
  symbol: string
  target: string
  horizon: number
  feature_version: string
  feature_count: number
  models: ModelComparison[]
  baselines: Record<string, { validation: MetricRecord; test: MetricRecord; description: string }>
  selected: {
    key: string
    name: string
    validation: MetricRecord
    test: MetricRecord
    selection_metric: string
  }
  interval: { level: number; low: number | null; high: number | null; n: number; method?: string } | null
  interval_coverage: { level: number; coverage: number; mean_width: number; n: number } | null
  walk_forward: {
    folds: number
    step_sessions: number
    purge_sessions: number
    predictions: number
    metrics: MetricRecord
    scope: string
    used_for_selection: boolean
    warning: string
  } | null
  series: {
    dates: string[]
    actual: number[]
    predicted: number[]
    probability: number[] | null
    residual: number[] | null
  }
  feature_importance: { feature: string; importance: number; definition: string }[]
  warnings: string[]
  data: {
    provider: string
    data_status: string
    fetched_at: string
    currency: string
    observations: number
    data_start: string
    data_end: string
    price_last: number
  }
  split: {
    train: { start: string; end: string; n: number }
    validation: { start: string; end: string; n: number }
    test: { start: string; end: string; n: number }
    purge_sessions: number
  }
  generated_at: string
}

export interface ExperimentDetail extends ExperimentSummary {
  metrics: ExperimentMetrics
  model_version: {
    id: string
    name: string
    version: number
    features: string[]
    feature_version: string
    approved: boolean
    approved_at: string | null
    test_metrics: MetricRecord
    validation_metrics: MetricRecord
  } | null
  artifact_available: boolean
  data_window: Record<string, string | null>
}

export interface Prediction {
  id: string
  symbol: string
  horizon: number
  target: string
  point: number
  low: number | null
  high: number | null
  probability: number | null
  as_of: string
  data_timestamp: string | null
  model_version_id: string
  model_name: string
  approved: boolean
  interval: { level: number; low: number | null; high: number | null; n: number; method?: string } | null
  scenario: {
    last_close: number
    expected_price: number
    low_price: number | null
    high_price: number | null
    assumption: string
  } | null
  test_metrics: MetricRecord
  val_metrics: MetricRecord
  warnings: string[]
  data: { provider: string; data_status: string; currency: string; last_close: number }
}

export interface StrategyRule {
  indicator: string
  op: string
  value: number | null
  params: Record<string, number>
}

export interface StrategyRules {
  entry: StrategyRule[]
  exit: StrategyRule[]
  entry_logic: 'all' | 'any'
  exit_logic: 'all' | 'any'
  stop_loss_pct?: number | null
  take_profit_pct?: number | null
  max_holding_days?: number | null
  position_size_pct?: number
}

export interface Strategy {
  id: string
  name: string
  description: string
  rules: StrategyRules
  version: number
  is_template: boolean
  created_at: string
  updated_at: string
}

export interface BacktestSummary {
  id: string
  symbol: string
  benchmark: string
  strategy_id: string
  strategy_name: string
  status: string
  error: string | null
  metrics: Record<string, unknown>
  created_at: string
  finished_at: string | null
}

export interface BacktestDetail {
  id: string
  symbol: string
  benchmark: string
  status: string
  error: string | null
  config: Record<string, unknown>
  metrics: Record<string, number | string | boolean | null | Record<string, unknown>>
  equity: {
    dates: string[]
    strategy: number[]
    benchmark: number[] | null
    drawdown: number[]
    monthly_returns?: { month: string; return_pct: number }[]
    assumptions?: Record<string, unknown>
    data?: Record<string, unknown>
    warnings?: string[]
  }
  strategy: Strategy | null
  data_start: string | null
  data_end: string | null
  created_at: string
  finished_at: string | null
  disclaimer: string
}

export interface Trade {
  id?: number
  entry_date: string
  exit_date: string | null
  side: string
  quantity: number
  entry_price: number
  exit_price: number | null
  fees: number
  pnl: number | null
  return_pct: number | null
  exit_reason: string
}

export interface PortfolioSummary {
  id: string
  name: string
  base_currency: string
  positions: number
  created_at?: string
}

export interface PositionRow {
  id: number
  symbol: string
  quantity: number
  avg_cost: number
  price: number
  market_value: number
  cost_basis: number
  unrealized_pnl: number
  unrealized_pct: number | null
  change_1d_pct: number | null
  currency: string
  as_of: string
  data_status: string
  weight_pct: number | null
}

export interface RiskBlock {
  available: boolean
  reason?: string
  annualized_volatility?: number
  max_drawdown?: number
  cumulative_return?: number
  observations?: number
  risk_contribution?: { symbol: string; weight: number; variance_contribution_pct: number }[]
  correlation?: { symbols: string[]; matrix: number[][] }
  benchmark?: { cumulative_return: number; benchmark_return: number; excess_return: number; beta: number | null }
}

export interface PortfolioDetail {
  portfolio: { id: string; name: string; base_currency: string }
  positions: PositionRow[]
  summary: {
    positions: number
    market_value: number
    cost_basis: number
    unrealized_pnl: number
    unrealized_pct: number | null
    concentration_hhi: number
    top_weight_pct: number
    currencies: string[]
    valuation_source: string
  }
  allocation: { symbol: string; weight_pct: number | null; market_value: number }[]
  risk: RiskBlock
  warnings: string[]
  generated_at: string
}

export interface NotificationRow {
  id: string
  title: string
  body: string
  kind: string
  link: string
  read: boolean
  created_at: string
}

export interface DatasetRecord {
  id: string
  name: string
  original_filename: string
  rows: number
  columns: string[]
  schema: Record<string, unknown>
  validation: Record<string, unknown>
  status: string
  version: number
  created_at: string
}
