'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import axios from 'axios'
import { toast, Toaster } from 'react-hot-toast'
import {
  HiArrowRight,
  HiBookOpen,
  HiChatBubbleLeftRight,
  HiCheck,
  HiExclamationTriangle,
  HiListBullet,
  HiPencilSquare,
  HiShare,
  HiSparkles,
  HiXMark,
} from 'react-icons/hi2'

import { isFeatureEnabled } from '@/lib/feature-flags'
import { withGrantWorkspaceStage } from '@/lib/grants/workspaceNavigation'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import type { DraftZeroClaim, DraftZeroGap, DraftZeroState } from '@/lib/draftZero/types'
import type { PrepContext, PrepHandoffPreview } from '@/components/grantPrep/types'
import DraftZeroMindMap from '@/components/draftZero/DraftZeroMindMap'
import { getStageNorms, StageNormsPanel } from '@/components/draftZero/DraftZeroNorms'

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

type ClaimAction = {
  stageKey: string
  pointKey: string
  action: 'confirm' | 'edit' | 'fill_gap' | 'reject'
  text?: string
  keywords?: string[]
}

type ClaimsMutationResponse = {
  prepContext?: PrepContext
  draftZero?: DraftZeroState
  sessionStatus?: string
  sessionUpdatedAt?: string
  warnings?: Array<{ stageKey: string; pointKey: string; message: string }>
}

type FundingHeader = {
  title: string
  agencyName: string
  deadline: string
  funding: string
  budgetLimits: string
  projectDuration: string
}

const GENERATING_STEPS = [
  'Reading the funding call rules…',
  'Scanning your material for verbatim facts…',
  'Filling the discussion points…',
  'Compiling your idea anchor…',
  'Assembling the proof…',
]

