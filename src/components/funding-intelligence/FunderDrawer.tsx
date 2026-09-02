'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Clock3, Loader2, Search, Target, X } from 'lucide-react'

import type { AgencyIpYield } from '@/lib/ideaIntelligence/priorWork'
import { formatAmountRange, formatDeadline } from './format'
import type { FundingMatchCall, FundingMatchState } from './types'

function ipYieldNote(yieldRow: AgencyIpYield | undefined) {
  if (!yieldRow || !yieldRow.awardCount) return null
  if (!yieldRow.awardsWithPatents) return 'None of their awards in this space reported a patent.'
  return `${yieldRow.awardsWithPatents} of ${yieldRow.awardCount} of their awards here reported patents — this funder pays for work that produces IP.`
}

/**
 * The funder step, in the same window as the evidence it is derived from. It
 * lists the calls the catalogue currently has open for this idea — read from the
 * call table, not inferred from whoever funded comparable work years ago.
 */
export default function FunderDrawer({
  runId,
  token,
  open,
  onClose,
  forTitle,
  selectedCallId,
  agencyIpYield,
  onCallEvaluated,
}: {
  runId: string
  token: string | null
  open: boolean
  onClose: () => void
  forTitle: string | null
  selectedCallId: string | null
  agencyIpYield: AgencyIpYield[]
  onCallEvaluated: () => void | Promise<void>
}) {
  const [match, setMatch] = useState<FundingMatchState | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyCallId, setBusyCallId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ipYieldByAgency = new Map(agencyIpYield.map((item) => [item.agencyName.toLowerCase(), item]))

  const loadCalls = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/funding-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load matching calls')
      setMatch(body.fundingMatch || null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load matching calls')
    } finally {
      setLoading(false)
    }
  }, [runId, token])

  useEffect(() => {
    if (!open) return
    if (!match) void loadCalls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadCalls])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  const chooseCall = async (call: FundingMatchCall) => {
    if (!token) return
    setBusyCallId(call.id)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/call-fit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingCallId: call.id }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not check the idea against this call')
      await onCallEvaluated()
      onClose()
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not check the idea against this call')
    } finally {
      setBusyCallId(null)
    }
  }

  if (!open) return null

  const calls = match?.calls || []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close funder panel" onClick={onClose} className="absolute inset-0 bg-slate-900/30" />

      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900">Who funds this</h2>
              {forTitle ? <p className="mt-0.5 truncate text-xs text-slate-500">For: {forTitle}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Calls currently open in the catalogue, ranked against your idea. Past awards are not what is being matched
            here — only calls you can still apply to.
          </p>
        </header>

        <div className="flex-1 px-5 py-4">
          {error ? (
            <div className="mb-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>
          ) : null}

          {!loading && match ? (
            calls.length ? (
              <div>
                {!match.rankedSemantically ? (
                  <p className="text-xs leading-5 text-amber-700">
                    Nothing in the catalogue ranked against your idea, so these are simply what is open, soonest deadline
                    first. Judge the fit yourself.
                  </p>
                ) : match.lowConfidence ? (
                  <p className="text-xs leading-5 text-amber-700">
                    Weak match — the ranking is not confident about any of these. Verify against the call document first.
                  </p>
                ) : null}

                <div className="mt-3 space-y-3">
                  {calls.map((call) => {
                    const amount = formatAmountRange(call.amountMin, call.amountMax, call.currency)
                    const deadline = formatDeadline(call.closeDate, call.isRolling)
                    const note = ipYieldNote(ipYieldByAgency.get((call.agencyName || '').toLowerCase()))
                    return (
                      <article key={call.id} className={`rounded-2xl border p-4 ${selectedCallId === call.id ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
                        <h3 className="text-sm font-semibold leading-6 text-slate-900">{call.schemeTitle || 'Untitled call'}</h3>
                        {call.agencyName ? <p className="mt-0.5 text-xs text-slate-500">{call.agencyName}</p> : null}
                        {call.shortDescription ? (
                          <p className="mt-2 text-sm leading-6 text-slate-600">{call.shortDescription}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                          {amount ? <span className="rounded-lg bg-slate-50 px-2 py-1">{amount}</span> : null}
                          {deadline ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1"><Clock3 className="h-3 w-3" /> {deadline}</span>
                          ) : null}
                          {selectedCallId === call.id ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 font-semibold text-emerald-800"><Check className="h-3 w-3" /> checked</span>
                          ) : null}
                        </div>
                        {call.matchReasons.length ? (
                          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                            {call.matchReasons.slice(0, 3).map((reason) => <li key={reason}>· {reason}</li>)}
                          </ul>
                        ) : null}
                        {note ? <p className="mt-1.5 text-xs font-semibold leading-5 text-indigo-700">{note}</p> : null}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => chooseCall(call)}
                            disabled={Boolean(busyCallId)}
                            className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {busyCallId === call.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                            {selectedCallId === call.id ? 'Re-check my fit' : 'Check my fit'}
                          </button>
                          <Link href={`/finder/calls/${call.id}`} className="text-xs font-semibold text-teal-700 hover:underline">Open call</Link>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Search className="mx-auto h-7 w-7 text-slate-300" />
                <h3 className="mt-3 font-semibold text-slate-900">Nothing open matches this idea today</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  The catalogue holds no open call close enough to this direction. Search it yourself, or come back when
                  the next cycle is announced.
                </p>
                <Link href="/finder" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Search the catalogue <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )
          ) : null}
        </div>
      </aside>
    </div>
  )
}
