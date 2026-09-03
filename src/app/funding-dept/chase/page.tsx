'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useToast } from '@/components/ui/toast'

/**
 * The backlog, worst first.
 *
 * Everything here is one screen away from the two actions an officer actually
 * takes — log what happened, and say when to look again — because the previous
 * route to those was expanding assignment rows one at a time.
 */

interface Reason {
  code: string
  label: string
}

interface ChaseRow {
  id: string
  status: string
  deadlineAt: string | null
  deadlineIn: number | null
  assignee: { id: string; name: string } | null
  assignedBy: { id: string; name: string; isMe: boolean } | null
  school: string | null
  /** The assignee's unit, for the dossier link. */
  schoolId?: string | null
  call: { id: string; title: string; agency: string | null } | null
  lastContact: { note: string; kind: string; happenedAt: string; author: string | null } | null
  pendingReminder: {
    id: string
    note: string
    remindAt: string | null
    remindFaculty: boolean
    author: string | null
  } | null
  reasons: Reason[]
  priority: number
}

interface ChaseData {
  view: 'mine' | 'schools'
  queue: ChaseRow[]
  counts: {
    needsAttention: number
    liveTotal: number
    overdue: number
    unanswered: number
    remindersDue: number
    deadlineNear: number
    goneQuiet: number
  }
}

const REASON_STYLE: Record<string, string> = {
  OVERDUE: 'nk-badge nk-badge-danger',
  UNANSWERED: 'nk-badge nk-badge-warn',
  REMINDER_DUE: 'nk-badge nk-badge-warn',
  DEADLINE_NEAR: 'nk-badge nk-badge-live',
  GONE_QUIET: 'nk-badge',
}

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'UNANSWERED', label: 'No answer' },
  { key: 'REMINDER_DUE', label: 'Reminder due' },
  { key: 'DEADLINE_NEAR', label: 'Deadline near' },
  { key: 'GONE_QUIET', label: 'Gone quiet' },
] as const

