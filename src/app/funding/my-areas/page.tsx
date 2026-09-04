'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

type Status = 'active' | 'expired' | 'all'

interface MyAreasCall {
  id: string
  title: string | null
  agencyName: string | null
  summary: string | null
  disciplines: string[]
  closesAt: string | null
  daysToClose: number | null
  isExpired: boolean
  score: number
  tier: 'strong' | 'moderate' | 'weak'
  basis: 'vector' | 'terms'
  source: 'profile' | 'research_area' | 'publication' | 'terms'
  matchedOn: string | null
  alerted: boolean
}

interface MyAreasData {
  status: Status
  calls: MyAreasCall[]
  counts: { active: number; expired: number; total: number }
  readiness: {
    hasProfileVector: boolean
    savedAreas: number
    taggedPublications: number
    terms: number
    isUnprofiled: boolean
    callVectorsMissing: boolean
  }
}

const TIER_STYLES: Record<MyAreasCall['tier'], string> = {
  strong: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  moderate: 'border-cobalt-200 bg-cobalt-50 text-cobalt-700',
  weak: 'border-nickel-200 bg-nickel-50 text-nickel-600',
}

const TIER_LABEL: Record<MyAreasCall['tier'], string> = {
  strong: 'Strong match',
  moderate: 'Good match',
  weak: 'Possible match',
}

/** Said in the researcher's terms: what of theirs the call matched. */
function sourceLabel(call: MyAreasCall) {
  if (call.source === 'research_area') {
    return call.matchedOn ? `Your research area: ${call.matchedOn}` : 'One of your research areas'
  }
  if (call.source === 'publication') {
    return call.matchedOn ? `Your paper: ${call.matchedOn}` : 'One of your papers'
  }
  if (call.source === 'terms') {
    return 'Your research areas and keywords'
  }
  return 'Your research profile'
}

