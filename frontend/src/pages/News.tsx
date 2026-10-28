import { useQuery } from '@tanstack/react-query'
import { BellOff, BookOpen, Globe2, KeyRound, Newspaper, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Callout, ErrorState, LoadingPanel, PageHeader, SectionTitle } from '../components/ui'
import { api } from '../lib/api'
import { useDocumentTitle } from '../lib/hooks'

interface Integrations {
  news: { configured: boolean; status: string; requires: string; env: string[] }
  streaming: { configured: boolean; status: string; requires: string }
  broker: { configured: boolean; status: string; requires: string; env: string[] }
  email: { configured: boolean; status: string; requires: string }
}

export default function News() {
  useDocumentTitle('News & events')
  const integrations = useQuery<Integrations>({
    queryKey: ['integrations'],
    queryFn: () => api('/api/v1/settings/integrations'),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Market news & event intelligence"
        title="News & events"
        description="A legitimate news feed requires an authorized provider, licensing and an implemented adapter. None is configured in this deployment, so no headlines are shown."
        actions={<Badge tone="warn">setup required</Badge>}
      />

      {integrations.isLoading ? (
        <LoadingPanel rows={5} />
      ) : integrations.isError ? (
        <ErrorState message={integrations.error instanceof Error ? integrations.error.message : 'Integration state unavailable'} onRetry={() => void integrations.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="panel p-5">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-violet-400">
              <Newspaper className="h-5 w-5" />
            </div>
            <h2 className="display text-[17px] text-white">No news adapter is active</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-mutedx">
              The platform will not scrape restricted content, invent headlines, or present an AI summary as published information.
              The workspace stays in an explicit setup state until a provider is authorized and an adapter is implemented.
            </p>
            <div className="mt-4 space-y-2">
              {[
                ['Provider authorization', 'Select an official news or financial-events API and verify its redistribution terms.'],
                ['Entitlement checks', 'Respect article limits, licensing and attribution requirements.'],
                ['Adapter + normalization', 'Map timestamps, symbols, sources, links and duplicate stories into a typed contract.'],
                ['Sentiment, if added', 'Label it as a model output with documented limitations — never as a price prediction.'],
              ].map(([title, copy], index) => (
                <div key={title} className="flex gap-3 border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
                  <span className="font-mono text-[9px] text-violet-400/70">0{index + 1}</span>
                  <div>
                    <div className="text-[11px] text-white">{title}</div>
                    <div className="mt-0.5 text-[10px] leading-relaxed text-dimx">{copy}</div>
                  </div>
                </div>
              ))}
            </div>
            <Link to="/app/settings" className="btn btn-outline btn-sm mt-4">Integration settings</Link>
          </section>

          <div className="space-y-4">
            <section className="panel p-5">
              <SectionTitle eyebrow="Configuration" title="What is required" />
              <div className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
                <div className="eyebrow mb-1.5">Required environment</div>
                <code className="block font-mono text-[10px] text-cyanx/80">{integrations.data?.news.env.join(' · ') || 'NEWS_API_KEY'}</code>
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-dimx">{integrations.data?.news.requires}</p>
              <div className="mt-3 flex items-center gap-2 text-[10px] text-dimx">
                <KeyRound className="h-3 w-3" /> Check the provider's official documentation before enabling redistribution.
              </div>
            </section>

            <section className="panel p-5">
              <SectionTitle eyebrow="Boundaries" title="What will still be true after setup" />
              <div className="space-y-2.5 text-[10.5px] leading-relaxed text-dimx">
                <p className="flex gap-2"><BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn/70" /> Instruments are not assigned BUY or SELL labels from headlines.</p>
                <p className="flex gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn/70" /> Sentiment is not proof of direction and will not be presented as calibrated probability.</p>
                <p className="flex gap-2"><BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyanx/70" /> Published information and AI interpretation will be visually separated.</p>
                <p className="flex gap-2"><Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400/70" /> Source attribution and direct links are retained where licensing permits.</p>
              </div>
            </section>

            <Callout tone="warn" title="Other unconfigured integrations">
              Streaming market data is <strong>{integrations.data?.streaming.configured ? 'configured' : 'not configured'}</strong>; live brokerage is{' '}
              <strong>{integrations.data?.broker.configured ? 'configured' : 'disabled'}</strong>; email delivery is{' '}
              <strong>{integrations.data?.email.configured ? 'configured' : 'not implemented'}</strong>. The app performs research and paper trading without them.
            </Callout>
          </div>
        </div>
      )}
    </div>
  )
}
