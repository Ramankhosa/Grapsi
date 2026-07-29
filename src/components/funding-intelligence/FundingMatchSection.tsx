'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, Clock3, Compass, Loader2, Search, Target,
} from 'lucide-react'

export type FundingMatchAgency = {
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

export type FundingMatchCall = {
  id: string
  agencyName: string
  schemeTitle: string
  shortDescription: string
  closeDate: string | null
  isRolling: boolean
  amountMin: number | null
  amountMax: number | null
  currency: string | null
  eligibilitySummary: string
  officialUrls: string[]
  score: number
  matchReasons: string[]
}

export type FundingMatchState = {
  agencyName: string
  calls: FundingMatchCall[]
  rankedSemantically: boolean
  lowConfidence: boolean
  matchedAt: string
}

type Step = 'idle' | 'agencies' | 'calls'

function formatMoney(value: number | null, currency = 'INR') {
  if (value === null) return null
  if (currency === 'INR') {
    if (value >= 10_000_000) return `Rs ${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Cr`
    if (value >= 100_000) return `Rs ${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)} L`
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

function formatRange(call: FundingMatchCall) {
  const currency = call.currency || 'INR'
  const min = formatMoney(call.amountMin, currency)
  const max = formatMoney(call.amountMax, currency)
  if (min && max) return min === max ? min : `${min} - ${max}`
  return min || max
}

function formatDeadline(call: FundingMatchCall) {
  if (call.isRolling) return 'Rolling'
  if (!call.closeDate) return null
  const date = new Date(call.closeDate)
  if (Number.isNaN(date.getTime())) return null
  return `Closes ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/**
 * The funding match is deliberately manual and in order: funders first, then
 * that funder's calls, then the fit against the one call the user picked. The
 * review pass itself never touches a call, so nothing here is pre-selected.
 */
export default function FundingMatchSection({
  runId,
  token,
  selectedCallId,
  storedMatch,
  onCallEvaluated,
}: {
  runId: string
  token: string | null
  selectedCallId: string | null
  storedMatch: FundingMatchState | null
  onCallEvaluated: () => void | Promise<void>
}) {
  const [step, setStep] = useState<Step>(storedMatch ? 'calls' : 'idle')
  const [agencies, setAgencies] = useState<FundingMatchAgency[]>([])
  const [emptyLedger, setEmptyLedger] = useState(false)
  const [match, setMatch] = useState<FundingMatchState | null>(storedMatch)
  const [loadingAgencies, setLoadingAgencies] = useState(false)
  const [busyAgency, setBusyAgency] = useState<string | null>(null)
  const [busyCallId, setBusyCallId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAgencies = async () => {
    if (!token) return
    setLoadingAgencies(true)
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
      setStep('agencies')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load funder recommendations')
    } finally {
      setLoadingAgencies(false)
    }
  }

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

  const chooseCall = async (fundingCallId: string) => {
    if (!token) return
    setBusyCallId(fundingCallId)
    setError(null)
    try {
      const response = await fetch(`/api/idea-intelligence/${runId}/call-fit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingCallId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not check the idea against this call')
      await onCallEvaluated()
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not check the idea against this call')
    } finally {
      setBusyCallId(null)
    }
  }

  return (
    <section id="funding-match" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-teal-700" />
            <h2 className="font-semibold text-slate-900">Find funding opportunities</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            The analysis above deliberately does not pick a call for you. When you are ready, choose a funder from the
            ones whose own award record fits, then choose which of their calls to read your idea against.
          </p>
        </div>
        {step !== 'idle' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Step {step === 'agencies' ? '1' : '2'} of 2
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {selectedCallId ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Your idea has been read against a call. The call fit, gap report and simulated review panel are in
            <span className="font-semibold"> Full evidence and detailed analysis</span> below, and Grant Prep will start
            against this call. Pick a different call any time to replace it.
          </span>
        </div>
      ) : null}

      {step === 'idle' ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={loadAgencies}
            disabled={!token || loadingAgencies}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-900/10 transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loadingAgencies ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Find funding opportunities
          </button>
        </div>
      ) : null}

      {step === 'agencies' ? (
        emptyLedger || !agencies.length ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <Building2 className="mx-auto h-7 w-7 text-slate-300" />
            <h3 className="mt-3 font-semibold text-slate-900">No funder can be recommended from evidence</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              No comparable sanctioned project was retrieved for this idea, so there is no award record to rank funders
              against. Guessing from the call catalogue alone would not be a recommendation. Search the catalogue
              directly instead, or sharpen the idea and re-run the analysis.
            </p>
            <Link
              href="/finder"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Search the funding catalogue <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose a funder</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {agencies.map((agency) => (
                <article
                  key={agency.agencyName}
                  className={`rounded-2xl border p-5 ${agency.role === 'primary' ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 bg-white'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold leading-6 text-slate-900">{agency.agencyName}</h3>
                    {agency.role === 'primary' ? (
                      <span className="rounded-full bg-teal-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Best match</span>
                    ) : null}
                  </div>
                  {agency.whyThisAgency ? <p className="mt-2 text-sm leading-6 text-slate-700">{agency.whyThisAgency}</p> : null}
                  <p className="mt-2 text-xs leading-5 text-slate-500">{agency.evidenceBasis}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                    {agency.activeYears ? <span className="rounded-lg bg-white px-2.5 py-1.5">Active {agency.activeYears}</span> : null}
                    {formatMoney(agency.typicalBudget, agency.budgetCurrency || 'INR') ? (
                      <span className="rounded-lg bg-white px-2.5 py-1.5">Typical award {formatMoney(agency.typicalBudget, agency.budgetCurrency || 'INR')}</span>
                    ) : null}
                    <span className="rounded-lg bg-white px-2.5 py-1.5">
                      {agency.openCallCount} open call{agency.openCallCount === 1 ? '' : 's'} in the catalogue
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => chooseAgency(agency.agencyName)}
                    disabled={Boolean(busyAgency)}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {busyAgency === agency.agencyName ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Choose this funder <ArrowRight className="h-4 w-4" />
                  </button>
                </article>
              ))}
            </div>
          </div>
        )
      ) : null}

      {step === 'calls' && match ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Calls from {match.agencyName}
            </p>
            <button
              type="button"
              onClick={() => (agencies.length ? setStep('agencies') : void loadAgencies())}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Choose a different funder
            </button>
          </div>

          {!match.rankedSemantically && match.calls.length ? (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              These are what this funder currently has open. None of them ranked against your idea, so judge the fit
              yourself before committing.
            </p>
          ) : null}
          {match.rankedSemantically && match.lowConfidence && match.calls.length ? (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              Weak match — the ranking is not confident about any of these. Verify against the call document before
              relying on the fit report.
            </p>
          ) : null}

          {match.calls.length ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {match.calls.map((call) => {
                const amount = formatRange(call)
                const deadline = formatDeadline(call)
                return (
                  <article key={call.id} className={`rounded-2xl border p-5 ${selectedCallId === call.id ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{call.agencyName}</span>
                      {match.rankedSemantically && call.score > 0 ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{Math.round(call.score * 100)}% match</span>
                      ) : null}
                    </div>
                    <h3 className="mt-1 text-base font-semibold leading-6 text-slate-900">{call.schemeTitle || 'Untitled call'}</h3>
                    {call.shortDescription ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{call.shortDescription}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      {amount ? <span className="rounded-lg bg-slate-50 px-2.5 py-1.5">{amount}</span> : null}
                      {deadline ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5">
                          <Clock3 className="h-3.5 w-3.5" /> {deadline}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => chooseCall(call.id)}
                        disabled={Boolean(busyCallId)}
                        className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {busyCallId === call.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                        {selectedCallId === call.id ? 'Re-check against this call' : 'Check my idea against this call'}
                      </button>
                      <Link href={`/funding/calls/${call.id}`} className="text-xs font-semibold text-teal-700 hover:underline">
                        Open call
                      </Link>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <Clock3 className="mx-auto h-7 w-7 text-slate-300" />
              <h3 className="mt-3 font-semibold text-slate-900">No open call from {match.agencyName} right now</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                This funder has sanctioned comparable work, but nothing of theirs is open in the catalogue today. Try
                another funder, or check their own site for the next cycle.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
