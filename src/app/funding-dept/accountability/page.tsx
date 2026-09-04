'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'

import FlagChips from '@/components/funding-dept/FlagChips'
import SummaryCards from '@/components/funding-dept/SummaryCards'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import type { AccountabilityFlag } from '@/lib/fundingDept/accountabilityFlags'

interface Buckets {
  awaitingReply: number
  inHand: number
  drafting: number
  overdue: number
  submitted: number
  awarded: number
  rejected: number
  declined: number
  cancelled: number
  goneQuiet: number
  overdueUnchased: number
}

interface SchoolRow {
  schoolId: string
  name: string
  code: string | null
  role: 'primary' | 'deputy'
  isUnmapped: boolean
  relevantOpen: number
  pending: number
  untouchedPending: number
  shortlisted: number
  assignedCalls: number
  buckets: Buckets
  live: number
  followUpsInWindow: number
  callsCirculatedInWindow: number
  dueNudges: number
  lastActionAt: string | null
  lastActorName: string | null
  flags: AccountabilityFlag[]
  score: number
}

interface MemberRow {
  id: string
  userId: string
  name: string | null
  email: string | null
  isHead: boolean
  isAway: boolean
  title: string | null
  awayUntil: string | null
  schoolCount: number
  deputyCount: number
  totals: {
    relevantOpen: number
    pending: number
    untouchedPending: number
    allocated: number
    live: number
    buckets: Buckets
    followUpsInWindow: number
    callsCirculatedInWindow: number
    submittedInWindow: number
    dueNudges: number
  }
  lastActionAt: string | null
  flags: AccountabilityFlag[]
  score: number
  schools: SchoolRow[]
}

interface MatrixData {
  window: { start: string; end: string; label: string; key: string }
  lens: 'department' | 'member'
  members: MemberRow[]
  uncovered: Array<{
    schoolId: string
    name: string
    pending: number
    untouchedPending: number
    live: number
    isUnmapped: boolean
    lastContactAt: string | null
    flags: AccountabilityFlag[]
  }>
  totals: {
    members: number
    schools: number
    uncovered: number
    pending: number
    untouchedPending: number
    live: number
    goneQuiet: number
    overdueUnchased: number
    submittedInWindow: number
    flaggedMembers: number
  }
}

const WINDOWS = [
  { key: 'reporting', label: 'Period of consideration' },
  { key: '90d', label: 'Last 90 days' },
  { key: '30d', label: 'Last 30 days' },
]

function shortDate(value: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function daysAgo(value: string | null) {
  if (!value) return null
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000)
}

