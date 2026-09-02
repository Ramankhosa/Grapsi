'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

/**
 * Passing a call on to the next candidate.
 *
 * The picker searches the roster the caller can actually assign within, and
 * defaults to people carrying nothing — after a decline the next question is
 * always "who else could take this", and the answer is rarely the busiest
 * person in the school.
 */

interface Person {
  userId: string
  name: string | null
  email: string
  employeeId: string | null
  school: string | null
  department: string | null
  liveAssignments: number
}

export default function ReassignDialog({
  assignment,
  onClose,
  onDone,
}: {
  assignment: {
    id: string
    status: string
    deadlineAt: string | null
    declinedReason: string | null
    call: { title: string } | null
    assignee: { name: string | null; email: string } | null
  }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { authFetch } = useAuth()
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [searching, setSearching] = useState(false)
  const [target, setTarget] = useState<Person | null>(null)
  const [deadline, setDeadline] = useState(
    assignment.deadlineAt ? assignment.deadlineAt.slice(0, 10) : ''
  )
  const [message, setMessage] = useState('')
  const [closeReason, setCloseReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stillOpen = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(assignment.status)

  const search = useCallback(
    async (term: string) => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ limit: '25', sort: 'load-asc' })
        if (term) params.set('q', term)
        const response = await authFetch(`/api/tenant-admin/faculty?${params.toString()}`)
        if (response.ok) {
          const data = await response.json()
          setPeople(data.faculty || [])
        }
      } finally {
        setSearching(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    void search('')
  }, [search])

  const submit = async () => {
    if (!target) return
    setSaving(true)
    setError(null)
    try {
      const response = await authFetch(`/api/assignments/${assignment.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeUserId: target.userId,
          deadlineAt: deadline ? new Date(deadline).toISOString() : null,
          message: message.trim() || undefined,
          closeReason: closeReason.trim() || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not pass this call on.')
        return
      }
      onDone(`Passed to ${target.name || target.email}.`)
    } catch {
      setError('Could not pass this call on.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-nickel-900/40 px-4 py-10">
      <div className="nk-panel w-full max-w-2xl bg-white">
        <div className="nk-panel-head">
          <div>
            <h2 className="nk-title">Pass this call on</h2>
            <p className="nk-sub">
              {assignment.call?.title || 'Untitled call'} ·{' '}
              {assignment.assignee?.name || assignment.assignee?.email || 'Unknown'} could not take
              it
            </p>
          </div>
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {assignment.declinedReason ? (
            <div className="nk-panel-quiet px-4 py-3">
              <p className="nk-eyebrow mb-1">Their reason</p>
              <p className="text-[13.5px] text-nickel-800">{assignment.declinedReason}</p>
            </div>
          ) : null}

          <div>
            <label className="nk-label mb-1.5 block" htmlFor="reassign-search">
              Who takes it now
            </label>
            <input
              id="reassign-search"
              className="nk-input w-full"
              placeholder="Search by name, email or employee ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void search(query)
              }}
            />
            <p className="nk-sub mt-1 text-[11.5px]">
              Sorted by who is carrying least. Only people you can assign to are listed.
            </p>

            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-nickel-200">
              {searching ? (
                <p className="nk-sub px-4 py-6 text-center">Searching…</p>
              ) : people.length === 0 ? (
                <p className="nk-sub px-4 py-6 text-center">Nobody matches that search.</p>
              ) : (
                people.map((person) => (
                  <button
                    key={person.userId}
                    type="button"
                    onClick={() => setTarget(person)}
                    className={`block w-full border-b border-nickel-100 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-nickel-50 ${
                      target?.userId === person.userId ? 'bg-cobalt-50' : 'bg-white'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium text-nickel-900">
                          {person.name || person.email}
                        </span>
                        <span className="nk-sub block text-[12px]">
                          {[person.employeeId, person.department, person.school]
                            .filter(Boolean)
                            .join(' · ') || person.email}
                        </span>
                      </span>
                      <span
                        className={
                          person.liveAssignments > 0
                            ? 'nk-badge nk-badge-live shrink-0 tabular-nums'
                            : 'nk-badge shrink-0 tabular-nums'
                        }
                        title="Live assignments"
                      >
                        {person.liveAssignments}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="nk-label mb-1.5 block">Internal deadline</span>
              <input
                type="date"
                className="nk-input w-full"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
              <span className="nk-sub mt-1 block text-[11.5px]">
                Carried over from the original unless you change it.
              </span>
            </label>

            {stillOpen ? (
              <label className="block">
                <span className="nk-label mb-1.5 block">Why it is being moved</span>
                <input
                  className="nk-input w-full"
                  placeholder="e.g. on sabbatical"
                  value={closeReason}
                  onChange={(event) => setCloseReason(event.target.value)}
                />
                <span className="nk-sub mt-1 block text-[11.5px]">
                  Recorded against the original, which is still open.
                </span>
              </label>
            ) : null}
          </div>

          <label className="block">
            <span className="nk-label mb-1.5 block">Message to the new assignee</span>
            <textarea
              className="nk-input min-h-[80px] w-full"
              placeholder="Leave blank to carry the original brief over."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          {error ? <p className="text-[13px] text-red-700">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="nk-btn-primary nk-btn-sm"
              disabled={!target || saving}
              onClick={() => void submit()}
            >
              {saving ? 'Passing on…' : 'Pass it on'}
            </button>
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onClose}>
              Cancel
            </button>
            {stillOpen ? (
              <p className="nk-sub ml-auto text-[11.5px]">
                The original will be cancelled when you confirm.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
