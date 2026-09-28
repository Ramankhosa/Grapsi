'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ALLOCATION_REASONS, ALLOCATION_REASON_LABELS, allocationHref, type AllocationReason } from '@/lib/assignments/manualAllocation'

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
  manual?: boolean
  embedded?: boolean
  onSavingChange?: (saving: boolean) => void
  onClose: () => void
  onAssigned: (assignment?: { id: string }) => void
}

export default function AssignDialog({
  callId,
  callTitle,
  person,
  callCloseDate,
  manual = false,
  embedded = false,
  onSavingChange,
  onClose,
  onAssigned,
}: Props) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const submitting = useRef(false)
  const [reason, setReason] = useState<AllocationReason | ''>('')
  const [note, setNote] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)
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
    if (submitting.current || (manual && !reason)) return
    submitting.current = true
    setSaving(true)
    onSavingChange?.(true)
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
          matchScore: manual ? undefined : person.score ?? undefined,
          matchTier: manual ? undefined : person.matchTier ?? undefined,
          ...(manual ? { allocationMethod: 'MANUAL', allocationReason: reason, allocationNote: note.trim() || null } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Could not create the assignment')
        if (data.assignmentId) setExistingId(data.assignmentId)
        return
      }
      showToast({
        type: 'success',
        title: `Assigned to ${person.name}`,
        message: 'Saved. The usual assignment notifications have been requested.',
        action: data.assignment?.id ? { label: 'Open allocation', onClick: () => router.push(allocationHref(data.assignment.id)) } : undefined,
      })
      onAssigned(data.assignment)
    } catch {
      setError('Could not create the assignment')
    } finally {
      setSaving(false)
      submitting.current = false
      onSavingChange?.(false)
    }
  }

  return (
    <div className={embedded ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'}>
      <div className={embedded ? '' : 'nk-panel w-full max-w-lg max-h-[90vh] overflow-y-auto p-6'}>
        {!embedded && <><h3 className="nk-title text-lg">Assign to {person.name}</h3><p className="nk-sub mt-1">{callTitle}</p></>}

        {error && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
            {existingId && <Link className="ml-2 underline" href={allocationHref(existingId)}>Open allocation</Link>}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {manual && <>
            <div><label className="nk-label mb-1" htmlFor="allocation-reason">Allocation reason (required)</label>
              <select id="allocation-reason" className="nk-input" value={reason} required disabled={saving} onChange={event => setReason(event.target.value as AllocationReason)}>
                <option value="">Choose a reason</option>{ALLOCATION_REASONS.map(value => <option key={value} value={value}>{ALLOCATION_REASON_LABELS[value]}</option>)}
              </select>
              <p className="nk-sub mt-1">The faculty member will still accept or decline this allocation.</p>
            </div>
            <div><label className="nk-label mb-1" htmlFor="allocation-note">Allocation note (optional, visible to faculty)</label>
              <textarea id="allocation-note" className="nk-input" rows={2} maxLength={2000} value={note} disabled={saving} onChange={event => setNote(event.target.value)} />
            </div>
          </>}
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
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="nk-btn-primary nk-btn-sm"
            onClick={() => void submit()}
            disabled={saving || Boolean(existingId) || (manual && !reason)}
          >
            {saving ? 'Saving…' : manual ? 'Allocate and notify' : 'Assign and notify'}
          </button>
        </div>
      </div>
    </div>
  )
}
