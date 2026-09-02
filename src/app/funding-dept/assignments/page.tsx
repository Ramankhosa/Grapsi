'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useToast } from '@/components/ui/toast'
import FollowUpPanel from '@/components/funding-dept/FollowUpPanel'
import ReassignDialog from '@/components/funding-dept/ReassignDialog'
import AssignmentDossier from '@/components/funding-dept/AssignmentDossier'

interface Assignment {
  id: string
  status: string
  message: string | null
  deadlineAt: string | null
  declinedReason: string | null
  respondedAt: string | null
  submittedAt: string | null
  completedAt: string | null
  outcome: string
  createdAt: string
  call: { id: string; title: string; agencyName: string | null } | null
  assignee: { id: string; name: string | null; email: string } | null
  assignedBy: { id: string; name: string | null; email: string } | null
  passedOnFrom: { id: string; name: string | null; declinedReason: string | null } | null
  passedOnTo: { id: string; name: string | null; status: string } | null
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ASSIGNED: { label: 'Awaiting reply', className: 'nk-badge nk-badge-warn' },
  ACCEPTED: { label: 'Accepted', className: 'nk-badge nk-badge-live' },
  IN_PROGRESS: { label: 'In progress', className: 'nk-badge nk-badge-live' },
  COMPLETED: { label: 'Submitted', className: 'nk-badge nk-badge-ok' },
  CANCELLED: { label: 'Cancelled', className: 'nk-badge' },
  DECLINED: { label: 'Declined', className: 'nk-badge nk-badge-danger' },
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ASSIGNED', label: 'Awaiting reply' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'COMPLETED', label: 'Submitted' },
]

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function DeptAssignmentsPage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()
  const { showToast } = useToast()

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  // Server-side narrowing: a department head assigning across several schools
  // needs to isolate one school, one outcome, or one person by name/ID.
  const [orgUnitId, setOrgUnitId] = useState('')
  const [outcome, setOutcome] = useState('')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  // A tenant-wide admin covers no schools personally, so `reachSchools` is
  // empty for them; fall back to the tenant's school list.
  const [orgSchools, setOrgSchools] = useState<Array<{ id: string; name: string }>>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reassignTarget, setReassignTarget] = useState<Assignment | null>(null)

  const load = useCallback(async (
    next: { orgUnitId?: string; outcome?: string; q?: string } = {}
  ) => {
    setLoading(true)
    const unit = next.orgUnitId ?? orgUnitId
    const result = next.outcome ?? outcome
    const search = next.q ?? appliedQuery
    setOrgUnitId(unit)
    setOutcome(result)
    setAppliedQuery(search)
    try {
      const params = new URLSearchParams({ view: 'assigned-by-me', limit: '300' })
      if (unit) params.set('orgUnitId', unit)
      if (result) params.set('outcome', result)
      if (search) params.set('q', search)
      const response = await authFetch(`/api/assignments?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setAssignments(data.assignments || [])
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, orgUnitId, outcome, appliedQuery])

  useEffect(() => {
    if (authLoading || meLoading) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading])

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

  const visible = useMemo(
    () => (filter === 'all' ? assignments : assignments.filter((row) => row.status === filter)),
    [assignments, filter]
  )

  const counts = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const row of assignments) tally[row.status] = (tally[row.status] || 0) + 1
    return tally
  }, [assignments])

  const patchStatus = async (assignment: Assignment, status: string, label: string) => {
    setBusyId(assignment.id)
    try {
      const response = await authFetch(`/api/assignments/${assignment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || `Could not ${label.toLowerCase()}` })
        return
      }
      setAssignments((current) =>
        current.map((row) => (row.id === assignment.id ? { ...row, ...data.assignment } : row))
      )
      showToast({ type: 'success', title: `${label} done` })
    } finally {
      setBusyId(null)
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
            Calls I have assigned
          </h1>
          <p className="nk-sub mt-1">
            Track responses, record what you did about them, and schedule the next nudge.
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const count = option.value === 'all' ? assignments.length : counts[option.value] || 0
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={
                  filter === option.value
                    ? 'nk-btn-primary nk-btn-sm'
                    : 'nk-btn-secondary nk-btn-sm'
                }
              >
                {option.label}
                <span className="nk-mono opacity-70">{count}</span>
              </button>
            )
          })}
          <Link href="/researcher-matching" className="nk-btn-secondary nk-btn-sm ml-auto">
            Assign a new call
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="nk-input max-w-sm"
            placeholder="Search by call, agency, faculty name or employee ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load({ q: query })
            }}
          />
          {schoolOptions.length > 1 ? (
            <select
              className="nk-select max-w-xs"
              aria-label="Filter by school"
              value={orgUnitId}
              onChange={(event) => void load({ orgUnitId: event.target.value })}
            >
              <option value="">
                {me.capabilities.isTenantWide ? 'All schools' : 'All my schools'}
              </option>
              {schoolOptions.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="nk-select max-w-xs"
            aria-label="Filter by outcome"
            value={outcome}
            onChange={(event) => void load({ outcome: event.target.value })}
          >
            <option value="">Any outcome</option>
            <option value="PENDING">Outcome pending</option>
            <option value="AWARDED">Awarded</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            onClick={() => void load({ q: query })}
          >
            Search
          </button>
          {orgUnitId || outcome || appliedQuery ? (
            <button
              type="button"
              className="nk-btn-secondary nk-btn-sm"
              onClick={() => {
                setQuery('')
                void load({ orgUnitId: '', outcome: '', q: '' })
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {loading ? (
          <p className="nk-sub">Loading assignments…</p>
        ) : visible.length === 0 ? (
          <div className="nk-panel-quiet px-5 py-12 text-center">
            <p className="nk-title">
              {assignments.length === 0 ? 'You have not assigned any calls yet' : 'Nothing here'}
            </p>
            <p className="nk-sub mx-auto mt-1 max-w-md">
              {assignments.length === 0
                ? 'Find a funding call, match it against your faculty, and assign it — it will show up here for chasing.'
                : 'Try another filter.'}
            </p>
            {assignments.length === 0 ? (
              <Link href="/researcher-matching" className="nk-btn-primary nk-btn-sm mt-4">
                Find researchers for a call
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((assignment, index) => {
              const badge = STATUS_BADGE[assignment.status] || {
                label: assignment.status,
                className: 'nk-badge',
              }
              const isOpen = openId === assignment.id
              return (
                <li
                  key={assignment.id}
                  className="nk-panel nk-enter"
                  style={{ ['--nk-i' as string]: Math.min(index, 8) }}
                >
                  <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={badge.className}>{badge.label}</span>
                        {assignment.deadlineAt ? (
                          <span className="nk-sub">due {formatDate(assignment.deadlineAt)}</span>
                        ) : null}
                      </div>
                      <p className="nk-title mt-1.5 truncate">
                        {assignment.call?.title || 'Untitled call'}
                      </p>
                      <p className="nk-sub mt-0.5">
                        {assignment.assignee?.name || assignment.assignee?.email || 'Unknown'}
                        {assignment.call?.agencyName ? ` · ${assignment.call.agencyName}` : ''}
                      </p>
                      {assignment.status === 'DECLINED' && assignment.declinedReason ? (
                        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                          <span className="font-semibold">Declined:</span>{' '}
                          {assignment.declinedReason}
                        </p>
                      ) : null}
                      {/* The chain, so a passed-on call reads as one story
                          rather than two unrelated records. */}
                      {assignment.passedOnFrom ? (
                        <p className="nk-sub mt-2 text-[12px]">
                          Passed on from {assignment.passedOnFrom.name || 'a colleague'}
                          {assignment.passedOnFrom.declinedReason
                            ? ` — ${assignment.passedOnFrom.declinedReason}`
                            : ''}
                        </p>
                      ) : null}
                      {assignment.passedOnTo ? (
                        <p className="nk-sub mt-2 text-[12px]">
                          Passed on to {assignment.passedOnTo.name || 'a colleague'} (
                          {assignment.passedOnTo.status.toLowerCase().replace(/_/g, ' ')})
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {assignment.status === 'DECLINED' ? (
                        <button
                          type="button"
                          className="nk-btn-secondary nk-btn-sm"
                          disabled={busyId === assignment.id}
                          onClick={() => patchStatus(assignment, 'ASSIGNED', 'Re-request')}
                        >
                          Ask again
                        </button>
                      ) : null}
                      {/* Passing it on beats cancel-and-recreate: the new record
                          keeps the decline reason and the chase history. */}
                      {!assignment.passedOnTo &&
                      ['DECLINED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(
                        assignment.status
                      ) ? (
                        <button
                          type="button"
                          className="nk-btn-secondary nk-btn-sm"
                          onClick={() => setReassignTarget(assignment)}
                        >
                          Pass on
                        </button>
                      ) : null}
                      {['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(assignment.status) ? (
                        <button
                          type="button"
                          className="nk-btn-ghost nk-btn-sm"
                          disabled={busyId === assignment.id}
                          onClick={() => patchStatus(assignment, 'CANCELLED', 'Cancel')}
                        >
                          Cancel
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="nk-btn-secondary nk-btn-sm"
                        onClick={() => setOpenId(isOpen ? null : assignment.id)}
                      >
                        {isOpen ? 'Hide follow-ups' : 'Follow-ups'}
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="border-t border-nickel-200 px-5 py-4">
                      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1">
                        <span className="nk-sub">Assigned {formatDate(assignment.createdAt)}</span>
                        <span className="nk-sub">
                          Responded {assignment.respondedAt ? formatDate(assignment.respondedAt) : '—'}
                        </span>
                        <span className="nk-sub">
                          Submitted {assignment.submittedAt ? formatDate(assignment.submittedAt) : '—'}
                        </span>
                      </div>
                      <FollowUpPanel assignmentId={assignment.id} />
                      <div className="mt-5 border-t border-nickel-200 pt-4">
                        <AssignmentDossier
                          assignmentId={assignment.id}
                          outcome={assignment.outcome}
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {reassignTarget ? (
          <ReassignDialog
            assignment={reassignTarget}
            onClose={() => setReassignTarget(null)}
            onDone={(message) => {
              setReassignTarget(null)
              showToast({ type: 'success', title: message })
              void load()
            }}
          />
        ) : null}
      </div>
    </main>
  )
}
