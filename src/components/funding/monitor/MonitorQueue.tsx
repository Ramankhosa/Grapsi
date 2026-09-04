'use client'

import { ArrowUpRight, Check, Clock, X } from 'lucide-react'
import { useState } from 'react'

import type { DiffPart, MonitorChange } from './types'
import { VERDICT_LABEL, timeAgo } from './types'

function DiffView({ diff }: { diff: DiffPart[] }) {
  if (!Array.isArray(diff) || diff.length === 0) {
    return <p className="cb-hint">No diff recorded.</p>
  }
  return (
    <div className="cb-scroll-x overflow-x-auto rounded-lg border border-hairline bg-inset p-3 font-mono text-[11.5px] leading-relaxed">
      {diff.map((part, index) => (
        <pre
          key={index}
          className={
            part.t === 'add'
              ? 'whitespace-pre-wrap text-emerald-700'
              : part.t === 'del'
                ? 'whitespace-pre-wrap text-red-600 line-through decoration-red-300'
                : 'whitespace-pre-wrap text-muted'
          }
        >
          {part.text
            .split('\n')
            .map((line) => `${part.t === 'add' ? '+ ' : part.t === 'del' ? '- ' : '  '}${line}`)
            .join('\n')}
        </pre>
      ))}
    </div>
  )
}

export default function MonitorQueue({
  changes,
  busy,
  onAction,
}: {
  changes: MonitorChange[]
  busy: boolean
  onAction: (changeId: string, body: Record<string, unknown>) => Promise<void>
}) {
  const [openDiff, setOpenDiff] = useState<Record<string, boolean>>({})
  const [ignoreFor, setIgnoreFor] = useState<string | null>(null)
  const [ignorePattern, setIgnorePattern] = useState('')

  if (changes.length === 0) {
    return (
      <div className="cb-card p-10 text-center">
        <p className="cb-hint">
          Nothing waiting. When a watched page posts something new, it lands here for review.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => {
        const opportunities = change.extracted?.opportunities ?? []
        const isOpen = Boolean(openDiff[change.id])
        const isPending = change.state === 'NEW' || change.state === 'SNOOZED'

        return (
          <div key={change.id} className="cb-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{change.source.name}</span>
                <a
                  href={change.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-cobalt-700 hover:underline"
                >
                  open page <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={
                    change.verdict === 'NEW_OPPORTUNITY' ? 'cb-badge-cobalt' : 'cb-badge'
                  }
                >
                  {VERDICT_LABEL[change.verdict] ?? change.verdict}
                </span>
                {change.confidence !== null && (
                  <span className="font-mono text-[11px] text-muted">
                    {Math.round(change.confidence * 100)}%
                  </span>
                )}
                <span className="text-[12px] text-muted">{timeAgo(change.created_at)}</span>
              </div>
            </div>

            {change.extracted?.summary && (
              <p className="mt-2 text-sm text-ink-soft">{change.extracted.summary}</p>
            )}

            {opportunities.length > 0 && (
              <div className="mt-3 space-y-2">
                {opportunities.map((opportunity, index) => (
                  <div key={index} className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3">
                    <div className="text-sm font-medium text-ink">{opportunity.title}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-ink-soft">
                      {opportunity.funder && <span>Funder: {opportunity.funder}</span>}
                      {opportunity.deadline && (
                        <span className="font-medium text-amber-700">
                          Deadline: {opportunity.deadline}
                        </span>
                      )}
                      {opportunity.amount && <span>Amount: {opportunity.amount}</span>}
                    </div>
                    {opportunity.link && (
                      <a
                        href={opportunity.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate text-[12px] text-cobalt-700 hover:underline"
                      >
                        {opportunity.link}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="mt-3 text-[12px] font-medium text-muted hover:text-ink"
              onClick={() => setOpenDiff((prev) => ({ ...prev, [change.id]: !prev[change.id] }))}
            >
              {isOpen ? 'Hide what changed' : 'Show what changed'}
            </button>
            {isOpen && (
              <div className="mt-2">
                <DiffView diff={change.diff} />
              </div>
            )}

            {isPending ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="cb-btn-primary cb-btn-sm"
                  disabled={busy}
                  onClick={() => onAction(change.id, { action: 'confirm' })}
                >
                  <Check className="h-3.5 w-3.5" /> Confirm — send to intake
                </button>
                <button
                  className="cb-btn-secondary cb-btn-sm"
                  disabled={busy}
                  onClick={() => onAction(change.id, { action: 'dismiss' })}
                >
                  <X className="h-3.5 w-3.5" /> Dismiss
                </button>
                <button
                  className="cb-btn-secondary cb-btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setIgnoreFor(ignoreFor === change.id ? null : change.id)
                    setIgnorePattern('')
                  }}
                >
                  Dismiss &amp; ignore…
                </button>
                <button
                  className="cb-btn-secondary cb-btn-sm"
                  disabled={busy}
                  onClick={() => onAction(change.id, { action: 'snooze', snoozeDays: 7 })}
                >
                  <Clock className="h-3.5 w-3.5" /> Snooze 7d
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="cb-badge">{change.state}</span>
                {change.intake_job_id && (
                  <a
                    href={`/funding/imports?job=${change.intake_job_id}`}
                    className="text-[12px] text-cobalt-700 hover:underline"
                  >
                    View intake job
                  </a>
                )}
                <button
                  className="cb-btn-secondary cb-btn-sm"
                  disabled={busy}
                  onClick={() => onAction(change.id, { action: 'reopen' })}
                >
                  Reopen
                </button>
              </div>
            )}

            {ignoreFor === change.id && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[260px] flex-1">
                  <label className="cb-label mb-1" htmlFor={`ignore-${change.id}`}>
                    Text or pattern to ignore on this source
                  </label>
                  <input
                    id={`ignore-${change.id}`}
                    className="cb-input"
                    placeholder="e.g. Visitor count"
                    value={ignorePattern}
                    onChange={(event) => setIgnorePattern(event.target.value)}
                  />
                </div>
                <button
                  className="cb-btn-secondary cb-btn-sm"
                  disabled={busy || !ignorePattern.trim()}
                  onClick={() =>
                    onAction(change.id, {
                      action: 'dismiss',
                      ignorePattern: ignorePattern.trim(),
                    }).then(() => setIgnoreFor(null))
                  }
                >
                  Dismiss &amp; never flag this again
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
