'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  ChevronLeft,
  X,
} from 'lucide-react'

import GrantPrepPage from '../prep/page'
import GrantBlueprintStageWrapper from '@/components/grants/GrantBlueprintStageWrapper'
import { GrantPrepEmbedModeProvider } from '@/components/grantPrep/GrantPrepEmbedModeContext'
import GrantReviewerStage from '@/components/grants/GrantReviewerStage'
import GrantSectionDraftingStage from '@/components/grants/GrantSectionDraftingStage'
import FullTextEvidenceExtractionStage from '@/components/stages/FullTextEvidenceExtractionStage'
import LiteratureSearchStage from '@/components/stages/LiteratureSearchStage'
import PaperFigurePlannerStage from '@/components/stages/PaperFigurePlannerStage'
import PaperVerticalStageNav from '@/components/stages/PaperVerticalStageNav'
import LoadingBird from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { budgetStructuredDataHasMeaningfulRows } from '@/lib/grants/budgetTemplate'
import { isGrantBibliographySection } from '@/lib/grants/workflowMode'
import { withGrantWorkspaceStage } from '@/lib/grants/workspaceNavigation'

const STAGES = [
  { key: 'GRANTMENTOR', label: 'GrantMentor' },
  { key: 'BLUEPRINT', label: 'Blueprint' },
  { key: 'LITERATURE_SEARCH', label: 'Literature Search' },
  { key: 'FULL_TEXT_EVIDENCE_EXTRACTION', label: 'Deep Analysis' },
  { key: 'FIGURE_PLANNER', label: 'Figure Planning' },
  { key: 'SECTION_DRAFTING', label: 'Section Drafting' },
  { key: 'REVIEWER', label: 'Reviewer' },
] as const

const WORKSPACE_NAV_COLLAPSED_KEY_PREFIX = 'grant-workspace-nav-collapsed'

type StageKey = typeof STAGES[number]['key']
const DEFAULT_GRANT_WORKSPACE_STAGE: StageKey = 'BLUEPRINT'

type GrantSection = {
  id?: string
  sectionKey: string
  label: string
  sectionOrder?: number
  sectionType: 'narrative' | 'short_answer' | 'checklist' | 'table' | 'budget_rows'
  workflowMode: 'app_draft' | 'app_support' | 'team_manual'
  citationMode?: 'mapped_evidence' | 'direct_draft' | 'no_citations'
  status: string
  content: string | null
  structuredResponses?: Array<{ fieldKey?: string; responseJson?: unknown }>
}

type GrantWorkspaceResponse = {
  grantSession: {
    id: string
    status: string
    draftingSessionId: string | null
    projectId: string
    project: { id: string; name: string }
    fundingCall?: { scheme_title?: string | null; agency_name?: string | null } | null
  }
  blueprint: {
    id: string
    status: string
    version: number
    sectionPlan: any[]
    sectionDrafts: GrantSection[]
  } | null
  proposalFoundation: {
    thesisStatement: string
    centralObjective: string
    keyContributions: string[]
    status: string | null
    version: number | null
  } | null
  launchPreview?: {
    blockers: Array<{ stageKey: string; pointKey: string; message: string }>
    canLaunch?: boolean
    overallReadiness?: number
    generationReady?: boolean
    generationReadinessThreshold?: number
    generationBlockedMessage?: string | null
    launchUrl?: string | null
  } | null
}

type PaperSession = any

