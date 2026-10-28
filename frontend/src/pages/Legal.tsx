import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Brand, MonoTag } from '../components/Brand'
import { Badge } from '../components/ui'
import { useDocumentTitle } from '../lib/hooks'

type Kind = 'privacy' | 'terms' | 'data-sources'

const CONTENT: Record<Kind, { title: string; subtitle: string; sections: { heading: string; body: string[] }[] }> = {
  privacy: {
    title: 'Privacy notice',
    subtitle: 'What this research build stores, why, and how to remove it.',
    sections: [
      {
        heading: 'Data stored with your account',
        body: [
          'Email address, display name, Argon2id password hash, account creation time and email-verification state.',
          'Research records you create: preferences, watchlists, alerts, portfolios and manual positions, paper-trading accounts/orders/fills, strategies, experiments, model versions, predictions, backtests and research notes.',
          'Uploaded CSV datasets and their validation metadata. Files are stored under generated identifiers, not user-supplied paths.',
          'Operational security records: hashed session tokens, session timestamps, approximate request IP and user agent, plus an audit trail of sensitive actions.',
        ],
      },
      {
        heading: 'Why it is stored',
        body: [
          'To provide the research workspace, associate records with their owner, enforce authorization, detect abuse, and support account security and auditability.',
          'Market-data request content is sent server-side to the configured provider (Yahoo Finance in the default deployment) to retrieve prices. Account records are not intentionally sent to that provider.',
          'No advertising, analytics or third-party tracking scripts are included in this build.',
        ],
      },
      {
        heading: 'Cookies and sessions',
        body: [
          'One essential cookie, sp_session, holds an opaque session token. It is HttpOnly, SameSite=Lax, path-scoped, and Secure when COOKIE_SECURE is enabled. The server stores only a SHA-256 hash of the token.',
          'Sessions expire after the configured period (seven days by default) and can be revoked individually or all at once from Settings. Password changes and resets revoke other sessions.',
        ],
      },
      {
        heading: 'Retention and deletion',
        body: [
          'Most records persist until you delete them or delete the account. Dataset files and model artifacts are removed on account deletion.',
          'Audit records reference the account by a nullable foreign key and are anonymized when the account is deleted. Database backups, if configured by the operator, may retain deleted data for the documented backup-retention window; deletion propagation depends on the deployment.',
          'You can export a JSON copy of owned records from Settings and delete the account there. Export first: deletion is not reversible through the app.',
        ],
      },
      {
        heading: 'Security and limitations',
        body: [
          'Transport encryption depends on deployment configuration. Use HTTPS in production and set COOKIE_SECURE=true. Rate limiting is in-process in this build, so multi-replica deployments must supply a shared limiter.',
          'No system can guarantee absolute security. Report suspected compromise to the operator of this deployment and revoke sessions immediately.',
          'This notice is a transparent starting point, not legal advice or a certification of compliance with any jurisdiction. The deployment operator must review it against applicable law.',
        ],
      },
    ],
  },
  terms: {
    title: 'Research terms',
    subtitle: 'The product is software for research and simulation, not a brokerage or adviser.',
    sections: [
      {
        heading: 'No investment advice or brokerage service',
        body: [
          'StockPulse AI provides quantitative research tools, historical simulations, model evaluation and a simulated paper-trading ledger. It does not provide personalised investment advice, execute real trades, hold client assets, or act as a broker-dealer.',
          'No output is a recommendation to buy or sell a security. Forecasts, scores, signals and backtests are research artifacts with uncertainty and failure modes.',
        ],
      },
      {
        heading: 'Data and outputs are not guaranteed',
        body: [
          'Market data may be delayed, incomplete, adjusted differently than expected, rate-limited, or unavailable. Provider terms apply. Data status is displayed in the interface.',
          'Machine-learning estimates and backtests can be wrong, overfit, or unstable. Past simulated performance does not indicate future results. The system is designed to report failures and weak evidence, but it cannot eliminate them.',
          'The service is provided without warranties to the extent permitted by law. Availability and accuracy are not guaranteed.',
        ],
      },
      {
        heading: 'Paper trading and live execution',
        body: [
          'Paper orders are simulated against delayed data with configured costs. They are never sent to an exchange or broker. No real money moves.',
          'Live brokerage execution is not implemented in this build. Any future live capability requires a separate official adapter, authorization, risk controls, reconciliation, explicit activation and applicable regulatory review.',
        ],
      },
      {
        heading: 'Your responsibilities',
        body: [
          'Keep your credentials secure and use the account only as permitted by applicable law and provider terms. Do not attempt to access another user’s records, bypass rate limits, upload malicious content, or redistribute restricted market data.',
          'Uploaded data must be lawfully obtained. You are responsible for the accuracy and licensing of user-supplied datasets. Uploaded files are treated as untrusted input and are never executed.',
          'Do not rely on this software as the sole basis for a financial decision. Consult a qualified professional where appropriate.',
        ],
      },
      {
        heading: 'Changes and liability',
        body: [
          'Features, providers and limitations may change. Material changes should be documented by the deployment operator. Accounts may be suspended to protect the service or other users.',
          'To the maximum extent permitted by applicable law, the operator is not liable for trading losses, data loss, or indirect damages arising from use of the software. This text is not legal advice; the operator must obtain jurisdiction-specific review.',
        ],
      },
    ],
  },
  'data-sources': {
    title: 'Data sources & limitations',
    subtitle: 'What the numbers come from, and where the evidence stops.',
    sections: [
      {
        heading: 'Default market-data provider',
        body: [
          'The default adapter is Yahoo Finance accessed through the open-source yfinance library. It supplies delayed or end-of-day historical OHLCV and delayed quotes. It is not an exchange real-time feed and not a licensed redistribution source.',
          'Daily bars are adjusted by the provider for splits and dividends where available. Corporate-action handling, survivor coverage and point-in-time index membership are not guaranteed. The research engine therefore cannot claim survivorship-free historical results.',
          'Rate limits, outages and symbol changes can cause missing data or failed requests. The interface surfaces failure states and does not silently substitute fabricated prices. Cached data, when used, carries its age and a warning.',
          'Yahoo’s terms and any applicable exchange licensing govern use. This project makes no claim of market-data redistribution rights. A production deployment must select a provider appropriate to its jurisdiction and use case.',
        ],
      },
      {
        heading: 'Simulated provider',
        body: [
          'Setting MARKET_DATA_PROVIDER=sample activates deterministic synthetic daily prices for offline demos and tests. Every response is labelled simulated in the API and the interface.',
          'Simulated results are never evidence about real markets. The application displays a banner while this provider is active.',
        ],
      },
      {
        heading: 'User-uploaded data',
        body: [
          'Uploaded CSV files are validated and described but are not treated as a live feed or verified market history. Adjusted close is set equal to close; corporate actions are not inferred. Symbols and timestamps are user-supplied.',
          'Uploads are limited by size and row count, parsed as text only, and stored under generated filenames. No macros, scripts or formulas are executed.',
        ],
      },
      {
        heading: 'Unconfigured integrations',
        body: [
          'No news provider, fundamentals provider, streaming market-data feed, email provider, MFA provider or brokerage adapter is enabled in this build. Their absence is shown as a setup state rather than filled with invented data.',
          'Optionally installed model libraries (for example XGBoost) appear only when genuinely available; the core evaluations use scikit-learn.',
        ],
      },
      {
        heading: 'Method boundaries',
        body: [
          'Features are causal and versioned. Chronological splits use purge gaps for overlapping labels. The final test block is scored once after selection on validation. Baselines include a zero-return persistence forecast and historical mean.',
          'A single chronological test window is weak evidence. Multiple testing, regime shifts, transaction costs, execution timing and model drift can invalidate apparent improvements. Backtests are simulations with explicit assumptions, not live results.',
        ],
      },
    ],
  },
}

