'use client'

/**
 * The calls nobody has taken up, named one by one.
 *
 * The grid next door already counts these. This is the list behind the count,
 * which is the difference between a head knowing somebody is behind and being
 * able to do something about it — so every row links to the work, and the sort is
 * by how soon doing nothing becomes permanent rather than by how long it has been
 * waiting. A call that has sat six weeks and closes in March is less urgent than
 * one that arrived last week and closes on Friday.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

interface BacklogCall {
  callId: string
  schoolId: string
  schoolName: string
  title: string | null
  agencyName: string | null
  enteredAt: string | null
  daysWaiting: number
  closesAt: string | null
  daysToClose: number | null
  relevance: { tier: string; reason: string | null }
  triageStatus: string
  shortlisted: number
  escalated: string[]
  officer: {
    memberId: string
    userId: string | null
    name: string | null
    isAway: boolean
    coveringName: string | null
    effectivelyUncovered: boolean
  } | null
}

interface BacklogData {
  untouchedDays: number
  calls: BacklogCall[]
  totals: { calls: number; schools: number; closingSoon: number; uncovered: number; oldestDays: number }
}

const TIER_LABEL: Record<string, string> = {
  exact: 'exact area',
  broad: 'related area',
  keyword: 'keyword',
  pinned: 'school says relevant',
  unclassified: 'not classified',
  none: 'no match',
}

const STAGE_LABEL: Record<string, string> = {
  OFFICER: 'officer told',
  HEAD: 'head told',
  ADMIN: 'admins told',
}

function shortDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Red once it is close enough that a week of silence loses the opportunity. */
function closingTone(days: number | null) {
  if (days === null) return 'nk-sub'
  if (days < 0) return 'text-nickel-500'
  if (days <= 14) return 'font-semibold text-red-700'
  if (days <= 30) return 'text-amber-700'
  return 'nk-sub'
}

export default function BacklogTab({ windowKey }: { windowKey: string }) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<BacklogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ window: windowKey, ...extra })
      if (includeClosed) params.set('includeClosed', 'true')
      return params.toString()
    },
    [windowKey, includeClosed]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authFetch(`/api/funding-dept/accountability/backlog?${query()}`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load the backlog.')
        return
      }
      setData(payload as BacklogData)
    } catch {
      setError('Could not load the backlog.')
    } finally {
      setLoading(false)
    }
  }, [authFetch, query])

  useEffect(() => {
    void load()
  }, [load])

  // authFetch, not a plain link: auth here is Bearer-only, so a download has to
  // go through fetch and be saved from the blob.
  const download = async () => {
    setDownloading(true)
    try {
      const response = await authFetch(
        `/api/funding-dept/accountability/backlog?${query({ format: 'csv' })}`
      )
      if (!response.ok) return
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `unallocated-calls-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <p className="nk-sub mt-6">Working out what is still waiting…</p>
  }
  if (error) {
    return <p className="nk-sub mt-6 text-red-700">{error}</p>
  }

  const calls = data?.calls ?? []

  return (
    <section className="nk-panel mt-6 overflow-hidden">
      <div className="nk-panel-head">
        <div>
          <h2 className="nk-title">Calls nobody has taken up</h2>
          <p className="nk-sub">
            Relevant to the school, open, nobody allocated, and nobody has logged a word about them
            for {data?.untouchedDays ?? 7} days or more. Soonest to close reads first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="nk-sub flex items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => setIncludeClosed(event.target.checked)}
            />
            Include calls that already closed
          </label>
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading || calls.length === 0}
            className="nk-btn-secondary nk-btn-sm"
          >
            {downloading ? 'Preparing…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {calls.length === 0 ? (
        <p className="nk-sub px-4 py-8 text-center">
          Nothing has been sitting unallocated past the threshold. Either every relevant call has
          somebody on it, or somebody has at least looked at it and said why not.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-nickel-200 bg-nickel-50 px-4 py-2.5">
            <span className="nk-sub text-[12px]">
              <span className="nk-mono font-semibold text-nickel-900">{data?.totals.calls}</span> in{' '}
              {data?.totals.schools} school{data?.totals.schools === 1 ? '' : 's'}
            </span>
            <span className="nk-sub text-[12px]">
              <span className="nk-mono font-semibold text-red-700">{data?.totals.closingSoon}</span>{' '}
              close within a fortnight
            </span>
            <span className="nk-sub text-[12px]">
              <span className="nk-mono font-semibold text-nickel-900">{data?.totals.oldestDays}</span>{' '}
              days is the longest wait
            </span>
            {(data?.totals.uncovered ?? 0) > 0 ? (
              <span className="nk-sub text-[12px] text-red-700">
                <span className="nk-mono font-semibold">{data?.totals.uncovered}</span> have nobody
                covering the school at all
              </span>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {['Call', 'School', 'Waiting', 'Closes', 'Why it matches', 'Covering officer', ''].map(
                    (heading, index) => (
                      <th
                        key={heading || index}
                        className={`nk-eyebrow px-4 py-2.5 ${index === 2 || index === 3 ? 'text-right' : 'text-left'}`}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr
                    key={`${call.callId}:${call.schoolId}`}
                    className="border-b border-nickel-100 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/funding-dept/calls/${call.callId}?school=${call.schoolId}`}
                        className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                      >
                        {call.title || 'Untitled call'}
                      </Link>
                      <p className="nk-sub text-[11.5px]">{call.agencyName || 'Agency not recorded'}</p>
                      {call.shortlisted > 0 ? (
                        <p className="text-[11.5px] text-amber-700">
                          {call.shortlisted} shortlisted, nobody assigned
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/funding-dept/schools/${call.schoolId}/ledger`}
                        className="text-[13px] text-cobalt-700 hover:underline"
                      >
                        {call.schoolName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="nk-mono font-semibold text-nickel-900">{call.daysWaiting}</span>
                      <span className="nk-sub text-[11.5px]"> days</span>
                      <p className="nk-sub text-[11px]">since {shortDate(call.enteredAt)}</p>
                    </td>
                    <td className={`px-4 py-3 text-right text-[13px] ${closingTone(call.daysToClose)}`}>
                      {call.closesAt ? shortDate(call.closesAt) : 'no date'}
                      {call.daysToClose !== null ? (
                        <p className="text-[11px]">
                          {call.daysToClose < 0
                            ? `closed ${Math.abs(call.daysToClose)}d ago`
                            : `${call.daysToClose}d left`}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="nk-badge">{TIER_LABEL[call.relevance.tier] || call.relevance.tier}</span>
                      {call.relevance.reason ? (
                        <p className="nk-sub mt-1 text-[11.5px]">{call.relevance.reason}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {call.officer ? (
                        <>
                          <p className="text-[13px] text-nickel-900">{call.officer.name || '—'}</p>
                          {call.officer.isAway ? (
                            <p className="nk-sub text-[11.5px]">
                              on leave
                              {call.officer.coveringName
                                ? ` — ${call.officer.coveringName} standing in`
                                : ', nobody standing in'}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className="nk-badge nk-badge-danger">nobody covers this school</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {call.escalated.length > 0 ? (
                        <span className="nk-badge" title="How far up this has already been raised">
                          {STAGE_LABEL[call.escalated[call.escalated.length - 1]] ||
                            call.escalated[call.escalated.length - 1]}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
