'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useToast } from '@/components/ui/toast'
import FollowUpPanel from '@/components/funding-dept/FollowUpPanel'

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
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch('/api/assignments?view=assigned-by-me&limit=300')
      if (response.ok) {
        const data = await response.json()
        setAssignments(data.assignments || [])
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (authLoading || meLoading) return
    void load()
  }, [authLoading, meLoading, load])

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
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
