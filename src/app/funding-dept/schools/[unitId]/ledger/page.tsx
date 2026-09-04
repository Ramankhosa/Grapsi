'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import ProgressChip from '@/components/funding-dept/ProgressChip'
import SummaryCards from '@/components/funding-dept/SummaryCards'
import { useAuth } from '@/lib/auth-context'
import type { ProgressCode } from '@/lib/fundingDept/accountabilityProgress'

interface Allocation {
  id: string
  assignee: { id: string; name: string | null; email: string | null }
  assignedBy: { id: string; name: string | null } | null
  status: string
  outcome: string
  deadlineAt: string | null
  progress: {
    code: ProgressCode
    label: string
    isLive: boolean
    stage: string | null
    lastActionAt: string | null
    daysSilent: number | null
    goneQuiet: boolean
    overdueUnchased: boolean
  }
  lastFollowUpAt: string | null
  lastFollowUpKind: string | null
  lastFollowUpNote: string | null
  followUpCount: number
  submittedAt: string | null
  submissionReference: string | null
}

interface LedgerCall {
  callId: string
  title: string | null
  agencyName: string | null
  closesAt: string | null
  daysSincePublished: number | null
  queueState: 'pending' | 'shortlisted' | 'assigned' | 'dismissed'
  triageStatus: string
  triageDecidedBy: string | null
  lastActionAt: string | null
  lastActorName: string | null
  isUntouched: boolean
  allocations: Allocation[]
}

interface LedgerData {
  school: { id: string; name: string; code: string | null; isUnmapped: boolean }
  window: { label: string; key: string }
  lens: 'officer' | 'head'
  counts: Record<string, number>
  attention: { goneQuiet: number; overdueUnchased: number; awaitingReply: number; submitted: number }
  calls: LedgerCall[]
  coveredBy: {
    name: string | null
    isMe: boolean
    deputyName: string | null
    isAway: boolean
    uncoveredRightNow: boolean
  } | null
}

const STATE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Needs somebody' },
  { key: 'assigned', label: 'Allocated' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'dismissed', label: 'Not relevant' },
] as const

const ATTENTION_FILTERS = [
  { key: 'quiet', label: 'Gone quiet' },
  { key: 'overdue', label: 'Past deadline' },
  { key: 'awaiting', label: 'Awaiting reply' },
  { key: 'untouched', label: 'Never looked at' },
] as const

function shortDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

function closesIn(value: string | null) {
  if (!value) return { label: 'Rolling', tone: 'text-nickel-500' }
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: `Closed ${Math.abs(days)}d ago`, tone: 'text-nickel-400' }
  if (days <= 14) return { label: `Closes in ${days}d`, tone: 'text-red-700 font-medium' }
  if (days <= 45) return { label: `Closes in ${days}d`, tone: 'text-amber-700' }
  return { label: shortDate(value), tone: 'text-nickel-600' }
}

