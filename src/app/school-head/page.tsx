'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import SummaryCards from '@/components/funding-dept/SummaryCards'
import { useAuth } from '@/lib/auth-context'

interface FacultyRow {
  userId: string
  name: string
  email: string | null
  department: string | null
  assigned: number
  awaitingReply: number
  inHand: number
  overdue: number
  submitted: number
  awarded: number
  declined: number
  medianResponseDays: number | null
  lastResponseAt: string | null
}

interface Section {
  unit: {
    id: string
    name: string
    code: string | null
    depth: number
    title: string | null
    scope: 'SUBTREE' | 'UNIT_ONLY'
  }
  schoolRootId: string
  funnel: {
    relevantOpen: number
    pending: number
    untouchedPending: number
    shortlisted: number
    assignedCalls: number
    isUnmapped: boolean
    lastContactAt: string | null
  } | null
  summary: {
    active: number
    submitted: number
    missed: number
    declined: number
    awarded: number
    total: number
    awardedAmount: number
    successRate: number | null
  }
  faculty: FacultyRow[]
  dsrContact: {
    name: string | null
    deputyName: string | null
    covered: boolean
    isAway: boolean
    uncoveredRightNow: boolean
  } | null
}

interface OverviewData {
  window: { label: string; key: string }
  sections: Section[]
}

const WINDOWS = [
  { key: 'reporting', label: 'Period of consideration' },
  { key: '90d', label: 'Last 90 days' },
  { key: '30d', label: 'Last 30 days' },
]

