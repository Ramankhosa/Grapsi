'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, Clock3, Loader2, Target, X } from 'lucide-react'

import type { AgencyIpYield } from '@/lib/ideaIntelligence/priorWork'
import { formatAmountRange, formatDeadline, formatMoney } from './format'
import type { FundingMatchCall, FundingMatchState } from './types'

type FundingMatchAgency = {
  agencyName: string
  role: 'primary' | 'alternate'
  matchScore: number
  fundedNearbyCount: number
  ongoingNearbyCount: number
  activeYears: string | null
  typicalBudget: number | null
  budgetCurrency: string | null
  schemes: string[]
  openCallIds: string[]
  openCallCount: number
  evidenceBasis: string
  whyThisAgency: string
}

type Step = 'agencies' | 'calls'

function ipYieldNote(yieldRow: AgencyIpYield | undefined) {
  if (!yieldRow || !yieldRow.awardCount) return null
  if (!yieldRow.awardsWithPatents) return 'None of their awards here reported a patent.'
  return `${yieldRow.awardsWithPatents} of ${yieldRow.awardCount} of their awards here reported patents — this funder pays for work that produces IP.`
}

/**
 * The funder step, in the same window as the evidence it is derived from. It
 * opens against ONE chosen opening, and every recommendation points back at
 * award rows the researcher can still see behind the drawer.
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
  const [step, setStep] = useState<Step>('agencies')
  const [agencies, setAgencies] = useState<FundingMatchAgency[]>([])
  const [match, setMatch] = useState<FundingMatchState | null>(null)
  const [emptyLedger, setEmptyLedger] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyAgency, setBusyAgency] = useState<string | null>(null)
  const [busyCallId, setBusyCallId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ipYieldByAgency = new Map(agencyIpYield.map((item) => [item.agencyName.toLowerCase(), item]))

  const loadAgencies = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/funding-match`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load funder recommendations')
      setAgencies(Array.isArray(body.agencies) ? body.agencies : [])
      setEmptyLedger(body.reason === 'no_sanctioned_evidence')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load funder recommendations')
    } finally {
      setLoading(false)
    }
  }, [runId, token])

  useEffect(() => {
    if (!open) return
    setStep('agencies')
    setMatch(null)
    if (!agencies.length) void loadAgencies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadAgencies])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  const chooseAgency = async (agencyName: string) => {
    if (!token) return
    setBusyAgency(agencyName)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/funding-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencyName }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not find calls for this funder')
      setMatch(body.fundingMatch)
      setStep('calls')
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : 'Could not find calls for this funder')
    } finally {
      setBusyAgency(null)
    }
  }

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
            Ranked by who has already sanctioned comparable work — the awards listed behind this panel. Open calls are a
            tiebreaker, not the basis.
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

          {!loading && step === 'agencies' ? (
            emptyLedger || !agencies.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Building2 className="mx-auto h-7 w-7 text-slate-300" />
                <h3 className="mt-3 font-semibold text-slate-900">No funder can be recommended from evidence</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  No comparable sanctioned award was retrieved, so there is no record to rank funders against. Guessing
                  from the call catalogue alone would not be a recommendation.
                </p>
                <Link href="/finder" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Search the catalogue <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {agencies.map((agency) => {
                  const note = ipYieldNote(ipYieldByAgency.get(agency.agencyName.toLowerCase()))
                  const typical = formatMoney(agency.typicalBudget, agency.budgetCurrency || 'INR')
                  return (
                    <article
                      key={agency.agencyName}
                      className={`rounded-2xl border p-4 ${agency.role === 'primary' ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200'}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold text-slate-900">{agency.agencyName}</h3>
                        {agency.role === 'primary' ? (
                          <span className="rounded-full bg-teal-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Best match</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-slate-600">{agency.evidenceBasis}</p>
                      {note ? <p className="mt-1.5 text-xs font-semibold leading-5 text-indigo-700">{note}</p> : null}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                        {agency.activeYears ? <span className="rounded-lg bg-white px-2 py-1">Active {agency.activeYears}</span> : null}
                        {typical ? <span className="rounded-lg bg-white px-2 py-1">Typical {typical}</span> : null}
                        <span className="rounded-lg bg-white px-2 py-1">{agency.openCallCount} open call{agency.openCallCount === 1 ? '' : 's'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => chooseAgency(agency.agencyName)}
                        disabled={Boolean(busyAgency)}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {busyAgency === agency.agencyName ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        See their open calls <ArrowRight className="h-4 w-4" />
                      </button>
                    </article>
                  )
                })}
              </div>
            )
          ) : null}

          {!loading && step === 'calls' && match ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calls from {match.agencyName}</p>
                <button type="button" onClick={() => setStep('agencies')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
                  <ArrowLeft className="h-3.5 w-3.5" /> Other funders
                </button>
              </div>

              {!match.rankedSemantically && match.calls.length ? (
                <p className="mt-2 text-xs leading-5 text-amber-700">
                  These are what this funder currently has open. None ranked against your idea, so judge the fit yourself.
                </p>
              ) : null}
              {match.rankedSemantically && match.lowConfidence && match.calls.length ? (
                <p className="mt-2 text-xs leading-5 text-amber-700">
                  Weak match — the ranking is not confident about any of these. Verify against the call document first.
                </p>
              ) : null}

              {match.calls.length ? (
                <div className="mt-3 space-y-3">
                  {match.calls.map((call) => {
                    const amount = formatAmountRange(call.amountMin, call.amountMax, call.currency)
                    const deadline = formatDeadline(call.closeDate, call.isRolling)
                    return (
                      <article key={call.id} className={`rounded-2xl border p-4 ${selectedCallId === call.id ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
                        <h3 className="text-sm font-semibold leading-6 text-slate-900">{call.schemeTitle || 'Untitled call'}</h3>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                          {amount ? <span className="rounded-lg bg-slate-50 px-2 py-1">{amount}</span> : null}
                          {deadline ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1"><Clock3 className="h-3 w-3" /> {deadline}</span>
                          ) : null}
                          {selectedCallId === call.id ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 font-semibold text-emerald-800"><Check className="h-3 w-3" /> checked</span>
                          ) : null}
                        </div>
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
                          <Link href={`/funding/calls/${call.id}`} className="text-xs font-semibold text-teal-700 hover:underline">Open call</Link>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <Clock3 className="mx-auto h-7 w-7 text-slate-300" />
                  <h3 className="mt-3 font-semibold text-slate-900">Nothing open from {match.agencyName} today</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    They have sanctioned comparable work, but nothing of theirs is open in the catalogue. Try another
                    funder, or check their site for the next cycle.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
