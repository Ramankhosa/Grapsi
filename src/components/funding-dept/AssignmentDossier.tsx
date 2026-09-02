'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * The paperwork on one assignment: files, and what is still owed after an award.
 *
 * Both lists sit behind the same panel because they answer the same question at
 * two points in time — "what is the evidence for this application" before the
 * decision, and "what do we still owe the funder" after it.
 */

interface DocumentRow {
  id: string
  kind: string
  fileName: string
  byteSize: number
  note: string | null
  visibleToAssignee: boolean
  createdAt: string
  uploadedBy: string | null
  uploadedByUserId: string | null
}

interface MilestoneRow {
  id: string
  kind: string
  title: string
  dueAt: string | null
  amount: number | null
  currency: string | null
  status: string
  completedAt: string | null
  note: string | null
}

const DOCUMENT_KINDS = [
  { value: 'CONCEPT_NOTE', label: 'Concept note' },
  { value: 'ENDORSEMENT', label: 'Endorsement' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'SANCTION', label: 'Sanction order' },
  { value: 'OTHER', label: 'Other' },
]

const MILESTONE_KINDS = [
  { value: 'INSTALMENT', label: 'Instalment' },
  { value: 'UC', label: 'Utilisation certificate' },
  { value: 'SE', label: 'Statement of expenditure' },
  { value: 'REPORT', label: 'Progress report' },
  { value: 'OTHER', label: 'Other' },
]

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'nk-badge nk-badge-warn',
  SUBMITTED: 'nk-badge nk-badge-live',
  CLEARED: 'nk-badge nk-badge-ok',
  WAIVED: 'nk-badge',
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AssignmentDossier({
  assignmentId,
  outcome,
}: {
  assignmentId: string
  outcome?: string
}) {
  const { user, authFetch } = useAuth()
  const { showToast } = useToast()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [milestones, setMilestones] = useState<MilestoneRow[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const [docKind, setDocKind] = useState('OTHER')
  const [shareWithFaculty, setShareWithFaculty] = useState(true)

  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [msKind, setMsKind] = useState('UC')
  const [msTitle, setMsTitle] = useState('')
  const [msDue, setMsDue] = useState('')
  const [msAmount, setMsAmount] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [docs, stones] = await Promise.all([
        authFetch(`/api/assignments/${assignmentId}/documents`).then((r) =>
          r.ok ? r.json() : null
        ),
        authFetch(`/api/assignments/${assignmentId}/milestones`).then((r) =>
          r.ok ? r.json() : null
        ),
      ])
      if (docs) setDocuments(docs.documents || [])
      if (stones) {
        setMilestones(stones.milestones || [])
        setCanManage(Boolean(stones.canManage))
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch, assignmentId])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('kind', docKind)
      body.append('visibleToAssignee', String(shareWithFaculty))
      const response = await authFetch(`/api/assignments/${assignmentId}/documents`, {
        method: 'POST',
        body,
      })
      const data = await response.json()
      if (!response.ok) {
        showToast({ type: 'error', title: data.error || 'Could not upload that file' })
        return
      }
      showToast({ type: 'success', title: `${file.name} attached` })
      await load()
    } finally {
      setUploading(false)
    }
  }

  // The download route is Bearer-authenticated, so a plain <a href> (which
  // only sends cookies) would 401. Fetch with auth and hand the blob over.
  const downloadDocument = async (row: DocumentRow) => {
    setDownloadingId(row.id)
    try {
      const response = await authFetch(`/api/assignments/${assignmentId}/documents/${row.id}`)
      if (!response.ok) {
        showToast({
          type: 'error',
          title:
            response.status === 410
              ? 'That file is recorded but missing from storage'
              : 'Could not download that file',
        })
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = row.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingId(null)
    }
  }

  const removeDocument = async (id: string) => {
    const response = await authFetch(`/api/assignments/${assignmentId}/documents/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      showToast({ type: 'error', title: data.error || 'Could not remove that file' })
      return
    }
    setDocuments((current) => current.filter((row) => row.id !== id))
  }

  const addMilestone = async () => {
    if (!msTitle.trim()) return
    const response = await authFetch(`/api/assignments/${assignmentId}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: msKind,
        title: msTitle.trim(),
        dueAt: msDue ? new Date(msDue).toISOString() : null,
        amount: msAmount ? Number(msAmount) : null,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      showToast({ type: 'error', title: data.error || 'Could not add that' })
      return
    }
    setMsTitle('')
    setMsDue('')
    setMsAmount('')
    setShowMilestoneForm(false)
    await load()
  }

  const setMilestoneStatus = async (id: string, status: string) => {
    const response = await authFetch(`/api/assignments/${assignmentId}/milestones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneId: id, status }),
    })
    const data = await response.json()
    if (!response.ok) {
      showToast({ type: 'error', title: data.error || 'Could not update that' })
      return
    }
    setMilestones((current) =>
      current.map((row) => (row.id === id ? { ...row, ...data.milestone, dueAt: row.dueAt } : row))
    )
  }

  if (loading) return <p className="nk-sub">Loading paperwork…</p>

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="nk-eyebrow mb-2">Files ({documents.length})</p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            className="nk-select max-w-[190px]"
            value={docKind}
            onChange={(event) => setDocKind(event.target.value)}
          >
            {DOCUMENT_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="nk-btn-secondary nk-btn-sm cursor-pointer">
            {uploading ? 'Uploading…' : 'Attach a file'}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
                event.target.value = ''
              }}
            />
          </label>
          {canManage ? (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-cobalt-600"
                checked={shareWithFaculty}
                onChange={(event) => setShareWithFaculty(event.target.checked)}
              />
              <span className="nk-sub text-[11.5px]">Faculty can see it</span>
            </label>
          ) : null}
        </div>

        {documents.length === 0 ? (
          <p className="nk-sub">
            Nothing attached. Concept notes, endorsements and sanction orders belong here rather
            than in email.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={downloadingId === row.id}
                  onClick={() => void downloadDocument(row)}
                  className="text-[13px] font-medium text-cobalt-700 hover:underline disabled:opacity-60"
                >
                  {downloadingId === row.id ? 'Downloading…' : row.fileName}
                </button>
                <span className="nk-badge normal-case tracking-normal">
                  {DOCUMENT_KINDS.find((k) => k.value === row.kind)?.label || row.kind}
                </span>
                <span className="nk-sub text-[11.5px]">
                  {formatSize(row.byteSize)} · {row.uploadedBy || 'Unknown'} ·{' '}
                  {formatDate(row.createdAt)}
                </span>
                {canManage && !row.visibleToAssignee ? (
                  <span className="nk-badge nk-badge-warn">internal</span>
                ) : null}
                {canManage || (row.uploadedByUserId && row.uploadedByUserId === user?.user_id) ? (
                  <button
                    type="button"
                    className="nk-btn-ghost nk-btn-xs ml-auto"
                    onClick={() => void removeDocument(row.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="nk-eyebrow">After the award ({milestones.length})</p>
          {canManage ? (
            <button
              type="button"
              className="nk-btn-secondary nk-btn-xs"
              onClick={() => setShowMilestoneForm((visible) => !visible)}
            >
              {showMilestoneForm ? 'Cancel' : 'Add'}
            </button>
          ) : null}
        </div>

        {showMilestoneForm ? (
          <div className="nk-panel-quiet mb-3 space-y-2 px-3 py-3">
            <div className="flex flex-wrap gap-2">
              <select
                className="nk-select max-w-[190px]"
                value={msKind}
                onChange={(event) => setMsKind(event.target.value)}
              >
                {MILESTONE_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="nk-input flex-1"
                placeholder="e.g. First-year UC"
                value={msTitle}
                onChange={(event) => setMsTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="nk-sub text-[11.5px]">Due</span>
                <input
                  type="date"
                  className="nk-input"
                  value={msDue}
                  onChange={(event) => setMsDue(event.target.value)}
                />
              </label>
              <input
                className="nk-input max-w-[140px]"
                placeholder="Amount"
                inputMode="decimal"
                value={msAmount}
                onChange={(event) => setMsAmount(event.target.value)}
              />
              <button
                type="button"
                className="nk-btn-primary nk-btn-sm"
                disabled={!msTitle.trim()}
                onClick={() => void addMilestone()}
              >
                Add
              </button>
            </div>
            <p className="nk-sub text-[11.5px]">
              Due dates here are chased by the same reminders as a submission deadline.
            </p>
          </div>
        ) : null}

        {milestones.length === 0 ? (
          <p className="nk-sub">
            {outcome === 'AWARDED'
              ? 'Nothing recorded yet. Add the instalments and certificates this award owes.'
              : 'Instalments and certificates appear here once the call is awarded.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {milestones.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-nickel-900">{row.title}</span>
                <span className="nk-badge normal-case tracking-normal">{row.kind}</span>
                <span className={STATUS_BADGE[row.status] || 'nk-badge'}>
                  {row.status.toLowerCase()}
                </span>
                <span className="nk-sub text-[11.5px]">due {formatDate(row.dueAt)}</span>
                {row.amount ? (
                  <span className="nk-sub text-[11.5px]">
                    {row.currency || ''} {row.amount.toLocaleString('en-IN')}
                  </span>
                ) : null}
                {row.status === 'PENDING' ? (
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-xs ml-auto"
                    onClick={() => void setMilestoneStatus(row.id, 'SUBMITTED')}
                  >
                    Mark submitted
                  </button>
                ) : row.status === 'SUBMITTED' && canManage ? (
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-xs ml-auto"
                    onClick={() => void setMilestoneStatus(row.id, 'CLEARED')}
                  >
                    Mark cleared
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
