'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { isFeatureEnabled } from '@/lib/feature-flags'
import LoadingBird from '@/components/ui/loading-bird'
import TopicEntryStage from '@/components/stages/TopicEntryStage'
import BlueprintStage from '@/components/stages/BlueprintStage'
import LiteratureSearchStage from '@/components/stages/LiteratureSearchStage'
import FullTextEvidenceExtractionStage from '@/components/stages/FullTextEvidenceExtractionStage'
import OutlinePlanningStage from '@/components/stages/OutlinePlanningStage'
import PaperFigurePlannerStage from '@/components/stages/PaperFigurePlannerStage'
import PaperReviewStage from '@/components/stages/PaperReviewStage'
import PaperImproveStage from '@/components/stages/PaperImproveStage'
import SectionDraftingStage from '@/components/stages/SectionDraftingStage'
import HumanizationStage from '@/components/stages/HumanizationStage'
import ReviewExportStage from '@/components/stages/ReviewExportStage'
import PaperVerticalStageNav from '@/components/stages/PaperVerticalStageNav'
import { getLatestPaperReview } from '@/lib/paper-review-utils'
import { isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata'

const STAGES = [
  { key: 'OUTLINE_PLANNING', label: 'Paper Foundation' },
  { key: 'TOPIC_ENTRY', label: 'Research Topic' },
  { key: 'BLUEPRINT', label: 'Paper Blueprint' },
  { key: 'LITERATURE_SEARCH', label: 'Literature Search' },
  { key: 'FULL_TEXT_EVIDENCE_EXTRACTION', label: 'Deep Analysis' },
  { key: 'FIGURE_PLANNER', label: 'Figure Planning' },
  { key: 'SECTION_DRAFTING', label: 'Section Drafting' },
  { key: 'MANUSCRIPT_REVIEW', label: 'Review' },
  { key: 'MANUSCRIPT_IMPROVE', label: 'Improve' },
  { key: 'HUMANIZATION', label: 'Humanization' },
  { key: 'REVIEW_EXPORT', label: 'Export' },
] as const

type StageKey = typeof STAGES[number]['key']

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onTopicSaved?: (topic: any) => void
  onNavigateToStage?: (stage: string) => void
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
}

type StageComponent = (props: StageProps) => JSX.Element

const STAGE_COMPONENTS: Record<StageKey, StageComponent> = {
  TOPIC_ENTRY: TopicEntryStage as any,
  BLUEPRINT: BlueprintStage as any,
  LITERATURE_SEARCH: LiteratureSearchStage as any,
  FULL_TEXT_EVIDENCE_EXTRACTION: FullTextEvidenceExtractionStage as any,
  OUTLINE_PLANNING: OutlinePlanningStage as any,
  FIGURE_PLANNER: PaperFigurePlannerStage as any,
  SECTION_DRAFTING: SectionDraftingStage as any,
  MANUSCRIPT_REVIEW: PaperReviewStage as any,
  MANUSCRIPT_IMPROVE: PaperImproveStage as any,
  HUMANIZATION: HumanizationStage as any,
  REVIEW_EXPORT: ReviewExportStage as any,
}

const STAGE_ORDER: StageKey[] = [
  'OUTLINE_PLANNING',
  'TOPIC_ENTRY',
  'BLUEPRINT',
  'LITERATURE_SEARCH',
  'FULL_TEXT_EVIDENCE_EXTRACTION',
  'FIGURE_PLANNER',
  'SECTION_DRAFTING',
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION',
  'REVIEW_EXPORT',
]

const HIDDEN_STAGE_KEYS = new Set<StageKey>([
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION',
])

const VISIBLE_STAGES = STAGES.filter((stage) => !HIDDEN_STAGE_KEYS.has(stage.key))
const VISIBLE_STAGE_ORDER = STAGE_ORDER.filter((stage) => !HIDDEN_STAGE_KEYS.has(stage))

interface PaperSession {
  id: string
  title?: string
  paperBlueprint?: {
    status?: string
    paperTypeCode?: string | null
  }
  paperType?: {
    code: string
    name: string
    sectionOrder?: string[]
    requiredSections?: string[]
    optionalSections?: string[]
    defaultWordLimits?: Record<string, number>
  }
  citationStyle?: {
    code: string
    name: string
  }
  publicationVenue?: {
    code: string
    name: string
  }
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED'
  citations?: any[]
  deepAnalysisJobs?: any[]
  researchTopic?: any
  annexureDrafts?: any[]
  figurePlans?: any[]
  paperSections?: Array<{
    sectionKey?: string
    status?: string
    content?: string
    wordCount?: number
  }>
  targetWordCount?: number
  literatureReviewStatus?: string
  createdAt: string
  updatedAt: string
}

