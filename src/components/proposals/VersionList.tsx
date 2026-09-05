'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * The drafts, newest first, with the upload box above them.
 *
 * Downloads go through `authFetch` and a blob rather than a plain link:
 * authentication here is Bearer-only, so an `<a href>` 401s.
 */

export interface ProposalVersion {
  id: string
  versionNo: number
  fileName: string
  byteSize: number
  note: string | null
  overrideReason: string | null
  reviewStatus: string
  uploadedAt: string
  uploadedBy: string | null
}

const REVIEW_STATE_LABEL: Record<string, string> = {
  NONE: 'Not reviewed yet',
  QUEUED: 'Review queued',
  RUNNING: 'Review running',
  REVIEWED: 'Reviewed — not yet shared',
  FAILED: 'Review failed',
  SHARED: 'Review shared',
}

const REVIEW_STATE_STYLE: Record<string, string> = {
  NONE: 'nk-badge',
  QUEUED: 'nk-badge',
  RUNNING: 'nk-badge-live',
  REVIEWED: 'nk-badge-ok',
  FAILED: 'nk-badge-danger',
  SHARED: 'nk-badge-ok',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function VersionList({
  proposalId,
  versions,
  canUpload,
  canOverrideCutoff,
  onChanged,
  renderVersionExtra,
}: {
  proposalId: string
  versions: ProposalVersion[]
  canUpload: boolean
  canOverrideCutoff: boolean
  onChanged: () => void | Promise<void>
  renderVersionExtra?: (version: ProposalVersion) => React.ReactNode
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [needsOverride, setNeedsOverride] = useState(false)
  const [busy, setBusy] = useState(false)

  async function upload() {
    if (!file) {
      showToast({ type: 'error', title: 'Choose the document first' })
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (note.trim()) form.append('note', note.trim())
      if (overrideReason.trim()) form.append('overrideReason', overrideReason.trim())

      const response = await authFetch(`/api/proposals/${proposalId}/versions`, {
        method: 'POST',
        body: form,
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        // The cut-off refusal is the one an officer can answer, so the form
        // grows the field it needs rather than just reporting failure.
        if (data?.code === 'UPLOAD_BLOCKED' && canOverrideCutoff) setNeedsOverride(true)
        throw new Error(data?.error || 'Could not upload that draft.')
      }

      showToast({ type: 'success', title: `Version ${data.version.versionNo} uploaded` })
      setFile(null)
      setNote('')
      setOverrideReason('')
      setNeedsOverride(false)
      const input = document.getElementById('proposal-version-file') as HTMLInputElement | null
      if (input) input.value = ''
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Upload failed', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function download(version: ProposalVersion) {
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/versions/${version.id}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Could not download that file.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = version.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      showToast({ type: 'error', title: 'Download failed', description: error?.message })
    }
  }

  return (
    <div className="space-y-5">
      {canUpload && (
        <div className="nk-panel-quiet p-4">
          <h3 className="nk-label mb-3">Upload a draft</h3>
          <input
            id="proposal-version-file"
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="block w-full text-sm text-nickel-700 file:mr-3 file:rounded-md file:border-0 file:bg-nickel-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-nickel-800 hover:file:bg-nickel-200"
          />
          <p className="nk-hint mt-2 text-xs">
            PDF or Word (.docx), up to 25MB. Legacy .doc files cannot be read — save as .docx first.
          </p>

          <textarea
            className="nk-input mt-3 w-full"
            rows={2}
            placeholder="What changed in this version? (optional, the officer sees this)"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />

          {needsOverride && canOverrideCutoff && (
            <div className="mt-3">
              <label className="nk-label">Reason for accepting this after the cut-off</label>
              <input
                className="nk-input mt-1 w-full"
                value={overrideReason}
                maxLength={500}
                placeholder="e.g. the agency extended its deadline by a week"
                onChange={(event) => setOverrideReason(event.target.value)}
              />
            </div>
          )}

          <button
            type="button"
            className="nk-btn-primary nk-btn-sm mt-3"
            disabled={busy || !file}
            onClick={() => void upload()}
          >
            {busy ? 'Uploading…' : 'Upload draft'}
          </button>
        </div>
      )}

      {versions.length === 0 ? (
        <p className="nk-sub text-sm">No draft has been uploaded yet.</p>
      ) : (
        <ul className="space-y-3">
          {versions.map((version) => (
            <li key={version.id} className="nk-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="nk-title text-sm">
                    Version {version.versionNo}
                    <span className="nk-sub ml-2 font-normal">{version.fileName}</span>
                  </p>
                  <p className="nk-hint mt-1 text-xs">
                    {new Date(version.uploadedAt).toLocaleString()} ·{' '}
                    {version.uploadedBy || 'Unknown'} · {formatBytes(version.byteSize)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={REVIEW_STATE_STYLE[version.reviewStatus] || 'nk-badge'}>
                    {REVIEW_STATE_LABEL[version.reviewStatus] || version.reviewStatus}
                  </span>
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-xs"
                    onClick={() => void download(version)}
                  >
                    Download
                  </button>
                </div>
              </div>

              {version.note && <p className="nk-sub mt-3 text-sm">{version.note}</p>}
              {version.overrideReason && (
                <p className="nk-hint mt-2 text-xs">
                  Accepted after the cut-off: {version.overrideReason}
                </p>
              )}

              {renderVersionExtra?.(version)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
