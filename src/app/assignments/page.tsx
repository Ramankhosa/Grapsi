'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

interface Assignment {
  id: string
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  message: string | null
  deadlineAt: string | null
  matchScore: number | null
  matchTier: string | null
  submissionReference: string | null
  submissionUrl: string | null
  submissionNotes: string | null
  submittedAt: string | null
  completedAt: string | null
  outcome: 'PENDING' | 'AWARDED' | 'REJECTED' | 'WITHDRAWN'
  awardAmount: number | null
  awardCurrency: string | null
  decisionAt: string | null
  createdAt: string
  call: {
    id: string
    title: string
    agencyName: string | null
    closeDate: string | null
    deadlineAt: string | null
    sourceUrl: string | null
  } | null
  assignee: { id: string; name: string | null; email: string } | null
  assignedBy: { id: string; name: string | null; email: string } | null
}

const ASSIGNER_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPER_ADMIN']

const OUTCOME_STYLES: Record<Assignment['outcome'], { label: string; className: string }> = {
  PENDING: { label: 'Decision pending', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  AWARDED: { label: 'Awarded', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  REJECTED: { label: 'Rejected', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  WITHDRAWN: { label: 'Withdrawn', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
}

const STATUS_STYLES: Record<Assignment['status'], { label: string; className: string }> = {
  ASSIGNED: { label: 'Assigned', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  IN_PROGRESS: { label: 'In progress', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
}

/** Same urgency treatment the funding cards use, phrased for an internal due date. */
function deadlineBadge(value: string | null) {
  if (!value) {
    return { label: 'No deadline set', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  }
  const due = new Date(value)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)

  if (days < 0) {
    return {
      label: `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`,
      className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    }
  }
  if (days === 0) {
    return { label: 'Due today', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' }
  }
  if (days <= 30) {
    return {
      label: `Due in ${days} day${days !== 1 ? 's' : ''}`,
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    }
  }
  return {
    label: `Due ${due.toLocaleDateString()}`,
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }
}

export default function AssignmentsPage() {
  const { user, isLoading: authLoading, authFetch } = useAuth()

  const [view, setView] = useState<'mine' | 'managed'>('mine')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [completing, setCompleting] = useState<Assignment | null>(null)
  const [reference, setReference] = useState('')
  const [url, setUrl] = useState('')
  const [submittedAt, setSubmittedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Outcome capture (admin)
  const [deciding, setDeciding] = useState<Assignment | null>(null)
  const [outcome, setOutcome] = useState<Assignment['outcome']>('PENDING')
  const [awardAmount, setAwardAmount] = useState('')
  const [awardCurrency, setAwardCurrency] = useState('INR')
  const [decisionAt, setDecisionAt] = useState('')
  const [outcomeSaving, setOutcomeSaving] = useState(false)
  const [outcomeError, setOutcomeError] = useState<string | null>(null)

  const canManage = useMemo(
    () => Boolean(user?.roles?.some((role: string) => ASSIGNER_ROLES.includes(role))),
    [user]
  )

  const fetchAssignments = useCallback(async (nextView: 'mine' | 'managed') => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/assignments?view=${nextView}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load assignments')
      setAssignments(data.assignments || [])
    } catch (e: any) {
      setError(e.message)
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (user) fetchAssignments(view)
  }, [user, view, fetchAssignments])

  const patchAssignment = async (assignment: Assignment, body: Record<string, unknown>) => {
    const res = await authFetch(`/api/assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Update failed')
    return data.assignment as Assignment
  }

  const applyUpdate = (updated: Assignment) => {
    setAssignments(list => list.map(item => (item.id === updated.id ? updated : item)))
  }

  const startProgress = async (assignment: Assignment) => {
    try {
      applyUpdate(await patchAssignment(assignment, { status: 'IN_PROGRESS' }))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const cancelAssignment = async (assignment: Assignment) => {
    if (!confirm('Cancel this assignment? The faculty member will no longer be expected to submit.')) return
    try {
      applyUpdate(await patchAssignment(assignment, { status: 'CANCELLED' }))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const openComplete = (assignment: Assignment) => {
    setCompleting(assignment)
    setReference(assignment.submissionReference || '')
    setUrl(assignment.submissionUrl || '')
    setNotes(assignment.submissionNotes || '')
    setSubmittedAt(assignment.submittedAt ? assignment.submittedAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
    setModalError(null)
  }

  const submitCompletion = async () => {
    if (!completing) return
    if (!reference.trim() && !url.trim() && !notes.trim()) {
      setModalError('Add a reference number, a link, or notes as proof of submission.')
      return
    }
    setSaving(true)
    setModalError(null)
    try {
      const updated = await patchAssignment(completing, {
        status: 'COMPLETED',
        submissionReference: reference.trim() || null,
        submissionUrl: url.trim() || null,
        submissionNotes: notes.trim() || null,
        submittedAt: submittedAt || null,
      })
      applyUpdate(updated)
      setCompleting(null)
    } catch (e: any) {
      setModalError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const openDecision = (assignment: Assignment) => {
    setDeciding(assignment)
    setOutcome(assignment.outcome || 'PENDING')
    setAwardAmount(assignment.awardAmount != null ? String(assignment.awardAmount) : '')
    setAwardCurrency(assignment.awardCurrency || 'INR')
    setDecisionAt(
      assignment.decisionAt ? assignment.decisionAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
    )
    setOutcomeError(null)
  }

  const submitDecision = async () => {
    if (!deciding) return
    setOutcomeSaving(true)
    setOutcomeError(null)
    try {
      const parsedAmount = awardAmount.trim() ? Number(awardAmount) : null
      if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
        throw new Error('Enter a valid award amount.')
      }
      const updated = await patchAssignment(deciding, {
        outcome,
        awardAmount: outcome === 'AWARDED' ? parsedAmount : null,
        awardCurrency: outcome === 'AWARDED' ? awardCurrency.trim() || null : null,
        decisionAt: outcome === 'PENDING' ? null : decisionAt || null,
      })
      applyUpdate(updated)
      setDeciding(null)
    } catch (e: any) {
      setOutcomeError(e.message)
    } finally {
      setOutcomeSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sign in required</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Please log in to see your assignments.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Assignments</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {view === 'mine'
              ? 'Funding calls assigned to you. Record your submission to mark one complete.'
              : 'Funding calls your organization has assigned, and their submission status.'}
          </p>
        </div>

        {canManage && (
          <div className="mb-6 flex gap-2">
            {(['mine', 'managed'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  view === tab
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {tab === 'mine' ? 'My assignments' : 'Managed'}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {view === 'mine'
                ? 'No funding calls have been assigned to you yet.'
                : 'Your organization has not assigned any funding calls yet.'}
            </p>
            {view === 'managed' && (
              <a href="/researcher-matching" className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400">
                Find researchers to assign →
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {assignments.map(assignment => {
              const status = STATUS_STYLES[assignment.status]
              const deadline = deadlineBadge(assignment.deadlineAt)
              const isOpen = assignment.status === 'ASSIGNED' || assignment.status === 'IN_PROGRESS'

              return (
                <div
                  key={assignment.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                        {assignment.call?.title || 'Funding call'}
                      </h2>
                      <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        {assignment.call?.agencyName || 'Unknown agency'}
                        {view === 'managed' && assignment.assignee && (
                          <> · Assigned to <span className="font-medium text-gray-700 dark:text-gray-200">
                            {assignment.assignee.name || assignment.assignee.email}
                          </span></>
                        )}
                        {view === 'mine' && assignment.assignedBy && (
                          <> · Assigned by {assignment.assignedBy.name || assignment.assignedBy.email}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${deadline.className}`}>
                        {deadline.label}
                      </span>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${status.className}`}>
                        {status.label}
                      </span>
                      {assignment.outcome && assignment.outcome !== 'PENDING' && (
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            OUTCOME_STYLES[assignment.outcome]?.className || ''
                          }`}
                        >
                          {OUTCOME_STYLES[assignment.outcome]?.label}
                          {assignment.outcome === 'AWARDED' && assignment.awardAmount
                            ? ` · ${assignment.awardCurrency || ''}${new Intl.NumberFormat('en-IN').format(assignment.awardAmount)}`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {assignment.message && (
                    <blockquote className="mt-3 border-l-2 border-gray-300 dark:border-gray-600 pl-3 text-sm text-gray-600 dark:text-gray-300">
                      {assignment.message}
                    </blockquote>
                  )}

                  {assignment.status === 'COMPLETED' && (
                    <div className="mt-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 text-sm">
                      <p className="font-medium text-green-800 dark:text-green-300">Submission recorded</p>
                      <dl className="mt-1 space-y-0.5 text-green-900/80 dark:text-green-200/80">
                        {assignment.submissionReference && (
                          <div><span className="font-medium">Reference:</span> {assignment.submissionReference}</div>
                        )}
                        {assignment.submissionUrl && (
                          <div>
                            <span className="font-medium">Link:</span>{' '}
                            <a
                              href={assignment.submissionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline break-all"
                            >
                              {assignment.submissionUrl}
                            </a>
                          </div>
                        )}
                        {assignment.submittedAt && (
                          <div>
                            <span className="font-medium">Submitted:</span>{' '}
                            {new Date(assignment.submittedAt).toLocaleDateString()}
                          </div>
                        )}
                        {assignment.submissionNotes && (
                          <div><span className="font-medium">Notes:</span> {assignment.submissionNotes}</div>
                        )}
                      </dl>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    {assignment.call?.sourceUrl && (
                      <a
                        href={assignment.call.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        View call ↗
                      </a>
                    )}
                    {view === 'mine' && assignment.status === 'ASSIGNED' && (
                      <button
                        onClick={() => startProgress(assignment)}
                        className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                      >
                        Mark in progress
                      </button>
                    )}
                    {view === 'mine' && isOpen && (
                      <button
                        onClick={() => openComplete(assignment)}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                      >
                        Mark complete
                      </button>
                    )}
                    {view === 'mine' && assignment.status === 'COMPLETED' && (
                      <button
                        onClick={() => openComplete(assignment)}
                        className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        Edit submission info
                      </button>
                    )}
                    {view === 'managed' && canManage && assignment.status === 'COMPLETED' && (
                      <button
                        onClick={() => openDecision(assignment)}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        {assignment.outcome && assignment.outcome !== 'PENDING'
                          ? 'Edit decision'
                          : 'Record decision'}
                      </button>
                    )}
                    {view === 'managed' && isOpen && canManage && (
                      <button
                        onClick={() => cancelAssignment(assignment)}
                        className="text-sm text-red-600 hover:text-red-800 dark:text-red-400"
                      >
                        Cancel assignment
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Mark complete modal */}
      {completing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Record your submission</h3>
            <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">
              {completing.call?.title}. Provide at least one piece of submission info.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Proposal / reference number
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="e.g. SERB/2026/00412"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Submission link
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://portal.agency.gov/application/..."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Submission date
                </label>
                <input
                  type="date"
                  value={submittedAt}
                  onChange={e => setSubmittedAt(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Co-investigators, budget requested, anything the office should know..."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {modalError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setCompleting(null)}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submitCompletion}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Mark complete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Funding decision modal (admin) */}
      {deciding && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Record funding decision</h3>
            <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">
              {deciding.call?.title} · {deciding.assignee?.name || deciding.assignee?.email}
            </p>

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Assignment['outcome'])}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white mb-3"
            >
              {(['PENDING', 'AWARDED', 'REJECTED', 'WITHDRAWN'] as const).map((value) => (
                <option key={value} value={value}>{OUTCOME_STYLES[value].label}</option>
              ))}
            </select>

            {outcome === 'AWARDED' && (
              <div className="flex gap-2 mb-3">
                <div className="w-24">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
                  <input
                    type="text"
                    value={awardCurrency}
                    onChange={(e) => setAwardCurrency(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Award amount</label>
                  <input
                    type="number"
                    min="0"
                    value={awardAmount}
                    onChange={(e) => setAwardAmount(e.target.value)}
                    placeholder="e.g. 2500000"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {outcome !== 'PENDING' && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Decision date</label>
                <input
                  type="date"
                  value={decisionAt}
                  onChange={(e) => setDecisionAt(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
              </div>
            )}

            {outcomeError && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {outcomeError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeciding(null)}
                disabled={outcomeSaving}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submitDecision}
                disabled={outcomeSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
              >
                {outcomeSaving ? 'Saving...' : 'Save decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
