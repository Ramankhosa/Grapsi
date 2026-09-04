'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import SummaryCards from '@/components/funding-dept/SummaryCards'

interface DeadlineRow {
  id: string
  callTitle: string | null
  agencyName: string | null
  facultyName: string | null
  school: string | null
  deadlineAt: string | null
  status: string
}

interface ReminderRow {
  id: string
  note: string
  kind: string
  remindAt: string | null
  remindFaculty: boolean
  assignmentId: string | null
  facultyName: string | null
  /** Set on a call-level tickler, which has a school instead of a person. */
  schoolName?: string | null
  callTitle: string | null
  authorName: string | null
  authorIsMe: boolean
}

interface OpenCall {
  id: string
  title: string | null
  agencyName: string | null
  closesAt: string | null
}

interface DashboardData {
  view: 'mine' | 'schools'
  summary: {
    active: number
    submitted: number
    missed: number
    declined: number
    total: number
  }
  upcoming: DeadlineRow[]
  missed: DeadlineRow[]
  dueReminders: ReminderRow[]
  openCalls: OpenCall[]
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysUntil(value: string | null) {
  if (!value) return null
  const due = new Date(value)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

export default function FundingDeptHomePage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 'mine' is what I delegated; 'schools' is everything landing in the schools
  // I cover, whoever delegated it. Personal stays the default — an officer's
  // own chase list should not be diluted by a colleague's work.
  const [view, setView] = useState<'mine' | 'schools'>('mine')

  const load = useCallback(async (nextView: 'mine' | 'schools') => {
    setLoading(true)
    setView(nextView)
    try {
      const response = await authFetch(`/api/funding-dept/dashboard?view=${nextView}`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not load your dashboard.')
        return
      }
      setData(payload)
      setError(null)
    } catch {
      setError('Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (authLoading || meLoading) return
    if (!me.isMember && !me.canAdminister) {
      setLoading(false)
      return
    }
    void load('mine')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading, me.isMember, me.canAdminister])

  if (authLoading || meLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading your funding department dashboard…</p>
        </div>
      </main>
    )
  }

  if (!me.isMember && !me.canAdminister) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Funding department</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">
            You are not a member of your organization&apos;s funding department. An organization
            admin can add you from Faculty &amp; Organization.
          </p>
        </div>
      </main>
    )
  }

  const summary = data?.summary
  const stats = [
    { label: 'Active', value: summary?.active ?? 0, hint: 'assignments in hand', tone: 'live' as const },
    {
      label: 'Overdue',
      value: summary?.missed ?? 0,
      hint: 'past the internal deadline',
      tone: 'danger' as const,
    },
    {
      label: 'Declined',
      value: summary?.declined ?? 0,
      hint: 'need a new home',
      tone: 'warn' as const,
    },
    { label: 'Submitted', value: summary?.submitted ?? 0, hint: 'applications recorded' },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-64" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            {view === 'schools' ? 'My schools' : 'My worklist'}
          </h1>
          <p className="nk-sub mt-1">
            {view === 'schools'
              ? 'Everything landing in the schools you cover, whoever assigned it.'
              : 'The calls you handed out and are chasing.'}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Each school is a door into its own desk, not just a label. */}
            {me.reachSchools.map((school) => (
              <Link
                key={school.id}
                href={`/funding-dept/schools/${school.id}`}
                className="nk-badge transition hover:bg-nickel-100"
              >
                {school.name}
              </Link>
            ))}
            {/* An admin viewing this page is not a member and has no schools —
                telling them theirs are missing would be nonsense. */}
            {me.isMember && me.schools.length === 0 ? (
              <span className="nk-badge nk-badge-warn">no schools assigned yet</span>
            ) : null}
            {!me.isMember && me.canAdminister ? (
              <span className="nk-badge">viewing as organization admin</span>
            ) : null}
            {me.isHead ? <span className="nk-badge nk-badge-live">department head</span> : null}
          </div>
        </header>

