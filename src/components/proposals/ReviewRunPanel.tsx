'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'

/**
 * Starting, watching and sharing a review run.
 *
 * The run is server-side, so this screen is a window onto it rather than the
 * thing driving it: the officer can close the tab and the review carries on.
 * Every step shown is a real completed unit of work — a section reviewed, the
 * report compiled — never a timer pretending to be progress.
 */

interface ReviewRun {
  id: string
  versionId: string
  versionNo: number | null
  status: string
  overallScore: number | null
  recommendation: string | null
  sharedAt: string | null
  officerNote: string | null
  error: string | null
  errorCode: string | null
  progress: { steps?: Step[]; reviewed?: number; failed?: number; phase?: string; log?: LogLine[] } | null
  importSummary: any
  hasReport: boolean
  hasDocx: boolean
}

interface Step {
  key: string
  title: string
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'
  score?: number | null
  detail?: string | null
}

interface LogLine {
  at: string
  message: string
}

const LIVE = ['QUEUED', 'IMPORTING', 'REVIEWING', 'REPORTING']

const PHASE_LABEL: Record<string, string> = {
  QUEUED: 'Waiting to start',
  IMPORTING: 'Reading the document',
  REVIEWING: 'Reviewing each section',
  REPORTING: 'Compiling the panel report',
  DONE: 'Finished',
  FAILED: 'Stopped',
  CANCELLED: 'Cancelled',
}

const STEP_MARK: Record<Step['status'], string> = {
  pending: '·',
  active: '▸',
  done: '✓',
  failed: '×',
  skipped: '–',
}

