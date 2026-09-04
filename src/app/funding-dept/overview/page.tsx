'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useToast } from '@/components/ui/toast'
import SchoolCoverageEditor, {
  type CoverageSchool,
} from '@/components/funding-dept/SchoolCoverageEditor'
import SummaryCards from '@/components/funding-dept/SummaryCards'

interface MemberRow {
  id: string
  userId: string
  name: string | null
  email: string | null
  isHead: boolean
  title: string | null
  schools: Array<{ id: string; name: string | null }>
  schoolCount: number
  deputySchools: Array<{ id: string; name: string | null }>
  awayFrom: string | null
  awayUntil: string | null
  isAway: boolean
  active: number
  submitted: number
  missed: number
  declined: number
  awarded: number
  total: number
  followUpsLast30Days: number
  overdueReminders: number
  /** Relevant open calls in this member's schools that nobody is on yet. */
  pendingInSchools: number
}

/** A school row with the load the coverage editor does not carry. */
interface SchoolRow {
  id: string
  name: string
  covered: boolean
  memberName?: string | null
  active: number
  missed: number
  submitted: number
  declined: number
  awarded: number
  faculty: number
  busyFaculty: number
  mappedAreas: number
  isUnmapped: boolean
  relevantOpen: number
  /** Work in hand, overdue or not. `active` excludes anything past its date. */
  live: number
  pending: number
  shortlisted: number
  awardAmount: number
  lastContactAt: string | null
}

interface OverviewData {
  members: MemberRow[]
  schools: Array<CoverageSchool & SchoolRow>
  uncovered: CoverageSchool[]
  openCalls: Array<{ id: string; title: string | null; agencyName: string | null; closesAt: string | null }>
  totals: {
    members: number
    schools: number
    uncovered: number
    active: number
    missed: number
    declined: number
    submitted: number
  }
  departmentTotals: {
    openCalls: number
    unclassifiedCalls: number
    unmappedSchools: number
    pending: number
    overdue: number
    live: number
    submitted: number
    awarded: number
    awardAmount: number
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function FundingDeptOverviewPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()
  const { showToast } = useToast()

  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch('/api/funding-dept/overview')
      if (response.status === 403) {
        setDenied(true)
        return
      }
      if (response.ok) {
        setData(await response.json())
        setDenied(false)
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (authLoading || meLoading) return
    void load()
  }, [authLoading, meLoading, load])

