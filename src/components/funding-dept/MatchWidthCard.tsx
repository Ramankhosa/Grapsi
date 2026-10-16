'use client'

/**
 * Choosing how good a match has to be, with the consequence in view.
 *
 * A reranker score has no absolute meaning an office can reason about, and the
 * scale shifts with the discipline and with how broadly agencies write — so
 * asking an administrator for a number would be asking them to guess. This asks
 * for a judgement they can actually make ("narrow or wide?") and shows what
 * each one would do to their own figures before they commit to it.
 *
 * Nothing here re-scores anything: the widths are applied to scores already
 * stored, which is why the preview is instant and switching is free.
 */
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { MATCH_BAND_LABELS, type MatchWidth } from '@/lib/fundingDept/matchBands'

type Preview = {
  width: MatchWidth
  label: string
  help: string
  cutoffs: { strong: number; moderate: number }
  matchedPairs: number
  matchedPeople: number
  callsWithMatch: number
  strongPairs: number
}

export default function MatchWidthCard() {
  const { authFetch } = useAuth()
  const { showToast } = useToast()
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  const [current, setCurrent] = useState<MatchWidth | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const response = await authFetch('/api/tenant-admin/match-width')
    if (!response.ok) return
    const payload = await response.json()
    setPreviews(payload.previews)
    setCurrent(payload.width)
  }, [authFetch])

  useEffect(() => { void load() }, [load])

  const choose = async (width: MatchWidth) => {
    setSaving(true)
    try {
      const response = await authFetch('/api/tenant-admin/match-width', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width }),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not save that.' })
        return
      }
      setCurrent(payload.width)
      showToast({ type: 'success', title: `Matching set to ${payload.width.toLowerCase()}` })
    } finally {
      setSaving(false)
    }
  }

  if (!previews) {
    return (
      <section className="nk-panel">
        <div className="nk-panel-head"><h2 className="nk-title">How wide a match counts</h2></div>
        <p className="nk-sub px-4 py-6">Loading…</p>
      </section>
    )
  }

  const nothingScored = previews.every((preview) => preview.matchedPairs === 0)

  return (
    <section className="nk-panel">
      <div className="nk-panel-head">
        <div>
          <h2 className="nk-title">How wide a match counts</h2>
          <p className="nk-sub">
            Every faculty member is scored against every open call. This sets how good that score
            has to be before the person is counted as matched — on the reports, on the call window
            and in exports. Below each option is what it would do to your own figures right now.
            Changing it re-counts work already done; nothing is re-scored and no call is re-read.
          </p>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
        {previews.map((preview) => {
          const on = preview.width === current
          return (
            <button
              key={preview.width}
              disabled={saving}
              aria-pressed={on}
              onClick={() => void choose(preview.width)}
              className={`rounded-lg border p-3 text-left transition ${
                on ? 'border-cobalt-500 bg-cobalt-50 ring-1 ring-cobalt-200' : 'border-nickel-200 hover:bg-nickel-50'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{preview.label}</span>
                {on && <span className="nk-badge nk-badge-live">In use</span>}
              </div>
              <p className="nk-sub mt-1 text-xs">{preview.help}</p>
              <dl className="mt-3 space-y-1 text-sm tabular-nums">
                <div className="flex justify-between gap-2">
                  <dt className="nk-sub text-xs">Faculty counted as matched</dt>
                  <dd className="font-medium">{preview.matchedPeople}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="nk-sub text-xs">Open calls with a match</dt>
                  <dd className="font-medium">{preview.callsWithMatch}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="nk-sub text-xs">Person-to-call matches</dt>
                  <dd className="font-medium">{preview.matchedPairs}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="nk-sub text-xs">Of those, “{MATCH_BAND_LABELS.strong}”</dt>
                  <dd className="font-medium">{preview.strongPairs}</dd>
                </div>
              </dl>
            </button>
          )
        })}
      </div>

      {nothingScored && (
        <p className="nk-sub px-4 pb-4 text-xs">
          No scored matches yet, so every width reads zero. That is expected until the overnight
          matching run has been through your open calls — it scores each call once and then reuses
          the result.
        </p>
      )}
    </section>
  )
}