function parsePaperDraftSections(session: PaperSession | null): Record<string, string> {
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const paperDraft = drafts
    .filter((draft: any) => String(draft?.jurisdiction || '').toUpperCase() === 'PAPER')
    .sort((left: any, right: any) => (right?.version || 0) - (left?.version || 0))[0]

  if (!paperDraft?.extraSections) return {}
  if (typeof paperDraft.extraSections === 'string') {
    try {
      return JSON.parse(paperDraft.extraSections) as Record<string, string>
    } catch {
      return {}
    }
  }

  return typeof paperDraft.extraSections === 'object'
    ? paperDraft.extraSections as Record<string, string>
    : {}
}

function countWords(value: string): number {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').trim()
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

export default function PaperSessionPage() {
  const params = useParams()
  const router = useRouter()
  const { user, token, isLoading: authLoading, authFetch } = useAuth()
  const paperId = params?.paperId as string

  const [session, setSession] = useState<PaperSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<StageKey>('OUTLINE_PLANNING')
  const [hasHydratedStage, setHasHydratedStage] = useState(false)
  const [stageWarning, setStageWarning] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string>('')
  const resolvedCurrentStage = VISIBLE_STAGE_ORDER.includes(currentStage)
    ? currentStage
    : VISIBLE_STAGE_ORDER[0]

  const loadSession = useCallback(async () => {
    if (!paperId || !user) return

    try {
      setLoading(true)
      const response = await authFetch(`/api/papers/${paperId}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load paper session')
      }

      setSession(data.session)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load paper session')
    } finally {
      setLoading(false)
    }
  }, [authFetch, paperId, user])

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
      return
    }

    if (user && paperId && isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
      void loadSession()
    }
  }, [authLoading, user, paperId, router, loadSession])

  useEffect(() => {
    setHasHydratedStage(false)
    if (!paperId) return

    const storedStage = typeof window !== 'undefined'
      ? localStorage.getItem(`paper_stage_${paperId}`)
      : null

    if (storedStage && VISIBLE_STAGES.some((stage) => stage.key === storedStage)) {
      setCurrentStage(storedStage as StageKey)
    }
    setHasHydratedStage(true)
  }, [paperId])

  useEffect(() => {
    if (!paperId || !hasHydratedStage) return
    localStorage.setItem(`paper_stage_${paperId}`, currentStage)
  }, [paperId, currentStage, hasHydratedStage])

  const citationsCount = Array.isArray(session?.citations) ? session.citations.length : 0
  const hasTopic = !!session?.researchTopic?.researchQuestion
  const hasPaperType = !!(session?.paperBlueprint?.paperTypeCode || session?.paperType?.code)
  const hasFrozenBlueprint = session?.paperBlueprint?.status === 'FROZEN'
  const deepCandidatesCount = Array.isArray(session?.citations)
    ? session.citations.filter((citation: any) => {
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

  const paperDraftSections = useMemo(() => parsePaperDraftSections(session), [session])
  const hasDraftContent = useMemo(
    () => Object.values(paperDraftSections).some((value) => countWords(String(value || '')) > 0),
    [paperDraftSections]
  )
  const requiredSectionKeys = useMemo(() => {
    const requiredSections = session?.paperType?.requiredSections
    if (Array.isArray(requiredSections)) {
      return requiredSections.map((section: any) => String(section)).filter(Boolean)
    }
    if (typeof requiredSections === 'string') {
      try {
        const parsed = JSON.parse(requiredSections)
        if (Array.isArray(parsed)) {
          return parsed.map((section: any) => String(section)).filter(Boolean)
        }
      } catch {
        return []
      }
    }
    return []
  }, [session?.paperType?.requiredSections])
  const hasRequiredSections = useMemo(() => {
    if (requiredSectionKeys.length === 0) return false
    return requiredSectionKeys.every((sectionKey) => countWords(paperDraftSections[sectionKey] || '') >= 20)
  }, [paperDraftSections, requiredSectionKeys])
  const latestReview = useMemo(() => getLatestPaperReview(session), [session])
  const hasReviewReport = !!latestReview

  const grantBacked = isGrantBackedPaperTypeCode(
    session?.paperBlueprint?.paperTypeCode || session?.paperType?.code
  )

  const getStageLockReason = useCallback((stageKey: StageKey): string | null => {
    switch (stageKey) {
      case 'OUTLINE_PLANNING':
        return null
      case 'TOPIC_ENTRY':
        return hasPaperType ? null : 'Select a paper type first to define the topic context.'
      case 'LITERATURE_SEARCH':
        return hasTopic ? null : 'Define the research topic before literature search.'
      case 'FULL_TEXT_EVIDENCE_EXTRACTION':
        if (!hasTopic) return 'Define the research topic before deep analysis.'
        if (!hasFrozenBlueprint) return 'Freeze the blueprint before running deep analysis.'
        if (citationsCount === 0) return 'Import at least one citation before deep analysis.'
        return deepCandidatesCount > 0
          ? null
          : 'Run Analyze & Map in Literature Search so papers are labeled for deep analysis.'
      case 'SECTION_DRAFTING':
        return hasPaperType ? null : 'Complete paper foundation setup before drafting sections.'
      case 'MANUSCRIPT_REVIEW':
        return hasDraftContent ? null : 'Draft at least one section before review.'
      case 'MANUSCRIPT_IMPROVE':
        return hasReviewReport ? null : 'Run the Review stage first.'
      case 'HUMANIZATION':
        return hasDraftContent ? null : 'Draft at least one section before humanization.'
      case 'REVIEW_EXPORT':
        if (requiredSectionKeys.length === 0) {
          return hasDraftContent ? null : 'Draft at least one section before export.'
        }
        return hasRequiredSections ? null : 'Complete all required sections before export.'
      default:
        return null
    }
  }, [
    citationsCount,
    deepCandidatesCount,
    hasDraftContent,
    hasFrozenBlueprint,
    hasPaperType,
    hasRequiredSections,
    hasReviewReport,
    hasTopic,
    requiredSectionKeys.length,
  ])

  const handleNavigateToStage = useCallback(async (stageKey: string) => {
    const nextStage = stageKey as StageKey
    if (HIDDEN_STAGE_KEYS.has(nextStage)) return

    const lockReason = getStageLockReason(nextStage)
    if (lockReason) {
      setStageWarning(lockReason)
      return
    }

    setStageWarning(null)
    setCurrentStage(nextStage)
    if (paperId) {
      localStorage.setItem(`paper_stage_${paperId}`, nextStage)
    }
  }, [getStageLockReason, paperId])

  const handleSessionUpdated = useCallback((updatedSession: any) => {
    setSession(updatedSession)
  }, [])

  const handleTopicSaved = useCallback((topic: any) => {
    setSession((current) => (current ? { ...current, researchTopic: topic } : null))
  }, [])

  const { prev, next } = (() => {
    const index = VISIBLE_STAGE_ORDER.indexOf(resolvedCurrentStage)
    return {
      prev: index > 0 ? VISIBLE_STAGE_ORDER[index - 1] : null,
      next: index >= 0 && index < VISIBLE_STAGE_ORDER.length - 1 ? VISIBLE_STAGE_ORDER[index + 1] : null,
    }
  })()

  const StageComponent = STAGE_COMPONENTS[resolvedCurrentStage]

  if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Paper writing UI is disabled</div>
          <p className="mt-2 text-sm text-slate-600">Enable the paper writing feature flag to use this workspace.</p>
        </div>
      </div>
    )
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingBird message="Loading your literature and drafting workspace..." useKishoFallback={true} />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <div className="mt-4 text-xl font-semibold text-slate-900">Unable to load workspace</div>
          <p className="mt-2 text-sm text-slate-600">{error || 'Paper session not found'}</p>
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
        session={session}
        currentStage={resolvedCurrentStage}
        paperId={paperId}
        onNavigateToStage={handleNavigateToStage}
        selectedSection={selectedSection}
        onSectionSelect={setSelectedSection}
      />

      <div className="pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[98%] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <h1 className="mt-2 truncate text-xl font-semibold text-slate-900">
                {session.title || session.researchTopic?.title || 'Paper Workspace'}
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                {session.paperType?.name ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {session.paperType.name}
                  </span>
                ) : null}
                {session.citationStyle?.name ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {session.citationStyle.name}
                  </span>
                ) : null}
                {grantBacked ? (
                  <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">
                    Grant-backed workspace
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
                {hasDraftContent ? 'Draft started' : 'No draft yet'}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {grantBacked ? (
            <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 text-sm text-violet-900">
              This workspace mirrors the grant blueprint. Use the paper stages for literature search,
              deep analysis, figures, and drafting. Edit structure and dimensions from the grant blueprint.
            </div>
          ) : null}

          {stageWarning ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {stageWarning}
            </div>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            {StageComponent ? (
              <StageComponent
                sessionId={paperId}
                authToken={token}
                onSessionUpdated={handleSessionUpdated}
                onTopicSaved={handleTopicSaved}
                onNavigateToStage={handleNavigateToStage}
                selectedSection={selectedSection}
                onSectionSelect={setSelectedSection}
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
            <span className="hidden sm:inline">{VISIBLE_STAGES.find((stage) => stage.key === prev)?.label}</span>
          </button>
        ) : null}

        {next ? (
          <button
            type="button"
            onClick={() => void handleNavigateToStage(next)}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
          >
            <span className="hidden sm:inline">{VISIBLE_STAGES.find((stage) => stage.key === next)?.label}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