export default function AccountabilityPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [data, setData] = useState<MatrixData | null>(null)
  const [windowKey, setWindowKey] = useState('reporting')
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = useCallback(
    async (key: string) => {
      setLoading(true)
      try {
        const response = await authFetch(`/api/funding-dept/accountability?window=${key}`)
        if (!response.ok) {
          // Anything the server refuses lands on the explanation screen. An
          // expired session used to fall through to the empty table, which read
          // as "the department has no members" — a wrong and alarming answer to
          // "why is this blank".
          setDenied(true)
          setError(
            response.status === 401
              ? 'Your session has expired. Sign in again to see this.'
              : null
          )
          return
        }
        {
          const payload = (await response.json()) as MatrixData
          setData(payload)
          setDenied(false)
          setError(null)
          // A member looking at their own row wants it open; a head reading a
          // ranked list wants the summary first.
          if (payload.lens === 'member' && payload.members[0]) {
            setExpanded({ [payload.members[0].id]: true })
          }
        }
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading || meLoading) return
    void load(windowKey)
  }, [authLoading, meLoading, windowKey, load])

  if (authLoading || meLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <p className="nk-sub">Loading the accountability view…</p>
        </div>
      </main>
    )
  }

  if (denied) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Accountability</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">
            {error ||
              'This view is for the funding department. If you head a school, your own dashboard is under My School.'}
          </p>
          <Link href="/school-head" className="nk-btn-secondary nk-btn-sm mt-4">
            Go to My School
          </Link>
        </div>
      </main>
    )
  }

  const isDeptLens = data?.lens === 'department'
  const totals = data?.totals

  const stats = [
    {
      label: 'Needs somebody',
      value: totals?.pending ?? 0,
      hint: `${totals?.untouchedPending ?? 0} untouched for a week or more`,
      tone: (totals?.untouchedPending ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Gone quiet',
      value: totals?.goneQuiet ?? 0,
      hint: 'live, no contact in a fortnight',
      tone: (totals?.goneQuiet ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Past deadline',
      value: totals?.overdueUnchased ?? 0,
      hint: 'and nothing logged since',
      tone: (totals?.overdueUnchased ?? 0) > 0 ? ('danger' as const) : ('neutral' as const),
    },
    {
      label: 'Submitted',
      value: totals?.submittedInWindow ?? 0,
      hint: data?.window.label ? `in ${data.window.label}` : 'this period',
    },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            {isDeptLens ? 'Accountability' : 'My schools'}
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            {isDeptLens
              ? 'Every member, the schools they answer for, and what is happening in each. Sorted so the work that has waited longest reads first.'
              : 'The schools you cover, what is waiting in each, and where every allocation has got to.'}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="nk-eyebrow">Activity counted over</span>
            {WINDOWS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setWindowKey(option.key)}
                className={
                  windowKey === option.key
                    ? 'nk-btn-primary nk-btn-xs'
                    : 'nk-btn-secondary nk-btn-xs'
                }
              >
                {option.key === 'reporting' && data?.window.label
                  ? data.window.label
                  : option.label}
              </button>
            ))}
            {isDeptLens ? (
              <Link href="/funding-dept/overview" className="nk-btn-secondary nk-btn-xs ml-auto">
                Coverage &amp; membership
              </Link>
            ) : null}
          </div>
          <p className="nk-sub mt-2 text-[11.5px]">
            Pendency and allocations are as they stand right now. Only recorded activity — notes,
            calls circulated, submissions — is counted inside the window.
          </p>
        </header>

        <SummaryCards stats={stats} />

        <section className="nk-panel mt-6 overflow-hidden">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">{isDeptLens ? 'By member' : 'My record'}</h2>
              <p className="nk-sub">
                Open a row to see it school by school. A school covered as deputy is shown under
                both officers, and every note counts for whoever wrote it.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  <th className="nk-eyebrow px-4 py-2.5 text-left">Member</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Schools</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Relevant</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Needs somebody</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Live</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Awaiting</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Overdue</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Submitted</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-right">Notes</th>
                  <th className="nk-eyebrow px-3 py-2.5 text-left">Last action</th>
                  <th className="nk-eyebrow px-4 py-2.5 text-left">Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {(data?.members.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center">
                      <p className="nk-sub">
                        No department members yet. An organization admin staffs the department from
                        Manage membership.
                      </p>
                    </td>
                  </tr>
                ) : (
                  data?.members.map((member) => {
                    const isOpen = expanded[member.id]
                    const silence = daysAgo(member.lastActionAt)
                    return (
                      <Fragment key={member.id}>
                        <tr
                          className={`border-b border-nickel-100 ${isOpen ? 'bg-nickel-50/60' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="text-left"
                              onClick={() =>
                                setExpanded((current) => ({
                                  ...current,
                                  [member.id]: !current[member.id],
                                }))
                              }
                            >
                              <span className="flex items-center gap-2">
                                <span className="nk-mono text-[11px] text-nickel-400">
                                  {isOpen ? '−' : '+'}
                                </span>
                                <span className="text-[13.5px] font-medium text-nickel-900">
                                  {member.name || member.email}
                                </span>
                                {member.isHead ? (
                                  <span className="nk-badge nk-badge-live">head</span>
                                ) : null}
                                {member.isAway ? (
                                  <span
                                    className="nk-badge nk-badge-warn"
                                    title={
                                      member.awayUntil
                                        ? `Away until ${shortDate(member.awayUntil)}`
                                        : 'Away, no return date set'
                                    }
                                  >
                                    away
                                  </span>
                                ) : null}
                              </span>
                              {member.title ? <p className="nk-sub mt-0.5">{member.title}</p> : null}
                            </button>
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                            {member.schoolCount}
                            {member.deputyCount > 0 ? (
                              <span className="nk-sub"> +{member.deputyCount}d</span>
                            ) : null}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-600">
                            {member.totals.relevantOpen}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right">
                            {member.totals.pending > 0 ? (
                              <span className="font-medium text-cobalt-700">
                                {member.totals.pending}
                              </span>
                            ) : (
                              <span className="nk-sub">0</span>
                            )}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-900">
                            {member.totals.live}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                            {member.totals.buckets.awaitingReply}
                          </td>
                          <td
                            className={`nk-mono px-3 py-3 text-right ${
                              member.totals.buckets.overdue > 0
                                ? 'font-semibold text-red-700'
                                : 'text-nickel-700'
                            }`}
                          >
                            {member.totals.buckets.overdue}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                            {member.totals.buckets.submitted}
                          </td>
                          <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                            {member.totals.followUpsInWindow}
                          </td>
                          <td className="nk-sub px-3 py-3">
                            {member.lastActionAt ? (
                              <span className={silence !== null && silence > 14 ? 'text-amber-700' : ''}>
                                {shortDate(member.lastActionAt)}
                                {silence !== null ? ` · ${silence}d ago` : ''}
                              </span>
                            ) : (
                              'never'
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <FlagChips flags={member.flags} />
                          </td>
                        </tr>

                        {isOpen
                          ? member.schools.map((school) => (
                              <tr
                                key={`${member.id}:${school.schoolId}:${school.role}`}
                                className="border-b border-nickel-100 bg-white/60"
                              >
                                <td className="py-2.5 pl-10 pr-4">
                                  <Link
                                    href={`/funding-dept/schools/${school.schoolId}/ledger`}
                                    className="text-[13px] font-medium text-cobalt-700 hover:underline"
                                  >
                                    {school.name}
                                  </Link>
                                  {school.role === 'deputy' ? (
                                    <span className="nk-badge ml-2">deputy</span>
                                  ) : null}
                                  {school.isUnmapped ? (
                                    <span className="nk-badge nk-badge-warn ml-2">unmapped</span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2.5" />
                                <td className="nk-mono px-3 py-2.5 text-right text-nickel-600">
                                  {school.relevantOpen}
                                </td>
                                <td className="nk-mono px-3 py-2.5 text-right">
                                  {school.pending > 0 ? (
                                    <Link
                                      href={`/funding-dept/queue?orgUnitId=${school.schoolId}&state=pending`}
                                      className="font-medium text-cobalt-700 hover:underline"
                                    >
                                      {school.pending}
                                    </Link>
                                  ) : (
                                    <span className="nk-sub">0</span>
                                  )}
                                </td>
                                <td className="nk-mono px-3 py-2.5 text-right text-nickel-800">
                                  {school.live}
                                </td>
                                <td className="nk-mono px-3 py-2.5 text-right text-nickel-700">
                                  {school.buckets.awaitingReply}
                                </td>
                                <td
                                  className={`nk-mono px-3 py-2.5 text-right ${
                                    school.buckets.overdue > 0 ? 'text-red-700' : 'text-nickel-700'
                                  }`}
                                >
                                  {school.buckets.overdue}
                                </td>
                                <td className="nk-mono px-3 py-2.5 text-right text-nickel-700">
                                  {school.buckets.submitted}
                                </td>
                                <td className="nk-mono px-3 py-2.5 text-right text-nickel-700">
                                  {school.followUpsInWindow}
                                </td>
                                <td className="nk-sub px-3 py-2.5">
                                  {shortDate(school.lastActionAt)}
                                  {school.lastActorName ? (
                                    <span className="block text-[11px] text-nickel-500">
                                      by {school.lastActorName}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-4 py-2.5">
                                  <FlagChips
                                    flags={school.flags}
                                    hrefFor={(flag) =>
                                      flag.code === 'UNTOUCHED_PENDING'
                                        ? `/funding-dept/queue?orgUnitId=${school.schoolId}&state=pending`
                                        : flag.code === 'SILENT_LIVE' ||
                                            flag.code === 'OVERDUE_UNCHASED'
                                          ? `/funding-dept/schools/${school.schoolId}/ledger?filter=${
                                              flag.code === 'SILENT_LIVE' ? 'quiet' : 'overdue'
                                            }`
                                          : null
                                    }
                                  />
                                </td>
                              </tr>
                            ))
                          : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(data?.uncovered.length ?? 0) > 0 ? (
          <section className="nk-panel mt-6 overflow-hidden">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Schools nobody covers</h2>
                <p className="nk-sub">
                  These belong to no member, so nothing above accounts for them.
                </p>
              </div>
              <Link href="/funding-dept/overview" className="nk-btn-secondary nk-btn-sm">
                Assign coverage
              </Link>
            </div>
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {['School', 'Needs somebody', 'Untouched', 'Live', 'Last contact', ''].map(
                    (heading, index) => (
                      <th
                        key={heading || index}
                        className={`nk-eyebrow px-4 py-2.5 ${index === 0 || index > 3 ? 'text-left' : 'text-right'}`}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data?.uncovered.map((school) => (
                  <tr key={school.schoolId} className="border-b border-nickel-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/funding-dept/schools/${school.schoolId}/ledger`}
                        className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                      >
                        {school.name}
                      </Link>
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">{school.pending}</td>
                    <td className="nk-mono px-4 py-3 text-right text-amber-700">
                      {school.untouchedPending}
                    </td>
                    <td className="nk-mono px-4 py-3 text-right">{school.live}</td>
                    <td className="nk-sub px-4 py-3">{shortDate(school.lastContactAt)}</td>
                    <td className="px-4 py-3">
                      <FlagChips flags={school.flags} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </main>
  )
}