  /**
   * The coverage editor speaks in "this school belongs to that member", but the
   * API is member-first (replace one member's whole set). Translating here
   * keeps the one-school-one-member rule expressible in a single request: we
   * only ever send the set the receiving member should end up with, and the
   * unique index rejects anything that would double-book.
   */
  const assignSchool = async (schoolId: string, memberId: string | null) => {
    if (!data) return
    const previousOwner = data.members.find((member) =>
      member.schools.some((school) => school.id === schoolId)
    )

    const requests: Array<Promise<Response>> = []
    if (previousOwner && previousOwner.id !== memberId) {
      requests.push(
        authFetch(`/api/funding-dept/members/${previousOwner.id}/schools`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgUnitIds: previousOwner.schools
              .filter((school) => school.id !== schoolId)
              .map((school) => school.id),
          }),
        })
      )
    }

    // Sequential on purpose: the school must be released before it is claimed,
    // or the unique index rejects the claim.
    for (const request of requests) {
      const response = await request
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        showToast({ type: 'error', title: payload.error || 'Could not free that school' })
        return
      }
    }

    if (memberId) {
      const target = data.members.find((member) => member.id === memberId)
      const nextSchools = Array.from(
        new Set([...(target?.schools.map((school) => school.id) ?? []), schoolId])
      )
      const response = await authFetch(`/api/funding-dept/members/${memberId}/schools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgUnitIds: nextSchools }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        showToast({ type: 'error', title: payload.error || 'Could not assign that school' })
        await load()
        return
      }
    }

    showToast({ type: 'success', title: 'Coverage updated' })
    await load()
  }

  /**
   * The deputy rota. Unlike the primary rota there is nothing to release
   * first — deputies are not exclusive, so this only ever rewrites one
   * member's own deputy list.
   */
  const assignDeputy = async (schoolId: string, memberId: string | null) => {
    if (!data) return
    const previous = data.members.find((member) =>
      (member.deputySchools || []).some((school) => school.id === schoolId)
    )

    if (previous && previous.id !== memberId) {
      const response = await authFetch(`/api/funding-dept/members/${previous.id}/schools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asDeputy: true,
          orgUnitIds: (previous.deputySchools || [])
            .filter((school) => school.id !== schoolId)
            .map((school) => school.id),
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        showToast({ type: 'error', title: payload.error || 'Could not free that deputy slot' })
        return
      }
    }

    if (memberId) {
      const target = data.members.find((member) => member.id === memberId)
      const next = Array.from(
        new Set([...((target?.deputySchools || []).map((school) => school.id)), schoolId])
      )
      const response = await authFetch(`/api/funding-dept/members/${memberId}/schools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asDeputy: true, orgUnitIds: next }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        showToast({ type: 'error', title: payload.error || 'Could not name that deputy' })
        await load()
        return
      }
    }

    showToast({ type: 'success', title: 'Deputy updated' })
    await load()
  }

  /** Mark a member away, or bring them back. */
  const setLeave = async (memberId: string, awayFrom: string | null, awayUntil: string | null) => {
    const response = await authFetch(`/api/funding-dept/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        awayFrom: awayFrom ? new Date(awayFrom).toISOString() : null,
        awayUntil: awayUntil ? new Date(awayUntil).toISOString() : null,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      showToast({ type: 'error', title: payload.error || 'Could not update that leave window' })
      return
    }
    showToast({ type: 'success', title: awayFrom ? 'Marked as away' : 'Marked as back' })
    await load()
  }

  if (authLoading || meLoading || loading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading the department overview…</p>
        </div>
      </main>
    )
  }

  if (denied || (!me.isHead && !me.canAdminister)) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Department overview</h1>
          <p className="nk-sub mx-auto mt-2 max-w-md">
            Only the department head or an organization admin can review the whole department.
          </p>
          <Link href="/funding-dept" className="nk-btn-secondary nk-btn-sm mt-4">
            Back to my worklist
          </Link>
        </div>
      </main>
    )
  }

  const totals = data?.totals
  const stats = [
    { label: 'Active', value: totals?.active ?? 0, hint: 'across the department', tone: 'live' as const },
    { label: 'Overdue', value: totals?.missed ?? 0, hint: 'past deadline', tone: 'danger' as const },
    {
      label: 'Uncovered schools',
      value: totals?.uncovered ?? 0,
      hint: `of ${totals?.schools ?? 0}`,
      tone: 'warn' as const,
    },
    { label: 'Submitted', value: totals?.submitted ?? 0, hint: 'applications recorded' },
  ]

  const dept = data?.departmentTotals
  // The discipline funnel, which the assignment rollup above cannot see: a
  // school with a hundred untouched relevant calls scores zero in every card
  // that counts assignments.
  const reachStats = [
    {
      label: 'Needs somebody',
      value: dept?.pending ?? 0,
      hint: 'relevant open calls nobody is on',
      tone: (dept?.pending ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
    },
    { label: 'Open calls', value: dept?.openCalls ?? 0, hint: 'in the catalog right now' },
    {
      label: 'Unclassified',
      value: dept?.unclassifiedCalls ?? 0,
      hint: 'shown to every school until classified',
    },
    {
      label: 'Unmapped schools',
      value: dept?.unmappedSchools ?? 0,
      hint: 'no disciplines, so no filtering',
      tone: (dept?.unmappedSchools ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
    },
  ]

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Department overview
          </h1>
          <p className="nk-sub mt-1">
            What each member is carrying, and which schools have nobody looking after them.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/funding-dept/accountability" className="nk-btn-primary nk-btn-sm">
              Accountability
            </Link>
            <Link href="/funding-dept/calls" className="nk-btn-secondary nk-btn-sm">
              Call funnel
            </Link>
          </div>
        </header>

        <SummaryCards stats={stats} />

        <div className="mt-3">
          <SummaryCards stats={reachStats} />
        </div>
        {(dept?.unmappedSchools ?? 0) > 0 && (
          <p className="nk-sub mt-2">
            An unmapped school sees the whole catalog rather than nothing —{' '}
            <Link href="/tenant-admin/faculty" className="underline">
              map its disciplines
            </Link>{' '}
            to make its pendency meaningful.
          </p>
        )}

        <section className="nk-panel mt-6 overflow-hidden">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Members</h2>
              <p className="nk-sub">Last 30 days of follow-up activity</p>
            </div>
            {me.canAdminister ? (
              <Link href="/tenant-admin/funding-dept" className="nk-btn-secondary nk-btn-sm">
                Manage membership
              </Link>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {[
                    'Member',
                    'Schools',
                    'Needs somebody',
                    'Active',
                    'Submitted',
                    'Overdue',
                    'Declined',
                    'Follow-ups',
                    'Due nudges',
                  ].map(
                    (heading) => (
                      <th
                        key={heading}
                        className={`nk-eyebrow px-4 py-2.5 ${heading === 'Member' ? 'text-left' : 'text-right'}`}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {(data?.members.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center">
                      <p className="nk-sub">
                        No members yet. An organization admin adds them from Manage membership.
                      </p>
                    </td>
                  </tr>
                ) : (
                  data?.members.map((member) => (
                    <tr key={member.id} className="border-b border-nickel-100 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
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
                                  ? `Away until ${new Date(member.awayUntil).toLocaleDateString('en-IN')}`
                                  : 'Away, no return date set'
                              }
                            >
                              away
                            </span>
                          ) : null}
                        </div>
                        {member.title ? <p className="nk-sub mt-0.5">{member.title}</p> : null}
                        {(member.deputySchools || []).length > 0 ? (
                          <p className="nk-sub mt-0.5 text-[11.5px]">
                            Deputy for{' '}
                            {(member.deputySchools || []).map((s) => s.name).filter(Boolean).join(', ')}
                          </p>
                        ) : null}
                        {me.canAdminister ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {member.isAway ? (
                              <button
                                type="button"
                                className="nk-btn-secondary nk-btn-xs"
                                onClick={() => void setLeave(member.id, null, null)}
                              >
                                Mark back
                              </button>
                            ) : (
                              <label className="flex items-center gap-1.5">
                                <span className="nk-sub text-[11.5px]">Away until</span>
                                <input
                                  type="date"
                                  className="nk-input h-7 py-0 text-[12px]"
                                  onChange={(event) => {
                                    if (!event.target.value) return
                                    void setLeave(
                                      member.id,
                                      new Date().toISOString().slice(0, 10),
                                      event.target.value
                                    )
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="nk-mono px-4 py-3 text-right text-nickel-700">
                        {member.schoolCount}
                      </td>
                      <td className="nk-mono px-4 py-3 text-right">
                        {member.pendingInSchools > 0 ? (
                          <span className="font-medium text-cobalt-700">
                            {member.pendingInSchools}
                          </span>
                        ) : (
                          <span className="nk-sub">0</span>
                        )}
                      </td>
                      <td className="nk-mono px-4 py-3 text-right text-nickel-900">{member.active}</td>
                      <td className="nk-mono px-4 py-3 text-right text-nickel-700">
                        {member.submitted}
                      </td>
                      <td
                        className={`nk-mono px-4 py-3 text-right ${member.missed > 0 ? 'font-semibold text-red-700' : 'text-nickel-700'}`}
                      >
                        {member.missed}
                      </td>
                      <td className="nk-mono px-4 py-3 text-right text-nickel-700">
                        {member.declined}
                      </td>
                      <td className="nk-mono px-4 py-3 text-right text-nickel-700">
                        {member.followUpsLast30Days}
                      </td>
                      <td
                        className={`nk-mono px-4 py-3 text-right ${member.overdueReminders > 0 ? 'font-semibold text-amber-700' : 'text-nickel-700'}`}
                      >
                        {member.overdueReminders}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="nk-panel mt-6">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Schools</h2>
              <p className="nk-sub">
                Sorted by what needs somebody. That column is the one the assignment counts cannot
                show — a school with nothing to do and a school ignoring fifty calls both read zero
                everywhere else.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-nickel-200 bg-nickel-50">
                  {[
                    'School',
                    'Covered by',
                    'Areas',
                    'Relevant',
                    'Needs somebody',
                    'Live',
                    'Overdue',
                    'Submitted',
                    'Awarded',
                    'Last contact',
                  ].map(
                    (heading) => (
                      <th key={heading} className="nk-eyebrow px-4 py-2.5 text-left">
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {(data?.schools ?? []).map((school) => (
                  <tr key={school.id} className="border-b border-nickel-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/funding-dept/schools/${school.id}`}
                        className="text-[13.5px] font-medium text-cobalt-700 hover:underline"
                      >
                        {school.name}
                      </Link>
                      <Link
                        href={`/funding-dept/schools/${school.id}/ledger`}
                        className="nk-sub mt-0.5 block text-[11px] hover:underline"
                      >
                        every call &amp; where it stands →
                      </Link>
                    </td>
                    <td className="nk-sub px-4 py-3">
                      {school.covered ? school.memberName || '—' : (
                        <span className="nk-badge nk-badge-warn">nobody</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {school.isUnmapped ? (
                        <span className="nk-badge nk-badge-warn">none</span>
                      ) : (
                        <span className="nk-sub">{school.mappedAreas}</span>
                      )}
                    </td>
                    <td className="nk-sub px-4 py-3 tabular-nums">{school.relevantOpen}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {school.pending > 0 ? (
                        <Link
                          href={`/funding-dept/queue?orgUnitId=${school.id}&state=pending`}
                          className="font-medium text-cobalt-700 hover:underline"
                        >
                          {school.pending}
                        </Link>
                      ) : (
                        <span className="nk-sub">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{school.live}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {school.missed > 0 ? (
                        <span className="font-medium text-red-700">{school.missed}</span>
                      ) : (
                        <span className="nk-sub">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{school.submitted}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {school.awarded}
                      {school.awardAmount > 0 ? (
                        <span className="nk-sub"> · ₹{school.awardAmount.toLocaleString('en-IN')}</span>
                      ) : null}
                    </td>
                    <td className="nk-sub px-4 py-3">
                      {school.lastContactAt ? formatDate(school.lastContactAt) : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-3">
            <h2 className="nk-title">School coverage</h2>
            <p className="nk-sub">
              One member per school. Moving a school here hands it over immediately.
            </p>
          </div>
          <SchoolCoverageEditor
            schools={data?.schools ?? []}
            members={data?.members ?? []}
            onAssign={assignSchool}
            onAssignDeputy={assignDeputy}
          />
        </section>

        {(data?.openCalls.length ?? 0) > 0 ? (
          <section className="nk-panel mt-6">
            <div className="nk-panel-head">
              <div>
                <h2 className="nk-title">Closing soon with nobody assigned</h2>
                <p className="nk-sub">Next 45 days</p>
              </div>
            </div>
            <ul className="divide-y divide-nickel-100">
              {data?.openCalls.map((call) => (
                <li key={call.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-[13.5px] font-medium text-nickel-900">
                      {call.title || 'Untitled call'}
                    </p>
                    <p className="nk-sub mt-0.5">
                      {call.agencyName || 'Unknown funder'} ·{' '}
                      {call.closesAt ? new Date(call.closesAt).toLocaleDateString() : '—'}
                    </p>
                  </div>
                  <Link
                    href={`/researcher-matching?callId=${call.id}`}
                    className="nk-btn-secondary nk-btn-xs shrink-0"
                  >
                    Find people
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  )
}
