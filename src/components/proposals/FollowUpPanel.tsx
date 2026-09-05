'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  FOLLOW_UP_KINDS,
  FOLLOW_UP_KIND_LABELS,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  type ProposalFollowUpKind,
  type ProposalStatus,
} from '@/lib/proposals/shared'

/**
 * Recording a call with the researcher.
 *
 * One form does the three things the job involves: what they said, where that
 * puts the proposal, and when to ask again. Splitting them apart is how a
 * status ends up describing a conversation nobody wrote down.
 */

export interface ProposalFollowUp {
  id: string
  kind: string
  kindLabel: string
  note: string
  happenedAt: string
  recordedStatus: string | null
  remindAt: string | null
  reminderSentAt: string | null
  visibleToFaculty: boolean
  author: string | null
}

/** The statuses a follow-up plausibly establishes. */
const REPORTABLE: ProposalStatus[] = [
  'UNDER_AGENCY_REVIEW',
  'REVISION_REQUESTED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
]

export default function FollowUpPanel({
  proposalId,
  followUps,
  currentStatus,
  canTrackAgency,
  onChanged,
}: {
  proposalId: string
  followUps: ProposalFollowUp[]
  currentStatus: string
  canTrackAgency: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [kind, setKind] = useState<ProposalFollowUpKind>('CALL')
  const [note, setNote] = useState('')
  const [recordStatus, setRecordStatus] = useState('')
  const [sanctionAmount, setSanctionAmount] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!note.trim()) {
      showToast({ type: 'error', title: 'Write down what was said' })
      return
    }
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          note: note.trim(),
          recordStatus: recordStatus || null,
          remindAt: remindAt || null,
          visibleToFaculty: visible,
          ...(recordStatus === 'SANCTIONED' && sanctionAmount
            ? { sanctionedAmount: Number(sanctionAmount) || null }
            : {}),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not record that.')

      showToast({
        type: 'success',
        title: recordStatus ? 'Recorded and status updated' : 'Recorded',
      })
      setNote('')
      setRecordStatus('')
      setSanctionAmount('')
      setRemindAt('')
      setVisible(false)
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not record', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function remove(followUp: ProposalFollowUp) {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/follow-ups/${followUp.id}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not remove that note.')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not remove', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="nk-panel-quiet p-4">
        <h3 className="nk-label mb-1">Record a follow-up</h3>
        <p className="nk-hint mb-3 text-xs">
          What the researcher told you, where it puts the proposal, and when to ask again.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="nk-label" htmlFor="fu-kind">
              How
            </label>
            <select
              id="fu-kind"
              className="nk-select mt-1 w-full"
              value={kind}
              onChange={(event) => setKind(event.target.value as ProposalFollowUpKind)}
            >
              {FOLLOW_UP_KINDS.map((value) => (
                <option key={value} value={value}>
                  {FOLLOW_UP_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {canTrackAgency && (
            <div>
              <label className="nk-label" htmlFor="fu-status">
                This puts it at
              </label>
              <select
                id="fu-status"
                className="nk-select mt-1 w-full"
                value={recordStatus}
                onChange={(event) => setRecordStatus(event.target.value)}
              >
                <option value="">No change ({PROPOSAL_STATUS_LABELS[currentStatus as ProposalStatus] || currentStatus})</option>
                {REPORTABLE.filter((value) => value !== currentStatus).map((value) => (
                  <option key={value} value={value}>
                    {PROPOSAL_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="nk-label" htmlFor="fu-remind">
              Remind me on
            </label>
            <input
              id="fu-remind"
              type="date"
              className="nk-input mt-1 w-full"
              value={remindAt}
              onChange={(event) => setRemindAt(event.target.value)}
            />
          </div>
        </div>

        {recordStatus === 'SANCTIONED' && (
          <div className="mt-3">
            <label className="nk-label" htmlFor="fu-amount">
              Sanctioned amount
            </label>
            <input
              id="fu-amount"
              className="nk-input mt-1 w-full sm:max-w-xs"
              inputMode="decimal"
              value={sanctionAmount}
              onChange={(event) => setSanctionAmount(event.target.value)}
            />
          </div>
        )}

        <textarea
          className="nk-input mt-3 w-full"
          rows={3}
          placeholder="e.g. Rang Dr Sharma — the agency portal shows it with the expert committee, meeting in October."
          value={note}
          maxLength={5000}
          onChange={(event) => setNote(event.target.value)}
        />

        <label className="mt-2 flex items-center gap-2 text-sm text-nickel-700">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          The researcher can read this note
        </label>

        <button
          type="button"
          className="nk-btn-primary nk-btn-sm mt-3"
          disabled={busy || !note.trim()}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Record'}
        </button>
      </div>

      {followUps.length === 0 ? (
        <p className="nk-sub text-sm">No contact recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {followUps.map((followUp) => (
            <li key={followUp.id} className="nk-panel p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm text-nickel-800">{followUp.note}</p>
                <button
                  type="button"
                  className="nk-btn-ghost nk-btn-xs shrink-0"
                  disabled={busy}
                  onClick={() => void remove(followUp)}
                >
                  Remove
                </button>
              </div>
              <p className="nk-hint mt-1 text-xs">
                {followUp.kindLabel} · {new Date(followUp.happenedAt).toLocaleString()}
                {followUp.author ? ` · ${followUp.author}` : ''}
                {followUp.recordedStatus
                  ? ` · moved to ${(PROPOSAL_STATUS_LABELS[followUp.recordedStatus as ProposalStatus] || followUp.recordedStatus).toLowerCase()}`
                  : ''}
                {followUp.remindAt
                  ? ` · ${followUp.reminderSentAt ? 'reminded' : 'reminder'} ${new Date(followUp.remindAt).toLocaleDateString()}`
                  : ''}
                {followUp.visibleToFaculty ? ' · shared' : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
