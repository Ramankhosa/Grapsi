'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'

/**
 * Faculty in the schools this member covers.
 *
 * Uses the existing roster endpoint unchanged: coverage rows already narrow
 * `scopedProfileSql` server-side, so this screen shows a member their schools
 * and an admin the whole roster without a second API or a client-side filter
 * that could be bypassed.
 */

interface FacultyRow {
  userId: string
  email: string
  name: string | null
  employeeId: string | null
  school: string | null
  department: string | null
  designation: string | null
  researchAreas: string[]
  hasEmbedding: boolean
  activated: boolean
  liveAssignments: number
  lastAssignedAt: string | null
  googleScholarUrl: string | null
  scopusUrl: string | null
  orcidUrl: string | null
  linkedinUrl: string | null
  publicationCount: number
}

/**
 * The external profiles the app stores. Shown as compact chips on the row so an
 * officer can open Scholar or Scopus without first opening the person — the
 * check they most often want is the one that leaves the app.
 */
const ROW_LINKS: Array<{ key: keyof FacultyRow; label: string; title: string }> = [
  { key: 'googleScholarUrl', label: 'GS', title: 'Google Scholar' },
  { key: 'scopusUrl', label: 'Scopus', title: 'Scopus' },
  { key: 'orcidUrl', label: 'ORCID', title: 'ORCID' },
  { key: 'linkedinUrl', label: 'in', title: 'LinkedIn' },
]

/** Distinct values present in the caller's slice of the roster. */
interface FacultyFacets {
  schools: string[]
  departments: string[]
  designations: string[]
  departmentsBySchool: Record<string, string[]>
}

/** Everything the roster query is keyed on, so one object drives every reload. */
interface FacultyFilters {
  q: string
  orgUnitId: string
  department: string
  designation: string
  employeeId: string
  researchArea: string
  access: '' | 'activated' | 'pending' | 'noid'
  matchable: '' | 'yes' | 'no'
  load: '' | 'free' | 'busy'
  sort: 'name' | 'load' | 'load-asc'
}

const DEFAULT_FILTERS: FacultyFilters = {
  q: '',
  orgUnitId: '',
  department: '',
  designation: '',
  employeeId: '',
  researchArea: '',
  access: '',
  matchable: '',
  load: '',
  sort: 'name',
}

const ACCESS_CHIPS = [
  { key: '', label: 'All' },
  { key: 'activated', label: 'Activated' },
  { key: 'pending', label: 'Pending' },
  { key: 'noid', label: 'No ID' },
] as const

const PAGE_SIZE = 50

