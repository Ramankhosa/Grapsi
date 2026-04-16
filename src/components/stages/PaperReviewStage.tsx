'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
} from 'lucide-react'
import PaperReviewReport from '@/components/stages/PaperReviewReport'
import { PaperReviewModeSwitcher, PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'
import {
  getLatestPaperReviewByMode,
  getPaperDraftSectionMapFromSession,
} from '@/lib/paper-review-utils'
import {
  persistPaperReviewMode,
  readPersistedPaperReviewMode,
} from '@/lib/paper-review-ui'
import type { PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
  onSectionSelect?: (sectionKey: string) => void
}

type ReviewProgressState = {
  reviewMode: PaperReviewMode
  phase: 'prepare' | 'review' | 'summarize_context' | 'section_review' | 'aggregate' | 'persist' | 'complete'
  message: string
  totalSections?: number
  completedSections?: number
  sectionKey?: string
  sectionLabel?: string
  activityType?: 'started' | 'completed'
  concurrency?: number
  at?: string
}

function progressPercent(progress: ReviewProgressState | null) {
  if (!progress) return 0
  if (progress.reviewMode === 'section_by_section') {
    const total = Math.max(progress.totalSections || 1, 1)
    const completed = Math.min(progress.completedSections || 0, total)
    if (progress.phase === 'prepare') return 10
    if (progress.phase === 'summarize_context') return 14 + Math.round((completed / total) * 20)
    if (progress.phase === 'section_review') return 38 + Math.round((completed / total) * 42)
    if (progress.phase === 'aggregate') return 84
    if (progress.phase === 'persist') return 94
    return 100
  }
  if (progress.phase === 'prepare') return 20
  if (progress.phase === 'review') return 64
  if (progress.phase === 'persist') return 92
  return 100
}

function progressDetailText(progress: ReviewProgressState | null) {
  if (!progress) return ''
  if (progress.reviewMode !== 'section_by_section') {
    return 'The reviewer is working against the latest saved manuscript draft.'
  }

  const total = progress.totalSections || 0
  const completed = progress.completedSections || 0
  const concurrencyNote = progress.concurrency ? ` Up to ${progress.concurrency} sections can run in parallel.` : ''

  if (progress.phase === 'summarize_context' && progress.activityType === 'started' && progress.sectionLabel) {
    return `Preparing a reusable context brief for ${progress.sectionLabel}.${concurrencyNote}`
  }
  if (progress.phase === 'section_review' && progress.activityType === 'started' && progress.sectionLabel) {
    return `Running the section-specific reviewer for ${progress.sectionLabel}.${concurrencyNote}`
  }
  if (progress.phase === 'summarize_context' && total > 0) {
    return `${completed} of ${total} neighboring-section context briefs prepared.${concurrencyNote}`
  }
  if (progress.phase === 'section_review' && total > 0) {
    return `${completed} of ${total} sections reviewed with full-text target analysis.${concurrencyNote}`
  }
  if (progress.phase === 'aggregate') {
    return 'Cross-section findings are being consolidated into a single manuscript report.'
  }
  if (progress.phase === 'persist') {
    return 'Saving the review report and issue queue.'
  }
  return 'Preparing the section-by-section review workspace.'
}

function progressBadgeLabel(progress: ReviewProgressState | null) {
  if (!progress) return 'Review'
  if (progress.reviewMode !== 'section_by_section') return 'Quick review'
  if (progress.phase === 'summarize_context') return 'Summarizing context'
  if (progress.phase === 'section_review') return 'Reviewing sections'
  if (progress.phase === 'aggregate') return 'Aggregating findings'
  if (progress.phase === 'persist') return 'Saving review'
  return 'Detailed review'
}

function buildLiveReviewActivity(progressLog: ReviewProgressState[]) {
  const summarizingActive = new Map<string, string>()
  const reviewingActive = new Map<string, string>()
  const summarizedDone: string[] = []
  const reviewedDone: string[] = []
  const summarizedSeen = new Set<string>()
  const reviewedSeen = new Set<string>()

  for (const event of progressLog) {
    const sectionId = event.sectionKey || event.sectionLabel
    const sectionLabel = event.sectionLabel || event.sectionKey
    if (!sectionId || !sectionLabel) continue

    if (event.phase === 'summarize_context') {
      if (event.activityType === 'started') {
        summarizingActive.set(sectionId, sectionLabel)
      }
      if (event.activityType === 'completed') {
        summarizingActive.delete(sectionId)
        if (!summarizedSeen.has(sectionId)) {
          summarizedSeen.add(sectionId)
          summarizedDone.push(sectionLabel)
        }
      }
    }

    if (event.phase === 'section_review') {
      if (event.activityType === 'started') {
        reviewingActive.set(sectionId, sectionLabel)
      }
      if (event.activityType === 'completed') {
        reviewingActive.delete(sectionId)
        if (!reviewedSeen.has(sectionId)) {
          reviewedSeen.add(sectionId)
          reviewedDone.push(sectionLabel)
        }
      }
    }
  }

  return {
    summarizingActive: Array.from(summarizingActive.values()),
    reviewingActive: Array.from(reviewingActive.values()),
    summarizedDone: summarizedDone.slice(-6),
    reviewedDone: reviewedDone.slice(-6),
    recentEvents: progressLog.filter(event => Boolean(event.message)).slice(-8).reverse(),
  }
}

function formatProgressEventTime(timestamp?: string) {
  if (!timestamp) return ''
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function readSseStream(
  response: Response,
  onStatus: (payload: ReviewProgressState) => void,
  onError: (message: string) => void
) {
  const reader = response.body?.getReader()
  if (!reader) return false
  const decoder = new TextDecoder()
  let buffer = ''
  let ok = false
  let failed = false

  const parseChunk = (chunk: string) => {
    const lines = chunk.split('\n')
    let event = 'message'
    const data: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (!data.length) return
    const payload = JSON.parse(data.join('\n'))
    if (event === 'status') onStatus(payload)
    if (event === 'error') {
      failed = true
      onError(payload?.message || 'Review generation failed')
    }
    if (event === 'done') {
      ok = payload?.ok === true
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      parseChunk(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    parseChunk(buffer)
  }

  return ok && !failed
}

export default function PaperReviewStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
  onSectionSelect,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [runningReview, setRunningReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<PaperReviewMode>('quick')
  const [progress, setProgress] = useState<ReviewProgressState | null>(null)
  const [progressLog, setProgressLog] = useState<ReviewProgressState[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const hasInitializedModeRef = useRef(false)

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return
    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load review context')
      setSession(data.session)
      onSessionUpdated?.(data.session)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load review context')
    } finally {
      setLoading(false)
    }
  }, [authToken, onSessionUpdated, sessionId])

  useEffect(() => {
    const persisted = readPersistedPaperReviewMode(sessionId)
    if (persisted) {
      setSelectedMode(persisted)
      hasInitializedModeRef.current = true
    }
  }, [sessionId])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const handleModeChange = useCallback((mode: PaperReviewMode) => {
    setSelectedMode(mode)
    persistPaperReviewMode(sessionId, mode)
  }, [sessionId])

  const draftSections = useMemo(() => getPaperDraftSectionMapFromSession(session), [session])
  const hasDraftContent = useMemo(
    () => Object.values(draftSections).some(value => String(value || '').trim()),
    [draftSections]
  )
  const quickReview = useMemo(
    () => getLatestPaperReviewByMode(session, 'quick'),
    [session]
  ) as PaperReviewRecord | null
  const detailedReview = useMemo(
    () => getLatestPaperReviewByMode(session, 'section_by_section'),
    [session]
  ) as PaperReviewRecord | null

  useEffect(() => {
    if (hasInitializedModeRef.current) return
    if (detailedReview) {
      handleModeChange('section_by_section')
      hasInitializedModeRef.current = true
      return
    }
    if (quickReview) {
      handleModeChange('quick')
      hasInitializedModeRef.current = true
    }
  }, [detailedReview, handleModeChange, quickReview])

  const activeReview = selectedMode === 'section_by_section' ? detailedReview : quickReview
  const liveReviewActivity = useMemo(() => buildLiveReviewActivity(progressLog), [progressLog])

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

  const openImprove = useCallback(() => {
    persistPaperReviewMode(sessionId, selectedMode)
    onNavigateToStage?.('MANUSCRIPT_IMPROVE')
  }, [onNavigateToStage, selectedMode, sessionId])

  const cancelReview = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setRunningReview(false)
    setProgress(null)
    setProgressLog([])
    setError('Review run cancelled before completion.')
  }, [])

  const handleProgressStatus = useCallback((payload: ReviewProgressState) => {
    setProgress(payload)
    setProgressLog(prev => [...prev.slice(-59), payload])
  }, [])

  const runReview = useCallback(async () => {
    if (!sessionId || !authToken) return
    if (
      activeReview
      && !window.confirm('Re-running the review will supersede the latest saved report for this mode. Continue?')
    ) {
      return
    }

    const controller = new AbortController()
    abortControllerRef.current = controller
    setRunningReview(true)
    setError(null)
    setProgressLog([])
    setProgress({
      reviewMode: selectedMode,
      phase: 'prepare',
      message: 'Preparing the review workspace',
    })
    persistPaperReviewMode(sessionId, selectedMode)

    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action: 'run_manuscript_review',
          sessionId,
          reviewMode: selectedMode,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Review generation failed')
      }

      let reviewCompleted = true
      if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
        reviewCompleted = await readSseStream(response, handleProgressStatus, message => setError(message))
      } else {
        const data = await response.json()
        if (!data.success) throw new Error(data.error || 'Review generation failed')
      }

      if (!reviewCompleted) return

      await loadSession()
      setProgress(current => current ? { ...current, phase: 'complete', message: 'Review report is ready' } : current)
    } catch (runError) {
      if (!controller.signal.aborted) {
        setError(runError instanceof Error ? runError.message : 'Review generation failed')
      }
    } finally {
      abortControllerRef.current = null
      setRunningReview(false)
    }
  }, [activeReview, authToken, handleProgressStatus, loadSession, selectedMode, sessionId])

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center text-slate-600">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading review workspace...
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

  if (!hasDraftContent) {
    return (
      <div className="space-y-6 p-6">
        <PaperReviewPipelineStepper
          currentStage="MANUSCRIPT_REVIEW"
          onNavigateToStage={stage => onNavigateToStage?.(stage)}
          canAccessImprove={false}
          canAccessExport={false}
        />
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-2xl text-center">
            <BookOpenCheck className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">
              Review starts after section drafting
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Draft at least one section first so the reviewer has enough manuscript context to evaluate structure, evidence, and publication risk.
            </p>
            <button
              type="button"
              onClick={() => onNavigateToStage?.('SECTION_DRAFTING')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Go To Section Drafting
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
        currentStage="MANUSCRIPT_REVIEW"
        onNavigateToStage={stage => onNavigateToStage?.(stage)}
        canAccessImprove={Boolean(quickReview || detailedReview)}
        canAccessExport={Boolean(quickReview || detailedReview)}
      />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eef2ff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                <SearchCheck className="h-3.5 w-3.5" />
                Structured manuscript audit
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Review the manuscript before you revise it
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Run a fast whole-manuscript pass or a detailed section-by-section review. The saved report now stays in one cohesive section-wise page and links directly into Improve.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runReview}
                disabled={runningReview}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {activeReview ? 'Re-run Review' : 'Run Review'}
              </button>
              {runningReview ? (
                <button
                  type="button"
                  onClick={cancelReview}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openImprove}
                  disabled={!activeReview}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Open Improve
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
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
      />

      {runningReview && progress && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Review Progress
              </div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{progress.message}</div>
              <div className="mt-1 text-sm text-slate-500">{progressDetailText(progress)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {progressBadgeLabel(progress)}
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-900 via-sky-700 to-emerald-600 transition-all duration-500"
              style={{ width: `${progressPercent(progress)}%` }}
            />
          </div>

          {progress.reviewMode === 'section_by_section' && (
            <>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Now Summarizing
                    </div>
                    {progress.concurrency ? (
                      <div className="text-xs text-slate-500">Concurrency {progress.concurrency}</div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {liveReviewActivity.summarizingActive.length > 0 ? liveReviewActivity.summarizingActive.map(label => (
                      <span
                        key={`summarizing-${label}`}
                        className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-700"
                      >
                        {label}
                      </span>
                    )) : (
                      <span className="text-sm text-slate-500">Waiting for the next context-summary slot.</span>
                    )}
                  </div>
                  {liveReviewActivity.summarizedDone.length > 0 && (
                    <div className="mt-3 text-xs text-slate-500">
                      Completed: {liveReviewActivity.summarizedDone.join(', ')}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Now Reviewing
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {liveReviewActivity.reviewingActive.length > 0 ? liveReviewActivity.reviewingActive.map(label => (
                      <span
                        key={`reviewing-${label}`}
                        className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700"
                      >
                        {label}
                      </span>
                    )) : (
                      <span className="text-sm text-slate-500">Waiting for the next section-review slot.</span>
                    )}
                  </div>
                  {liveReviewActivity.reviewedDone.length > 0 && (
                    <div className="mt-3 text-xs text-slate-500">
                      Reviewed: {liveReviewActivity.reviewedDone.join(', ')}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Backend Activity
                </div>
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                  {liveReviewActivity.recentEvents.length > 0 ? liveReviewActivity.recentEvents.map((event, index) => (
                    <div
                      key={`${event.at || 'event'}-${event.phase}-${event.sectionKey || index}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {formatProgressEventTime(event.at) ? <span>{formatProgressEventTime(event.at)}</span> : null}
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                          {event.phase === 'summarize_context'
                            ? 'Context summary'
                            : event.phase === 'section_review'
                              ? 'Section review'
                              : event.phase}
                        </span>
                        {event.sectionLabel ? <span>{event.sectionLabel}</span> : null}
                        {event.activityType ? (
                          <span className="uppercase tracking-[0.14em]">{event.activityType}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{event.message}</div>
                    </div>
                  )) : (
                    <div className="text-sm text-slate-500">Waiting for backend status events...</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {!activeReview && (
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">No review report yet</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                Run the {selectedMode === 'section_by_section' ? 'section-by-section' : 'quick'} review to create the saved report Improve and Export will use next.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeReview && (
        <PaperReviewReport
          review={activeReview}
          sectionContentByKey={draftSections}
          onSectionSelect={jumpToSection}
          onOpenImprove={openImprove}
          onOpenExport={() => onNavigateToStage?.('REVIEW_EXPORT')}
        />
      )}
    </div>
  )
}
