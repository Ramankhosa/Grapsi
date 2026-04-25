'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
} from 'lucide-react'

import GrantPrepPage from '../prep/page'
import GrantBlueprintStageWrapper from '@/components/grants/GrantBlueprintStageWrapper'
import { GrantPrepEmbedModeProvider } from '@/components/grantPrep/GrantPrepEmbedModeContext'
import GrantSectionDraftingStage from '@/components/grants/GrantSectionDraftingStage'
import FullTextEvidenceExtractionStage from '@/components/stages/FullTextEvidenceExtractionStage'
import LiteratureSearchStage from '@/components/stages/LiteratureSearchStage'
import PaperFigurePlannerStage from '@/components/stages/PaperFigurePlannerStage'
import PaperVerticalStageNav from '@/components/stages/PaperVerticalStageNav'
import LoadingBird from '@/components/ui/loading-bird'
import { useAuth } from '@/lib/auth-context'

const STAGES = [
  { key: 'GRANTMENTOR', label: 'GrantMentor' },
  { key: 'BLUEPRINT', label: 'Blueprint' },
  { key: 'LITERATURE_SEARCH', label: 'Literature Search' },
  { key: 'FULL_TEXT_EVIDENCE_EXTRACTION', label: 'Deep Analysis' },
  { key: 'FIGURE_PLANNER', label: 'Figure Planning' },
  { key: 'SECTION_DRAFTING', label: 'Section Drafting' },
] as const

const WORKSPACE_NAV_COLLAPSED_KEY_PREFIX = 'grant-workspace-nav-collapsed'

type StageKey = typeof STAGES[number]['key']

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
  structuredResponses?: Array<{ responseJson?: unknown }>
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
    launchUrl?: string | null
  } | null
}

type PaperSession = any