        {error ? (
          <div className="nk-panel mb-6 border-red-200 bg-red-50 px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        ) : null}

        {me.schools.length === 0 && me.isMember ? (
          <div className="nk-panel mb-6 border-amber-200 bg-amber-50/60 px-4 py-3">
            <p className="text-[13px] font-semibold text-amber-800">
              No schools have been assigned to you yet
            </p>
            <p className="nk-sub mt-0.5 text-amber-700">
              Until your department head assigns you schools, you will not see faculty here or be
              able to assign calls.
            </p>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {([
            { key: 'mine' as const, label: 'Assigned by me' },
            { key: 'schools' as const, label: 'In my schools' },
          ]).map((option) => (
            <button
              key={option.key}
              type="button"
              className={view === option.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'}
              onClick={() => void load(option.key)}
            >
              {option.label}
            </button>
          ))}
          {view === 'schools' && me.reachSchools.length === 0 && !me.capabilities.isTenantWide ? (
            <span className="nk-sub">No schools assigned to you, so there is nothing to show.</span>
          ) : null}
        </div>

        <SummaryCards stats={stats} />

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/researcher-matching" className="nk-btn-primary nk-btn-sm">
            Find researchers for a call
          </Link>
          <Link href="/funding-dept/chase" className="nk-btn-secondary nk-btn-sm">
            Chase queue
          </Link>
          <Link href="/funding-dept/accountability" className="nk-btn-secondary nk-btn-sm">
            My schools at a glance
          </Link>
          <Link href="/funding-dept/assignments" className="nk-btn-secondary nk-btn-sm">
            My assignments
          </Link>
          <Link href="/funding-dept/faculty" className="nk-btn-secondary nk-btn-sm">
            Faculty in my schools
          </Link>
          {me.isHead || me.canAdminister ? (
            <>
              <Link href="/funding-dept/overview" className="nk-btn-secondary nk-btn-sm">
                Department overview
              </Link>
              <Link href="/funding-dept/calls" className="nk-btn-secondary nk-btn-sm">
                Call funnel
              </Link>
            </>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Follow-ups due</h2>
                <p className="nk-sub">
                  {view === 'schools'
                    ? 'Reminders now due on work in your schools'
                    : 'Reminders you set that have come around'}
                </p>
              </div>
              {(data?.dueReminders.length ?? 0) > 0 ? (
                <span className="nk-badge nk-badge-warn">{data?.dueReminders.length}</span>
              ) : null}
            </div>
            <div className="px-5 py-4">
              {(data?.dueReminders.length ?? 0) === 0 ? (
                <p className="nk-sub">Nothing due. Anything you schedule will appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {data?.dueReminders.map((row) => (
                    <li key={row.id} className="border-b border-nickel-100 pb-3 last:border-0 last:pb-0">
                      <p className="text-[13.5px] font-medium text-nickel-900">
                        {row.facultyName || (row.schoolName ? `${row.schoolName} (nobody assigned yet)` : 'Unknown')}
                        <span className="nk-sub"> · {row.callTitle || 'Untitled call'}</span>
                      </p>
                      <p className="nk-sub mt-0.5">{row.note}</p>
                      {view === 'schools' && !row.authorIsMe && row.authorName ? (
                        <p className="nk-sub mt-0.5">Set by {row.authorName}</p>
                      ) : null}
                      <p className="nk-sub mt-1">
                        Due {formatDate(row.remindAt)}
                        {row.remindFaculty ? ' · they were emailed too' : ' · private to you'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Deadlines ahead</h2>
                <p className="nk-sub">Next 30 days</p>
              </div>
            </div>
            <div className="px-5 py-4">
              {(data?.upcoming.length ?? 0) === 0 ? (
                <p className="nk-sub">No internal deadlines in the next 30 days.</p>
              ) : (
                <ul className="space-y-3">
                  {data?.upcoming.map((row) => {
                    const days = daysUntil(row.deadlineAt)
                    return (
                      <li key={row.id} className="border-b border-nickel-100 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[13.5px] font-medium text-nickel-900">
                              {row.callTitle || 'Untitled call'}
                            </p>
                            <p className="nk-sub mt-0.5">
                              {row.facultyName}
                              {row.school ? ` · ${row.school}` : ''}
                            </p>
                          </div>
                          <span
                            className={
                              days !== null && days <= 7 ? 'nk-badge nk-badge-warn' : 'nk-badge'
                            }
                          >
                            {days === 0 ? 'today' : days !== null ? `${days}d` : '—'}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Overdue</h2>
                <p className="nk-sub">Open past their internal deadline</p>
              </div>
              {(data?.missed.length ?? 0) > 0 ? (
                <span className="nk-badge nk-badge-danger">{data?.missed.length}</span>
              ) : null}
            </div>
            <div className="px-5 py-4">
              {(data?.missed.length ?? 0) === 0 ? (
                <p className="nk-sub">Nothing overdue.</p>
              ) : (
                <ul className="space-y-3">
                  {data?.missed.map((row) => (
                    <li key={row.id} className="border-b border-nickel-100 pb-3 last:border-0 last:pb-0">
                      <p className="text-[13.5px] font-medium text-nickel-900">
                        {row.callTitle || 'Untitled call'}
                      </p>
                      <p className="nk-sub mt-0.5">
                        {row.facultyName} · was due {formatDate(row.deadlineAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="nk-panel">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Closing soon, nobody on them</h2>
                <p className="nk-sub">In your schools, next 45 days</p>
              </div>
            </div>
            <div className="px-5 py-4">
              {(data?.openCalls.length ?? 0) === 0 ? (
                <p className="nk-sub">
                  Every call closing soon has someone from your schools working on it.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data?.openCalls.map((call) => (
                    <li key={call.id} className="border-b border-nickel-100 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[13.5px] font-medium text-nickel-900">
                            {call.title || 'Untitled call'}
                          </p>
                          <p className="nk-sub mt-0.5">
                            {call.agencyName || 'Unknown funder'} · closes {formatDate(call.closesAt)}
                          </p>
                        </div>
                        <Link
                          href={`/researcher-matching?callId=${call.id}`}
                          className="nk-btn-secondary nk-btn-xs shrink-0"
                        >
                          Find people
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
