'use client'

import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SiteEvidence, SiteSummary } from './types'
import { timeAgo, timeUntil } from './types'

/**
 * What the crawler actually saw, per site: each check run (and whether it was
 * complete — "no new calls" and "not fully checked" are different answers),
 * and every resource the watch points observed, with the words around it.
 */
export default function MonitorEvidence({
  authedFetch,
}: {
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>
}) {
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<SiteEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSites = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authedFetch('/api/funding/monitor/sites')
      if (!response.ok) throw new Error('Could not load sites.')
      const data = await response.json()
      setSites(data.sites ?? [])
      setSelected((current) => current ?? data.sites?.[0]?.id ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load sites.')
    } finally {
      setLoading(false)
    }
  }, [authedFetch])

  // Only the latest request may fill the panel: clicking between sites quickly
  // must never show one site's evidence under another site's name.
  const latestRequest = useRef(0)
  const loadEvidence = useCallback(
    async (siteId: string) => {
      const requestId = ++latestRequest.current
      setError(null)
      try {
        const response = await authedFetch(`/api/funding/monitor/sites/${siteId}?take=100`)
        if (!response.ok) throw new Error('Could not load evidence for this site.')
        const data = await response.json()
        if (requestId === latestRequest.current) setEvidence(data)
      } catch (caught) {
        if (requestId === latestRequest.current) {
          setError(caught instanceof Error ? caught.message : 'Could not load evidence.')
        }
      }
    },
    [authedFetch]
  )

  useEffect(() => {
    void loadSites()
  }, [loadSites])

  useEffect(() => {
    if (!selected) return
    setEvidence(null)
    void loadEvidence(selected)
  }, [selected, loadEvidence])

  if (loading && sites.length === 0) return <p className="cb-hint">Loading sites…</p>
  if (sites.length === 0) {
    return (
      <div className="cb-card p-10 text-center">
        <p className="cb-hint">No sites yet. Adding a source creates the site for its host.</p>
      </div>
    )
  }

  const sourceName = (sourceId: string) => evidence?.site.sources.find((s) => s.id === sourceId)?.name ?? sourceId.slice(0, 6)

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="cb-card h-fit divide-y divide-hairline">
        {sites.map((site) => (
          <button
            key={site.id}
            className={`block w-full px-3 py-2.5 text-left ${selected === site.id ? 'bg-cobalt-50' : 'hover:bg-inset'}`}
            onClick={() => setSelected(site.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium text-ink">{site.host}</span>
              <span className={site.status === 'ACTIVE' ? 'cb-badge-cobalt' : 'cb-badge'}>{site.status}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              {site.sources.length} watch point{site.sources.length === 1 ? '' : 's'} · {site._count.resources} resources
              {site.consecutive_fetch_failures > 0 ? ` · ${site.consecutive_fetch_failures} failing` : ''}
            </div>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
        {!evidence && !error && <p className="cb-hint">Loading evidence…</p>}
        {evidence && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="cb-eyebrow">Site</p>
                <h2 className="text-lg font-semibold text-ink">{evidence.site.host}</h2>
                <p className="cb-hint">
                  {Object.entries(evidence.resourceCounts)
                    .map(([role, count]) => `${count} ${role.toLowerCase().replace(/_/g, ' ')}`)
                    .join(' · ') || 'Nothing observed yet'}
                </p>
              </div>
              <button className="cb-btn-secondary cb-btn-sm" onClick={() => selected && void loadEvidence(selected)}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>

            <div className="cb-card p-4">
              <p className="cb-eyebrow">Watch points</p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {sites
                  .find((site) => site.id === selected)
                  ?.sources.map((source) => (
                    <li key={source.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{source.name}</span>
                      <span className="cb-badge">{source.kind}</span>
                      <span className="cb-badge">{source.fetch_mode}</span>
                      <span className="text-muted">
                        checked {timeAgo(source.last_checked_at)}, last complete {timeAgo(source.last_complete_check_at)}, next{' '}
                        {timeUntil(source.next_check_at)}
                      </span>
                      {source.last_error && <span className="text-red-600">{source.last_error}</span>}
                    </li>
                  ))}
              </ul>
            </div>

            <div className="cb-card cb-scroll-x overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-inset text-left">
                    {['Check', 'Watch point', 'Result', 'Pages', 'Items', 'New', 'Mode', 'When'].map((heading) => (
                      <th key={heading} className="cb-eyebrow px-3 py-2">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evidence.checkRuns.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-[13px] text-muted">
                        No checks have run yet.
                      </td>
                    </tr>
                  )}
                  {evidence.checkRuns.map((run) => (
                    <tr key={run.id} className="border-b border-hairline last:border-0 align-top">
                      <td className="px-3 py-2 font-mono text-[12px]">#{run.check_generation}</td>
                      <td className="px-3 py-2 text-ink-soft">{sourceName(run.source_id)}</td>
                      <td className="px-3 py-2">
                        <span className={run.complete ? 'cb-badge-cobalt' : 'cb-badge'}>
                          {run.status}
                          {run.complete ? '' : ' · incomplete'}
                        </span>
                        {run.error_message && <div className="mt-1 max-w-xs text-[12px] text-red-600">{run.error_message}</div>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-ink-soft">{run.pages_visited}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-soft">{run.items_observed}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-soft">{run.new_resources}</td>
                      <td className="px-3 py-2 text-[12px] text-muted">{run.fetch_mode_used ?? '—'}</td>
                      <td className="px-3 py-2 text-[12px] text-muted">{timeAgo(run.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cb-card divide-y divide-hairline">
              <div className="px-4 py-2.5">
                <p className="cb-eyebrow">Observed resources (newest first)</p>
              </div>
              {evidence.resources.length === 0 && <p className="px-4 py-4 text-[13px] text-muted">Nothing observed yet.</p>}
              {evidence.resources.map((resource) => {
                const missing = resource.observations.every((obs) => obs.missing_since)
                const observation = resource.observations[0]
                return (
                  <div key={resource.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[13px] font-medium text-ink">{resource.title || resource.canonical_url}</span>
                        {resource.canonical_url && (
                          <a
                            href={resource.canonical_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 inline-flex items-center gap-0.5 text-[12px] text-cobalt-700 hover:underline"
                          >
                            open <ArrowUpRight className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="cb-badge">{resource.kind.toLowerCase()}</span>
                        {missing && <span className="cb-badge">gone from listing</span>}
                        <span className="text-[12px] text-muted">first seen {timeAgo(resource.first_seen_at)}</span>
                      </div>
                    </div>
                    {observation?.context_text && observation.context_text !== resource.title && (
                      <p className="mt-1 line-clamp-2 text-[12px] text-ink-soft">{observation.context_text}</p>
                    )}
                    {observation && observation.date_hints.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {observation.date_hints.map((hint) => (
                          <span key={hint} className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-800">
                            {hint}
                          </span>
                        ))}
                      </div>
                    )}
                    {resource.observations.length > 1 && (
                      <p className="mt-1 text-[11px] text-muted">Seen from {resource.observations.length} watch points</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
