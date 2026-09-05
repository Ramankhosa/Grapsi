'use client'

import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import {
  PROPOSAL_DOCUMENT_KINDS,
  PROPOSAL_DOCUMENT_LABELS,
  type ProposalDocumentKind,
} from '@/lib/proposals/shared'

/**
 * The letters the institution has issued on this proposal.
 *
 * The applicant's side is deliberately plain: a list and a download, because
 * that is the whole of what they need — the endorsement letter goes in their
 * submission bundle. The issuing form only appears for the office.
 */

export interface ProposalLetter {
  id: string
  kind: string
  kindLabel: string
  title: string
  referenceNo: string | null
  issuedOn: string | null
  signedBy: string | null
  fileName: string
  byteSize: number
  note: string | null
  visibleToFaculty: boolean
  issuedBy: string | null
  createdAt: string
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function LetterList({
  proposalId,
  letters,
  canIssue,
  onChanged,
}: {
  proposalId: string
  letters: ProposalLetter[]
  canIssue: boolean
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<ProposalDocumentKind>('ENDORSEMENT')
  const [referenceNo, setReferenceNo] = useState('')
  const [signedBy, setSignedBy] = useState('')
  const [issuedOn, setIssuedOn] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [visible, setVisible] = useState(true)

  async function issue() {
    if (!file) {
      showToast({ type: 'error', title: 'Attach the signed letter' })
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      if (referenceNo.trim()) form.append('referenceNo', referenceNo.trim())
      if (signedBy.trim()) form.append('signedBy', signedBy.trim())
      if (issuedOn) form.append('issuedOn', issuedOn)
      if (note.trim()) form.append('note', note.trim())
      form.append('visibleToFaculty', String(visible))

      const response = await authFetch(`/api/proposals/${proposalId}/documents`, {
        method: 'POST',
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not issue that document.')

      showToast({
        type: 'success',
        title: `${data.document.title} issued`,
        description: visible ? 'The researcher has been told.' : 'Kept on the internal file.',
      })
      setOpen(false)
      setFile(null)
      setReferenceNo('')
      setSignedBy('')
      setNote('')
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not issue', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function download(letter: ProposalLetter) {
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/documents/${letter.id}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Could not download that letter.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = letter.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      showToast({ type: 'error', title: 'Download failed', description: error?.message })
    }
  }

  async function withdraw(letter: ProposalLetter) {
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/documents/${letter.id}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not withdraw that letter.')
      showToast({ type: 'success', title: 'Withdrawn' })
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not withdraw', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {canIssue && (
        <div>
          {!open ? (
            <button type="button" className="nk-btn-primary nk-btn-sm" onClick={() => setOpen(true)}>
              Issue a letter
            </button>
          ) : (
            <div className="nk-panel-quiet p-4">
              <h3 className="nk-label mb-3">Issue a letter</h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="nk-label" htmlFor="letter-kind">
                    Type
                  </label>
                  <select
                    id="letter-kind"
                    className="nk-select mt-1 w-full"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as ProposalDocumentKind)}
                  >
                    {PROPOSAL_DOCUMENT_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {PROPOSAL_DOCUMENT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="nk-label" htmlFor="letter-ref">
                    Reference number
                  </label>
                  <input
                    id="letter-ref"
                    className="nk-input mt-1 w-full"
                    placeholder="e.g. DSR/2026/114"
                    value={referenceNo}
                    onChange={(event) => setReferenceNo(event.target.value)}
                  />
                </div>
                <div>
                  <label className="nk-label" htmlFor="letter-signed">
                    Signed by
                  </label>
                  <input
                    id="letter-signed"
                    className="nk-input mt-1 w-full"
                    placeholder="e.g. Registrar"
                    value={signedBy}
                    onChange={(event) => setSignedBy(event.target.value)}
                  />
                </div>
                <div>
                  <label className="nk-label" htmlFor="letter-date">
                    Date on the letter
                  </label>
                  <input
                    id="letter-date"
                    type="date"
                    className="nk-input mt-1 w-full"
                    value={issuedOn}
                    onChange={(event) => setIssuedOn(event.target.value)}
                  />
                </div>
              </div>

              <div className="mt-3">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="block w-full text-sm text-nickel-700 file:mr-3 file:rounded-md file:border-0 file:bg-nickel-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-nickel-800 hover:file:bg-nickel-200"
                />
                <p className="nk-hint mt-2 text-xs">
                  The signed copy — a scan or a photograph is fine. PDF, JPG, PNG or .docx.
                </p>
              </div>

              <textarea
                className="nk-input mt-3 w-full"
                rows={2}
                placeholder="A note for the researcher (optional)"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />

              <label className="mt-3 flex items-center gap-2 text-sm text-nickel-700">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => setVisible(event.target.checked)}
                />
                Send it to the researcher
              </label>
              <p className="nk-hint mt-1 text-xs">
                Uncheck only for a file copy the applicant should not receive.
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="nk-btn-primary nk-btn-sm"
                  disabled={busy || !file}
                  onClick={() => void issue()}
                >
                  {busy ? 'Issuing…' : 'Issue'}
                </button>
                <button type="button" className="nk-btn-ghost nk-btn-sm" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {letters.length === 0 ? (
        <p className="nk-sub text-sm">
          {canIssue
            ? 'No letter has been issued on this proposal yet.'
            : 'Your funding department has not issued any letters on this proposal yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {letters.map((letter) => (
            <li key={letter.id} className="nk-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="nk-title text-sm">{letter.title}</p>
                  <p className="nk-hint mt-1 text-xs">
                    {letter.referenceNo ? `${letter.referenceNo} · ` : ''}
                    {formatDate(letter.issuedOn)}
                    {letter.signedBy ? ` · signed by ${letter.signedBy}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!letter.visibleToFaculty && <span className="nk-badge text-[10px]">internal</span>}
                  <button
                    type="button"
                    className="nk-btn-secondary nk-btn-xs"
                    onClick={() => void download(letter)}
                  >
                    Download
                  </button>
                  {canIssue && (
                    <button
                      type="button"
                      className="nk-btn-ghost nk-btn-xs"
                      disabled={busy}
                      onClick={() => void withdraw(letter)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
              {letter.note && <p className="nk-sub mt-3 text-sm">{letter.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
