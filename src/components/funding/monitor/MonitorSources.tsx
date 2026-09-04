'use client'

import { AlertTriangle, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { MonitorSource } from './types'
import { frequencyLabel, timeAgo } from './types'

export default function MonitorSources({
  sources,
  busy,
  onCheckNow,
  onToggleStatus,
  onDelete,
}: {
  sources: MonitorSource[]
  busy: boolean
  onCheckNow: (sourceId: string) => Promise<string>
  onToggleStatus: (source: MonitorSource) => Promise<void>
  onDelete: (source: MonitorSource) => Promise<void>
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState<string | null>(null)

  const allTags = Array.from(
    new Set(
      sources.flatMap((source) =>
        source.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    )
  ).sort()

  const visible = activeTag
    ? sources.filter((source) =>
        source.tags
          .split(',')
          .map((tag) => tag.trim())
          .includes(activeTag)
      )
    : sources

  async function checkNow(source: MonitorSource) {
    setChecking(source.id)
    try {
      const message = await onCheckNow(source.id)
      setCheckResult((prev) => ({ ...prev, [source.id]: message }))
    } finally {
      setChecking(null)
    }
  }

  if (sources.length === 0) {
    return (
      <div className="cb-card p-10 text-center">
        <p className="cb-hint">
          No sources yet. Add the funder pages someone checks by hand today, and Moni takes over
          the checking.
        </p>
      </div>
    )
  }

  const failing = sources.filter((source) => source.fail_count >= 3)

  return (
    <div className="space-y-4">
      {failing.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {failing.length} source{failing.length > 1 ? 's are' : ' is'} failing — check
            {failing.length > 1 ? ' these' : ' this'} by hand
          </div>
          <ul className="mt-2 space-y-1 text-[13px] text-amber-900">
            {failing.map((source) => (
              <li key={source.id}>
                <span className="font-medium">{source.name}</span> — {source.fail_count} failures.{' '}
                {source.last_error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {allTags.length > 0 && (
        <div className="cb-scroll-x flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            className={`cb-chip ${!activeTag ? 'cb-chip-active' : ''}`}
            onClick={() => setActiveTag(null)}
          >
            all
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`cb-chip ${activeTag === tag ? 'cb-chip-active' : ''}`}
              onClick={() => setActiveTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="cb-card cb-scroll-x overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline bg-inset text-left">
              {['Source', 'Owner', 'Mode', 'Checks', 'Last checked', 'Finds', ''].map((heading) => (
                <th key={heading} className="cb-eyebrow px-4 py-2.5">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((source) => (
              <tr key={source.id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{source.name}</div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block max-w-xs truncate text-[12px] text-muted hover:text-cobalt-700 hover:underline"
                  >
                    {source.url}
                  </a>
                  {source.tags && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {source.tags
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .map((tag) => (
                          <span key={tag} className="cb-badge">
                            {tag}
                          </span>
                        ))}
                    </div>
                  )}
                  {checkResult[source.id] && (
                    <div className="mt-1 text-[12px] text-cobalt-700">{checkResult[source.id]}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-soft">{source.owner?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={source.mode === 'FEED' ? 'cb-badge-cobalt' : 'cb-badge'}>
                    {source.mode}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {frequencyLabel(source.frequency_minutes)}
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {timeAgo(source.last_checked_at)}
                  {source.fail_count >= 3 && (
                    <span className="ml-1.5 font-mono text-[11px] font-semibold text-red-600">
                      {source.fail_count} fails
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">
                  {source._count?.changes ?? 0}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="cb-btn-secondary cb-btn-xs"
                      disabled={busy || checking === source.id}
                      onClick={() => checkNow(source)}
                      title="Check this source now, without waiting for the daily sweep"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {checking === source.id ? 'Checking…' : 'Check now'}
                    </button>
                    <button
                      className="cb-btn-ghost cb-btn-xs"
                      disabled={busy}
                      onClick={() => onToggleStatus(source)}
                      title={source.status === 'ACTIVE' ? 'Pause checking' : 'Resume checking'}
                    >
                      {source.status === 'ACTIVE' ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      className="cb-btn-danger cb-btn-xs"
                      disabled={busy}
                      onClick={() => onDelete(source)}
                      title="Delete this source and its history"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