const KINDS = [
  { value: 'CALL', label: 'Phone call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'NOTE', label: 'Note' },
]

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** A date input default of "n days from today". */
function inDays(count: number) {
  const date = new Date()
  date.setDate(date.getDate() + count)
  return date.toISOString().slice(0, 10)
}

export default function ChaseQueuePage() {
  const { authFetch, isLoading: authLoading } = useAuth()
  const { me, loading: meLoading } = useFundingDeptMe()
  const { showToast } = useToast()

  const [data, setData] = useState<ChaseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'mine' | 'schools'>('schools')
  const [reasonFilter, setReasonFilter] = useState<string>('')
  const [selected, setSelected] = useState<string[]>([])

  // The bulk composer: one note against everything ticked, and the date the
  // officer will look again.
  const [kind, setKind] = useState('CALL')
  const [note, setNote] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [remindFaculty, setRemindFaculty] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (nextView: 'mine' | 'schools') => {
      setLoading(true)
      setView(nextView)
      try {
        const response = await authFetch(`/api/funding-dept/chase?view=${nextView}`)
        const payload = await response.json()
        if (!response.ok) {
          setError(payload.error || 'Could not load the chase queue.')
          return
        }
        setData(payload)
        setError(null)
      } catch {
        setError('Could not load the chase queue.')
      } finally {
        setLoading(false)
      }
    },
    [authFetch]
  )

  useEffect(() => {
    if (authLoading || meLoading) return
    void load('schools')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, meLoading])

  const visible = useMemo(() => {
    if (!data) return []
    if (!reasonFilter) return data.queue
    return data.queue.filter((row) => row.reasons.some((reason) => reason.code === reasonFilter))
  }, [data, reasonFilter])

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )

  const logAgainstSelected = async () => {
    if (selected.length === 0 || !note.trim()) return
    setSaving(true)
    try {
      const response = await authFetch('/api/funding-dept/chase/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'log',
          assignmentIds: selected,
          kind,
          note: note.trim(),
          remindAt: remindAt ? new Date(remindAt).toISOString() : null,
          remindFaculty,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not log that' })
        return
      }
      showToast({
        type: 'success',
        title: `Logged against ${payload.created} ${payload.created === 1 ? 'person' : 'people'}`,
        message:
          payload.skipped?.length > 0
            ? `${payload.skipped.length} skipped: ${payload.skipped[0].reason}`
            : undefined,
      })
      setNote('')
      setRemindAt('')
      setRemindFaculty(false)
      setSelected([])
      await load(view)
    } finally {
      setSaving(false)
    }
  }

  const snoozeSelected = async (days: number) => {
    const ids = visible
      .filter((row) => selected.includes(row.id) && row.pendingReminder)
      .map((row) => row.pendingReminder!.id)
    if (ids.length === 0) {
      showToast({ type: 'error', title: 'None of those have a reminder to push' })
      return
    }
    setSaving(true)
    try {
      const response = await authFetch('/api/funding-dept/chase/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze',
          followUpIds: ids,
          remindAt: new Date(inDays(days)).toISOString(),
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: payload.error || 'Could not push those reminders' })
        return
      }
      showToast({
        type: 'success',
        title: `${payload.snoozed} reminder${payload.snoozed === 1 ? '' : 's'} moved to ${formatDate(
          payload.remindAt
        )}`,
      })
      setSelected([])
      await load(view)
    } finally {
      setSaving(false)
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
          <h1 className="nk-title text-[19px]">Chase queue</h1>
          <p className="nk-sub mt-2">You are not a member of the funding department.</p>
        </div>
      </main>
    )
  }

  const counts = data?.counts

  return (
    <main className="nk-ground nk-wash">
      <div className="nk-grid absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-5">
          <p className="nk-eyebrow">Funding department</p>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] text-nickel-900">
            Chase queue
          </h1>
          <p className="nk-sub mt-1">
            {counts
              ? `${counts.needsAttention} of ${counts.liveTotal} live assignments need something from you.`
              : 'Everything that needs attention, worst first.'}
          </p>
          <div className="nk-ticks mt-3" aria-hidden />
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([
            { key: 'schools' as const, label: 'In my schools' },
            { key: 'mine' as const, label: 'Assigned by me' },
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
          <Link href="/funding-dept" className="nk-btn-secondary nk-btn-sm ml-auto">
            Back to my worklist
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((option) => {
            const count =
              option.key === ''
                ? counts?.needsAttention
                : option.key === 'OVERDUE'
                  ? counts?.overdue
                  : option.key === 'UNANSWERED'
                    ? counts?.unanswered
                    : option.key === 'REMINDER_DUE'
                      ? counts?.remindersDue
                      : option.key === 'DEADLINE_NEAR'
                        ? counts?.deadlineNear
                        : counts?.goneQuiet
            return (
              <button
                key={option.key || 'all'}
                type="button"
                className={
                  reasonFilter === option.key ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'
                }
                onClick={() => setReasonFilter(option.key)}
              >
                {option.label}
                {count ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>

        {error ? (
          <div className="nk-panel-quiet mb-4 px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        ) : null}

        {selected.length > 0 ? (
          <div className="nk-panel sticky top-2 z-10 mb-4 border-cobalt-200 bg-white px-5 py-4">
            <p className="nk-title text-[15px]">
              {selected.length} selected — log it once for all of them
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
              <select className="nk-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="nk-input"
                placeholder="e.g. Met at the school meeting, all three are drafting"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="nk-sub">Chase again on</span>
                <input
                  type="date"
                  className="nk-input"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-cobalt-600"
                  checked={remindFaculty}
                  onChange={(e) => setRemindFaculty(e.target.checked)}
                />
                <span className="nk-sub">Remind them, not me</span>
              </label>
              <button
                type="button"
                className="nk-btn-primary nk-btn-sm"
                disabled={saving || !note.trim()}
                onClick={() => void logAgainstSelected()}
              >
                {saving ? 'Saving…' : 'Log it'}
              </button>
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                disabled={saving}
                onClick={() => void snoozeSelected(7)}
                title="Push any pending reminder on these out by a week"
              >
                Push reminders a week
              </button>
              <button
                type="button"
                className="nk-btn-ghost nk-btn-sm ml-auto"
                onClick={() => setSelected([])}
              >
                Clear selection
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="nk-sub">Loading the queue…</p>
        ) : visible.length === 0 ? (
          <div className="nk-panel-quiet px-5 py-12 text-center">
            <p className="nk-title">Nothing needs chasing</p>
            <p className="nk-sub mx-auto mt-1 max-w-md">
              Every live assignment has been answered, has a reminder pending, or has been contacted
              recently.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="nk-btn-secondary nk-btn-sm"
                onClick={() => setSelected(visible.map((row) => row.id))}
              >
                Select all {visible.length}
              </button>
            </div>
            <ul className="space-y-2">
              {visible.map((row) => (
                <li key={row.id} className="nk-panel px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-cobalt-600"
                      checked={selected.includes(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.assignee?.name || 'assignment'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.reasons.map((reason) => (
                          <span
                            key={reason.code}
                            className={REASON_STYLE[reason.code] || 'nk-badge'}
                          >
                            {reason.label}
                          </span>
                        ))}
                      </div>
                      <p className="nk-title mt-1.5 truncate text-[15px]">
                        {row.assignee?.name || 'Unknown'}
                        <span className="nk-sub"> · {row.call?.title || 'Untitled call'}</span>
                      </p>
                      <p className="nk-sub mt-0.5">
                        {[row.school, row.call?.agency].filter(Boolean).join(' · ')}
                        {row.assignedBy && !row.assignedBy.isMe
                          ? ` · assigned by ${row.assignedBy.name}`
                          : ''}
                      </p>
                      {row.lastContact ? (
                        <p className="nk-sub mt-1.5 text-[12px]">
                          Last contact {formatDate(row.lastContact.happenedAt)} (
                          {row.lastContact.kind.toLowerCase()}
                          {row.lastContact.author ? `, ${row.lastContact.author}` : ''}):{' '}
                          {row.lastContact.note}
                        </p>
                      ) : (
                        <p className="nk-sub mt-1.5 text-[12px]">Nothing logged yet.</p>
                      )}
                      {row.pendingReminder ? (
                        <p className="nk-sub mt-1 text-[12px]">
                          Reminder set for {formatDate(row.pendingReminder.remindAt)}
                          {row.pendingReminder.remindFaculty ? ' (to them)' : ' (to you)'}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="nk-sub">{formatDate(row.deadlineAt)}</span>
                      <Link
                        href={
                          row.call
                            ? `/funding-dept/calls/${row.call.id}${row.schoolId ? `?school=${row.schoolId}` : ''}`
                            : '/funding-dept/assignments'
                        }
                        className="nk-btn-secondary nk-btn-sm"
                      >
                        Open
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  )
}
