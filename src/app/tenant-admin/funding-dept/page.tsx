'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

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

  useEffect(() => {
    if (authLoading || !allowed) return
    void load()
  }, [authLoading, allowed, load])

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
