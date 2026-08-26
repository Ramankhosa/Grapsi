'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'

/**
 * The call funnel: every call the department can act on, with its
 * matched → assigned → accepted → submitted → awarded counts, and a per-call
 * drill-in showing exactly who was alerted and who was put on it.
 */

interface FunnelCall {
  id: string
  title: string
  agency: string | null
  closeDate: string | null
  visibility: string
  isDraft: boolean
  isClosed: boolean
  matched: {
    count: number
    emailsSent: number
    emailsQueued: number
    emailsFailed: number
    lastAlertAt: string | null
  }
  assignments: {
    total: number
    active: number
    accepted: number
    declined: number
    submitted: number
    awarded: number
    awardAmount: number
    schools: number
  }
}

interface MatchedPerson {
  id: string
  userId: string
  name: string
  email: string
  school: string | null
  tier: string | null
  score: number | null
  emailStatus: string
  emailError: string | null
  assigned: boolean
}

interface DrillAssignment {
  id: string
  status: string
  deadlineAt: string | null
  submittedAt: string | null
  outcome: string
  awardAmount: number | null
  assignee: { id: string; name: string | null; email: string } | null
  assignedBy: { id: string; name: string | null; email: string } | null
}

interface DrillIn {
  matched: MatchedPerson[]
  assignments: DrillAssignment[]
}

const STATES = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'unassigned', label: 'Open, unassigned' },
  { key: 'draft', label: 'Drafts' },
  { key: 'closed', label: 'Closed' },
] as const

