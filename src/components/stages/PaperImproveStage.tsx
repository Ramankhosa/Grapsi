'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, Sparkles, Wrench } from 'lucide-react'
import PaperReviewReport, { type PaperReviewFixPreview } from '@/components/stages/PaperReviewReport'
import { PaperReviewModeSwitcher, PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'
import {
  applyPaperReviewFixOptimistically,
  getLatestPaperReviewByMode,
  getPaperDraftSectionMapFromSession,
  resolvePaperReviewIssueOptimistically,
  revertPaperReviewFixOptimistically,
  updatePaperDraftSectionInSession,
  upsertPaperReviewIntoSession,
} from '@/lib/paper-review-utils'
import {
  formatPaperReviewDateTime,
  persistPaperReviewMode,
  readPersistedPaperReviewMode,
} from '@/lib/paper-review-ui'
import type { PaperReviewIssue, PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
  onSectionSelect?: (sectionKey: string) => void
}

function updateSession(
  session: any,
  review: PaperReviewRecord,
  onSessionUpdated?: (session: any) => void,
  sectionUpdate?: { sectionKey: string; content: string }
) {
  let nextSession = upsertPaperReviewIntoSession(session, review)
  if (sectionUpdate) {
    nextSession = updatePaperDraftSectionInSession(
      nextSession,
      sectionUpdate.sectionKey,
      sectionUpdate.content
    )
  }
  onSessionUpdated?.(nextSession)
  return nextSession
}

export default function PaperImproveStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
  onSectionSelect,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PaperReviewFixPreview | null>(null)
  const [previewingIssueId, setPreviewingIssueId] = useState<string | null>(null)
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null)
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null)
  const [revertingIssueId, setRevertingIssueId] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<PaperReviewMode>('quick')
  const [hasInitializedMode, setHasInitializedMode] = useState(false)

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return
    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load improvement workspace')
      setSession(data.session)
      onSessionUpdated?.(data.session)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load improvement workspace')
    } finally {
      setLoading(false)
    }
  }, [authToken, onSessionUpdated, sessionId])

  useEffect(() => {
    const persisted = readPersistedPaperReviewMode(sessionId)
    if (persisted) {
      setSelectedMode(persisted)
      setHasInitializedMode(true)
    }
  }, [sessionId])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const handleModeChange = useCallback((mode: PaperReviewMode) => {
    setSelectedMode(mode)
    persistPaperReviewMode(sessionId, mode)
    setPreview(null)
  }, [sessionId])

  const quickReview = useMemo(
    () => getLatestPaperReviewByMode(session, 'quick'),
    [session]
  ) as PaperReviewRecord | null
  const detailedReview = useMemo(
    () => getLatestPaperReviewByMode(session, 'section_by_section'),
    [session]
  ) as PaperReviewRecord | null
  const sectionContentByKey = useMemo(
    () => getPaperDraftSectionMapFromSession(session),
    [session]
  )

  useEffect(() => {
    if (hasInitializedMode) return
    if (detailedReview) {
      handleModeChange('section_by_section')
      setHasInitializedMode(true)
      return
    }
    if (quickReview) {
      handleModeChange('quick')
      setHasInitializedMode(true)
    }
  }, [detailedReview, handleModeChange, hasInitializedMode, quickReview])

  const latestReview = selectedMode === 'section_by_section' ? detailedReview : quickReview

  useEffect(() => {
    if (selectedMode === 'quick' && !quickReview && detailedReview) {
      handleModeChange('section_by_section')
      return
    }
    if (selectedMode === 'section_by_section' && !detailedReview && quickReview) {
      handleModeChange('quick')
    }
  }, [detailedReview, handleModeChange, quickReview, selectedMode])

  const jumpToSection = useCallback((sectionKey: string) => {
    onSectionSelect?.(sectionKey)
    onNavigateToStage?.('SECTION_DRAFTING')
  }, [onNavigateToStage, onSectionSelect])

  const previewFix = useCallback(async (issue: PaperReviewIssue) => {
    if (!sessionId || !authToken || !latestReview) return
    try {
      setPreviewingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'preview_review_fix',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to preview improvement')
      setPreview({
        issueId: issue.id,
        reviewId: latestReview.reviewId,
        sectionKey: issue.sectionKey,
        sectionLabel: issue.sectionLabel,
        title: issue.title,
        originalContent: String(data.originalContent || ''),
        fixedContent: String(data.fixedContent || ''),
      })
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview improvement')
    } finally {
      setPreviewingIssueId(null)
    }
  }, [authToken, latestReview, sessionId])

  const applyPreview = useCallback(async () => {
    if (!preview || !authToken || !sessionId || !latestReview || !session) return
    try {
      setApplyingIssueId(preview.issueId)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'apply_review_fix',
          sessionId,
          reviewId: preview.reviewId,
          issueId: preview.issueId,
          originalContent: preview.originalContent,
          fixedContent: preview.fixedContent,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to apply improvement')
      const nextReview = applyPaperReviewFixOptimistically(
        latestReview,
        preview.issueId,
        preview.originalContent,
        preview.fixedContent,
        data.appliedAt
      )
      setSession(
        updateSession(session, nextReview, onSessionUpdated, {
          sectionKey: preview.sectionKey,
          content: preview.fixedContent,
        })
      )
      setPreview(null)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply improvement')
    } finally {
      setApplyingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, preview, session, sessionId])

  const resolveIssue = useCallback(async (issue: PaperReviewIssue, resolution: 'fixed' | 'ignored') => {
    if (!authToken || !latestReview || !sessionId || !session) return
    try {
      setResolvingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'resolve_review_issue',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
          resolution,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update issue status')
      const nextReview = resolvePaperReviewIssueOptimistically(
        latestReview,
        issue.id,
        resolution,
        data.appliedAt
      )
      setSession(updateSession(session, nextReview, onSessionUpdated))
      if (preview?.issueId === issue.id) setPreview(null)
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Unable to update issue status')
    } finally {
      setResolvingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, preview?.issueId, session, sessionId])

  const revertFix = useCallback(async (issue: PaperReviewIssue) => {
    if (!authToken || !latestReview || !sessionId || !session) return
    try {
      setRevertingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'revert_review_fix',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to revert fix')
      const nextReview = revertPaperReviewFixOptimistically(latestReview, issue.id, data.revertedAt)
      setSession(
        updateSession(session, nextReview, onSessionUpdated, {
          sectionKey: data.sectionKey,
          content: data.revertedContent,
        })
      )
    } catch (revertError) {
      setError(revertError instanceof Error ? revertError.message : 'Unable to revert fix')
    } finally {
      setRevertingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, session, sessionId])

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center text-slate-600">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading improvement workspace...
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        {error}
      </div>
    )
  }

  if (!latestReview) {
    return (
      <div className="space-y-6 p-6">
        <PaperReviewPipelineStepper
          currentStage="MANUSCRIPT_IMPROVE"
          onNavigateToStage={stage => onNavigateToStage?.(stage)}
          canAccessImprove={false}
          canAccessExport={false}
        />
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-2xl text-center">
            <Sparkles className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">
              Improve depends on a saved review
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Run the Review stage first. Improve executes actions from the latest saved report in the selected review mode.
            </p>
            <button
              type="button"
              onClick={() => onNavigateToStage?.('MANUSCRIPT_REVIEW')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Go To Review
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <PaperReviewPipelineStepper
        currentStage="MANUSCRIPT_IMPROVE"
        onNavigateToStage={stage => onNavigateToStage?.(stage)}
        canAccessImprove
        canAccessExport
      />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(5,150,105,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#ecfeff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <Wrench className="h-3.5 w-3.5" />
                Recommendation execution
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Resolve the review queue without losing context
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Run recommendation fixes inline, compare old and new section content, and keep the whole report unified while you move section by section.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              Review basis: {formatPaperReviewDateTime(latestReview.reviewedAt)}
            </div>
          </div>
          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>
      </div>

      <PaperReviewModeSwitcher
        selectedMode={selectedMode}
        onChange={handleModeChange}
        latestRunByMode={{
          quick: quickReview?.reviewedAt,
          section_by_section: detailedReview?.reviewedAt,
        }}
        noun="improvement pass"
      />

      {latestReview.summary.pendingIssues === 0 && (
        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                All issues in this review are addressed
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The saved review queue is clear. Continue to Export for the final structural and citation checks.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToStage?.('REVIEW_EXPORT')}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Proceed To Adaptive Export
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <PaperReviewReport
        review={latestReview}
        sectionContentByKey={sectionContentByKey}
        onSectionSelect={jumpToSection}
        onOpenExport={() => onNavigateToStage?.('REVIEW_EXPORT')}
        interactive
        preview={preview}
        previewingIssueId={previewingIssueId}
        applyingIssueId={applyingIssueId}
        resolvingIssueId={resolvingIssueId}
        revertingIssueId={revertingIssueId}
        onPreviewFix={previewFix}
        onApplyPreview={applyPreview}
        onClosePreview={() => setPreview(null)}
        onResolveIssue={resolveIssue}
        onRevertFix={revertFix}
      />
    </div>
  )
}
