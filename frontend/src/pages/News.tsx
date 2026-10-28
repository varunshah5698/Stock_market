import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Newspaper, RefreshCw, Rss, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Callout, EmptyState, ErrorState, Input, LoadingPanel, PageHeader, SectionTitle, WarningList } from '../components/ui'
import { api } from '../lib/api'
import { cn, fmtDateTime, relativeTime } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'

interface NewsArticle {
  title: string
  url: string
  source: string
  published_at: string | null
}

interface NewsPayload {
  query: string
  provider: string
  provider_mode: string
  fetched_at: string
  from_cache: boolean
  cache_ttl_minutes: number
  count: number
  newest_published_at: string | null
  tone: { score: number; label: string; positive_hits: number; negative_hits: number; sample: number; method: string }
  articles: NewsArticle[]
  warnings: string[]
  disclaimer: string
}

export default function News() {
  useDocumentTitle('News & events')
  const [symbol, setSymbol] = useState('')
  const [applied, setApplied] = useState('')

  const news = useQuery<NewsPayload>({
    queryKey: ['news', applied],
    queryFn: () => api(`/api/v1/news?symbol=${encodeURIComponent(applied)}&limit=25`),
    staleTime: 60_000,
    retry: 0,
  })

  const data = news.data
  const tone = data?.tone
  const toneTone = tone?.label === 'positive' ? 'gain' : tone?.label === 'negative' ? 'loss' : 'neutral'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Market news & event intelligence"
        title="News & events"
        description="Live headlines from a keyless public RSS aggregator. Nothing here is seeded or generated: if the feed is unreachable you get an explicit error, not placeholder stories."
        actions={
          data ? (
            <Badge tone={data.from_cache ? 'neutral' : 'gain'}>{data.from_cache ? 'cached' : 'live fetch'}</Badge>
          ) : (
            <Badge tone="neutral">keyless provider</Badge>
          )
        }
      />

      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="eyebrow mb-1.5 block" htmlFor="news-symbol">
              Filter by instrument
            </label>
            <Input
              id="news-symbol"
              value={symbol}
              placeholder="AAPL — leave blank for the general market"
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setApplied(symbol.trim())
              }}
            />
          </div>
          <Button size="sm" onClick={() => setApplied(symbol.trim())}>
            Search
          </Button>
          <Button size="sm" variant="outline" onClick={() => setApplied('')}>
            Market feed
          </Button>
          <Button size="sm" variant="outline" icon={<RefreshCw className={cn('h-3.5 w-3.5', news.isFetching && 'animate-spin')} />} onClick={() => void news.refetch()}>
            Refresh
          </Button>
        </div>
        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[8.5px] text-dimx">
            <span className="flex items-center gap-1"><Rss className="h-3 w-3" /> {data.provider}</span>
            <span>query “{data.query}”</span>
            <span>{data.count} headlines</span>
            <span>fetched {fmtDateTime(data.fetched_at)}</span>
            <span>cache {data.cache_ttl_minutes}m</span>
            {data.newest_published_at && <span>newest {relativeTime(data.newest_published_at)}</span>}
          </div>
        )}
      </section>

      {news.isLoading ? (
        <LoadingPanel rows={6} />
      ) : news.isError ? (
        <ErrorState
          title="News provider unavailable"
          message={news.error instanceof Error ? news.error.message : 'The feed could not be reached.'}
          onRetry={() => void news.refetch()}
        />
      ) : !data || data.count === 0 ? (
        <EmptyState
          title="No headlines right now"
          description={`The provider returned no articles for this query. This is an empty result, not a placeholder.`}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] text-white">
                <Newspaper className="h-3.5 w-3.5 text-violet-400" /> Headlines
                <span className="font-mono text-[9px] text-dimx">{data.count}</span>
              </div>
              <span className="font-mono text-[8.5px] text-dimx">{data.from_cache ? 'served from cache' : 'fetched just now'}</span>
            </div>
            <ul className="divide-y divide-white/[0.05]">
              {data.articles.map((article) => (
                <li key={article.url} className="px-4 py-3">
                  <a href={article.url} target="_blank" rel="noreferrer noopener" className="group flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[12px] leading-snug text-white group-hover:text-violet-300">{article.title}</div>
                      <div className="mt-1 flex items-center gap-2 font-mono text-[8.5px] text-dimx">
                        <span>{article.source || 'unknown source'}</span>
                        {article.published_at && <span>· {relativeTime(article.published_at)}</span>}
                      </div>
                    </div>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-dimx group-hover:text-white" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <div className="space-y-4">
            <section className="panel p-4">
              <SectionTitle
                eyebrow="Headline tone"
                title={tone?.label ?? 'mixed'}
                action={<Badge tone={toneTone as 'gain' | 'loss' | 'neutral'}>{tone ? tone.score.toFixed(2) : '—'}</Badge>}
              />
              <div className="font-mono text-[9px] text-dimx">
                {tone ? `${tone.positive_hits} positive · ${tone.negative_hits} negative hits across ${tone.sample} headlines` : 'no sample'}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-dimx">{tone?.method}</p>
              <p className="mt-2 flex gap-2 text-[10px] leading-relaxed text-warn/80">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A keyword score over headlines is a crude signal, not sentiment analysis, and it is not a model input.
              </p>
            </section>

            <WarningList warnings={data.warnings} title="Provider limits" />
            <Callout tone="warn" title="How this reaches the forecast">{data.disclaimer}</Callout>
          </div>
        </div>
      )}
    </div>
  )
}