export default function ReviewRunPanel({
  proposalId,
  versionId,
  versionNo,
  reviewerCallId,
  initialReview,
  onChanged,
}: {
  proposalId: string
  versionId: string
  versionNo: number
  reviewerCallId: string | null
  initialReview: ReviewRun | null
  onChanged: () => void | Promise<void>
}) {
  const { authFetch } = useAuth()
  const { showToast } = useToast()

  const [review, setReview] = useState<ReviewRun | null>(initialReview)
  const [busy, setBusy] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [officerNote, setOfficerNote] = useState(initialReview?.officerNote || '')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const live = review ? LIVE.includes(review.status) : false

  const poll = useCallback(async () => {
    if (!review?.id) return
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/reviews/${review.id}`)
      if (!response.ok) return
      const data = await response.json()
      setReview(data.review)
      if (!LIVE.includes(data.review.status)) {
        await onChanged()
      }
    } catch {
      // A dropped poll is not worth reporting; the next tick tries again.
    }
  }, [authFetch, proposalId, review?.id, onChanged])

  // Poll only while something is actually happening.
  useEffect(() => {
    if (!live) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    pollRef.current = setInterval(() => void poll(), 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [live, poll])

  async function start(skipImport = false) {
    setBusy(true)
    try {
      const response = await authFetch(
        `/api/proposals/${proposalId}/versions/${versionId}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipImport }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not start the review.')
      setReview(data.review)
      showToast({
        type: 'success',
        title: 'Review started',
        description: 'It runs on the server — you can close this page.',
      })
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not start', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!review?.id) return
    setBusy(true)
    try {
      const response = await authFetch(`/api/proposals/${proposalId}/reviews/${review.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not cancel.')
      await poll()
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not cancel', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    if (!review?.id) return
    setBusy(true)
    try {
      const response = await authFetch(
        `/api/proposals/${proposalId}/reviews/${review.id}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officerNote: officerNote.trim() || null }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not share the review.')
      setReview(data.review)
      setShowShare(false)
      showToast({ type: 'success', title: 'Sent to the researcher' })
      await onChanged()
    } catch (error: any) {
      showToast({ type: 'error', title: 'Could not share', description: error?.message })
    } finally {
      setBusy(false)
    }
  }

  const steps = review?.progress?.steps || []
  const doneCount = steps.filter((step) => ['done', 'skipped'].includes(step.status)).length
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0

  if (!review) {
    return (
      <div className="nk-panel-quiet mt-3 p-4">
        <p className="nk-sub text-sm">
          This draft has not been reviewed. The review runs on the server, so you can start it and close
          the page.
        </p>
        <button
          type="button"
          className="nk-btn-primary nk-btn-sm mt-3"
          disabled={busy}
          onClick={() => void start(false)}
        >
          {busy ? 'Starting…' : `Run the AI review on v${versionNo}`}
        </button>
      </div>
    )
  }

  return (
    <div className="nk-panel-quiet mt-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {live && <span className="nk-lamp" aria-hidden />}
          <span className="nk-label">{PHASE_LABEL[review.status] || review.status}</span>
        </div>
        {review.overallScore != null && (
          <span className="nk-readout-sm">{review.overallScore.toFixed(1)}</span>
        )}
      </div>

      {live && steps.length > 0 && (
        <div className="mt-3">
          <div className="nk-meter">
            <div className="nk-meter-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="nk-hint mt-1 text-xs">
            {doneCount} of {steps.length} steps
          </p>
        </div>
      )}

      {steps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {steps.map((step) => (
            <li key={step.key} className="flex items-baseline gap-2 text-sm">
              <span
                className={
                  step.status === 'failed'
                    ? 'text-rose-600'
                    : step.status === 'done'
                      ? 'text-emerald-600'
                      : 'text-nickel-500'
                }
                aria-hidden
              >
                {STEP_MARK[step.status]}
              </span>
              <span className={step.status === 'active' ? 'text-nickel-900' : 'text-nickel-700'}>
                {step.title}
              </span>
              {step.score != null && <span className="nk-mono text-xs">{step.score.toFixed(1)}</span>}
              {step.detail && <span className="nk-hint text-xs">{step.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {review.status === 'FAILED' && review.error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm text-rose-700">{review.error}</p>
          {review.errorCode === 'IMPORT_UNMAPPED' && reviewerCallId && (
            <p className="nk-hint mt-2 text-xs">
              Open the workspace, assign the sections by hand, then run the review again without the
              import step.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {live ? (
          <button type="button" className="nk-btn-secondary nk-btn-sm" disabled={busy} onClick={() => void cancel()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            disabled={busy}
            onClick={() => void start(false)}
          >
            {review.status === 'DONE' ? 'Run again' : 'Try again'}
          </button>
        )}

        {review.errorCode === 'IMPORT_UNMAPPED' && (
          <button
            type="button"
            className="nk-btn-secondary nk-btn-sm"
            disabled={busy}
            onClick={() => void start(true)}
          >
            Review what I mapped by hand
          </button>
        )}

        {reviewerCallId && (
          <a
            href={`/reviewer/${reviewerCallId}`}
            target="_blank"
            rel="noreferrer"
            className="nk-btn-ghost nk-btn-sm"
          >
            Open reviewer workspace
          </a>
        )}

        {review.status === 'DONE' && !review.sharedAt && (
          <button
            type="button"
            className="nk-btn-primary nk-btn-sm ml-auto"
            onClick={() => setShowShare(true)}
          >
            Share with the researcher
          </button>
        )}

        {review.sharedAt && (
          <span className="nk-badge-ok ml-auto">
            Shared {new Date(review.sharedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {showShare && (
        <div className="mt-4 rounded-md border border-hairline bg-white p-4">
          <h4 className="nk-label mb-2">Send this review to the researcher</h4>
          <p className="nk-hint mb-3 text-xs">
            They will see the score, the panel&rsquo;s remarks and the Word document. A copy is frozen now,
            so later runs will not rewrite what you send today.
          </p>
          <textarea
            className="nk-input w-full"
            rows={3}
            placeholder="A covering note (optional) — what to prioritise, when you need the revision"
            value={officerNote}
            maxLength={5000}
            onChange={(event) => setOfficerNote(event.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" className="nk-btn-primary nk-btn-sm" disabled={busy} onClick={() => void share()}>
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="nk-btn-ghost nk-btn-sm" onClick={() => setShowShare(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