export default function DeptFacultyPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [faculty, setFaculty] = useState<FacultyRow[]>([])
  const [total, setTotal] = useState(0)
  const [profileTarget, setProfileTarget] = useState<FacultyRow | null>(null)
  const [embedded, setEmbedded] = useState(0)
  const [counts, setCounts] = useState({ activated: 0, pending: 0, noid: 0 })
  const [offset, setOffset] = useState(0)
  // `filters` is the applied query; `draftFilters` is what the user is still
  // typing. Text boxes commit on Enter or Search, dropdowns commit at once.
  const [filters, setFilters] = useState<FacultyFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<FacultyFilters>(DEFAULT_FILTERS)
  const [facets, setFacets] = useState<FacultyFacets>({
    schools: [],
    departments: [],
    designations: [],
    departmentsBySchool: {},
  })
  const [showFilters, setShowFilters] = useState(false)
  // A tenant-wide admin covers no schools personally, so `reachSchools` is
  // empty for them — without this they got no school filter at all on the one
  // screen that spans every school.
  const [orgSchools, setOrgSchools] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (nextOffset: number, next: FacultyFilters) => {
      setLoading(true)
      setFilters(next)
      setDraftFilters(next)
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (next.q) params.set('q', next.q)
        if (next.orgUnitId) params.set('orgUnitId', next.orgUnitId)
        if (next.department) params.set('department', next.department)
        if (next.designation) params.set('designation', next.designation)
        if (next.employeeId) params.set('employeeId', next.employeeId)
        if (next.researchArea) params.set('researchArea', next.researchArea)
        if (next.access) params.set('access', next.access)
        if (next.matchable) params.set('matchable', next.matchable)
        if (next.load) params.set('load', next.load)
        if (next.sort && next.sort !== 'name') params.set('sort', next.sort)
        const response = await authFetch(`/api/tenant-admin/faculty?${params.toString()}`)
        if (response.ok) {
          const data = await response.json()
          setFaculty(data.faculty || [])
          setTotal(data.total || 0)
          setEmbedded(data.embedded || 0)
          setCounts({
            activated: data.activatedCount || 0,
            pending: data.pendingCount || 0,
            noid: data.noIdCount || 0,
          })
          setOffset(nextOffset)
        }
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading || meLoading) return
    // ?school=… arrives from a school desk, so the roster opens already scoped
    // to the school the officer was just looking at.
    const school =
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('school')
    void load(0, school ? { ...DEFAULT_FILTERS, orgUnitId: school } : DEFAULT_FILTERS)
  }, [authLoading, meLoading, load])

  // Department and designation lists come from the rows the caller can already
  // see, so the dropdowns never offer a filter that would return nothing.
  useEffect(() => {
    if (authLoading || meLoading) return
    let cancelled = false
    void authFetch('/api/tenant-admin/faculty?action=facets')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setFacets({
          schools: data.schools || [],
          departments: data.departments || [],
          designations: data.designations || [],
          departmentsBySchool: data.departmentsBySchool || {},
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [authLoading, meLoading, authFetch])

  // The org-unit ids behind the school picker, already clamped to the caller's
  // reach server-side.
  useEffect(() => {
    if (authLoading || meLoading) return
    let cancelled = false
    void authFetch('/api/researcher-matching?action=facets')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setOrgSchools(
          (data.schools || []).map((school: { id: string; name: string }) => ({
            id: school.id,
            name: school.name,
          }))
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [authLoading, meLoading, authFetch])

  /** Coverage first; an admin with no personal coverage still gets every school. */
  const schoolOptions = me.reachSchools.length > 0
    ? me.reachSchools.map((school) => ({ id: school.id, name: school.name || 'Unnamed school' }))
    : orgSchools

  /** Departments narrow to the selected school, matched by its name. */
  const departmentOptions = useMemo(() => {
    if (!draftFilters.orgUnitId) return facets.departments
    const schoolName = schoolOptions.find((school) => school.id === draftFilters.orgUnitId)?.name
    if (!schoolName) return facets.departments
    return facets.departmentsBySchool[schoolName] || facets.departments
  }, [draftFilters.orgUnitId, facets, schoolOptions])

  const activeFilterCount =
    (filters.orgUnitId ? 1 : 0) +
    (filters.department ? 1 : 0) +
    (filters.designation ? 1 : 0) +
    (filters.employeeId ? 1 : 0) +
    (filters.researchArea ? 1 : 0) +
    (filters.matchable ? 1 : 0) +
    (filters.load ? 1 : 0)

  if (authLoading || meLoading) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="nk-sub">Loading…</p>
        </div>
      </main>
    )
  }

  if (!me.isMember && !me.canAdminister) {
    return (
      <main className="nk-ground nk-wash">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="nk-title text-[19px]">Funding department</h1>
          <p className="nk-sub mt-2">You are not a member of the funding department.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-5">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Faculty in my schools
          </h1>
          <p className="nk-sub mt-1">
            {me.capabilities.isTenantWide
              ? 'You can see the whole organization.'
              : `Scoped to ${me.reachSchools.length} school${me.reachSchools.length === 1 ? '' : 's'} ${me.isHead ? 'the department covers' : 'you cover'}.`}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className="nk-input max-w-sm"
            placeholder="Search by name, email or employee ID"
            value={draftFilters.q}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, q: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(0, draftFilters)
            }}
          />
          {schoolOptions.length > 1 ? (
            <select
              className="nk-select max-w-xs"
              aria-label="Filter by school"
              value={draftFilters.orgUnitId}
              onChange={(event) =>
                // Changing school clears the department: a department from the
                // previous school would intersect to an empty roster.
                void load(0, { ...draftFilters, orgUnitId: event.target.value, department: '' })
              }
            >
              <option value="">{me.capabilities.isTenantWide ? 'All schools' : 'All my schools'}</option>
              {schoolOptions.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            onClick={() => setShowFilters((visible) => !visible)}
            aria-expanded={showFilters}
          >
            {showFilters ? 'Hide filters' : 'Filters'}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            onClick={() => void load(0, draftFilters)}
          >
            Search
          </button>
          <Link href="/researcher-matching" className="nk-btn-primary nk-btn-sm ml-auto">
            Match a call to these people
          </Link>
        </div>

        {showFilters ? (
          <div className="nk-panel-quiet mb-3 px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="nk-label mb-1 block">Department</span>
                <select
                  className="nk-select w-full"
                  value={draftFilters.department}
                  onChange={(event) =>
                    void load(0, { ...draftFilters, department: event.target.value })
                  }
                >
                  <option value="">All departments</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Designation</span>
                <select
                  className="nk-select w-full"
                  value={draftFilters.designation}
                  onChange={(event) =>
                    void load(0, { ...draftFilters, designation: event.target.value })
                  }
                >
                  <option value="">All designations</option>
                  {facets.designations.map((designation) => (
                    <option key={designation} value={designation}>
                      {designation}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Employee ID</span>
                <input
                  className="nk-input w-full"
                  placeholder="e.g. 21345"
                  value={draftFilters.employeeId}
                  onChange={(event) =>
                    setDraftFilters((current) => ({ ...current, employeeId: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void load(0, draftFilters)
                  }}
                />
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Research area or keyword</span>
                <input
                  className="nk-input w-full"
                  placeholder="e.g. photovoltaics"
                  value={draftFilters.researchArea}
                  onChange={(event) =>
                    setDraftFilters((current) => ({ ...current, researchArea: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void load(0, draftFilters)
                  }}
                />
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Matchable</span>
                <select
                  className="nk-select w-full"
                  value={draftFilters.matchable}
                  onChange={(event) =>
                    void load(0, {
                      ...draftFilters,
                      matchable: event.target.value as FacultyFilters['matchable'],
                    })
                  }
                >
                  <option value="">Everyone</option>
                  <option value="yes">Has a profile embedding</option>
                  <option value="no">Not yet matchable</option>
                </select>
                <span className="nk-sub mt-1 block text-[11.5px]">
                  Only people with an embedding surface in call matching.
                </span>
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Current workload</span>
                <select
                  className="nk-select w-full"
                  value={draftFilters.load}
                  onChange={(event) =>
                    void load(0, { ...draftFilters, load: event.target.value as FacultyFilters['load'] })
                  }
                >
                  <option value="">Any workload</option>
                  <option value="free">Nothing live — has capacity</option>
                  <option value="busy">Already carrying something</option>
                </select>
              </label>

              <label className="block">
                <span className="nk-label mb-1 block">Sort by</span>
                <select
                  className="nk-select w-full"
                  value={draftFilters.sort}
                  onChange={(event) =>
                    void load(0, { ...draftFilters, sort: event.target.value as FacultyFilters['sort'] })
                  }
                >
                  <option value="name">Name A–Z</option>
                  <option value="load">Busiest first</option>
                  <option value="load-asc">Most capacity first</option>
                </select>
              </label>
            </div>

            {activeFilterCount > 0 ? (
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm mt-3"
                onClick={() =>
                  void load(0, { ...DEFAULT_FILTERS, q: filters.q, access: filters.access })
                }
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {ACCESS_CHIPS.map((chip) => (
            <button
              key={chip.key || 'all'}
              type="button"
              className={
                filters.access === chip.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'
              }
              onClick={() => void load(0, { ...draftFilters, access: chip.key })}
            >
              {chip.label}
              {chip.key === 'activated' ? ` (${counts.activated})` : ''}
              {chip.key === 'pending' ? ` (${counts.pending})` : ''}
              {chip.key === 'noid' ? ` (${counts.noid})` : ''}
            </button>
          ))}
          <p className="nk-sub ml-auto">
            {total} shown · {embedded} matchable
          </p>
        </div>

        {me.reachSchools.length === 0 && !me.capabilities.isTenantWide ? (
          <div className="nk-panel-quiet px-5 py-12 text-center">
            <p className="nk-title">No schools assigned to you yet</p>
            <p className="nk-sub mx-auto mt-1 max-w-md">
              Your department head assigns schools. Once they do, the faculty in those schools
              appear here.
            </p>
          </div>
        ) : (
          <div className="nk-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-nickel-200 bg-nickel-50">
                    {[
                      'Name',
                      'Employee ID',
                      'School',
                      'Department',
                      'Designation',
                      'Live calls',
                      'Publications',
                      'Research areas',
                      'Status',
                      '',
                    ].map((heading) => (
                      <th key={heading} className="nk-eyebrow px-4 py-2.5 text-left">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center">
                        <p className="nk-sub">Loading faculty…</p>
                      </td>
                    </tr>
                  ) : faculty.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center">
                        <p className="nk-sub">No faculty found.</p>
                      </td>
                    </tr>
                  ) : (
                    faculty.map((person) => (
                      <tr key={person.userId} className="border-b border-nickel-100 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-[13.5px] font-medium text-nickel-900">
                            {person.name || person.email}
                          </p>
                          <p className="nk-sub mt-0.5">{person.email}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {ROW_LINKS.filter((link) => person[link.key]).map((link) => (
                              <a
                                key={link.key}
                                href={person[link.key] as string}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={link.title}
                                className="nk-badge hover:border-cobalt-400 hover:text-cobalt-700"
                              >
                                {link.label} ↗
                              </a>
                            ))}
                          </div>
                        </td>
                        <td className="nk-sub px-4 py-3 tabular-nums">{person.employeeId || '—'}</td>
                        <td className="nk-sub px-4 py-3">{person.school || '—'}</td>
                        <td className="nk-sub px-4 py-3">{person.department || '—'}</td>
                        <td className="nk-sub px-4 py-3">{person.designation || '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              person.liveAssignments > 0
                                ? 'nk-badge nk-badge-live tabular-nums'
                                : 'nk-badge tabular-nums'
                            }
                            title={
                              person.lastAssignedAt
                                ? `Last assigned ${new Date(person.lastAssignedAt).toLocaleDateString()}`
                                : 'Never assigned a call'
                            }
                          >
                            {person.liveAssignments}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              person.publicationCount > 0
                                ? 'nk-badge tabular-nums'
                                : 'nk-sub tabular-nums'
                            }
                            title={
                              person.publicationCount > 0
                                ? 'Publications this person marked for funding matching'
                                : 'None marked for funding matching \u2014 not proof they have not published'
                            }
                          >
                            {person.publicationCount || '\u2014'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {person.researchAreas.slice(0, 3).map((area) => (
                              <span key={area} className="nk-badge normal-case tracking-normal">
                                {area}
                              </span>
                            ))}
                            {person.researchAreas.length > 3 ? (
                              <span className="nk-sub">+{person.researchAreas.length - 3}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={person.activated ? 'nk-badge nk-badge-ok' : 'nk-badge'}
                              title={
                                person.activated
                                  ? 'Has signed in and set a password'
                                  : 'Seeded from the roster, has not activated yet'
                              }
                            >
                              {person.activated ? 'active' : 'pending'}
                            </span>
                            {!person.hasEmbedding ? (
                              <span
                                className="nk-badge nk-badge-warn"
                                title="No profile embedding yet, so this person will not surface in matching"
                              >
                                unmatched
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="nk-btn-secondary nk-btn-sm"
                            onClick={() => setProfileTarget(person)}
                          >
                            Profile
                          </button>
                        </td>
                      </tr>
                    ))
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
                    onClick={() => void load(Math.max(offset - PAGE_SIZE, 0), filters)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-sm"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => void load(offset + PAGE_SIZE, filters)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {profileTarget && (
          <FacultyProfileDrawer
            userId={profileTarget.userId}
            fallbackName={profileTarget.name || profileTarget.email}
            fallbackHint={[profileTarget.department, profileTarget.school]
              .filter(Boolean)
              .join(' \u00b7 ')}
            onClose={() => setProfileTarget(null)}
          />
        )}
      </div>
    </main>
  )
}
