'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

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
}

const PAGE_SIZE = 50

export default function DeptFacultyPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()

  const [faculty, setFaculty] = useState<FacultyRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (nextOffset: number, query: string, unit: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (query) params.set('q', query)
        if (unit) params.set('orgUnitId', unit)
        const response = await authFetch(`/api/tenant-admin/faculty?${params.toString()}`)
        if (response.ok) {
          const data = await response.json()
          setFaculty(data.faculty || [])
          setTotal(data.total || 0)
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
    void load(0, '', '')
  }, [authLoading, meLoading, load])

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
              : `Scoped to ${me.schools.length} school${me.schools.length === 1 ? '' : 's'} you cover.`}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="nk-input max-w-sm"
            placeholder="Search by name, email or employee ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(0, search, unitFilter)
            }}
          />
          {me.schools.length > 1 ? (
            <select
              className="nk-select max-w-xs"
              value={unitFilter}
              onChange={(event) => {
                setUnitFilter(event.target.value)
                void load(0, search, event.target.value)
              }}
            >
              <option value="">All my schools</option>
              {me.schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            onClick={() => void load(0, search, unitFilter)}
          >
            Search
          </button>
          <Link href="/researcher-matching" className="nk-btn-primary nk-btn-sm ml-auto">
            Match a call to these people
          </Link>
        </div>

        {me.schools.length === 0 && !me.capabilities.isTenantWide ? (
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
                    {['Name', 'School', 'Department', 'Designation', 'Research areas', 'Status'].map(
                      (heading) => (
                        <th key={heading} className="nk-eyebrow px-4 py-2.5 text-left">
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center">
                        <p className="nk-sub">Loading faculty…</p>
                      </td>
                    </tr>
                  ) : faculty.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center">
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
                        </td>
                        <td className="nk-sub px-4 py-3">{person.school || '—'}</td>
                        <td className="nk-sub px-4 py-3">{person.department || '—'}</td>
                        <td className="nk-sub px-4 py-3">{person.designation || '—'}</td>
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
                    onClick={() => void load(Math.max(offset - PAGE_SIZE, 0), search, unitFilter)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-sm"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => void load(offset + PAGE_SIZE, search, unitFilter)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
