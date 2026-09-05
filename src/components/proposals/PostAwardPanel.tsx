'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  MILESTONE_KINDS,
  MILESTONE_LABELS,
  type MilestoneKind,
  type MilestoneStatus,
} from '@/lib/proposals/shared'

/**
 * What the institution owes the agency once the money has arrived.
 *
 * Shown to the applicant as well as the office, because the certificate is
 * usually theirs to prepare — a due date only they can meet is no use sitting
 * on somebody else's screen.
 */

export interface ProposalMilestone {
  id: string
  kind: string
  kindLabel: string
  title: string
  dueAt: string | null
  amount: number | null
  currency: string | null
  status: string
  statusLabel: string
  completedAt: string | null
  note: string | null
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  SUBMITTED: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200',
  CLEARED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WAIVED: 'bg-nickel-100 text-nickel-600 border-nickel-200',
}

function daysUntil(value: string | null): number | null {
  if (!value) return null
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
}

export default function PostAwardPanel({
  proposalId,
  milestones,
  projectStartAt,
  projectEndAt,
  currency,
  canEdit,
  onChanged,
}: {
  proposalId: string
  milestones: ProposalMilestone[]
  projectStartAt: string | null
  projectEndAt: string | null
  currency: string
  canEdit: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<MilestoneKind>('UC')
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [amount, setAmount] = useState('')
  const [scheduleStart, setScheduleStart] = useState(new Date().toISOString().slice(0, 10))
  const [scheduleYears, setScheduleYears] = useState('3')

  async function post(body: Record<string, unknown>, successTitle: string) {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not save that.')
      showToast({ type: 'success', title: successTitle })
      setAdding(false)
      setTitle('')
      setDueAt('')
      setAmount('')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not save', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(milestone: ProposalMilestone, status: MilestoneStatus) {
    setBusy(true)
    try {
      const response = await authFetch(
        `/api/proposals/${proposalId}/milestones/${milestone.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not update that.')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not update', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <p className="nk-hint text-xs">Project starts</p>
          <p className="nk-mono text-sm">
            {projectStartAt ? new Date(projectStartAt).toLocaleDateString() : '—'}
          </p>
        </div>
        <div>
          <p className="nk-hint text-xs">Project ends</p>
          <p className="nk-mono text-sm">
            {projectEndAt ? new Date(projectEndAt).toLocaleDateString() : '—'}
          </p>
        </div>
      </div>

      {milestones.length === 0 ? (
        <div className="nk-panel-quiet p-4">
          <p className="nk-sub text-sm">
            Nothing is being tracked yet. A standard schedule sets a utilisation certificate and a
            progress report for each project year, which you can then adjust.
          </p>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="nk-label" htmlFor="pa-start">
                  Project starts
                </label>
                <input
                  id="pa-start"
                  type="date"
                  className="nk-input mt-1"
                  value={scheduleStart}
                  onChange={(event) => setScheduleStart(event.target.value)}
                />
              </div>
              <div>
                <label className="nk-label" htmlFor="pa-years">
                  Years
                </label>
                <input
                  id="pa-years"
                  type="number"
                  min={1}
                  max={10}
                  className="nk-input mt-1 w-20"
                  value={scheduleYears}
                  onChange={(event) => setScheduleYears(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="nk-btn-primary nk-btn-sm"
                disabled={busy}
                onClick={() =>
                  void post(
                    {
                      action: 'schedule',
                      startAt: scheduleStart,
                      years: Number(scheduleYears) || 1,
                    },
                    'Schedule created'
                  )
                }
              >
                Create the schedule
              </button>
            </div>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {milestones.map((milestone) => {
            const days = daysUntil(milestone.dueAt)
            const late = milestone.status === 'PENDING' && days !== null && days < 0
            return (
              <li key={milestone.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-nickel-900">{milestone.title}</p>
                  <p className="nk-hint mt-0.5 text-xs">
                    {milestone.kindLabel}
                    {milestone.dueAt
                      ? ` · due ${new Date(milestone.dueAt).toLocaleDateString()}`
                      : ''}
                    {milestone.amount != null
                      ? ` · ${milestone.currency || currency} ${milestone.amount.toLocaleString()}`
                      : ''}
                    {late ? ` · ${Math.abs(days!)} days overdue` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      late ? 'bg-rose-50 text-rose-700 border-rose-200' : STATUS_STYLE[milestone.status] || STATUS_STYLE.PENDING
                    }`}
                  >
                    {late ? 'Overdue' : milestone.statusLabel}
                  </span>
                  {canEdit && (
                    <select
                      className="nk-select text-xs"
                      value={milestone.status}
                      disabled={busy}
                      onChange={(event) =>
                        void setStatus(milestone, event.target.value as MilestoneStatus)
                      }
                    >
                      <option value="PENDING">Due</option>
                      <option value="SUBMITTED">Submitted</option>
                      <option value="CLEARED">Cleared</option>
                      <option value="WAIVED">Waived</option>
                    </select>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && milestones.length > 0 && (
        <div>
          {!adding ? (
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => setAdding(true)}>
              Add an obligation
            </button>
          ) : (
            <div className="nk-panel-quiet p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="nk-label" htmlFor="ms-kind">
                    Type
                  </label>
                  <select
                    id="ms-kind"
                    className="nk-select mt-1 w-full"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as MilestoneKind)}
                  >
                    {MILESTONE_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {MILESTONE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="nk-label" htmlFor="ms-due">
                    Due
                  </label>
                  <input
                    id="ms-due"
                    type="date"
                    className="nk-input mt-1 w-full"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </div>
                <div>
                  <label className="nk-label" htmlFor="ms-title">
                    Title
                  </label>
                  <input
                    id="ms-title"
                    className="nk-input mt-1 w-full"
                    placeholder={MILESTONE_LABELS[kind]}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div>
                  <label className="nk-label" htmlFor="ms-amount">
                    Amount (optional)
                  </label>
                  <input
                    id="ms-amount"
                    className="nk-input mt-1 w-full"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="nk-btn-primary nk-btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void post(
                      {
                        action: 'add',
                        kind,
                        title: title.trim() || null,
                        dueAt: dueAt || null,
                        amount: amount ? Number(amount) || null : null,
                      },
                      'Obligation added'
                    )
                  }
                >
                  Add
                </button>
                <button type="button" className="nk-btn-ghost nk-btn-sm" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