const PAGE_SIZE = 50

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DeptCallFunnelPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [calls, setCalls] = useState<FunnelCall[]>([])
  const [counts, setCounts] = useState({ all: 0, drafts: 0, unassignedOpen: 0 })
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<(typeof STATES)[number]['key']>('open')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [openCallId, setOpenCallId] = useState<string | null>(null)
  const [drill, setDrill] = useState<Record<string, DrillIn | 'loading'>>({})
  const [publishingId, setPublishingId] = useState<string | null>(null)

  const canReview = me.isHead || me.canAdminister

  const load = useCallback(
    async (nextOffset: number, nextState: string, query: string) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          state: nextState,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (query) params.set('q', query)
        const response = await authFetch(`/api/funding-dept/calls?${params.toString()}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to load the call funnel')
        setCalls(data.calls || [])
        setCounts(data.counts || { all: 0, drafts: 0, unassignedOpen: 0 })
        setTotal(data.total || 0)
        setOffset(nextOffset)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load the call funnel')
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading || meLoading || !canReview) return
    void load(0, state, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading, canReview])

  const switchState = (next: (typeof STATES)[number]['key']) => {
    setState(next)
    setOpenCallId(null)
    void load(0, next, search)
  }

  const toggleDrill = async (callId: string) => {
    if (openCallId === callId) {
      setOpenCallId(null)
      return
    }
    setOpenCallId(callId)
    if (drill[callId] && drill[callId] !== 'loading') return
    setDrill((current) => ({ ...current, [callId]: 'loading' }))
    try {
      const response = await authFetch(`/api/funding-dept/calls/${callId}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load call detail')
      setDrill((current) => ({
        ...current,
        [callId]: { matched: data.matched || [], assignments: data.assignments || [] },
      }))
    } catch {
      setDrill((current) => {
        const next = { ...current }
        delete next[callId]
        return next
      })
      setOpenCallId(null)
    }
  }

  const publishCall = async (callId: string) => {
    setPublishingId(callId)
    setError(null)
    try {
      const response = await authFetch(`/api/funding/calls/${callId}/publish`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        const missing: string[] = data.requiredFieldsRemaining || []
        throw new Error(
          missing.length > 0 ? `${data.error} Missing: ${missing.join(', ')}` : data.error || 'Publish failed'
        )
      }
      await load(offset, state, search)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Publish failed')
    } finally {
      setPublishingId(null)
    }
  }

  if (authLoading || meLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!canReview) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Call funnel</h1>
          <p className="nk-sub mt-2">
            This view is available to administrators and the funding department head.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-5">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Call funnel
          </h1>
          <p className="nk-sub mt-1">
            Every call, with who it reached and where it stands — {counts.unassignedOpen} open call
            {counts.unassignedOpen === 1 ? '' : 's'} still ha{counts.unassignedOpen === 1 ? 's' : 've'} nobody
            assigned.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={entry.key === state ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
              onClick={() => switchState(entry.key)}
            >
              {entry.label}
              {entry.key === 'draft' && counts.drafts > 0 ? ` (${counts.drafts})` : ''}
              {entry.key === 'unassigned' && counts.unassignedOpen > 0 ? ` (${counts.unassignedOpen})` : ''}
            </button>
          ))}
          <input
            className="nk-input ml-auto max-w-xs"
            placeholder="Search calls or agencies"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(0, state, search)
            }}
          />
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => void load(0, state, search)}>
            Search
          </button>
        </div>

        {error ? (
          <div className="nk-panel-quiet mb-4 px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        ) : null}

        <div className="nk-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {['Call', 'Deadline', 'State', 'Matched', 'Assigned', 'Submitted', 'Awarded', ''].map(
                    (heading, index) => (
                      <th key={index} className="nk-eyebrow px-4 py-2.5 text-left">
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center">
                      <p className="nk-sub">Loading calls…</p>
                    </td>
                  </tr>
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center">
                      <p className="nk-sub">No calls in this view.</p>
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => {
                    const expanded = openCallId === call.id
                    const detail = drill[call.id]
                    return (
                      <Fragment key={call.id}>
                        <tr
                          className="cursor-pointer border-b border-nickel-100 last:border-0 hover:bg-nickel-50/60"
                          onClick={() => void toggleDrill(call.id)}
                        >
                          <td className="max-w-md px-4 py-3">
                            <p className="text-[13.5px] font-medium text-nickel-900">{call.title}</p>
                            <p className="nk-sub mt-0.5">{call.agency || '—'}</p>
                          </td>
                          <td className="nk-sub px-4 py-3 whitespace-nowrap">{formatDate(call.closeDate)}</td>
                          <td className="px-4 py-3">
                            {call.isDraft ? (
                              <span className="nk-badge nk-badge-warn">draft</span>
                            ) : call.isClosed ? (
                              <span className="nk-badge">closed</span>
                            ) : (
                              <span className="nk-badge nk-badge-ok">open</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[13.5px] text-nickel-900">{call.matched.count}</p>
                            {call.matched.emailsFailed > 0 ? (
                              <p className="text-[11.5px] text-red-700">
                                {call.matched.emailsFailed} email{call.matched.emailsFailed === 1 ? '' : 's'} failed
                              </p>
                            ) : call.matched.emailsQueued > 0 ? (
                              <p className="nk-sub text-[11.5px]">{call.matched.emailsQueued} in digest</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[13.5px] text-nickel-900">
                              {call.assignments.total}
                              {call.assignments.declined > 0 ? (
                                <span className="nk-sub"> ({call.assignments.declined} declined)</span>
                              ) : null}
                            </p>
                            {call.assignments.schools > 1 ? (
                              <p className="nk-sub text-[11.5px]">{call.assignments.schools} schools</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-[13.5px] text-nickel-900">{call.assignments.submitted}</td>
                          <td className="px-4 py-3">
                            <p className="text-[13.5px] text-nickel-900">{call.assignments.awarded}</p>
                            {call.assignments.awardAmount > 0 ? (
                              <p className="nk-sub text-[11.5px]">
                                ₹{new Intl.NumberFormat('en-IN').format(Math.round(call.assignments.awardAmount))}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                              {call.isDraft ? (
                                <button
                                  type="button"
                                  className="nk-btn-primary nk-btn-sm"
                                  disabled={publishingId === call.id}
                                  onClick={() => void publishCall(call.id)}
                                >
                                  {publishingId === call.id ? 'Publishing…' : 'Publish'}
                                </button>
                              ) : (
                                <Link
                                  href={`/researcher-matching?callId=${encodeURIComponent(call.id)}`}
                                  className="nk-btn-secondary nk-btn-sm"
                                >
                                  Find faculty
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr key={`${call.id}-detail`} className="border-b border-nickel-100 bg-nickel-50/40">
                            <td colSpan={8} className="px-6 py-4">
                              {detail === 'loading' || !detail ? (
                                <p className="nk-sub">Loading detail…</p>
                              ) : (
                                <div className="grid gap-6 lg:grid-cols-2">
                                  <div>
                                    <p className="nk-eyebrow mb-2">
                                      Matched by alerts ({detail.matched.length})
                                    </p>
                                    {detail.matched.length === 0 ? (
                                      <p className="nk-sub">
                                        Nobody has been alerted for this call yet
                                        {call.isDraft ? ' — publish it to alert matched faculty.' : '.'}
                                      </p>
                                    ) : (
                                      <ul className="space-y-1.5">
                                        {detail.matched.map((person) => (
                                          <li key={person.id} className="flex flex-wrap items-center gap-2">
                                            <span className="text-[13px] font-medium text-nickel-900">
                                              {person.name}
                                            </span>
                                            {person.school ? (
                                              <span className="nk-sub text-[12px]">{person.school}</span>
                                            ) : null}
                                            {person.tier ? (
                                              <span className="nk-badge normal-case tracking-normal">
                                                {person.tier}
                                              </span>
                                            ) : null}
                                            {person.emailStatus === 'failed' ? (
                                              <span
                                                className="nk-badge nk-badge-warn"
                                                title={person.emailError || 'Email failed'}
                                              >
                                                email failed
                                              </span>
                                            ) : null}
                                            {person.assigned ? (
                                              <span className="nk-badge nk-badge-ok">assigned</span>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <div>
                                    <p className="nk-eyebrow mb-2">
                                      Assignments ({detail.assignments.length})
                                    </p>
                                    {detail.assignments.length === 0 ? (
                                      <p className="nk-sub">No one has been assigned to this call.</p>
                                    ) : (
                                      <ul className="space-y-1.5">
                                        {detail.assignments.map((assignment) => (
                                          <li key={assignment.id} className="flex flex-wrap items-center gap-2">
                                            <span className="text-[13px] font-medium text-nickel-900">
                                              {assignment.assignee?.name || assignment.assignee?.email || 'Unknown'}
                                            </span>
                                            <span className="nk-badge normal-case tracking-normal">
                                              {assignment.status.toLowerCase().replace(/_/g, ' ')}
                                            </span>
                                            {assignment.submittedAt ? (
                                              <span className="nk-badge nk-badge-ok">submitted</span>
                                            ) : null}
                                            {assignment.outcome === 'AWARDED' ? (
                                              <span className="nk-badge nk-badge-ok">awarded</span>
                                            ) : null}
                                            {assignment.deadlineAt ? (
                                              <span className="nk-sub text-[12px]">
                                                due {formatDate(assignment.deadlineAt)}
                                              </span>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-nickel-200 px-4 py-3">
              <p className="nk-sub">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={offset === 0}
                  onClick={() => void load(Math.max(offset - PAGE_SIZE, 0), state, search)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="nk-btn-secondary nk-btn-sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => void load(offset + PAGE_SIZE, state, search)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
