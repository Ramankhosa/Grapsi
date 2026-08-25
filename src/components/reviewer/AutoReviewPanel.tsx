// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { AUTO_PHASES } from './useAutoReview'

/**
 * What the review is doing, while it does it.
 *
 * A run takes minutes, so the screen has to keep earning the wait. Everything
 * here is a real signal — completed steps, elapsed time, the actual section
 * being read, the live rate-limit countdown. Nothing advances on a timer.
 */

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

const STEP_ICON = {
  pending: <span className="h-1.5 w-1.5 rounded-full bg-nickel-300" />,
  active: <span className="nk-lamp" />,
  done: (
    <svg viewBox="0 0 12 12" className="h-3 w-3 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2.5 6.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  skipped: <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />,
  failed: (
    <svg viewBox="0 0 12 12" className="h-3 w-3 text-red-600" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
    </svg>
  ),
}

function Countdown({ until }) {
  const [left, setLeft] = useState(Math.max(0, until - Date.now()))
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, until - Date.now())), 250)
    return () => clearInterval(id)
  }, [until])
  return <span className="nk-mono">{Math.ceil(left / 1000)}s</span>
}

function PhaseSpine({ phase }) {
  const order = ['reviews', 'report']
  const activeIndex = order.indexOf(phase)

  return (
    <ol className="grid gap-2 sm:grid-cols-2">
      {AUTO_PHASES.map((item, index) => {
        const state =
          activeIndex === -1
            ? phase === 'done'
              ? 'done'
              : 'pending'
            : index < activeIndex
              ? 'done'
              : index === activeIndex
                ? 'active'
                : 'pending'
        return (
          <li
            key={item.key}
            className={`rounded-lg border px-3 py-2.5 transition-colors ${
              state === 'active'
                ? 'border-cobalt-300 bg-cobalt-50'
                : state === 'done'
                  ? 'border-nickel-200 bg-white'
                  : 'border-nickel-200 bg-nickel-25'
            }`}
          >
            <div className="flex items-center gap-2">
              {state === 'active' ? (
                <span className="nk-lamp" />
              ) : state === 'done' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-nickel-300" />
              )}
              <span
                className={`text-[13px] font-medium ${
                  state === 'active' ? 'text-cobalt-800' : state === 'done' ? 'text-nickel-800' : 'text-nickel-500'
                }`}
              >
                {index + 1}. {item.label}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-4 text-nickel-500">{item.blurb}</p>
          </li>
        )
      })}
    </ol>
  )
}

export default function AutoReviewPanel({ run, onOpenReport }) {
  const { phase, running, steps, log, error, detail, elapsedMs, waitingUntil, percent, doneCount, totalCount } = run
  const [showLog, setShowLog] = useState(false)
  const logEndRef = useRef(null)

  useEffect(() => {
    if (showLog) logEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [log, showLog])

  if (phase === 'idle') return null

  const finished = ['done', 'error', 'cancelled'].includes(phase)

  return (
    <section className="nk-panel" aria-live="polite">
      <div className="nk-panel-head">
        <div className="min-w-0">
          <h2 className="nk-title">
            {phase === 'done'
              ? 'Review complete'
              : phase === 'cancelled'
                ? 'Review stopped'
                : phase === 'error'
                  ? 'Review stopped early'
                  : 'Reviewing your proposal'}
          </h2>
          <p className="nk-sub mt-0.5">
            {running ? `${doneCount} of ${totalCount} steps · ${formatElapsed(elapsedMs)} elapsed` : `Took ${formatElapsed(elapsedMs)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <button type="button" onClick={run.cancel} className="nk-btn-secondary nk-btn-sm">
              Stop
            </button>
          )}
          {phase === 'done' && onOpenReport && (
            <button type="button" onClick={onOpenReport} className="nk-btn-primary nk-btn-sm">
              Open the report
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {/* Progress is completed steps, not a guess at remaining time. */}
        <div>
          <div className="nk-meter">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                phase === 'error' ? 'bg-red-500' : phase === 'cancelled' ? 'bg-nickel-400' : 'nk-meter-fill'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <PhaseSpine phase={phase} />

        {/* The single most useful line: what is happening right now. */}
        {(running || detail) && (
          <div
            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${
              waitingUntil ? 'border-amber-200 bg-amber-50' : 'border-cobalt-200 bg-cobalt-50'
            }`}
          >
            {running && !waitingUntil && <span className="nk-lamp mt-1.5 shrink-0" />}
            <p
              className={`min-w-0 flex-1 text-[13px] leading-5 ${
                waitingUntil ? 'text-amber-900' : 'text-cobalt-900'
              }`}
            >
              {detail}
              {waitingUntil && (
                <>
                  {' '}
                  <Countdown until={waitingUntil} />
                </>
              )}
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-5 text-red-700">
            {error}
          </div>
        )}

        {/* Per-step ledger, so the wait is visibly made of parts. */}
        {steps.length > 0 && (
          <ul className="divide-y divide-nickel-100 rounded-lg border border-nickel-200">
            {steps.map(step => (
              <li key={step.key} className="flex items-center gap-3 px-3.5 py-2">
                <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                  {STEP_ICON[step.status]}
                </span>
                <span className="nk-eyebrow w-[74px] shrink-0">
                  {step.kind === 'summary' ? 'Summary' : step.kind === 'review' ? 'Review' : 'Report'}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${
                    step.status === 'active'
                      ? 'font-medium text-cobalt-800'
                      : step.status === 'pending'
                        ? 'text-nickel-500'
                        : 'text-nickel-800'
                  }`}
                >
                  {step.title}
                </span>
                {step.detail && (
                  <span className="hidden shrink-0 text-[11.5px] text-nickel-500 sm:inline">{step.detail}</span>
                )}
                {typeof step.score === 'number' && (
                  <span className="nk-mono shrink-0 rounded bg-nickel-100 px-1.5 py-0.5 text-nickel-700">
                    {step.score.toFixed(1)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-nickel-200 pt-4">
          <button
            type="button"
            onClick={() => setShowLog(v => !v)}
            aria-expanded={showLog}
            className="nk-btn-ghost nk-btn-xs"
          >
            {showLog ? 'Hide' : 'Show'} activity log ({log.length})
          </button>
          {running && (
            <p className="text-[11.5px] text-nickel-500">
              Keep this tab open — the run stops if you navigate away.
            </p>
          )}
        </div>

        {showLog && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-nickel-200 bg-nickel-25 p-3">
            <ul className="space-y-1">
              {log.map((entry, index) => (
                <li key={index} className="flex gap-2 text-[11.5px] leading-4">
                  <span className="nk-mono shrink-0 text-nickel-400">{entry.at}</span>
                  <span className="text-nickel-600">{entry.message}</span>
                </li>
              ))}
            </ul>
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </section>
  )
}
