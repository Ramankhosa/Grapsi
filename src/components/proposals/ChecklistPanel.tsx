'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { CHECKLIST_SETTLED, type ChecklistStatus } from '@/lib/proposals/shared'

/**
 * The attachments an agency wants alongside the proposal.
 *
 * The applicant sees it read-only: it tells them what to send in, which is the
 * useful half. Only the office ticks a line, because a checklist the applicant
 * signs off records only that they believe they attached something.
 */

export interface ChecklistItem {
  id: string
  label: string
  isRequired: boolean
  status: string
  statusLabel: string
  note: string | null
  documentId: string | null
  documentName: string | null
  completedBy: string | null
  completedAt: string | null
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WAIVED: 'bg-nickel-100 text-nickel-700 border-nickel-200',
  NOT_APPLICABLE: 'bg-nickel-100 text-nickel-600 border-nickel-200',
}

export default function ChecklistPanel({
  proposalId,
  items,
  canEdit,
  onChanged,
}: {
  proposalId: string
  items: ChecklistItem[]
  canEdit: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [busyId, setBusyId] = useState<string | null>(null)
  const [waiving, setWaiving] = useState<string | null>(null)
  const [waiveReason, setWaiveReason] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  const outstanding = items.filter(
    (item) => item.isRequired && !CHECKLIST_SETTLED.includes(item.status as ChecklistStatus)
  ).length

  async function setStatus(item: ChecklistItem, status: ChecklistStatus, note?: string) {
    setBusyId(item.id)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/checklist/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(note !== undefined ? { note } : {}) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not update that line.')
      setWaiving(null)
      setWaiveReason('')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not update', description: error?.message })
    } finally {
      setBusyId(null)
    }
  }

  async function addLine() {
    if (!newLabel.trim()) return
    setAdding(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), isRequired: true }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not add that line.')
      setNewLabel('')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not add', description: error?.message })
    } finally {
      setAdding(false)
    }
  }

  if (items.length === 0) {
    return <p className="nk-sub text-sm">No attachments are being tracked for this proposal.</p>
  }

  return (
    <div className="space-y-4">
      <p className="nk-sub text-sm">
        {outstanding === 0
          ? 'Everything required is settled.'
          : `${outstanding} of ${items.length} still outstanding.`}
      </p>

      <ul className="divide-y divide-hairline">
        {items.map((item) => {
          const settled = CHECKLIST_SETTLED.includes(item.status as ChecklistStatus)
          return (
            <li key={item.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${settled ? 'text-nickel-600' : 'text-nickel-900'}`}>
                    {item.label}
                    {!item.isRequired && <span className="nk-hint ml-2 text-xs">optional</span>}
                  </p>
                  {item.documentName && (
                    <p className="nk-hint mt-0.5 text-xs">satisfied by {item.documentName}</p>
                  )}
                  {item.note && <p className="nk-hint mt-0.5 text-xs">{item.note}</p>}
                  {item.completedBy && settled && (
                    <p className="nk-hint mt-0.5 text-xs">
                      {item.statusLabel.toLowerCase()} by {item.completedBy}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[item.status] || STATUS_STYLE.PENDING
                    }`}
                  >
                    {item.statusLabel}
                  </span>

                  {canEdit && (
                    <select
                      className="nk-select text-xs"
                      value={item.status}
                      disabled={busyId === item.id}
                      onChange={(event) => {
                        const next = event.target.value as ChecklistStatus
                        // Waiving a required attachment is a decision that has
                        // to be explainable later, so it asks for the reason
                        // rather than accepting a silent click.
                        if (next === 'WAIVED') {
                          setWaiving(item.id)
                          return
                        }
                        void setStatus(item, next)
                      }}
                    >
                      <option value="PENDING">Outstanding</option>
                      <option value="DONE">Done</option>
                      <option value="WAIVED">Waived</option>
                      <option value="NOT_APPLICABLE">Not applicable</option>
                    </select>
                  )}
                </div>
              </div>

              {waiving === item.id && (
                <div className="mt-2 rounded-md border border-hairline bg-white p-3">
                  <label className="nk-label" htmlFor={`waive-${item.id}`}>
                    Why is this being waived?
                  </label>
                  <input
                    id={`waive-${item.id}`}
                    className="nk-input mt-1 w-full"
                    value={waiveReason}
                    maxLength={1000}
                    onChange={(event) => setWaiveReason(event.target.value)}
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="nk-btn-primary nk-btn-xs"
                      disabled={!waiveReason.trim() || busyId === item.id}
                      onClick={() => void setStatus(item, 'WAIVED', waiveReason.trim())}
                    >
                      Waive
                    </button>
                    <button
                      type="button"
                      className="nk-btn-ghost nk-btn-xs"
                      onClick={() => {
                        setWaiving(null)
                        setWaiveReason('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit && (
        <div className="flex gap-2">
          <input
            className="nk-input flex-1"
            placeholder="Add a line this agency also wants"
            value={newLabel}
            maxLength={200}
            onChange={(event) => setNewLabel(event.target.value)}
          />
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            disabled={adding || !newLabel.trim()}
            onClick={() => void addLine()}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
