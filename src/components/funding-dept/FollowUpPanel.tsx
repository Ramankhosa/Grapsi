'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * The contact log for one piece of work, plus the form that adds to it.
 *
 * The reminder controls live inside the same form as the note because that is
 * how the work actually happens: you log the call you just made and set the
 * date you will chase again in the same breath.
 *
 * Two targets, one component. An assignment-level log hangs off an assignment;
 * a call-level log hangs off a (call, school) and exists so the earliest
 * chasing — before anyone has been assigned — has somewhere to go. The form is
 * identical except that a call-level note cannot email "the faculty member",
 * because there is not one yet.
 */

export type FollowUpTarget =
  | { assignmentId: string }
  | { callId: string; orgUnitId: string }

interface FollowUp {
  id: string
  kind: string
  stage: string | null
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

/**
 * Where the application stands, as opposed to how the contact happened.
 * Optional — most notes are just notes — and only SUBMITTED does anything
 * beyond labelling the note.
 */
const STAGES = [
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'APPROVALS', label: 'Approvals' },
  { value: 'SUBMITTED', label: 'Submitted' },
]

const STAGE_LABEL: Record<string, string> = {
  CONTACTED: 'Contacted',
  PREPARING: 'Preparing',
  APPROVALS: 'Approvals',
  SUBMITTED: 'Submitted',
}

const KIND_LABEL: Record<string, string> = {
  ...Object.fromEntries(KINDS.map((kind) => [kind.value, kind.label])),
  TRIAGE: 'Decision',
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function endpointFor(target: FollowUpTarget) {
  if ('assignmentId' in target) {
    return {
      list: `/api/assignments/${target.assignmentId}/follow-ups`,
      item: (id: string) => `/api/assignments/${target.assignmentId}/follow-ups/${id}`,
      key: target.assignmentId,
      isCallLevel: false,
    }
  }
  const query = `?orgUnitId=${encodeURIComponent(target.orgUnitId)}`
  return {
    list: `/api/funding-dept/calls/${target.callId}/follow-ups${query}`,
    item: (id: string) => `/api/funding-dept/calls/${target.callId}/follow-ups/${id}${query}`,
    key: `${target.callId}:${target.orgUnitId}`,
    isCallLevel: true,
  }
}

type Props = (
  | { assignmentId: string; target?: never }
  | { target: FollowUpTarget; assignmentId?: never }
) & {
  onLogged?: () => void
  /**
   * Render the form alone. The dossier shows this log merged into one
   * timeline with assignments, nudges and triage decisions, so repeating the
   * bare list underneath would show every note twice.
   */
  formOnly?: boolean
}

export default function FollowUpPanel(props: Props) {
  const target: FollowUpTarget = props.target ?? { assignmentId: props.assignmentId as string }
  const endpoint = endpointFor(target)
  const { authFetch } = useAuth()
  const { showToast } = useToast()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [kind, setKind] = useState('NOTE')
  const [stage, setStage] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [remindAt, setRemindAt] = useState('')
  const [remindFaculty, setRemindFaculty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await authFetch(endpoint.list)
      if (response.ok) {
        const data = await response.json()
        setFollowUps(data.followUps || [])
      }
    } finally {
      setLoading(false)
    }
    // endpoint.list is derived from endpoint.key; keying on the string keeps
    // the callback stable across re-renders that rebuild the target object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, endpoint.key])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!note.trim()) return
    setSaving(true)
    try {
      const response = await authFetch(endpoint.list, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          stage,
          note: note.trim(),
          remindAt: remindAt ? new Date(remindAt).toISOString() : null,
          remindFaculty: endpoint.isCallLevel ? false : remindFaculty,
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
      setStage(null)
      showToast({
        type: 'success',
        title: data.markedSubmitted ? 'Recorded as submitted' : 'Follow-up recorded',
        message: data.markedSubmitted
          ? 'The allocation is now marked submitted, and the department head has been told.'
          : data.followUp?.remindAt
          ? remindFaculty && !endpoint.isCallLevel
            ? 'They will be reminded at the time you chose.'
            : 'You will be reminded at the time you chose.'
          : undefined,
      })
      props.onLogged?.()
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const response = await authFetch(endpoint.item(id), { method: 'DELETE' })
    if (response.ok) {
      setFollowUps((current) => current.filter((row) => row.id !== id))
      props.onLogged?.()
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="nk-label mb-0 mr-1">Where it stands</span>
            {STAGES.filter((option) => !(endpoint.isCallLevel && option.value === 'SUBMITTED')).map(
              (option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStage(stage === option.value ? null : option.value)}
                  className={
                    stage === option.value ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'
                  }
                >
                  {option.label}
                </button>
              )
            )}
            <span className="nk-sub text-[11.5px]">optional</span>
          </div>
          {stage === 'SUBMITTED' ? (
            <p className="rounded-lg border border-cobalt-200 bg-cobalt-50 px-3 py-2 text-[12.5px] text-cobalt-800">
              This marks the allocation as submitted everywhere — the school, the department and the
              head. Put the reference number or portal link in the note so the record stands on its
              own.
            </p>
          ) : null}
          <textarea
            className="nk-input min-h-[76px]"
            placeholder={
              endpoint.isCallLevel
                ? 'What happened? e.g. Rang the HoD — will sound out two faculty by Friday.'
                : 'What happened? e.g. Called — he is waiting on a co-PI confirmation.'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={5000}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="nk-label mb-1" htmlFor={`remind-${endpoint.key}`}>
                Remind me on
              </label>
              <input
                id={`remind-${endpoint.key}`}
                type="datetime-local"
                className="nk-input w-auto"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
              />
            </div>
            {!endpoint.isCallLevel && (
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
            )}
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
            {endpoint.isCallLevel
              ? 'Only the funding department sees this log. Nobody is assigned yet, so a reminder here is a note to yourself.'
              : 'Only the funding department sees this log. Tick the box above when the nudge should reach the faculty member too.'}
          </p>
        </div>
      </div>

      {props.formOnly ? null : loading ? (
        <p className="nk-sub">Loading follow-ups…</p>
      ) : followUps.length === 0 ? (
        <p className="nk-sub">No follow-ups recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {followUps.map((row) => (
            <li key={row.id} className="nk-panel px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="nk-badge">{KIND_LABEL[row.kind] || row.kind}</span>
                {row.stage ? (
                  <span
                    className={
                      row.stage === 'SUBMITTED' ? 'nk-badge nk-badge-live' : 'nk-badge'
                    }
                  >
                    {STAGE_LABEL[row.stage] || row.stage}
                  </span>
                ) : null}
                <span className="nk-sub">{formatWhen(row.happenedAt)}</span>
                <span className="nk-sub">
                  · {row.author?.name || row.author?.email || 'Unknown'}
                </span>
                {row.kind !== 'TRIAGE' && (
                  <button
                    type="button"
                    className="nk-btn-ghost nk-btn-xs ml-auto"
                    onClick={() => remove(row.id)}
                  >
                    Remove
                  </button>
                )}
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
