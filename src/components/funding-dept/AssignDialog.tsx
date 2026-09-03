'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * Hand one call to one person.
 *
 * The matching page has an equivalent dialog, but it lives inline in a
 * 1,500-line file and reads from that page's state. This is the same two
 * fields against the same endpoint, usable from anywhere a person and a call
 * are already on screen.
 */

interface Props {
  callId: string
  callTitle: string
  person: { userId: string; name: string; score?: number | null; matchTier?: string | null }
  /** Deadline the call itself closes on, to sanity-check the internal one. */
  callCloseDate?: string | null
  onClose: () => void
  onAssigned: () => void
}

export default function AssignDialog({
  callId,
  callTitle,
  person,
  callCloseDate,
  onClose,
  onAssigned,
}: Props) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()
  const [deadline, setDeadline] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An internal deadline after the call closes is almost always a slip, and
  // costs a missed submission. Warn, but do not block — a rolling call has no
  // close date and an officer may know something the record does not.
  const afterClose = Boolean(
    deadline && callCloseDate && new Date(deadline) > new Date(callCloseDate)
  )

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await authFetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fundingCallId: callId,
          assigneeUserId: person.userId,
          deadlineAt: deadline ? new Date(deadline).toISOString() : null,
          message: message.trim() || null,
          matchScore: person.score ?? undefined,
          matchTier: person.matchTier ?? undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not create the assignment')
        return
      }
      showToast({
        type: 'success',
        title: `Assigned to ${person.name}`,
        message: 'They have been notified by app and email.',
      })
      onAssigned()
    } catch {
      setError('Could not create the assignment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="nk-panel w-full max-w-lg p-6">
        <h3 className="nk-title text-lg">Assign to {person.name}</h3>
        <p className="nk-sub mt-1">{callTitle}</p>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="nk-label mb-1" htmlFor="assign-deadline">
              Internal deadline
            </label>
            <input
              id="assign-deadline"
              type="date"
              className="nk-input w-auto"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
            <p className="nk-sub mt-1">
              {afterClose
                ? 'That is after the call closes — the department usually sets an earlier internal date.'
                : 'When the department needs it, not when the funder closes. Drives the automatic nudges.'}
            </p>
          </div>

          <div>
            <label className="nk-label mb-1" htmlFor="assign-message">
              Message to the faculty member
            </label>
            <textarea
              id="assign-message"
              rows={4}
              className="nk-input"
              placeholder="Why you thought of them, and what you need back."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={5000}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nk-btn-primary nk-btn-sm"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'Assigning…' : 'Assign and notify'}
          </button>
        </div>
      </div>
    </div>
  )
}