function closingLabel(call: MyAreasCall) {
  if (!call.closesAt) return { label: 'Rolling — no closing date', tone: 'text-nickel-500' }
  const date = new Date(call.closesAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  if (call.isExpired) {
    return { label: `Closed ${date}`, tone: 'text-nickel-400' }
  }
  const days = call.daysToClose
  if (days !== null && days <= 14) {
    return { label: `Closes in ${days} day${days === 1 ? '' : 's'} · ${date}`, tone: 'text-red-700 font-medium' }
  }
  if (days !== null && days <= 45) {
    return { label: `Closes in ${days} days · ${date}`, tone: 'text-amber-700' }
  }
  return { label: `Closes ${date}`, tone: 'text-nickel-600' }
}

export default function FundingInMyAreasPage() {
  const { authFetch, isLoading: authLoading } = useAuth()

  const [data, setData] = useState<MyAreasData | null>(null)
  const [status, setStatus] = useState<Status>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (next: Status) => {
      setLoading(true)
      try {
        const response = await authFetch(`/api/funding/my-areas?status=${next}`)
        const payload = await response.json()
        if (!response.ok) {
          setError(
            response.status === 401
              ? 'Your session has expired. Sign in again to see your calls.'
              : payload.error || 'Could not work out your matching calls.'
          )
          return
        }
        setData(payload)
        setError(null)
      } catch {
        setError('Could not work out your matching calls.')
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading) return
    void load(status)
  }, [authLoading, status, load])

  const counts = data?.counts
  const TABS: Array<{ key: Status; label: string; count?: number }> = [
    { key: 'active', label: 'Open now', count: counts?.active },
    { key: 'expired', label: 'Closed', count: counts?.expired },
    { key: 'all', label: 'All', count: counts?.total },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Funding</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Funding in my areas
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            Calls matched against your research profile, your saved research areas and the papers
            you tagged as your own. Nothing to type — this is what the system already knows about
            your work.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/finder" className="nk-btn-secondary nk-btn-sm">
              Search with the finder
            </Link>
            <Link href="/profile/research-areas" className="nk-btn-secondary nk-btn-sm">
              Manage my research areas
            </Link>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatus(tab.key)}
              className={status === tab.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
            >
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span className="nk-mono ml-1.5 opacity-70">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="nk-sub">Finding calls in your areas…</p>
        ) : error ? (
          <div className="nk-panel px-5 py-8 text-center">
            <p className="nk-sub">{error}</p>
          </div>
        ) : data?.readiness.isUnprofiled ? (
          <div className="nk-panel px-5 py-10 text-center">
            <h2 className="nk-title">We do not know your areas yet</h2>
            <p className="nk-sub mx-auto mt-2 max-w-md">
              This page matches calls against your research profile, your saved research areas and
              the papers you tag as your own. Fill in any one of them and your calls appear here.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/profile/researcher" className="nk-btn-primary nk-btn-sm">
                Complete my research profile
              </Link>
              <Link href="/profile/research-areas" className="nk-btn-secondary nk-btn-sm">
                Add research areas
              </Link>
            </div>
          </div>
        ) : (data?.calls.length ?? 0) === 0 ? (
          <div className="nk-panel px-5 py-10 text-center">
            <h2 className="nk-title">
              {status === 'expired'
                ? 'Nothing of yours has closed yet'
                : status === 'active'
                  ? 'No open calls match your areas right now'
                  : 'No calls match your areas yet'}
            </h2>
            <p className="nk-sub mx-auto mt-2 max-w-md">
              {status === 'active' && (counts?.expired ?? 0) > 0
                ? `${counts?.expired} closed call${counts?.expired === 1 ? '' : 's'} did match — worth a look to see what usually comes up in your field.`
                : 'New calls are matched as they are published, and you will be alerted. Adding research areas widens what we can match.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {status === 'active' && (counts?.expired ?? 0) > 0 ? (
                <button
                  type="button"
                  className="nk-btn-secondary nk-btn-sm"
                  onClick={() => setStatus('expired')}
                >
                  Show closed calls
                </button>
              ) : null}
              <Link href="/profile/research-areas" className="nk-btn-secondary nk-btn-sm">
                Add research areas
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {data?.calls.map((call) => {
                const closing = closingLabel(call)
                return (
                  <li key={call.id} className="nk-panel px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${TIER_STYLES[call.tier]}`}
                          >
                            {TIER_LABEL[call.tier]}
                          </span>
                          {call.alerted ? (
                            <span
                              className="nk-badge"
                              title="You were already alerted about this call"
                            >
                              already alerted
                            </span>
                          ) : null}
                          {call.isExpired ? <span className="nk-badge">closed</span> : null}
                        </div>
                        <Link
                          href={`/finder/calls/${call.id}`}
                          className="mt-1.5 block text-[15px] font-semibold text-cobalt-700 hover:underline"
                        >
                          {call.title || 'Untitled call'}
                        </Link>
                        <p className="nk-sub mt-0.5">{call.agencyName || 'Unknown funder'}</p>
                        {call.summary ? (
                          <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-nickel-700">
                            {call.summary}
                          </p>
                        ) : null}
                        <p className="nk-sub mt-2 text-[11.5px]">
                          Matched on: {sourceLabel(call)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[12.5px] ${closing.tone}`}>{closing.label}</p>
                        <Link
                          href={`/finder/calls/${call.id}`}
                          className="nk-btn-secondary nk-btn-xs mt-2"
                        >
                          Open call
                        </Link>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            <p className="nk-sub mt-4 text-[11.5px]">
              Ranked by how closely each call matches your work. A call matching more than one thing
              of yours is listed once, under its strongest match.
              {data?.readiness.callVectorsMissing
                ? ' Matching is running on your research areas and keywords — the call catalog has not been indexed for meaning-based matching yet, so some related calls may be missing.'
                : ''}
            </p>
          </>
        )}
      </div>
    </main>
  )
}