export default function DraftZeroPage() {
  const params = useParams<{ projectId: string; grantId: string }>()
  const router = useRouter()
  const projectId = String(params?.projectId || '')
  const grantId = String(params?.grantId || '')

  const [loading, setLoading] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<string | null>(null)
  // Ref mirror so sequential mutations (chunked bulk confirm) always send the
  // freshest optimistic-concurrency timestamp, not a stale closure value.
  const sessionUpdatedAtRef = useRef<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string>('active')
  const [prepContext, setPrepContext] = useState<PrepContext | null>(null)
  const [draftZero, setDraftZero] = useState<DraftZeroState | null>(null)
  const [funding, setFunding] = useState<FundingHeader | null>(null)
  const [guidelinePack, setGuidelinePack] = useState<GuidelinePackDocument | null>(null)

  const [seedText, setSeedText] = useState('')
  const [ideaHint, setIdeaHint] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingStep, setGeneratingStep] = useState(0)
  const [pendingPoint, setPendingPoint] = useState<string | null>(null)
  const [editingClaim, setEditingClaim] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [spotCheckClaim, setSpotCheckClaim] = useState<string | null>(null)
  const [gapDrafts, setGapDrafts] = useState<Record<string, string>>({})
  const [launchPreview, setLaunchPreview] = useState<PrepHandoffPreview | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [aiFilling, setAiFilling] = useState(false)
  const [normsOpenStages, setNormsOpenStages] = useState<Record<string, boolean>>({})

  const featureEnabled = isFeatureEnabled('ENABLE_DRAFT_ZERO')
  const readOnly = ['launched', 'handed_off', 'archived'].includes(sessionStatus)
  const anyBusy = pendingPoint !== null

  const axiosConfig = useCallback(
    () => ({
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') || '' : ''}`,
      },
    }),
    []
  )

  const surfaceError = useCallback((error: unknown, fallback: string) => {
    toast.error(
      axios.isAxiosError(error) && error.response?.data?.message ? error.response.data.message : fallback
    )
  }, [])

  const hydrateDraftZero = useCallback(
    async (resolvedSessionId: string) => {
      const response = await axios.get(`/api/grant-prep/sessions/${resolvedSessionId}/draft-zero`, axiosConfig())
      setDraftZero(response.data.draftZero || null)
      setPrepContext(response.data.prepContext || null)
      setGuidelinePack(response.data.guidelinePack || null)
      setSessionStatus(response.data.sessionStatus || 'active')
      setSessionUpdatedAt(response.data.sessionUpdatedAt || null)
      sessionUpdatedAtRef.current = response.data.sessionUpdatedAt || null
      if (response.data.fundingContext) {
        const context = response.data.fundingContext
        setFunding({
          title: context.title || '',
          agencyName: context.agencyName || '',
          deadline: context.deadline || '',
          funding: context.funding || '',
          budgetLimits: context.budgetLimits || '',
          projectDuration: context.projectDuration || '',
        })
      }
    },
    [axiosConfig]
  )

  useEffect(() => {
    if (!projectId || !grantId || !featureEnabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const bootstrap = await axios.get(`/api/projects/${projectId}/grants/${grantId}`, axiosConfig())
        if (cancelled) return
        const resolvedSessionId = bootstrap.data?.session?.id
        if (!resolvedSessionId) throw new Error('missing session')
        setSessionId(resolvedSessionId)
        await hydrateDraftZero(resolvedSessionId)
      } catch (error) {
        if (!cancelled) surfaceError(error, 'Failed to load Draft Zero')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, grantId, featureEnabled, axiosConfig, hydrateDraftZero, surfaceError])

  useEffect(() => {
    if (!generating) return
    setGeneratingStep(0)
    const timer = setInterval(() => {
      setGeneratingStep((step) => Math.min(step + 1, GENERATING_STEPS.length - 1))
    }, 3500)
    return () => clearInterval(timer)
  }, [generating])

  // View preference survives reloads; read after mount to stay hydration-safe.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('draft_zero_view') : null
    if (stored === 'map' || stored === 'list') setViewMode(stored)
  }, [])
  const switchView = useCallback((mode: 'list' | 'map') => {
    setViewMode(mode)
    if (typeof window !== 'undefined') window.localStorage.setItem('draft_zero_view', mode)
  }, [])

  const applyMutationResponse = useCallback((data: { prepContext?: PrepContext; draftZero?: DraftZeroState; sessionStatus?: string; sessionUpdatedAt?: string }) => {
    if (data.prepContext) setPrepContext(data.prepContext)
    if (data.draftZero) setDraftZero(data.draftZero)
    if (data.sessionStatus) setSessionStatus(data.sessionStatus)
    if (data.sessionUpdatedAt) {
      setSessionUpdatedAt(data.sessionUpdatedAt)
      sessionUpdatedAtRef.current = data.sessionUpdatedAt
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!sessionId || !sessionUpdatedAt || generating) return
    setGenerating(true)
    try {
      const response = await axios.post(
        `/api/grant-prep/sessions/${sessionId}/draft-zero/generate`,
        {
          seedText,
          ideaHint: ideaHint.trim() || undefined,
          clientRequestId: `dz_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          expectedSessionUpdatedAt: sessionUpdatedAt,
        },
        axiosConfig()
      )
      applyMutationResponse(response.data)
      if (response.data.warning) toast(response.data.warning, { icon: '!' })
      toast.success('Draft Zero is ready — review the claims below.')
    } catch (error) {
      surfaceError(error, 'Draft Zero generation failed')
      if (axios.isAxiosError(error) && error.response?.status === 409 && sessionId) {
        await hydrateDraftZero(sessionId).catch(() => undefined)
      }
    } finally {
      setGenerating(false)
    }
  }, [sessionId, sessionUpdatedAt, generating, seedText, ideaHint, axiosConfig, applyMutationResponse, surfaceError, hydrateDraftZero])

  const sendActions = useCallback(
    async (actions: ClaimAction[], busyKey: string | null): Promise<ClaimsMutationResponse | null> => {
      if (!sessionId || !sessionUpdatedAtRef.current) return null
      setPendingPoint(busyKey)
      try {
        const response = await axios.patch(
          `/api/grant-prep/sessions/${sessionId}/draft-zero/claims`,
          { actions, expectedSessionUpdatedAt: sessionUpdatedAtRef.current },
          axiosConfig()
        )
        applyMutationResponse(response.data)
        return response.data as ClaimsMutationResponse
      } catch (error) {
        surfaceError(error, 'Failed to update the claim')
        if (axios.isAxiosError(error) && error.response?.status === 409 && sessionId) {
          await hydrateDraftZero(sessionId).catch(() => undefined)
        }
        return null
      } finally {
        setPendingPoint(null)
      }
    },
    [sessionId, axiosConfig, applyMutationResponse, surfaceError, hydrateDraftZero]
  )

  const warningFor = useCallback((data: ClaimsMutationResponse, stageKey: string, pointKey: string) => {
    return (data.warnings || []).find((warning) => warning.stageKey === stageKey && warning.pointKey === pointKey) || null
  }, [])

  // Shared low-level actions (used by both the list view and the mind map;
  // the spot-check gate lives in each view's own UI state).
  const confirmClaim = useCallback(
    async (claim: DraftZeroClaim) => {
      const data = await sendActions([{ stageKey: claim.stageKey, pointKey: claim.pointKey, action: 'confirm' }], claim.id)
      if (data) {
        const warning = warningFor(data, claim.stageKey, claim.pointKey)
        if (warning) toast(warning.message, { icon: '⚠️', duration: 6000 })
        else toast.success('Confirmed')
      }
    },
    [sendActions, warningFor]
  )

  const saveClaimEdit = useCallback(
    async (claim: DraftZeroClaim, text: string): Promise<boolean> => {
      if (!text) return false
      const data = await sendActions([{ stageKey: claim.stageKey, pointKey: claim.pointKey, action: 'edit', text }], claim.id)
      if (!data) return false
      const warning = warningFor(data, claim.stageKey, claim.pointKey)
      if (warning) toast(warning.message, { icon: '⚠️', duration: 6000 })
      else toast.success('Updated with your wording')
      return true
    },
    [sendActions, warningFor]
  )

  const rejectClaim = useCallback(
    async (claim: DraftZeroClaim) => {
      const data = await sendActions([{ stageKey: claim.stageKey, pointKey: claim.pointKey, action: 'reject' }], claim.id)
      if (data) toast('Struck — answer it in your own words, or let the AI draft a fresh take', { icon: '✂️' })
    },
    [sendActions]
  )

  const fillGap = useCallback(
    async (gap: DraftZeroGap, text: string): Promise<boolean> => {
      if (!text) return false
      const data = await sendActions([{ stageKey: gap.stageKey, pointKey: gap.pointKey, action: 'fill_gap', text }], gap.id)
      if (!data) return false
      const warning = warningFor(data, gap.stageKey, gap.pointKey)
      if (warning) toast(warning.message, { icon: '⚠️', duration: 6000 })
      else toast.success('Gap closed with your answer')
      return true
    },
    [sendActions, warningFor]
  )

  const handleConfirm = useCallback(
    async (claim: DraftZeroClaim) => {
      if (claim.spotCheck && spotCheckClaim !== claim.id) {
        setSpotCheckClaim(claim.id)
        return
      }
      setSpotCheckClaim(null)
      await confirmClaim(claim)
    },
    [confirmClaim, spotCheckClaim]
  )

  const handleEditSave = useCallback(
    async (claim: DraftZeroClaim) => {
      if (await saveClaimEdit(claim, editText.trim())) {
        setEditingClaim(null)
        setEditText('')
      }
    },
    [editText, saveClaimEdit]
  )

  const handleGapFill = useCallback(
    async (gap: DraftZeroGap) => {
      if (await fillGap(gap, (gapDrafts[gap.id] || '').trim())) {
        setGapDrafts((drafts) => ({ ...drafts, [gap.id]: '' }))
      }
    },
    [gapDrafts, fillGap]
  )

  // Hand a set of open gaps to the AI. Answers come back as violet
  // "AI-drafted" claims that still need the user's confirm — same trust gate
  // as extraction claims, so launch stays blocked until they are reviewed.
  const handleAiFill = useCallback(
    async (pointIds: string[]) => {
      if (!sessionId || !sessionUpdatedAtRef.current || aiFilling || readOnly) return
      setAiFilling(true)
      try {
        const response = await axios.post(
          `/api/grant-prep/sessions/${sessionId}/draft-zero/ai-fill`,
          {
            points: pointIds,
            clientRequestId: `dzf_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            expectedSessionUpdatedAt: sessionUpdatedAtRef.current,
          },
          axiosConfig()
        )
        applyMutationResponse(response.data)
        const filledCount = Number(response.data?.filledCount || 0)
        if (filledCount) {
          toast.success(
            `AI drafted ${filledCount} answer${filledCount === 1 ? '' : 's'} — review the violet claims and confirm what's right.`
          )
        } else {
          toast('Nothing left for the AI to fill.', { icon: 'ℹ️' })
        }
        for (const warning of (response.data?.warnings || []).slice(0, 2)) {
          toast(warning, { icon: '⚠️', duration: 6000 })
        }
      } catch (error) {
        surfaceError(error, 'AI fill failed')
        if (axios.isAxiosError(error) && error.response?.status === 409 && sessionId) {
          await hydrateDraftZero(sessionId).catch(() => undefined)
        }
      } finally {
        setAiFilling(false)
      }
    },
    [sessionId, aiFilling, readOnly, axiosConfig, applyMutationResponse, surfaceError, hydrateDraftZero]
  )

  // Stages can be disabled after generation — only enabled stages count toward
  // the sweep, bulk confirm, and "proof clean".
  const enabledStageKeySet = useMemo(
    () =>
      new Set(
        Object.values(prepContext?.stageStates || {})
          .filter((stage) => stage.enabled && stage.pickable)
          .map((stage) => String(stage.stageKey))
      ),
    [prepContext]
  )
  const unconfirmedClaims = useMemo(
    () => (draftZero?.claims || []).filter((claim) => claim.status === 'unconfirmed' && enabledStageKeySet.has(claim.stageKey)),
    [draftZero, enabledStageKeySet]
  )
  const openGaps = useMemo(
    () => (draftZero?.gaps || []).filter((gap) => gap.status === 'open' && enabledStageKeySet.has(gap.stageKey)),
    [draftZero, enabledStageKeySet]
  )

  const handleConfirmAllSimple = useCallback(async () => {
    const simple = unconfirmedClaims.filter((claim) => !claim.spotCheck)
    if (!simple.length) return
    // The claims route caps one batch at 60 actions — chunk and thread the
    // refreshed timestamp (via sessionUpdatedAtRef) between batches.
    const CHUNK_SIZE = 50
    let confirmedCount = 0
    let warnedCount = 0
    for (let index = 0; index < simple.length; index += CHUNK_SIZE) {
      const chunk = simple.slice(index, index + CHUNK_SIZE)
      const data = await sendActions(
        chunk.map((claim) => ({ stageKey: claim.stageKey, pointKey: claim.pointKey, action: 'confirm' as const })),
        '__bulk__'
      )
      if (!data) break
      const warnings = data.warnings || []
      warnedCount += warnings.length
      confirmedCount += chunk.length - warnings.length
    }
    if (confirmedCount || warnedCount) {
      toast.success(
        `Confirmed ${confirmedCount} claims${warnedCount ? ` — ${warnedCount} conflict with call rules and need a rewrite` : ' — spot-checks still need your eyes'}`
      )
    }
  }, [unconfirmedClaims, sendActions])

  const handleOpenLaunch = useCallback(async () => {
    if (!sessionId || pendingPoint !== null) return
    try {
      const response = await axios.get(`/api/grant-prep/sessions/${sessionId}/handoff-preview`, axiosConfig())
      setLaunchPreview(response.data.preview || null)
      setLaunchOpen(true)
    } catch (error) {
      surfaceError(error, 'Failed to load launch preview')
    }
  }, [sessionId, pendingPoint, axiosConfig, surfaceError])

  const navigateAfterLaunch = useCallback(
    (launchUrl: string | null | undefined) => {
      if (isFeatureEnabled('ENABLE_DRAFT_ONE')) {
        // Phase 2 of the fast path: straight into Draft One's batch drafting.
        toast.success('Launched — drafting the proposal next')
        router.push(`/projects/${projectId}/grants/${grantId}/draft-one`)
      } else {
        toast.success('Launched — opening the drafting workspace')
        if (launchUrl) router.push(withGrantWorkspaceStage(launchUrl, 'SECTION_DRAFTING'))
      }
    },
    [router, projectId, grantId]
  )

  const handleLaunch = useCallback(async () => {
    if (!sessionId || launching || readOnly) return
    setLaunching(true)
    try {
      const response = await axios.post(`/api/grant-prep/sessions/${sessionId}/handoff`, {}, axiosConfig())
      navigateAfterLaunch(response.data?.launchUrl)
    } catch (error) {
      // The launch can complete server-side while the response is lost (proxy
      // timeout, network blip). Check the session before reporting failure — a
      // replayed handoff on a launched session returns the stored launch info
      // instantly instead of relaunching.
      try {
        const check = await axios.get(`/api/grant-prep/sessions/${sessionId}/draft-zero`, axiosConfig())
        if (['launched', 'handed_off'].includes(check.data?.sessionStatus)) {
          const replay = await axios.post(`/api/grant-prep/sessions/${sessionId}/handoff`, {}, axiosConfig())
          navigateAfterLaunch(replay.data?.launchUrl)
          return
        }
      } catch {
        // Recovery probe failed too — surface the original launch error.
      }
      surfaceError(error, 'Launch failed')
      setLaunching(false)
    }
  }, [sessionId, launching, readOnly, axiosConfig, navigateAfterLaunch, surfaceError])

  const overallReadiness = useMemo(() => {
    if (!prepContext) return 0
    const stages = Object.values(prepContext.stageStates).filter((stage) => stage.enabled && stage.pickable)
    if (!stages.length) return 0
    return stages.reduce((sum, stage) => sum + (stage.readiness || 0), 0) / stages.length
  }, [prepContext])

  const stageGroups = useMemo(() => {
    if (!draftZero || !prepContext) return []
    const order = Object.values(prepContext.stageStates)
      .filter((stage) => stage.enabled && stage.pickable && stage.stageKey !== 'ideation')
      .map((stage) => ({ key: stage.stageKey, title: stage.title, readiness: stage.readiness }))
    return order
      .map((stage) => ({
        ...stage,
        claims: draftZero.claims.filter((claim) => claim.stageKey === stage.key),
        gaps: draftZero.gaps.filter((gap) => gap.stageKey === stage.key && gap.status === 'open'),
      }))
      .filter((stage) => stage.claims.length || stage.gaps.length)
  }, [draftZero, prepContext])

  const anchor = prepContext?.stageStates.ideation?.decision?.anchor || null

  if (!featureEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-prep-surface p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-prep-card">
          <HiSparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <h1 className="text-lg font-semibold text-slate-900">Draft Zero is not enabled</h1>
          <p className="mt-2 text-sm text-slate-500">
            Set <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_FEATURE_ENABLE_DRAFT_ZERO=true</code> and{' '}
            <code className="rounded bg-slate-100 px-1">FEATURE_ENABLE_DRAFT_ZERO=true</code> to try the fast path.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-prep-surface">
        <div className="text-sm text-slate-500">Loading Draft Zero…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-prep-surface pb-24">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-prep-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-prep-accent text-white">
              <HiSparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">Draft Zero</div>
              <div className="text-xs text-slate-500">{funding?.title || 'Grant preparation'}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {funding?.deadline ? (
              <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 sm:inline">
                Deadline {funding.deadline}
              </span>
            ) : null}
            {draftZero ? (
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  onClick={() => switchView('list')}
                  title="List view"
                  className={clsx(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium',
                    viewMode === 'list' ? 'bg-prep-surface text-prep-accent' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <HiListBullet className="h-3.5 w-3.5" /> List
                </button>
                <button
                  onClick={() => switchView('map')}
                  title="Mind map view"
                  className={clsx(
                    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium',
                    viewMode === 'map' ? 'bg-prep-surface text-prep-accent' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <HiShare className="h-3.5 w-3.5 rotate-90" /> Map
                </button>
              </div>
            ) : null}
            <button
              onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/prep`)}
              title="Prefer a guided, question-by-question preparation? Open the Grant Prep conversation — it works on the same session."
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-prep-accent hover:text-prep-accent"
            >
              <HiChatBubbleLeftRight className="h-3.5 w-3.5" /> Grant Prep
            </button>
            <span className="rounded-full border border-prep-border bg-prep-surface px-3 py-1 text-xs font-medium text-prep-accent">
              {Math.round(overallReadiness * 100)}% ready
            </span>
            {draftZero && !readOnly ? (
              <button
                onClick={handleOpenLaunch}
                disabled={anyBusy}
                className="flex items-center gap-1.5 rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark disabled:opacity-50"
              >
                Launch blueprint <HiArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        {readOnly ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>
              {sessionStatus === 'archived'
                ? 'This session is archived. Claims are read-only reference now.'
                : 'This session already launched. Claims are read-only reference now.'}
            </span>
            {sessionStatus !== 'archived' ? (
              <button
                onClick={() =>
                  router.push(
                    isFeatureEnabled('ENABLE_DRAFT_ONE')
                      ? `/projects/${projectId}/grants/${grantId}/draft-one`
                      : `/projects/${projectId}/grants/${grantId}/workspace?stage=SECTION_DRAFTING`
                  )
                }
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Continue drafting <HiArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {!draftZero ? (
          generating ? (
            <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-prep-border bg-white p-8 shadow-prep-card">
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-prep-accent transition-all duration-700"
                  style={{ width: `${((generatingStep + 1) / GENERATING_STEPS.length) * 100}%` }}
                />
              </div>
              <div className="space-y-2">
                {GENERATING_STEPS.map((step, index) => (
                  <div
                    key={step}
                    className={clsx(
                      'flex items-center gap-2 text-sm transition-opacity',
                      index < generatingStep ? 'text-emerald-600' : index === generatingStep ? 'text-slate-900' : 'text-slate-300'
                    )}
                  >
                    {index < generatingStep ? <HiCheck className="h-4 w-4" /> : <span className="h-4 w-4 text-center">·</span>}
                    {step}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-400">Usually under a minute. Your material never leaves your workspace.</p>
            </div>
          ) : (
            <div className="mx-auto mt-10 max-w-2xl">
              <div className="rounded-2xl border border-prep-border bg-white p-8 shadow-prep-card">
                <h1 className="text-xl font-semibold text-slate-900">Drop in anything. Correct the proof.</h1>
                <p className="mt-2 text-sm text-slate-500">
                  Paste an old proposal, an abstract, or rough notes. Draft Zero extracts a complete proposal plan from it in
                  one pass — you review claims instead of answering questions. No material? It will infer a starting point
                  from the call itself. Whatever it can’t extract becomes a gap — answer gaps yourself, or let the AI draft
                  those too and just review.
                </p>
                <textarea
                  value={seedText}
                  onChange={(event) => setSeedText(event.target.value)}
                  rows={10}
                  placeholder="Paste your material here — messy is fine. Leave empty to start from the call alone."
                  className="mt-4 w-full rounded-xl border border-slate-200 bg-prep-inputBg p-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-prep-accent focus:outline-none"
                />
                <input
                  value={ideaHint}
                  onChange={(event) => setIdeaHint(event.target.value)}
                  placeholder="Optional: one line steering the idea — e.g. “point-of-care AMR surveillance for poultry”"
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-prep-accent focus:outline-none"
                />
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {seedText.length ? `${seedText.length.toLocaleString()} characters` : 'Starting from the call only'}
                  </span>
                  <button
                    onClick={handleGenerate}
                    disabled={!sessionUpdatedAt || readOnly}
                    className="flex items-center gap-2 rounded-lg bg-prep-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    <HiSparkles className="h-4 w-4" /> Generate Draft Zero
                  </button>
                </div>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">
                Prefer to build it up step by step instead?{' '}
                <button
                  onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/prep`)}
                  className="font-medium text-prep-accent underline-offset-2 hover:underline"
                >
                  Open Grant Prep
                </button>{' '}
                — a guided, question-by-question conversation on the same session.
              </p>
            </div>
          )
        ) : viewMode === 'map' ? (
          <div className="space-y-4">
            {draftZero.generation.warnings.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {draftZero.generation.warnings.slice(0, 4).map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <DraftZeroMindMap
              anchorTitle={anchor?.title || draftZero.generation.ideaTitle}
              anchorSummary={anchor?.oneSentenceSummary || draftZero.generation.ideaSummary}
              stageGroups={stageGroups}
              guidelinePack={guidelinePack}
              readOnly={readOnly}
              busy={anyBusy}
              aiFillBusy={aiFilling}
              onConfirm={confirmClaim}
              onEditSave={saveClaimEdit}
              onReject={rejectClaim}
              onGapFill={fillGap}
              onAiFill={handleAiFill}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_290px]">
            {/* Center: the proof */}
            <div className="space-y-6">
              {anchor ? (
                <div className="rounded-2xl border border-prep-border bg-white p-5 shadow-prep-card">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-prep-accent">
                    <HiCheck className="h-4 w-4" /> Idea anchor · signed
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">{anchor.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{anchor.oneSentenceSummary}</p>
                </div>
              ) : null}

              {stageGroups.map((stage) => (
                <section key={stage.key} className="rounded-2xl border border-prep-border bg-white shadow-prep-card">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <h3 className="text-sm font-semibold text-slate-900">{stage.title}</h3>
                    {(() => {
                      const ruleCount = getStageNorms(stage.key, guidelinePack)?.ruleCount || 0
                      return (
                        <button
                          onClick={() => setNormsOpenStages((open) => ({ ...open, [stage.key]: !open[stage.key] }))}
                          className={clsx(
                            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            normsOpenStages[stage.key]
                              ? 'border-prep-border bg-prep-surface text-prep-accent'
                              : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'
                          )}
                          title="What this section must satisfy"
                        >
                          <HiBookOpen className="h-3 w-3" /> Norms{ruleCount ? ` · ${ruleCount}` : ''}
                        </button>
                      )
                    })()}
                    <span className="ml-auto text-xs text-slate-400">{Math.round((stage.readiness || 0) * 100)}%</span>
                  </div>
                  {normsOpenStages[stage.key] ? (
                    <div className="border-b border-slate-100 bg-prep-surface/60 px-5 py-3">
                      <StageNormsPanel stageKey={stage.key} guidelinePack={guidelinePack} />
                    </div>
                  ) : null}
                  <div className="divide-y divide-slate-50">
                    {stage.claims.map((claim) => {
                      const busy = anyBusy
                      const isEditing = editingClaim === claim.id
                      const showSpotCheck = spotCheckClaim === claim.id
                      return (
                        <div key={claim.id} className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <span
                              className={clsx(
                                'mt-0.5 h-2.5 w-2.5 flex-none rounded-full',
                                claim.status === 'confirmed' || claim.status === 'edited'
                                  ? 'bg-emerald-500'
                                  : claim.status === 'rejected'
                                    ? 'bg-slate-300'
                                    : claim.provenance === 'quoted'
                                      ? 'bg-sky-500'
                                      : claim.provenance === 'ai_generated'
                                        ? 'bg-violet-500'
                                        : 'bg-amber-500'
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                <span className="font-medium text-slate-500">{claim.pointLabel}</span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5">{claim.priority}</span>
                                {claim.provenance === 'quoted' ? (
                                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700" title={claim.sourceQuote || ''}>
                                    from your material
                                  </span>
                                ) : claim.provenance === 'ai_generated' ? (
                                  <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">
                                    AI-drafted · {Math.round(claim.confidence * 100)}%
                                  </span>
                                ) : (
                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                                    inferred · {Math.round(claim.confidence * 100)}%
                                  </span>
                                )}
                                {claim.status === 'confirmed' || claim.status === 'edited' ? (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">confirmed by you</span>
                                ) : null}
                              </div>
                              {isEditing ? (
                                <div className="mt-2">
                                  <textarea
                                    value={editText}
                                    onChange={(event) => setEditText(event.target.value)}
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-200 bg-prep-inputBg p-3 text-sm focus:border-prep-accent focus:outline-none"
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => handleEditSave(claim)}
                                      disabled={busy || !editText.trim()}
                                      className="rounded-lg bg-prep-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-prep-accentDark disabled:bg-slate-200"
                                    >
                                      Save as mine
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingClaim(null)
                                        setEditText('')
                                      }}
                                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p
                                  className={clsx(
                                    'mt-1 text-sm leading-relaxed',
                                    claim.status === 'rejected' ? 'text-slate-400 line-through' : 'text-slate-800'
                                  )}
                                >
                                  {claim.claimText}
                                </p>
                              )}
                              {claim.sourceQuote && !isEditing ? (
                                <p className="mt-1 border-l-2 border-sky-200 pl-2 text-xs italic text-slate-400">
                                  “{claim.sourceQuote}”
                                </p>
                              ) : null}
                              {claim.assumption && claim.status !== 'rejected' && !isEditing ? (
                                <p className="mt-1 rounded-lg bg-violet-50 px-2 py-1 text-xs text-violet-700">
                                  {claim.assumption} — verify before you confirm.
                                </p>
                              ) : null}
                              {showSpotCheck && claim.spotCheck ? (
                                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                  <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Spot-check</div>
                                  <p className="mt-1 text-sm text-amber-900">{claim.spotCheck}</p>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => handleConfirm(claim)}
                                      disabled={busy}
                                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                                    >
                                      Yes — confirm
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSpotCheckClaim(null)
                                        setEditingClaim(claim.id)
                                        setEditText(claim.claimText)
                                      }}
                                      className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                                    >
                                      No — fix it
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            {(claim.status === 'unconfirmed' || claim.status === 'rejected') && !isEditing ? (
                              <div className="flex flex-none gap-1.5">
                                {claim.status === 'unconfirmed' ? (
                                  <button
                                    onClick={() => handleConfirm(claim)}
                                    disabled={busy || readOnly}
                                    title="Confirm"
                                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                                  >
                                    <HiCheck className="h-4 w-4" />
                                  </button>
                                ) : null}
                                <button
                                  onClick={() => {
                                    setEditingClaim(claim.id)
                                    setEditText(claim.claimText)
                                    setSpotCheckClaim(null)
                                  }}
                                  disabled={busy || readOnly}
                                  title={claim.status === 'rejected' ? 'Rewrite in your words' : 'Edit'}
                                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  <HiPencilSquare className="h-4 w-4" />
                                </button>
                                {claim.status === 'unconfirmed' ? (
                                  <button
                                    onClick={() => rejectClaim(claim)}
                                    disabled={busy || readOnly}
                                    title="Strike"
                                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                                  >
                                    <HiXMark className="h-4 w-4" />
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}

                    {stage.gaps.map((gap) => (
                      <div key={gap.id} className="bg-slate-50/60 px-5 py-4">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <HiExclamationTriangle className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-medium">{gap.pointLabel}</span>
                          <span className="rounded bg-slate-200/70 px-1.5 py-0.5">{gap.priority}</span>
                          <span className="text-slate-400">answer it yourself — or let the AI draft it for your review</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{gap.ask}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            value={gapDrafts[gap.id] || ''}
                            onChange={(event) => setGapDrafts((drafts) => ({ ...drafts, [gap.id]: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !anyBusy && !readOnly) handleGapFill(gap)
                            }}
                            placeholder="Type your answer…"
                            className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-prep-accent focus:outline-none"
                          />
                          <button
                            onClick={() => handleGapFill(gap)}
                            disabled={anyBusy || !(gapDrafts[gap.id] || '').trim() || readOnly}
                            className="rounded-lg bg-prep-accent px-3 py-2 text-xs font-medium text-white hover:bg-prep-accentDark disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => handleAiFill([gap.id])}
                            disabled={anyBusy || aiFilling || readOnly}
                            title="The AI drafts an answer from your material, the call rules, and this section's norms — you review and confirm it."
                            className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                          >
                            <HiSparkles className="h-3.5 w-3.5" /> {aiFilling ? 'Drafting…' : 'Let AI draft it'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Right rail: agency lens */}
            <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              <div className="rounded-2xl border border-prep-border bg-white p-4 shadow-prep-card">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Funding call rules</h3>
                {guidelinePack ? (
                  <div className="mt-3 space-y-3">
                    {(
                      [
                        ['priorities', 'Priorities'],
                        ['mustAddress', 'Must address'],
                        ['avoid', 'Avoid'],
                        ['budgetRules', 'Budget rules'],
                        ['durationRules', 'Duration rules'],
                        ['submissionRules', 'Submission rules'],
                      ] as const
                    ).map(([blockKey, label]) => {
                      const rules = guidelinePack[blockKey] || []
                      if (!rules.length) return null
                      return (
                        <div key={blockKey}>
                          <div className="text-xs font-medium text-slate-600">{label}</div>
                          <ul className="mt-1 space-y-1">
                            {rules.slice(0, 3).map((rule) => (
                              <li key={rule.key} className="flex items-start gap-1.5 text-xs text-slate-500">
                                <span
                                  className={clsx(
                                    'mt-1 h-1.5 w-1.5 flex-none rounded-full',
                                    rule.enforcementLevel === 'hard' ? 'bg-rose-400' : rule.enforcementLevel === 'soft' ? 'bg-amber-400' : 'bg-slate-300'
                                  )}
                                />
                                {rule.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No structured guidelines on this call yet.</p>
                )}
              </div>
              {draftZero.generation.warnings.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  {draftZero.generation.warnings.slice(0, 4).map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </aside>
          </div>
        )}
      </main>

      {/* Sweep bar */}
      {draftZero && !readOnly ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-prep-border bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-sm text-slate-700">
              {unconfirmedClaims.length ? (
                <>
                  <b className="text-amber-600">{unconfirmedClaims.length}</b> claims need your eyes
                  {openGaps.length ? (
                    <>
                      {' '}
                      · <b className="text-slate-500">{openGaps.length}</b> gaps to fill
                    </>
                  ) : null}
                </>
              ) : openGaps.length ? (
                <>
                  <b className="text-slate-500">{openGaps.length}</b> gaps left — then you’re clear
                </>
              ) : (
                <span className="font-medium text-emerald-600">Proof clean — ready to launch</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {openGaps.length ? (
                <button
                  onClick={() => handleAiFill(openGaps.map((gap) => gap.id))}
                  disabled={pendingPoint !== null || aiFilling}
                  title="The AI drafts an answer for every open gap using each section's norms — you review and confirm them."
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  <HiSparkles className="h-4 w-4" />
                  {aiFilling ? 'AI drafting…' : `AI-fill ${openGaps.length} gap${openGaps.length === 1 ? '' : 's'}`}
                </button>
              ) : null}
              {unconfirmedClaims.some((claim) => !claim.spotCheck) ? (
                <button
                  onClick={handleConfirmAllSimple}
                  disabled={pendingPoint !== null}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Confirm all except spot-checks
                </button>
              ) : null}
              <button
                onClick={handleOpenLaunch}
                className="flex items-center gap-1.5 rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark"
              >
                Launch blueprint <HiArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Launch modal */}
      {launchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => !launching && setLaunchOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-prep-float" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Launch the blueprint?</h3>
            {launchPreview?.blockers?.length ? (
              <>
                <p className="mt-2 text-sm text-slate-500">
                  {launchPreview.blockers.length} item{launchPreview.blockers.length === 1 ? '' : 's'} still unresolved. You can
                  launch anyway, but the blueprint will note the gaps.
                </p>
                <ul className="mt-3 max-h-44 space-y-1.5 overflow-y-auto">
                  {launchPreview.blockers.map((blocker) => (
                    <li key={`${blocker.stageKey}.${blocker.pointKey}`} className="flex items-start gap-2 text-xs text-amber-800">
                      <HiExclamationTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-500" />
                      {blocker.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Everything is confirmed. The blueprint will be generated from your reviewed claims and you’ll land directly in
                the drafting workspace.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setLaunchOpen(false)}
                disabled={launching}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Keep reviewing
              </button>
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="rounded-lg bg-prep-accent px-4 py-2 text-sm font-medium text-white hover:bg-prep-accentDark disabled:opacity-60"
              >
                {launching ? 'Launching…' : launchPreview?.blockers?.length ? 'Launch anyway' : 'Launch'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
