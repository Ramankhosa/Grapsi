'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * The contact log for one assignment, plus the form that adds to it.
 *
 * The reminder controls live inside the same form as the note because that is
 * how the work actually happens: you log the call you just made and set the
 * date you will chase again in the same breath.
 */

interface FollowUp {
  id: string
  kind: string
  note: string
  happenedAt: string
  remindAt: string | null
  remindFaculty: boolean
  reminderSentAt: string | null
  author: { id: string; name: string | null; email: string } | null
}

const KINDS = [
  { value: 'NOTE', label: 'Note' },
  { value: 'CALL', label: 'Phone call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'REMINDER', label: 'Reminder' },
]

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((kind) => [kind.value, kind.label])
)

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function FollowUpPanel({ assignmentId }: { assignmentId: string }) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [kind, setKind] = useState('NOTE')
  const [note, setNote] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [remindFaculty, setRemindFaculty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(`/api/assignments/${assignmentId}/follow-ups`)
      if (response.ok) {
        const data = await response.json()
        setFollowUps(data.followUps || [])
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch, assignmentId])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!note.trim()) return
    setSaving(true)
    try {
      const response = await authFetch(`/api/assignments/${assignmentId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          note: note.trim(),
          remindAt: remindAt ? new Date(remindAt).toISOString() : null,
          remindFaculty,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || 'Could not save that follow-up' })
        return
      }
      setFollowUps((current) => [data.followUp, ...current])
      setNote('')
      setRemindAt('')
      setRemindFaculty(false)
      setKind('NOTE')
      showToast({
        type: 'success',
        title: 'Follow-up recorded',
        message: data.followUp?.remindAt
          ? remindFaculty
            ? 'They will be reminded at the time you chose.'
            : 'You will be reminded at the time you chose.'
          : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const response = await authFetch(`/api/assignments/${assignmentId}/follow-ups/${id}`, {
      method: 'DELETE',
    })
    if (response.ok) {
      setFollowUps((current) => current.filter((row) => row.id !== id))
    } else {
      const data = await response.json().catch(() => ({}))
      showToast({ type: 'error', title: data.error || 'Could not remove that follow-up' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="nk-panel-quiet px-4 py-4">
        <p className="nk-eyebrow">Record a follow-up</p>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                className={
                  kind === option.value ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <textarea
            className="nk-input min-h-[76px]"
            placeholder="What happened? e.g. Called — he is waiting on a co-PI confirmation."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={5000}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="nk-label mb-1" htmlFor={`remind-${assignmentId}`}>
                Remind me on
              </label>
              <input
                id={`remind-${assignmentId}`}
                type="datetime-local"
                className="nk-input w-auto"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
              />
            </div>
            <label className="flex min-h-[38px] items-center gap-2 text-[13px] text-nickel-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-nickel-300 text-cobalt-600 focus:ring-cobalt-500"
                checked={remindFaculty}
                disabled={!remindAt}
                onChange={(event) => setRemindFaculty(event.target.checked)}
              />
              Also email the faculty member
            </label>
            <button
              type="button"
              className="nk-btn-primary nk-btn-sm ml-auto"
              onClick={submit}
              disabled={saving || !note.trim()}
            >
              {saving ? 'Saving…' : 'Add follow-up'}
            </button>
          </div>
          <p className="nk-sub">
            Only the funding department sees this log. Tick the box above when the nudge should
            reach the faculty member too.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="nk-sub">Loading follow-ups…</p>
      ) : followUps.length === 0 ? (
        <p className="nk-sub">No follow-ups recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {followUps.map((row) => (
            <li key={row.id} className="nk-panel px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="nk-badge">{KIND_LABEL[row.kind] || row.kind}</span>
                <span className="nk-sub">{formatWhen(row.happenedAt)}</span>
                <span className="nk-sub">
                  · {row.author?.name || row.author?.email || 'Unknown'}
                </span>
                <button
                  type="button"
                  className="nk-btn-ghost nk-btn-xs ml-auto"
                  onClick={() => remove(row.id)}
                >
                  Remove
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-nickel-800">
                {row.note}
              </p>
              {row.remindAt ? (
                <p className="nk-sub mt-2">
                  {row.reminderSentAt
                    ? `Reminder sent ${formatWhen(row.reminderSentAt)}`
                    : `Reminder set for ${formatWhen(row.remindAt)}`}
                  {row.remindFaculty ? ' · faculty notified' : ' · private to you'}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