function countWords(value: string): number {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
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

  const responseJson = section.structuredResponses?.[0]?.responseJson
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

  const responseJson = section.structuredResponses?.[0]?.responseJson
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
  const [currentStage, setCurrentStage] = useState<StageKey>('GRANTMENTOR')
  const [hasHydratedStage, setHasHydratedStage] = useState(false)
  const [stageWarning, setStageWarning] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string>('')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [launchingBlueprint, setLaunchingBlueprint] = useState(false)
  const autoLaunchAttemptedRef = useRef(false)

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

  const visibleStageKeys = useMemo(() => STAGES.map((stage) => stage.key), [])
  const stageFromQuery = searchParams?.get('stage') || null
  const resolvedCurrentStage = visibleStageKeys.includes(currentStage)
    ? currentStage
    : 'GRANTMENTOR'

  const loadWorkspace = useCallback(async () => {
    if (!projectId || !grantId || !user) return

    try {
      setLoading(true)
      const grantResponse = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`)
      const grantPayload = await grantResponse.json().catch(() => ({})) as GrantWorkspaceResponse & { message?: string }
      if (!grantResponse.ok) {
        throw new Error(grantPayload.message || 'Failed to load grant workspace')
      }

      setWorkspace(grantPayload)

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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load grant workspace')
    } finally {
      setLoading(false)
    }
  }, [authFetch, grantId, projectId, user])

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
      description: section.workflowMode === 'app_draft'
        ? 'Drafted through the shadow paper engine'
        : 'Edited directly in the grant workspace',
      required: true,
      status: getDraftingStatus(section),
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

  const hydrateShadowSession = useCallback(async (sessionId: string) => {
    const shadowResponse = await authFetch(`/api/papers/${sessionId}`)
    const shadowPayload = await shadowResponse.json().catch(() => ({}))
    if (!shadowResponse.ok) {
      throw new Error(shadowPayload.error || 'Failed to load drafting engine session')
    }
    setShadowSession(shadowPayload.session || null)
  }, [authFetch])

  const launchBlueprintFromGrantMentor = useCallback(async () => {
    if (!workspace?.launchPreview?.canLaunch || launchingBlueprint) {
      return false
    }

    setLaunchingBlueprint(true)
    setStageWarning('Preparing the grant blueprint from the GrantMentor handoff...')
    try {
      const response = await authFetch(`/api/projects/${projectId}/grants/${grantId}/blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate' }),
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
  }, [authFetch, grantId, hydrateShadowSession, launchingBlueprint, projectId, workspace?.launchPreview?.canLaunch])

  const getStageLockReason = useCallback((stageKey: StageKey): string | null => {
    switch (stageKey) {
      case 'GRANTMENTOR':
        return null
      case 'BLUEPRINT':
        if (!draftingSessionId && !workspace?.launchPreview?.canLaunch) {
          return 'Cover the core GrantMentor points, then open the blueprint.'
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
        return hasFrozenBlueprint ? null : 'Freeze the grant blueprint before continuing.'
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
  }, [citationsCount, deepCandidatesCount, draftingSessionId, hasFrozenBlueprint, workspace?.launchPreview?.canLaunch])

  const handleNavigateToStage = useCallback(async (stageKey: string) => {
    const nextStage = stageKey as StageKey
    const lockReason = getStageLockReason(nextStage)
    if (lockReason) {
      setStageWarning(lockReason)
      return
    }

    if (nextStage === 'BLUEPRINT' && !draftingSessionId) {
      const launched = await launchBlueprintFromGrantMentor()
      if (!launched) return
    }

    setStageWarning(null)
    setCurrentStage(nextStage)
    router.replace(`/projects/${projectId}/grants/${grantId}/workspace?stage=${nextStage}`, { scroll: false })
  }, [draftingSessionId, getStageLockReason, grantId, launchBlueprintFromGrantMentor, projectId, router])

  useEffect(() => {
    if (!hasHydratedStage || resolvedCurrentStage !== 'BLUEPRINT' || draftingSessionId) return
    if (workspace?.launchPreview?.canLaunch && !launchingBlueprint && !autoLaunchAttemptedRef.current) {
      autoLaunchAttemptedRef.current = true
      void launchBlueprintFromGrantMentor()
      return
    }
    setStageWarning('Cover the core GrantMentor points, then open the blueprint.')
  }, [
    draftingSessionId,
    hasHydratedStage,
    launchingBlueprint,
    launchBlueprintFromGrantMentor,
    resolvedCurrentStage,
    workspace?.launchPreview?.canLaunch,
  ])

  const { prev, next } = (() => {
    const index = visibleStageKeys.indexOf(resolvedCurrentStage)
    return {
      prev: index > 0 ? visibleStageKeys[index - 1] as StageKey : null,
      next: index >= 0 && index < visibleStageKeys.length - 1 ? visibleStageKeys[index + 1] as StageKey : null,
    }
  })()

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
      <PaperVerticalStageNav
        session={navSession}
        currentStage={resolvedCurrentStage}
        paperId={workspace.grantSession.id}
        workspaceTitle="Grant Workspace"
        visibleStageKeys={visibleStageKeys}
        stageMetaOverrides={{
          GRANTMENTOR: { label: 'GrantMentor', description: 'Grant prep and mentoring (call-aware)' },
          BLUEPRINT: { label: 'Blueprint', description: 'Define grant structure & dimensions' },
          FULL_TEXT_EVIDENCE_EXTRACTION: { label: 'Deep Analysis' },
        }}
        draftingSections={draftingSections}
        onNavigateToStage={handleNavigateToStage}
        selectedSection={selectedSection}
        onSectionSelect={setSelectedSection}
        collapsed={navCollapsed}
        onCollapsedChange={setNavCollapsed}
        allowCollapse={true}
      />

      <div className={`flex min-h-screen flex-col ${navCollapsed ? 'pl-20' : 'pl-72'}`}>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[98%] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => router.push(`/projects/${projectId}/grants`)}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Grants
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
                {draftingSections.filter((section) => section.status === 'completed').length}/{draftingSections.length || 0} sections drafted
              </span>
            </div>
          </div>
        </header>

        <main
          className={
            resolvedCurrentStage === 'GRANTMENTOR'
              ? 'flex flex-1 flex-col px-0 py-0'
              : 'mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8'
          }
        >
          {stageWarning ? (
            <div
              className={
                resolvedCurrentStage === 'GRANTMENTOR'
                  ? 'mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-6 lg:mx-8'
                  : 'mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
              }
            >
              {stageWarning}
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
                <GrantPrepPage />
              </GrantPrepEmbedModeProvider>
            ) : null}

            {resolvedCurrentStage === 'BLUEPRINT' ? (
              draftingSessionId ? (
                <GrantBlueprintStageWrapper
                  sessionId={draftingSessionId}
                  authToken={token}
                  projectId={projectId}
                  grantSessionId={grantId}
                  onSessionUpdated={setShadowSession}
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
                  onSessionUpdated={setShadowSession}
                />
              ) : (
                <div className="p-6 text-sm text-slate-600">Shadow drafting session is not available yet.</div>
              )
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
              />
            ) : null}
          </div>
        </main>
      </div>

      <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
        {prev ? (
          <button
            type="button"
            onClick={() => void handleNavigateToStage(prev)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-lg hover:border-slate-300"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{STAGES.find((stage) => stage.key === prev)?.label}</span>
          </button>
        ) : null}

        {next ? (
          <button
            type="button"
            onClick={() => void handleNavigateToStage(next)}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
          >
            <span className="hidden sm:inline">{STAGES.find((stage) => stage.key === next)?.label}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