export default function Legal() {
  const { kind } = useParams()
  const content = CONTENT[kind as Kind]
  useDocumentTitle(content ? content.title : 'Not found')

  if (!content) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-950 px-6 text-center">
        <Brand />
        <h1 className="display text-2xl text-white">Document not found</h1>
        <Link to="/" className="btn btn-outline">Back home</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-5">
          <Brand />
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> Home</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-12">
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <Badge tone="warn">not legal advice</Badge>
          <MonoTag>effective 2026 · research build</MonoTag>
        </div>
        <h1 className="display text-[clamp(2rem,5vw,3.2rem)] font-semibold tracking-[-0.035em] text-white">{content.title}</h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-mutedx">{content.subtitle}</p>
        <div className="mt-10 space-y-8">
          {content.sections.map((section, index) => (
            <section key={section.heading} className="grid gap-3 border-t border-white/[0.07] pt-6 md:grid-cols-[220px_1fr]">
              <div>
                <div className="font-mono text-[9px] text-violet-400/70">0{index + 1}</div>
                <h2 className="display mt-1 text-[15px] text-white">{section.heading}</h2>
              </div>
              <div className="space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-[12px] leading-[1.75] text-mutedx">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-12 rounded-xl border border-warn/20 bg-warn/[0.04] p-4 text-[11px] leading-relaxed text-warn/80">
          This document describes the software as implemented. It is not a certification of regulatory compliance, and it is not a substitute for
          professional legal, privacy or financial review. The operator of this deployment is responsible for its jurisdiction-specific obligations.
        </div>
        <div className="mt-8 flex flex-wrap gap-3 text-[11px]">
          <Link to="/legal/privacy" className="link">Privacy</Link>
          <Link to="/legal/terms" className="link">Terms</Link>
          <Link to="/legal/data-sources" className="link">Data sources</Link>
        </div>
      </main>
    </div>
  )
}