function countWords(value: string): number {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

function readinessPercent(value: number | null | undefined): string {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`
}

function getStructuredResponseJson(section: GrantSection): unknown {
  return section.structuredResponses?.find((response) => response.fieldKey === 'structuredData')?.responseJson
    ?? section.structuredResponses?.[0]?.responseJson
}

function getDraftingStatus(section: GrantSection): 'completed' | 'in_progress' | 'pending' {
  if (section.status === 'REVIEWED' || section.status === 'COMPLETED') {
    return 'completed'
  }

  if (section.sectionType === 'narrative' || section.sectionType === 'short_answer') {
    const words = countWords(section.content || '')
    if (words >= 20) return 'completed'
    if (words > 0) return 'in_progress'
    return 'pending'
  }

  const responseJson = getStructuredResponseJson(section)
  if (responseJson && JSON.stringify(responseJson) !== '{}' && JSON.stringify(responseJson) !== '[]') {
    return section.status === 'DRAFT' ? 'in_progress' : 'completed'
  }

  if (section.status === 'DRAFT' || section.status === 'IN_PROGRESS') {
    return 'in_progress'
  }

  return 'pending'
}

function serializeGrantSectionContent(section: GrantSection): string {
  const directContent = typeof section.content === 'string' ? section.content.trim() : ''
  if (directContent) {
    return directContent
  }

  const responseJson = getStructuredResponseJson(section)
  if (!responseJson) {
    return ''
  }

  try {
    const serialized = JSON.stringify(responseJson, null, 2).trim()
    if (!serialized || serialized === '{}' || serialized === '[]') {
      return ''
    }
    return serialized
  } catch {
    return ''
  }
}

function hasMeaningfulDraftContent(value: unknown): boolean {
  return String(value || '').replace(/<[^>]*>/g, ' ').trim().length > 0
}

function hasMeaningfulStructuredDraft(value: unknown, sectionType?: GrantSection['sectionType']): boolean {
  if (value === null || typeof value === 'undefined') return false
  if (typeof value === 'string') return hasMeaningfulDraftContent(value)
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (sectionType === 'budget_rows') {
      return budgetStructuredDataHasMeaningfulRows(record)
    }
    if (Array.isArray(record.items)) {
      return record.items.some((item) => {
        const entry = item as Record<string, unknown>
        return Boolean(entry.completed) || hasMeaningfulDraftContent(entry.notes)
      })
    }
    if (Array.isArray(record.rows)) {
      return record.rows.length > 0
    }
    return Object.keys(record).length > 0
  }
  return true
}

function hasMeaningfulGrantSectionDraft(section: GrantSection): boolean {
  if (hasMeaningfulDraftContent(section.content)) return true
  return (section.structuredResponses || []).some((response) =>
    hasMeaningfulStructuredDraft(response.responseJson, section.sectionType)
  )
}

function isFreezeBlueprintLockMessage(value: string | null): boolean {
  return Boolean(value && value.includes('Freeze the grant blueprint'))
}

export default function GrantWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, token, isLoading: authLoading, authFetch } = useAuth()
  const projectId = params?.projectId as string
  const grantId = params?.grantId as string

  const [workspace, setWorkspace] = useState<GrantWorkspaceResponse | null>(null)
  const [shadowSession, setShadowSession] = useState<PaperSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<StageKey>(DEFAULT_GRANT_WORKSPACE_STAGE)
  const [hasHydratedStage, setHasHydratedStage] = useState(false)
  const [stageWarning, setStageWarning] = useState<string | null>(null)
  const [stageLockDialog, setStageLockDialog] = useState<string | null>(null)
  const [incompleteBlueprintLaunchWarning, setIncompleteBlueprintLaunchWarning] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string>('')
  const [sectionFilter, setSectionFilter] = useState<'all' | 'app_draft'>('all')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [grantMentorChatFullscreen, setGrantMentorChatFullscreen] = useState(false)
  const [launchingBlueprint, setLaunchingBlueprint] = useState(false)
  const autoLaunchAttemptedRef = useRef(false)
  const incompleteBlueprintLaunchConfirmedRef = useRef(false)

  const handleGrantSectionsUpdated = useCallback((sections: GrantSection[]) => {
    setWorkspace((current) => {
      if (!current?.blueprint) return current
      return {
        ...current,
        blueprint: {
          ...current.blueprint,
          sectionDrafts: sections,
        },
      }
    })
  }, [])

  const visibleStageKeys = useMemo<StageKey[]>(() => STAGES.map((stage) => stage.key), [])
  const stageFromQuery = searchParams?.get('stage') || null
  const resolvedCurrentStage = visibleStageKeys.includes(currentStage)
    ? currentStage
    : DEFAULT_GRANT_WORKSPACE_STAGE

  const loadWorkspace = useCallback(async (options: { showLoading?: boolean } = {}) => {
    if (!projectId || !grantId || !user) return

    const showLoading = options.showLoading !== false
    try {
      if (showLoading) setLoading(true)
      const grantResponse = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`)
      const grantPayload = await grantResponse.json().catch(() => ({})) as GrantWorkspaceResponse & { message?: string }
      if (!grantResponse.ok) {
        throw new Error(grantPayload.message || 'Failed to load grant workspace')
      }

      setWorkspace(grantPayload)
      if (grantPayload.blueprint?.status === 'FROZEN') {
        setStageWarning((current) => isFreezeBlueprintLockMessage(current) ? null : current)
        setStageLockDialog((current) => isFreezeBlueprintLockMessage(current) ? null : current)
      }

      const draftingSessionId = grantPayload.grantSession?.draftingSessionId
      if (draftingSessionId) {
        const shadowResponse = await authFetch(`/api/papers/${draftingSessionId}`)
        const shadowPayload = await shadowResponse.json().catch(() => ({}))
        if (!shadowResponse.ok) {
          throw new Error(shadowPayload.error || 'Failed to load drafting engine session')
        }
        setShadowSession(shadowPayload.session || null)
      } else {
        setShadowSession(null)
      }

      setError(null)
      if (grantPayload.grantSession?.draftingSessionId) {
        setStageWarning((current) => {
          if (
            current === 'Preparing the grant blueprint workspace...' ||
            current === 'Preparing the grant blueprint workspace. Try opening the blueprint again in a moment.' ||
            current === 'Cover the core GrantMentor points, then open the blueprint.' ||
            current === 'Open Grant Prep, review the launch warning, then open the blueprint.'
          ) {
            return null
          }
          return current
        })
      }
      return grantPayload
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load grant workspace')
      return null
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [authFetch, grantId, projectId, user])

  const handleGrantPrepWorkspaceLaunched = useCallback(async (payload: {
    grantSessionId?: string | null
    launchUrl?: string | null
  }) => {
    const targetGrantId = payload.grantSessionId || workspace?.grantSession?.id || grantId
    const targetUrl = withGrantWorkspaceStage(
      payload.launchUrl || `/projects/${projectId}/grants/${targetGrantId}/workspace`,
      DEFAULT_GRANT_WORKSPACE_STAGE
    )

    if (targetGrantId !== grantId) {
      router.push(targetUrl)
      return
    }

    const refreshed = await loadWorkspace({ showLoading: false })
    if (!refreshed?.grantSession?.draftingSessionId) {
      setStageWarning('Preparing the grant blueprint workspace. Try opening the blueprint again in a moment.')
      return
    }

    setStageWarning(null)
    setCurrentStage(DEFAULT_GRANT_WORKSPACE_STAGE)
    router.replace(targetUrl, { scroll: false })
  }, [grantId, loadWorkspace, projectId, router, workspace?.grantSession?.id])

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && projectId && grantId) {
      void loadWorkspace()
    }
  }, [authLoading, grantId, loadWorkspace, projectId, router, user])

  useEffect(() => {
    autoLaunchAttemptedRef.current = false
  }, [grantId])

  const workspaceStorageKey = useMemo(() => {
    const workspaceId = workspace?.grantSession?.id || grantId
    return workspaceId ? `grant_stage_${workspaceId}` : null
  }, [grantId, workspace?.grantSession?.id])

  const navCollapsedStorageKey = useMemo(() => {
    const workspaceId = workspace?.grantSession?.id || grantId
    return workspaceId ? `${WORKSPACE_NAV_COLLAPSED_KEY_PREFIX}_${workspaceId}` : null
  }, [grantId, workspace?.grantSession?.id])

  useEffect(() => {
    setHasHydratedStage(false)
    if (!workspaceStorageKey) return

    const storedStage = typeof window !== 'undefined'
      ? localStorage.getItem(workspaceStorageKey)
      : null

    if (stageFromQuery && visibleStageKeys.includes(stageFromQuery as StageKey)) {
      setCurrentStage(stageFromQuery as StageKey)
    } else if (storedStage && visibleStageKeys.includes(storedStage as StageKey)) {
      setCurrentStage(storedStage as StageKey)
    }

    setHasHydratedStage(true)
  }, [stageFromQuery, visibleStageKeys, workspaceStorageKey])

  useEffect(() => {
    if (!navCollapsedStorageKey || typeof window === 'undefined') return
    setNavCollapsed(localStorage.getItem(navCollapsedStorageKey) === '1')
  }, [navCollapsedStorageKey])

  useEffect(() => {
    if (!navCollapsedStorageKey || typeof window === 'undefined') return
    localStorage.setItem(navCollapsedStorageKey, navCollapsed ? '1' : '0')
  }, [navCollapsed, navCollapsedStorageKey])

  useEffect(() => {
    if (!workspaceStorageKey || !hasHydratedStage) return
    localStorage.setItem(workspaceStorageKey, currentStage)
  }, [currentStage, hasHydratedStage, workspaceStorageKey])

  const draftingSections = useMemo(() => {
    const sections = workspace?.blueprint?.sectionDrafts || []
    return sections.map((section) => ({
      key: section.sectionKey,
      label: section.label,
      description: isGrantBibliographySection(section.sectionKey)
        ? 'Generated from active citations'
        : section.sectionType === 'budget_rows'
        ? 'Generated by the app from the extracted table format'
        : section.workflowMode === 'app_draft'
          ? 'Drafted through the shadow paper engine'
        : 'Edited directly in the grant workspace',
      required: true,
      status: getDraftingStatus(section),
      workflowMode: section.workflowMode,
      sectionType: section.sectionType,
    }))
  }, [workspace?.blueprint?.sectionDrafts])

  useEffect(() => {
    if (selectedSection) return
    if (draftingSections.length === 0) return
    setSelectedSection(draftingSections[0].key)
  }, [draftingSections, selectedSection])

  const plannerPaperSections = useMemo(() => {
    const combinedSections: Array<{ sectionKey: string; content: string; status?: string }> = []
    const seen = new Set<string>()
    const shadowSections = Array.isArray(shadowSession?.paperSections) ? shadowSession.paperSections : []
    const shadowByKey = new Map<string, any>()

    for (const section of shadowSections) {
      const sectionKey = String(section?.sectionKey || '').trim()
      if (!sectionKey) continue
      shadowByKey.set(sectionKey, section)
    }

    const grantSections = [...(workspace?.blueprint?.sectionDrafts || [])].sort((left, right) => {
      const leftOrder = Number(left.sectionOrder ?? Number.MAX_SAFE_INTEGER)
      const rightOrder = Number(right.sectionOrder ?? Number.MAX_SAFE_INTEGER)
      return leftOrder - rightOrder
    })

    for (const section of grantSections) {
      const sectionKey = String(section.sectionKey || '').trim()
      if (!sectionKey || seen.has(sectionKey)) continue

      const shadowSection = shadowByKey.get(sectionKey)
      const grantContent = serializeGrantSectionContent(section)
      const shadowContent = typeof shadowSection?.content === 'string' ? shadowSection.content.trim() : ''
      const preferredContent = section.workflowMode === 'app_draft'
        ? (shadowContent || grantContent)
        : (grantContent || shadowContent)

      if (!preferredContent) continue

      combinedSections.push({
        sectionKey,
        content: preferredContent,
        status: shadowSection?.status || section.status,
      })
      seen.add(sectionKey)
    }

    for (const section of shadowSections) {
      const sectionKey = String(section?.sectionKey || '').trim()
      const content = typeof section?.content === 'string' ? section.content.trim() : ''
      if (!sectionKey || !content || seen.has(sectionKey)) continue
      combinedSections.push({
        sectionKey,
        content,
        status: section?.status,
      })
      seen.add(sectionKey)
    }

    return combinedSections
  }, [shadowSession?.paperSections, workspace?.blueprint?.sectionDrafts])

  const draftedGrantContentCount = useMemo(() => {
    const sectionKeys = new Set<string>()

    for (const section of workspace?.blueprint?.sectionDrafts || []) {
      if (hasMeaningfulGrantSectionDraft(section)) {
        sectionKeys.add(section.sectionKey)
      }
    }

    for (const section of Array.isArray(shadowSession?.paperSections) ? shadowSession.paperSections : []) {
      const sectionKey = String(section?.sectionKey || '').trim()
      if (sectionKey && hasMeaningfulDraftContent(section?.content)) {
        sectionKeys.add(sectionKey)
      }
    }

    return sectionKeys.size
  }, [shadowSession?.paperSections, workspace?.blueprint?.sectionDrafts])

  const prepPostLaunchImpact = useMemo(() => ({
    hasLaunchedWorkspace: Boolean(workspace?.blueprint || workspace?.grantSession?.draftingSessionId),
    hasBlueprint: Boolean(workspace?.blueprint),
    blueprintStatus: workspace?.blueprint?.status || null,
    hasDraftContent: draftedGrantContentCount > 0,
    draftedSectionCount: draftedGrantContentCount,
    appDraftContentCount: 0,
    manualDraftContentCount: 0,
  }), [draftedGrantContentCount, workspace?.blueprint, workspace?.grantSession?.draftingSessionId])

  const navSession = useMemo(() => {
    return {
      ...(shadowSession || {}),
      paperSections: plannerPaperSections,
      paperBlueprint: {
        ...(shadowSession?.paperBlueprint || {}),
        id: shadowSession?.paperBlueprint?.id || workspace?.blueprint?.id,
        status: workspace?.blueprint?.status || shadowSession?.paperBlueprint?.status,
        sectionPlan: shadowSession?.paperBlueprint?.sectionPlan || workspace?.blueprint?.sectionPlan || [],
      },
    }
  }, [plannerPaperSections, shadowSession, workspace?.blueprint])

  const citationsCount = Array.isArray(shadowSession?.citations) ? shadowSession.citations.length : 0
  const deepCandidatesCount = Array.isArray(shadowSession?.citations)
    ? shadowSession.citations.filter((citation: any) => {
        const explicit = String(citation?.deepAnalysisLabel || '').trim().toUpperCase()
        const fromMeta = citation?.aiMeta && typeof citation.aiMeta === 'object'
          ? String((citation.aiMeta as any).deepAnalysisRecommendation || '').trim().toUpperCase()
          : ''
        const score = Number(
          citation?.aiMeta && typeof citation.aiMeta === 'object'
            ? (citation.aiMeta as any).relevanceScore
            : 0
        )
        const label = explicit
          || fromMeta
          || (score >= 85 ? 'DEEP_ANCHOR' : score >= 65 ? 'DEEP_SUPPORT' : score >= 45 ? 'DEEP_STRESS_TEST' : 'LIT_ONLY')
        return Boolean(label) && label !== 'LIT_ONLY'
      }).length
    : 0

  const draftingSessionId = workspace?.grantSession.draftingSessionId || null
  const hasFrozenBlueprint = workspace?.blueprint?.status === 'FROZEN'
  const hasBlueprint = Boolean(workspace?.blueprint)
  const completedDraftingSectionsCount = draftingSections.filter((section) => section.status === 'completed').length
  const hideWorkspaceHeader = resolvedCurrentStage === 'GRANTMENTOR' && grantMentorChatFullscreen
  const prepGenerationDisabledReason = workspace?.launchPreview?.generationReady === false
    ? workspace.launchPreview.generationBlockedMessage
      || `Grant Prep is ${readinessPercent(workspace.launchPreview.overallReadiness)} complete. You can inspect this stage, but generation actions are disabled until Grant Prep reaches ${readinessPercent(workspace.launchPreview.generationReadinessThreshold ?? 0.5)}.`
    : null

  useEffect(() => {
    if (!hasFrozenBlueprint) return
    setStageWarning((current) => isFreezeBlueprintLockMessage(current) ? null : current)
    setStageLockDialog((current) => isFreezeBlueprintLockMessage(current) ? null : current)
  }, [hasFrozenBlueprint])

  const hydrateShadowSession = useCallback(async (sessionId: string) => {
    const shadowResponse = await authFetch(`/api/papers/${sessionId}`)
    const shadowPayload = await shadowResponse.json().catch(() => ({}))
    if (!shadowResponse.ok) {
      throw new Error(shadowPayload.error || 'Failed to load drafting engine session')
    }
    setShadowSession(shadowPayload.session || null)
  }, [authFetch])

  const handleBlueprintSessionUpdated = useCallback(async (session: any) => {
    setShadowSession(session || null)
    await loadWorkspace({ showLoading: false })
  }, [loadWorkspace])

  const launchBlueprintFromGrantMentor = useCallback(async () => {
    if (!workspace?.launchPreview || launchingBlueprint) {
      return false
    }

    setLaunchingBlueprint(true)
    setStageWarning('Preparing the grant blueprint from the GrantMentor handoff...')
    try {
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Idempotent launch/self-heal: never re-runs the blueprint LLM for an
        // already-launched, unchanged session (was 'regenerate', which forced a
        // rebuild on every mount/refresh of the BLUEPRINT stage).
        body: JSON.stringify({ action: 'launch' }),
      })
      const payload = await response.json().catch(() => ({})) as GrantWorkspaceResponse & { message?: string }
      if (!response.ok) {
        throw new Error(payload.message || 'Failed to prepare the grant blueprint')
      }

      setWorkspace(payload)
      const nextDraftingSessionId = payload.grantSession?.draftingSessionId
      if (nextDraftingSessionId) {
        await hydrateShadowSession(nextDraftingSessionId)
      }
      setStageWarning(null)
      return Boolean(nextDraftingSessionId)
    } catch (nextError) {
      setStageWarning(nextError instanceof Error ? nextError.message : 'Failed to prepare the grant blueprint')
      return false
    } finally {
      setLaunchingBlueprint(false)
    }
  }, [authFetch, grantId, hydrateShadowSession, launchingBlueprint, projectId, workspace?.launchPreview])

  const getStageLockReason = useCallback((stageKey: StageKey): string | null => {
    if (prepGenerationDisabledReason && stageKey !== 'GRANTMENTOR' && stageKey !== 'BLUEPRINT') {
      return null
    }

    switch (stageKey) {
      case 'GRANTMENTOR':
        return null
      case 'BLUEPRINT':
        if (!draftingSessionId && !hasBlueprint && !workspace?.launchPreview) {
          return 'Open Grant Prep, review the launch warning, then open the blueprint.'
        }
        return null
      case 'FIGURE_PLANNER':
        if (!hasFrozenBlueprint) return 'Freeze the grant blueprint before planning figures.'
        if (!draftingSessionId) return 'Shadow drafting session is not available yet.'
        return null
      case 'LITERATURE_SEARCH':
        if (!hasFrozenBlueprint) return 'Freeze the grant blueprint before continuing.'
        if (!draftingSessionId) return 'Shadow drafting session is not available yet.'
        return null
      case 'SECTION_DRAFTING':
        return null
      case 'REVIEWER':
        if (!hasFrozenBlueprint) return 'Freeze the grant blueprint before preparing the reviewer.'
        if (draftedGrantContentCount <= 0) return 'Draft at least one grant section before preparing the reviewer.'
        return null
      case 'FULL_TEXT_EVIDENCE_EXTRACTION':
        if (!hasFrozenBlueprint) return 'Freeze the grant blueprint before deep analysis.'
        if (!draftingSessionId) return 'Shadow drafting session is not available yet.'
        if (citationsCount === 0) return 'Import at least one citation before deep analysis.'
        return deepCandidatesCount > 0
          ? null
          : 'Run Analyze & Map in Literature Search so papers are labeled for deep analysis.'
      default:
        return null
    }
  }, [citationsCount, deepCandidatesCount, draftedGrantContentCount, draftingSessionId, hasBlueprint, hasFrozenBlueprint, prepGenerationDisabledReason, workspace?.launchPreview])

  const buildIncompleteBlueprintLaunchWarning = useCallback(() => {
    const blockerCount = workspace?.launchPreview?.blockers.length || 0
    const readiness = readinessPercent(workspace?.launchPreview?.overallReadiness)
    const readinessMessage = workspace?.launchPreview?.generationReady === false
      ? ` Grant Prep is ${readiness} complete, so generation actions will remain disabled until enough context is captured.`
      : ''
    return `${blockerCount} Grant Prep blocker${blockerCount === 1 ? '' : 's'} remain. You can open the blueprint now to inspect the workspace, but incomplete context will be recorded in the handoff snapshot.${readinessMessage}`
  }, [workspace?.launchPreview])

  const handleNavigateToStage = useCallback(async (stageKey: string) => {
    const nextStage = stageKey as StageKey
    const lockReason = getStageLockReason(nextStage)
    if (lockReason) {
      setStageWarning(null)
      setStageLockDialog(lockReason)
      return
    }

    if (nextStage === 'BLUEPRINT' && !draftingSessionId) {
      if (workspace?.blueprint) {
        const refreshed = await loadWorkspace({ showLoading: false })
        if (!refreshed?.grantSession?.draftingSessionId) {
          setStageWarning('Preparing the grant blueprint workspace. Try opening the blueprint again in a moment.')
          return
        }
      } else {
        if (
          workspace?.launchPreview
          && workspace.launchPreview.canLaunch === false
          && !incompleteBlueprintLaunchConfirmedRef.current
        ) {
          setIncompleteBlueprintLaunchWarning(buildIncompleteBlueprintLaunchWarning())
          return
        }
        const launched = await launchBlueprintFromGrantMentor()
        if (!launched) return
      }
    }

    setStageWarning(nextStage !== 'GRANTMENTOR' ? prepGenerationDisabledReason : null)
    setStageLockDialog(null)
    setCurrentStage(nextStage)
    router.replace(`/projects/${projectId}/grants/${grantId}/workspace?stage=${nextStage}`, { scroll: false })
  }, [buildIncompleteBlueprintLaunchWarning, draftingSessionId, getStageLockReason, grantId, launchBlueprintFromGrantMentor, loadWorkspace, prepGenerationDisabledReason, projectId, router, workspace?.blueprint, workspace?.launchPreview])

  useEffect(() => {
    if (!hasHydratedStage || resolvedCurrentStage !== 'BLUEPRINT' || draftingSessionId) return
    if (hasBlueprint) {
      setStageWarning('Preparing the grant blueprint workspace...')
      void loadWorkspace({ showLoading: false })
      return
    }
    if (workspace?.launchPreview?.canLaunch && !launchingBlueprint && !autoLaunchAttemptedRef.current) {
      autoLaunchAttemptedRef.current = true
      void launchBlueprintFromGrantMentor()
      return
    }
    if (workspace?.launchPreview) {
      const warning = buildIncompleteBlueprintLaunchWarning()
      setStageWarning(warning)
      if (workspace.launchPreview.canLaunch === false && !incompleteBlueprintLaunchConfirmedRef.current) {
        setIncompleteBlueprintLaunchWarning(warning)
      }
      return
    }
    setStageWarning('Open Grant Prep, review the launch warning, then open the blueprint.')
  }, [
    buildIncompleteBlueprintLaunchWarning,
    draftingSessionId,
    hasBlueprint,
    hasHydratedStage,
    launchingBlueprint,
    launchBlueprintFromGrantMentor,
    loadWorkspace,
    resolvedCurrentStage,
    workspace?.launchPreview,
  ])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingBird message="Loading your grant workspace..." useKishoFallback={true} />
      </div>
    )
  }

  if (error || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <div className="mt-4 text-xl font-semibold text-slate-900">Unable to load workspace</div>
          <p className="mt-2 text-sm text-slate-600">{error || 'Grant workspace not found'}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {!hideWorkspaceHeader ? (
        <PaperVerticalStageNav
          session={navSession}
          currentStage={resolvedCurrentStage}
          paperId={workspace.grantSession.id}
          workspaceTitle="Grant Workspace"
          visibleStageKeys={visibleStageKeys}
          stageMetaOverrides={{
            GRANTMENTOR: { label: 'Grant Prep', description: 'Grant prep and mentoring (call-aware)' },
            BLUEPRINT: { label: 'Blueprint', description: 'Define grant structure and dimensions' },
            FULL_TEXT_EVIDENCE_EXTRACTION: { label: 'Deep Analysis' },
            REVIEWER: { label: 'Grant Review', description: 'Map draft sections into reviewer checks' },
          }}
          draftingSections={draftingSections}
          onNavigateToStage={handleNavigateToStage}
          selectedSection={selectedSection}
          onSectionSelect={setSelectedSection}
          sectionFilter={sectionFilter}
          onSectionFilterChange={setSectionFilter}
          collapsed={navCollapsed}
          onCollapsedChange={setNavCollapsed}
          allowCollapse={true}
        />
      ) : null}

      <div className={`flex min-h-screen flex-col ${hideWorkspaceHeader ? 'pl-0' : navCollapsed ? 'pl-20' : 'pl-72'}`}>
        {!hideWorkspaceHeader ? (
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
            {resolvedCurrentStage === 'GRANTMENTOR' ? (
              <div className="mx-auto flex max-w-[98%] items-center gap-2 overflow-x-auto px-3 py-1.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => router.push('/projects')}
                  className="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  title="Back to Projects"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Projects</span>
                </button>
                <div className="flex min-w-[180px] flex-1 items-center gap-2">
                  <h1 className="truncate text-sm font-semibold text-slate-900" title={workspace.grantSession.project.name || 'Grant Workspace'}>
                    {workspace.grantSession.project.name || 'Grant Workspace'}
                  </h1>
                  {workspace.grantSession.fundingCall?.scheme_title ? (
                    <span className="hidden max-w-[220px] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 md:inline">
                      {workspace.grantSession.fundingCall.scheme_title}
                    </span>
                  ) : null}
                  {workspace.grantSession.fundingCall?.agency_name ? (
                    <span className="hidden max-w-[180px] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 lg:inline">
                      {workspace.grantSession.fundingCall.agency_name}
                    </span>
                  ) : null}
                  <span
                    className={hasFrozenBlueprint
                      ? 'flex-shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800'
                      : 'flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900'}
                  >
                    {hasFrozenBlueprint ? 'Frozen' : 'Not frozen'}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{citationsCount} cit</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">{deepCandidatesCount} deep</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">
                    {completedDraftingSectionsCount}/{draftingSections.length || 0} drafted
                  </span>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[98%] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => router.push('/projects')}
                    className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to Projects
                  </button>
                  <h1 className="mt-2 truncate text-xl font-semibold text-slate-900">
                    {workspace.grantSession.project.name || 'Grant Workspace'}
                  </h1>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                    {workspace.grantSession.fundingCall?.scheme_title ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                        {workspace.grantSession.fundingCall.scheme_title}
                      </span>
                    ) : null}
                    {workspace.grantSession.fundingCall?.agency_name ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                        {workspace.grantSession.fundingCall.agency_name}
                      </span>
                    ) : null}
                    {hasFrozenBlueprint ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                        Blueprint frozen
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                        Blueprint not frozen
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {citationsCount} citations
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {deepCandidatesCount} deep-analysis candidates
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {completedDraftingSectionsCount}/{draftingSections.length || 0} sections drafted
                  </span>
                </div>
              </div>
            )}
          </header>
        ) : null}

        <main
          className={
            resolvedCurrentStage === 'GRANTMENTOR'
              ? 'flex flex-1 flex-col px-0 py-0'
              : 'mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8'
          }
        >
          {stageWarning && !hideWorkspaceHeader ? (
            <div
              className={
                resolvedCurrentStage === 'GRANTMENTOR'
                  ? 'mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 sm:mx-4 lg:mx-5'
                  : 'mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
              }
            >
              {stageWarning}
            </div>
          ) : null}

          {prepGenerationDisabledReason && resolvedCurrentStage !== 'GRANTMENTOR' && stageWarning !== prepGenerationDisabledReason ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {prepGenerationDisabledReason}
            </div>
          ) : null}

          {draftedGrantContentCount > 0 && resolvedCurrentStage === 'BLUEPRINT' ? (
            <div
              className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              Drafted grant content already exists in {draftedGrantContentCount} section{draftedGrantContentCount === 1 ? '' : 's'}. Prep and blueprint edits are allowed, but review affected drafted sections afterward.
            </div>
          ) : null}

          {resolvedCurrentStage === 'GRANTMENTOR' && isFeatureEnabled('ENABLE_DRAFT_ZERO') ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
              <div className="text-sm text-teal-900">
                <span className="font-semibold">⚡ Draft Zero — fast path:</span> paste your notes once, review a generated
                proof instead of answering questions, and reach the blueprint in minutes.
              </div>
              <button
                onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/draft-zero`)}
                className="whitespace-nowrap rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
              >
                Open Draft Zero
              </button>
            </div>
          ) : null}

          {resolvedCurrentStage === 'BLUEPRINT' && isFeatureEnabled('ENABLE_DRAFT_ONE') ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
              <div className="text-sm text-teal-900">
                <span className="font-semibold">⚡ Draft One — fast path:</span> draft every section in one run, each
                auto-repaired against the agency rules, then export through the compliance gate.
              </div>
              <button
                onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/draft-one`)}
                className="whitespace-nowrap rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
              >
                Open Draft One
              </button>
            </div>
          ) : null}

          <div
            className={
              resolvedCurrentStage === 'GRANTMENTOR'
                ? 'flex flex-1 flex-col bg-prep-surface'
                : 'rounded-3xl border border-slate-200 bg-white shadow-sm'
            }
          >
            {resolvedCurrentStage === 'GRANTMENTOR' ? (
              <GrantPrepEmbedModeProvider embedded={true}>
                <GrantPrepPage
                  onWorkspaceLaunched={handleGrantPrepWorkspaceLaunched}
                  postLaunchImpactOverride={prepPostLaunchImpact}
                  onChatFullscreenChange={setGrantMentorChatFullscreen}
                />
              </GrantPrepEmbedModeProvider>
            ) : null}

            {resolvedCurrentStage === 'BLUEPRINT' ? (
              draftingSessionId ? (
                <GrantBlueprintStageWrapper
                  sessionId={draftingSessionId}
                  authToken={token}
                  projectId={projectId}
                  grantSessionId={grantId}
                  generationDisabledReason={prepGenerationDisabledReason}
                  onSessionUpdated={handleBlueprintSessionUpdated}
                  onNavigateToStage={handleNavigateToStage}
                />
              ) : (
                <div className="p-6 text-sm text-slate-600">Shadow drafting session is not available yet.</div>
              )
            ) : null}

            {resolvedCurrentStage === 'LITERATURE_SEARCH' ? (
              draftingSessionId ? (
                <LiteratureSearchStage
                  sessionId={draftingSessionId}
                  authToken={token}
                  onSessionUpdated={setShadowSession}
                />
              ) : (
                <div className="p-6 text-sm text-slate-600">Shadow drafting session is not available yet.</div>
              )
            ) : null}

            {resolvedCurrentStage === 'FULL_TEXT_EVIDENCE_EXTRACTION' ? (
              draftingSessionId ? (
                <FullTextEvidenceExtractionStage
                  sessionId={draftingSessionId}
                  authToken={token}
                  onSessionUpdated={setShadowSession}
                />
              ) : (
                <div className="p-6 text-sm text-slate-600">Shadow drafting session is not available yet.</div>
              )
            ) : null}

            {resolvedCurrentStage === 'FIGURE_PLANNER' ? (
              draftingSessionId ? (
                <PaperFigurePlannerStage
                  sessionId={draftingSessionId}
                  authToken={token}
                  session={navSession}
                  initialSelectedSectionKey={selectedSection}
                  onSessionUpdated={setShadowSession}
                  isGrantMode
                />
              ) : (
                <div className="p-6 text-sm text-slate-600">Shadow drafting session is not available yet.</div>
              )
            ) : null}

            {resolvedCurrentStage === 'SECTION_DRAFTING' && isFeatureEnabled('ENABLE_DRAFT_ONE') ? (
              <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
                <div className="text-sm text-teal-900">
                  <span className="font-semibold">Draft One:</span> draft every section in one run — each checked and
                  auto-repaired against the agency rules before you review it.
                </div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/grants/${grantId}/draft-one`)}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                >
                  Open Draft One
                </button>
              </div>
            ) : null}

            {resolvedCurrentStage === 'SECTION_DRAFTING' ? (
              <GrantSectionDraftingStage
                projectId={projectId}
                grantId={grantId}
                draftingSessionId={draftingSessionId}
                authToken={token}
                selectedSection={selectedSection}
                onSectionSelect={setSelectedSection}
                onSessionUpdated={setShadowSession}
                onSectionsUpdated={handleGrantSectionsUpdated}
                sectionFilter={sectionFilter}
                onSectionFilterChange={setSectionFilter}
              />
            ) : null}

            {resolvedCurrentStage === 'REVIEWER' ? (
              <GrantReviewerStage
                projectId={projectId}
                grantId={grantId}
                authToken={token}
                hasFrozenBlueprint={hasFrozenBlueprint}
                draftedSectionCount={draftedGrantContentCount}
              />
            ) : null}
          </div>
        </main>
      </div>

      {incompleteBlueprintLaunchWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="grant-incomplete-launch-title"
            aria-describedby="grant-incomplete-launch-message"
            className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="grant-incomplete-launch-title" className="text-base font-semibold text-slate-950">
                  Open blueprint with incomplete Grant Prep?
                </h2>
                <p id="grant-incomplete-launch-message" className="mt-2 text-sm leading-6 text-slate-700">
                  {incompleteBlueprintLaunchWarning}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIncompleteBlueprintLaunchWarning(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIncompleteBlueprintLaunchWarning(null)}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Keep editing prep
              </button>
              <button
                type="button"
                onClick={() => {
                  incompleteBlueprintLaunchConfirmedRef.current = true
                  setIncompleteBlueprintLaunchWarning(null)
                  void handleNavigateToStage('BLUEPRINT')
                }}
                className="inline-flex items-center rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                Continue to Blueprint
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stageLockDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="grant-stage-lock-title"
            aria-describedby="grant-stage-lock-message"
            className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-rose-100 p-2 text-rose-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="grant-stage-lock-title" className="text-base font-semibold text-slate-950">
                  Action needed
                </h2>
                <p id="grant-stage-lock-message" className="mt-2 text-sm leading-6 text-slate-700">
                  {stageLockDialog}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStageLockDialog(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {!hasFrozenBlueprint && stageLockDialog.includes('Freeze the grant blueprint') ? (
                <button
                  type="button"
                  onClick={() => {
                    setStageLockDialog(null)
                    void handleNavigateToStage('BLUEPRINT')
                  }}
                  className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Go to Blueprint
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setStageLockDialog(null)}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