export default function SchoolLedgerPage({ params }: { params: { unitId: string } }) {
  const { authFetch, isLoading: authLoading } = useAuth()

  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<string>('all')
  const [attention, setAttention] = useState<string | null>(null)

  useEffect(() => {
    // A flag chip on the accountability page links straight to the rows it counted.
    const params = new URLSearchParams(window.location.search)
    const filter = params.get('filter')
    if (filter && ATTENTION_FILTERS.some((option) => option.key === filter)) setAttention(filter)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(`/api/funding-dept/schools/${params.unitId}/ledger`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load this school.')
        return
      }
      setData(payload)
      setError(null)
    } finally {
      setLoading(false)
    }
  }, [authFetch, params.unitId])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  const calls = useMemo(() => {
    if (!data) return []
    return data.calls.filter((call) => {
      if (state !== 'all' && call.queueState !== state) return false
      if (!attention) return true
      if (attention === 'untouched') return call.isUntouched
      return call.allocations.some((allocation) => {
        if (attention === 'quiet') return allocation.progress.goneQuiet
        if (attention === 'overdue') return allocation.progress.code === 'OVERDUE'
        if (attention === 'awaiting') return allocation.progress.code === 'AWAITING_REPLY'
        return true
      })
    })
  }, [data, state, attention])

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <p className="nk-sub">Loading the call ledger…</p>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Call ledger</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">{error || 'Nothing to show.'}</p>
        </div>
      </main>
    )
  }

  const isOfficer = data.lens === 'officer'
  const stats = [
    {
      label: 'Needs somebody',
      value: data.counts.pending ?? 0,
      hint: `${data.counts.untouched ?? 0} never looked at`,
      tone: (data.counts.untouched ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
    },
    { label: 'Allocated', value: data.counts.assigned ?? 0, hint: 'someone is on it' },
    {
      label: 'Gone quiet',
      value: data.attention.goneQuiet,
      hint: 'no contact in a fortnight',
      tone: data.attention.goneQuiet > 0 ? ('warn' as const) : ('neutral' as const),
    },
    { label: 'Submitted', value: data.attention.submitted, hint: 'applications recorded' },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">{isOfficer ? 'Funding department' : 'My school'}</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            {data.school.name}
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            Every call this school could apply for, who is on it, and where each application has
            got to.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {data.coveredBy ? (
              <span className="nk-sub">
                Funding department contact:{' '}
                <span className="font-medium text-nickel-800">
                  {data.coveredBy.isMe ? 'you' : data.coveredBy.name}
                </span>
                {data.coveredBy.isAway && data.coveredBy.deputyName
                  ? ` (away — ${data.coveredBy.deputyName} is standing in)`
                  : ''}
              </span>
            ) : (
              <span className="nk-badge nk-badge-warn">No funding department contact</span>
            )}
            {data.coveredBy?.uncoveredRightNow ? (
              <span className="nk-badge nk-badge-danger">away with no stand-in</span>
            ) : null}
            {data.school.isUnmapped ? (
              <span className="nk-badge nk-badge-warn" title="Without disciplines this school sees the whole catalog">
                no disciplines mapped
              </span>
            ) : null}
            <span className="ml-auto flex gap-2">
              {isOfficer ? (
                <Link
                  href={`/funding-dept/schools/${data.school.id}`}
                  className="nk-btn-secondary nk-btn-xs"
                >
                  School desk
                </Link>
              ) : null}
              {/* A head reaching this through a manager grant is not department
                  staff, so the department view would 403 them. Their own
                  dashboard is the right destination. */}
              <Link
                href={isOfficer ? '/funding-dept/accountability' : '/school-head'}
                className="nk-btn-secondary nk-btn-xs"
              >
                {isOfficer ? 'Accountability' : 'My school'}
              </Link>
            </span>
          </div>
        </header>

        <SummaryCards stats={stats} />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {STATE_TABS.map((tab) => {
            const count = tab.key === 'all' ? data.counts.total : data.counts[tab.key]
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setState(tab.key)}
                className={state === tab.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
              >
                {tab.label}
                <span className="nk-mono ml-1.5 opacity-70">{count ?? 0}</span>
              </button>
            )
          })}
          <span className="ml-2 h-5 w-px bg-nickel-200" aria-hidden />
          {ATTENTION_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setAttention(attention === filter.key ? null : filter.key)}
              className={
                attention === filter.key ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        <section className="nk-panel mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  <th className="nk-eyebrow px-4 py-2.5 text-left">Call</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">Closes</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">State</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">Who is on it</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">Where it stands</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">Last contact</th>
                  <th className="nk-eyebrow px-4 py-2.5 text-left" />
                </tr>
              </thead>
              <tbody>
                {calls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <p className="nk-sub">Nothing matches that filter.</p>
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => {
                    const closing = closesIn(call.closesAt)
                    const rows = Math.max(1, call.allocations.length)
                    return call.allocations.length === 0 ? (
                      <tr key={call.callId} className="border-b border-nickel-100 last:border-0">
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={`/funding-dept/calls/${call.callId}?school=${data.school.id}`}
                            className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                          >
                            {call.title || 'Untitled call'}
                          </Link>
                          <p className="nk-sub mt-0.5">{call.agencyName || 'Unknown funder'}</p>
                        </td>
                        <td className={`px-3 py-3 align-top text-[12.5px] ${closing.tone}`}>
                          {closing.label}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span className="nk-badge">{call.queueState}</span>
                          {call.isUntouched ? (
                            <span
                              className="nk-badge nk-badge-warn ml-1.5"
                              title={`Published ${call.daysSincePublished} days ago and nobody has looked at it`}
                            >
                              never looked at
                            </span>
                          ) : null}
                        </td>
                        <td className="nk-sub px-3 py-3 align-top" colSpan={2}>
                          Nobody assigned
                        </td>
                        <td className="nk-sub px-3 py-3 align-top">
                          {call.lastActionAt ? (
                            <>
                              {shortDate(call.lastActionAt)}
                              {call.lastActorName ? (
                                <span className="block text-[11px] text-nickel-500">
                                  by {call.lastActorName}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            'never'
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={`/funding-dept/calls/${call.callId}?school=${data.school.id}`}
                            className="nk-btn-secondary nk-btn-xs"
                          >
                            {isOfficer ? 'Find people' : 'Open'}
                          </Link>
                        </td>
                      </tr>
                    ) : (
                      call.allocations.map((allocation, index) => (
                        <tr
                          key={allocation.id}
                          className={
                            index === call.allocations.length - 1
                              ? 'border-b border-nickel-100 last:border-0'
                              : ''
                          }
                        >
                          {index === 0 ? (
                            <>
                              <td className="px-4 py-3 align-top" rowSpan={rows}>
                                <Link
                                  href={`/funding-dept/calls/${call.callId}?school=${data.school.id}`}
                                  className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                                >
                                  {call.title || 'Untitled call'}
                                </Link>
                                <p className="nk-sub mt-0.5">{call.agencyName || 'Unknown funder'}</p>
                              </td>
                              <td
                                className={`px-3 py-3 align-top text-[12.5px] ${closing.tone}`}
                                rowSpan={rows}
                              >
                                {closing.label}
                              </td>
                              <td className="px-3 py-3 align-top" rowSpan={rows}>
                                <span className="nk-badge">{call.queueState}</span>
                              </td>
                            </>
                          ) : null}
                          <td className="px-3 py-3 align-top">
                            <p className="text-[13px] font-medium text-nickel-900">
                              {allocation.assignee.name || allocation.assignee.email}
                            </p>
                            {allocation.assignedBy?.name ? (
                              <p className="nk-sub text-[11px]">
                                sent by {allocation.assignedBy.name}
                              </p>
                            ) : null}
                            {allocation.deadlineAt ? (
                              <p className="nk-sub text-[11px]">
                                due {shortDate(allocation.deadlineAt)}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <ProgressChip
                              code={allocation.progress.code}
                              label={allocation.progress.label}
                              stage={allocation.progress.stage}
                              daysSilent={allocation.progress.daysSilent}
                              goneQuiet={allocation.progress.goneQuiet}
                              overdueUnchased={allocation.progress.overdueUnchased}
                            />
                            {allocation.submissionReference ? (
                              <p className="nk-sub mt-1 text-[11px]">
                                ref {allocation.submissionReference}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="nk-sub">
                              {allocation.lastFollowUpAt
                                ? `${shortDate(allocation.lastFollowUpAt)} · ${allocation.followUpCount} note${allocation.followUpCount === 1 ? '' : 's'}`
                                : 'never'}
                            </p>
                            {isOfficer && allocation.lastFollowUpNote ? (
                              <p
                                className="mt-0.5 max-w-[22ch] truncate text-[11.5px] text-nickel-600"
                                title={allocation.lastFollowUpNote}
                              >
                                {allocation.lastFollowUpNote}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Link
                              href={`/funding-dept/calls/${call.callId}?school=${data.school.id}`}
                              className="nk-btn-secondary nk-btn-xs"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {!isOfficer ? (
          <p className="nk-sub mt-3 text-[11.5px]">
            Contact dates and the stage of each application are shown. The funding department&rsquo;s
            own notes stay inside the department.
          </p>
        ) : null}
      </div>
    </main>
  )
}
