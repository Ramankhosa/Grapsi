'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import ProposalSettingsCard from '@/components/proposals/ProposalSettingsCard'
import { useAuth, useRoleAccess } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import SchoolCoverageEditor, {
  type CoverageSchool,
} from '@/components/funding-dept/SchoolCoverageEditor'

/**
 * Staffing the funding department.
 *
 * Membership is a privilege grant — coverage gives assign rights and access to
 * a school's faculty roster — so this screen is tenant-admin only, matching the
 * server. The head runs the department from /funding-dept/overview but cannot
 * recruit into it.
 */

interface Member {
  id: string
  userId: string
  name: string | null
  email: string | null
  isHead: boolean
  title: string | null
  isActive: boolean
  schools: Array<{ id: string; name: string | null }>
  deputySchools: Array<{ id: string; name: string | null }>
  awayFrom: string | null
  awayUntil: string | null
  isAway: boolean
}

interface PeriodSetting {
  configured: boolean
  stored: { start: string | null; end: string | null; label: string | null }
  period: {
    start: string
    end: string
    startDate: string
    endDate: string
    label: string
    isDefault: boolean
  }
}

interface FacultyOption {
  userId: string
  name: string | null
  email: string
  school: string | null
  designation: string | null
}

export default function TenantAdminFundingDeptPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { isTenantAdmin, isSuperAdmin } = useRoleAccess()
  const { showToast } = useToast()

  const [members, setMembers] = useState<Member[]>([])
  const [schools, setSchools] = useState<CoverageSchool[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)

  const [period, setPeriod] = useState<PeriodSetting | null>(null)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodLabel, setPeriodLabel] = useState('')
  const [savingPeriod, setSavingPeriod] = useState(false)

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<FacultyOption[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)

  const allowed = isTenantAdmin || isSuperAdmin

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(
        `/api/funding-dept/members?includeInactive=${showInactive ? 'true' : 'false'}`
      )
      if (response.ok) {
        const data = await response.json()
        setMembers(data.members || [])
        setSchools(data.schools || [])
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch, showInactive])

  const loadPeriod = useCallback(async () => {
    const response = await authFetch('/api/tenant-admin/reporting-period')
    if (!response.ok) return
    const data: PeriodSetting = await response.json()
    setPeriod(data)
    // Seed the form with what is actually in force, so an unconfigured tenant
    // starts from this calendar year rather than two empty boxes.
    setPeriodStart(data.stored.start || data.period.startDate)
    setPeriodEnd(data.stored.end || data.period.endDate)
    setPeriodLabel(data.stored.label || '')
  }, [authFetch])

  useEffect(() => {
    if (authLoading || !allowed) return
    void load()
    void loadPeriod()
  }, [authLoading, allowed, load, loadPeriod])

  /** Fill the form with a whole year starting on the given month/day. */
  const presetPeriod = (startMonth: number, startDay: number) => {
    const today = new Date()
    let year = today.getFullYear()
    const start = new Date(year, startMonth, startDay)
    if (start > today) {
      // The window that contains today is the one that began last year.
      year -= 1
      start.setFullYear(year)
    }
    const end = new Date(year + 1, startMonth, startDay)
    end.setDate(end.getDate() - 1)
    const iso = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
        value.getDate()
      ).padStart(2, '0')}`
    setPeriodStart(iso(start))
    setPeriodEnd(iso(end))
    setPeriodLabel(
      start.getFullYear() === end.getFullYear()
        ? String(start.getFullYear())
        : `${start.getFullYear()}-${String(end.getFullYear()).slice(-2)}`
    )
  }

  const savePeriod = async (clear = false) => {
    setSavingPeriod(true)
    try {
      const response = await authFetch('/api/tenant-admin/reporting-period', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          clear ? { clear: true } : { start: periodStart, end: periodEnd, label: periodLabel }
        ),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || 'Could not save the period' })
        return
      }
      setPeriod(data)
      setPeriodStart(data.stored?.start || data.period.startDate)
      setPeriodEnd(data.stored?.end || data.period.endDate)
      setPeriodLabel(data.stored?.label || '')
      showToast({
        type: 'success',
        title: clear ? 'Back to the calendar year' : 'Period of consideration saved',
      })
    } finally {
      setSavingPeriod(false)
    }
  }

  const runSearch = async () => {
    if (!search.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: search.trim(), limit: '10' })
      const response = await authFetch(`/api/tenant-admin/faculty?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setResults(data.faculty || [])
      }
    } finally {
      setSearching(false)
    }
  }

  const addMember = async (userId: string) => {
    setBusy(true)
    try {
      const response = await authFetch('/api/funding-dept/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || 'Could not add that person' })
        return
      }
      showToast({ type: 'success', title: 'Added to the funding department' })
      setSearch('')
      setResults([])
      await load()
    } finally {
      setBusy(false)
    }
  }

  const patchMember = async (member: Member, body: Record<string, unknown>, label: string) => {
    setBusy(true)
    try {
      const response = await authFetch(`/api/funding-dept/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || `Could not ${label}` })
        return
      }
      const freed: Array<{ name: string | null }> = data.freedSchools || []
      showToast({
        type: freed.length > 0 ? 'warning' : 'success',
        title: freed.length > 0 ? 'Member deactivated' : 'Updated',
        message:
          freed.length > 0
            ? `${freed.map((school) => school.name).join(', ')} now has nobody assigned.`
            : undefined,
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member: Member) => {
    setBusy(true)
    try {
      const response = await authFetch(`/api/funding-dept/members/${member.id}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || 'Could not remove that member' })
        return
      }
      const freed: Array<{ name: string | null }> = data.freedSchools || []
      showToast({
        type: 'success',
        title: 'Removed from the department',
        message:
          freed.length > 0
            ? `${freed.map((school) => school.name).join(', ')} now has nobody assigned.`
            : 'Calls they already assigned are unchanged.',
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const assignSchool = async (schoolId: string, memberId: string | null) => {
    const previousOwner = members.find((member) =>
      member.schools.some((school) => school.id === schoolId)
    )
    if (previousOwner && previousOwner.id !== memberId) {
      const response = await authFetch(`/api/funding-dept/members/${previousOwner.id}/schools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgUnitIds: previousOwner.schools
            .filter((school) => school.id !== schoolId)
            .map((school) => school.id),
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        showToast({ type: 'error', title: payload.error || 'Could not free that school' })
        return
      }
    }
    if (memberId) {
      const target = members.find((member) => member.id === memberId)
      const response = await authFetch(`/api/funding-dept/members/${memberId}/schools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgUnitIds: Array.from(
            new Set([...(target?.schools.map((school) => school.id) ?? []), schoolId])
          ),
        }),
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
    const previous = members.find((member) =>
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
      const target = members.find((member) => member.id === memberId)
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

  if (authLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!allowed) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Access denied</h1>
          <p className="nk-sub mt-2">
            Only organization owners and admins can staff the funding department.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="nk-eyebrow">Organization admin</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Funding department
          </h1>
          <p className="nk-sub mt-1">
            The central office that sources funding calls and pushes them to faculty. Members see
            the faculty in the schools they cover and can assign calls to them.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        {/*
          How this office runs the proposal desk. Sits above the reporting
          window because it decides which stages exist at all, and the window
          only describes how they are counted.
        */}
        <div className="mb-6">
          <ProposalSettingsCard />
        </div>

        <section className="nk-panel mb-6">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Period of consideration</h2>
              <p className="nk-sub">
                The window faculty workload and submissions are counted over, on the call dossier
                and in department reporting
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="nk-eyebrow block">Start</span>
                <input
                  type="date"
                  className="nk-input mt-1"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="nk-eyebrow block">End</span>
                <input
                  type="date"
                  className="nk-input mt-1"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="nk-eyebrow block">Name (optional)</span>
                <input
                  className="nk-input mt-1 max-w-[12rem]"
                  placeholder="AY 2026-27"
                  value={periodLabel}
                  onChange={(event) => setPeriodLabel(event.target.value)}
                />
              </label>
              <button
                className="nk-btn-primary"
                disabled={savingPeriod || !periodStart || !periodEnd}
                onClick={() => void savePeriod(false)}
              >
                {savingPeriod ? 'Saving...' : 'Save period'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="nk-sub">Quick set:</span>
              <button className="nk-btn-secondary nk-btn-sm" onClick={() => presetPeriod(0, 1)}>
                Calendar year (1 Jan &ndash; 31 Dec)
              </button>
              <button className="nk-btn-secondary nk-btn-sm" onClick={() => presetPeriod(6, 1)}>
                Academic year (1 Jul &ndash; 30 Jun)
              </button>
              <button className="nk-btn-secondary nk-btn-sm" onClick={() => presetPeriod(3, 1)}>
                Financial year (1 Apr &ndash; 31 Mar)
              </button>
            </div>

            {period && (
              <p className="nk-sub mt-3">
                {period.configured ? (
                  <>
                    In force: <strong>{period.period.label}</strong> &mdash;{' '}
                    {period.period.startDate} to {period.period.endDate}. It rolls forward a year
                    automatically once it closes.{' '}
                    <button
                      className="underline"
                      disabled={savingPeriod}
                      onClick={() => void savePeriod(true)}
                    >
                      Reset to the calendar year
                    </button>
                  </>
                ) : (
                  <>
                    Not set &mdash; counting the current calendar year ({period.period.startDate} to{' '}
                    {period.period.endDate}).
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        <section className="nk-panel mb-6">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Add a member</h2>
              <p className="nk-sub">Search your faculty roster</p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap gap-2">
              <input
                className="nk-input max-w-sm"
                placeholder="Name, email or employee ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch()
                }}
              />
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                onClick={() => void runSearch()}
                disabled={searching}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
            {results.length > 0 ? (
              <ul className="mt-3 divide-y divide-nickel-100 rounded-lg border border-nickel-200">
                {results.map((person) => {
                  const already = members.some((member) => member.userId === person.userId)
                  return (
                    <li
                      key={person.userId}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-nickel-900">
                          {person.name || person.email}
                        </p>
                        <p className="nk-sub truncate">
                          {person.email}
                          {person.school ? ` · ${person.school}` : ''}
                          {person.designation ? ` · ${person.designation}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="nk-btn-primary nk-btn-sm shrink-0"
                        disabled={busy || already}
                        onClick={() => void addMember(person.userId)}
                      >
                        {already ? 'Already a member' : 'Add'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="nk-panel mb-6 overflow-hidden">
          <div className="nk-panel-head">
            <div>
              <h2 className="nk-title">Members</h2>
              <p className="nk-sub">One head runs the department</p>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-nickel-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-nickel-300 text-cobalt-600 focus:ring-cobalt-500"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              Show inactive
            </label>
          </div>
          {loading ? (
            <p className="nk-sub px-5 py-8">Loading members…</p>
          ) : members.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="nk-title">No members yet</p>
              <p className="nk-sub mx-auto mt-1 max-w-md">
                Add the people who run sponsored research, then give each of them the schools they
                look after.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-nickel-100">
              {members.map((member) => (
                <li key={member.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
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
                        {!member.isActive ? <span className="nk-badge">inactive</span> : null}
                      </div>
                      <p className="nk-sub mt-0.5">{member.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {member.schools.length === 0 ? (
                          <span className="nk-badge nk-badge-warn">no schools</span>
                        ) : (
                          member.schools.map((school) => (
                            <span key={school.id} className="nk-badge normal-case tracking-normal">
                              {school.name}
                            </span>
                          ))
                        )}
                      </div>
                      {(member.deputySchools || []).length > 0 ? (
                        <p className="nk-sub mt-1 text-[11.5px]">
                          Deputy for{' '}
                          {(member.deputySchools || []).map((s) => s.name).filter(Boolean).join(', ')}
                        </p>
                      ) : null}
                      {member.isActive ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {member.isAway ? (
                            <button
                              type="button"
                              className="nk-btn-secondary nk-btn-xs"
                              disabled={busy}
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
                                disabled={busy}
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
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {!member.isHead && member.isActive ? (
                        <button
                          type="button"
                          className="nk-btn-secondary nk-btn-sm"
                          disabled={busy}
                          onClick={() => void patchMember(member, { isHead: true }, 'set the head')}
                        >
                          Make head
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="nk-btn-ghost nk-btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void patchMember(
                            member,
                            { isActive: !member.isActive },
                            member.isActive ? 'deactivate' : 'reactivate'
                          )
                        }
                      >
                        {member.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className="nk-btn-danger nk-btn-sm"
                        disabled={busy}
                        onClick={() => void removeMember(member)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3">
            <h2 className="nk-title">School coverage</h2>
            <p className="nk-sub">
              Exactly one member per school, so every school has one person accountable for it.
            </p>
          </div>
          <SchoolCoverageEditor
            schools={schools}
            members={members.filter((member) => member.isActive)}
            onAssign={assignSchool}
            onAssignDeputy={assignDeputy}
            disabled={busy}
          />
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/tenant-admin/faculty" className="nk-btn-secondary nk-btn-sm">
            Faculty &amp; organization
          </Link>
          <Link href="/funding-dept/overview" className="nk-btn-secondary nk-btn-sm">
            Department overview
          </Link>
        </div>
      </div>
    </main>
  )
}