function shortDate(value: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function SchoolHeadPage() {
  const { authFetch, isLoading: authLoading } = useAuth()

  const [data, setData] = useState<OverviewData | null>(null)
  const [windowKey, setWindowKey] = useState('reporting')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (key: string) => {
      setLoading(true)
      try {
        const response = await authFetch(`/api/school-head/overview?window=${key}`)
        const payload = await response.json()
        if (!response.ok) {
          setError(payload.error || 'Could not load your school.')
          return
        }
        setData(payload)
        setError(null)
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading) return
    void load(windowKey)
  }, [authLoading, windowKey, load])

  if (authLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading your school…</p>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">My school</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">
            {error || 'Nothing to show.'} This dashboard is for a Dean or Head of Department. An
            organization admin appoints heads from Faculty &amp; Organization.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">My school</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Research funding in {data.sections.length === 1 ? data.sections[0].unit.name : 'my units'}
          </h1>
          <p className="nk-sub mt-1 max-w-2xl">
            What funding has reached your faculty, who is sitting on it, and who to talk to when
            nothing is moving.
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
                  windowKey === option.key ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'
                }
              >
                {option.key === 'reporting' && data.window.label ? data.window.label : option.label}
              </button>
            ))}
          </div>
        </header>

        {data.sections.map((section) => {
          const stats = [
            {
              label: 'Open to us',
              value: section.funnel?.relevantOpen ?? 0,
              hint: 'calls matching our disciplines',
            },
            {
              label: 'Nobody on it',
              value: section.funnel?.pending ?? 0,
              hint: `${section.funnel?.untouchedPending ?? 0} untouched for a week or more`,
              tone:
                (section.funnel?.untouchedPending ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
            },
            {
              label: 'With our faculty',
              value: section.summary.active,
              hint: 'accepted or awaiting reply',
            },
            {
              label: 'Overdue',
              value: section.summary.missed,
              hint: 'past the internal deadline',
              tone: section.summary.missed > 0 ? ('danger' as const) : ('neutral' as const),
            },
          ]

          return (
            <section key={section.unit.id} className="mb-10">
              {data.sections.length > 1 ? (
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="nk-title text-[17px]">{section.unit.name}</h2>
                  {section.unit.title ? (
                    <span className="nk-badge">{section.unit.title}</span>
                  ) : null}
                  {section.unit.scope === 'UNIT_ONLY' ? (
                    <span className="nk-badge" title="Your authority covers this unit only">
                      this unit only
                    </span>
                  ) : null}
                </div>
              ) : null}

              <SummaryCards stats={stats} />

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="nk-panel px-5 py-4">
                  <h3 className="nk-eyebrow">Your funding department contact</h3>
                  {section.dsrContact?.covered ? (
                    <>
                      <p className="mt-2 text-[14px] font-medium text-nickel-900">
                        {section.dsrContact.name}
                      </p>
                      {section.dsrContact.isAway ? (
                        <p className="nk-sub mt-1">
                          Away right now.{' '}
                          {section.dsrContact.deputyName
                            ? `${section.dsrContact.deputyName} is standing in.`
                            : 'No stand-in has been named.'}
                        </p>
                      ) : null}
                      <p className="nk-sub mt-1">
                        Last contact recorded {shortDate(section.funnel?.lastContactAt ?? null)}
                      </p>
                    </>
                  ) : (
                    <p className="nk-sub mt-2">
                      No funding department officer covers this school. Ask the department head to
                      assign one.
                    </p>
                  )}
                </div>

                <div className="nk-panel px-5 py-4">
                  <h3 className="nk-eyebrow">Submitted</h3>
                  <p className="nk-readout mt-3">{section.summary.submitted}</p>
                  <p className="nk-sub mt-1.5">
                    {section.summary.awarded} awarded
                    {section.summary.awardedAmount > 0
                      ? ` · ₹${section.summary.awardedAmount.toLocaleString('en-IN')}`
                      : ''}
                    {section.summary.successRate !== null
                      ? ` · ${section.summary.successRate}% success`
                      : ''}
                  </p>
                </div>

                <div className="nk-panel px-5 py-4">
                  <h3 className="nk-eyebrow">Declined by our faculty</h3>
                  <p className="nk-readout mt-3">{section.summary.declined}</p>
                  <p className="nk-sub mt-1.5">
                    Calls our people were asked about and turned down.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/funding-dept/schools/${section.unit.id}/ledger`}
                  className="nk-btn-primary nk-btn-sm"
                >
                  See every call and where it stands
                </Link>
                <Link href="/assignments" className="nk-btn-secondary nk-btn-sm">
                  Assignments I manage
                </Link>
                <Link href="/tenant-admin/grant-dashboard" className="nk-btn-secondary nk-btn-sm">
                  Reports &amp; CSV
                </Link>
              </div>

              <div className="nk-panel mt-5 overflow-hidden">
                <div className="nk-panel-head">
                  <div>
                    <h3 className="nk-title">How our faculty are responding</h3>
                    <p className="nk-sub">
                      Worst first: unanswered requests, then work past its deadline. A request is
                      only counted as unanswered after three days.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-nickel-200 bg-nickel-50">
                        <th className="nk-eyebrow px-4 py-2.5 text-left">Faculty member</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-left">Department</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">Sent</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">No reply</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">In hand</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">Overdue</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">Submitted</th>
                        <th className="nk-eyebrow px-3 py-2.5 text-right">Declined</th>
                        <th className="nk-eyebrow px-4 py-2.5 text-right">Typical reply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.faculty.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center">
                            <p className="nk-sub">
                              Nothing has been sent to this school in the selected period.
                            </p>
                          </td>
                        </tr>
                      ) : (
                        section.faculty.map((row) => (
                          <tr key={row.userId} className="border-b border-nickel-100 last:border-0">
                            <td className="px-4 py-3">
                              <p className="text-[13.5px] font-medium text-nickel-900">{row.name}</p>
                              {row.email ? <p className="nk-sub text-[11px]">{row.email}</p> : null}
                            </td>
                            <td className="nk-sub px-3 py-3">{row.department || '—'}</td>
                            <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                              {row.assigned}
                            </td>
                            <td
                              className={`nk-mono px-3 py-3 text-right ${
                                row.awaitingReply > 0 ? 'font-semibold text-amber-700' : 'text-nickel-700'
                              }`}
                            >
                              {row.awaitingReply}
                            </td>
                            <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                              {row.inHand}
                            </td>
                            <td
                              className={`nk-mono px-3 py-3 text-right ${
                                row.overdue > 0 ? 'font-semibold text-red-700' : 'text-nickel-700'
                              }`}
                            >
                              {row.overdue}
                            </td>
                            <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                              {row.submitted}
                            </td>
                            <td className="nk-mono px-3 py-3 text-right text-nickel-700">
                              {row.declined}
                            </td>
                            <td className="nk-mono px-4 py-3 text-right text-nickel-600">
                              {row.medianResponseDays === null
                                ? '—'
                                : `${row.medianResponseDays}d`}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
