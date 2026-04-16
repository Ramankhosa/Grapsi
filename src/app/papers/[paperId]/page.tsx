'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import LoadingBird from '@/components/ui/loading-bird'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle,
  AlertCircle,
  Sparkles,
  X
} from 'lucide-react'
import { isFeatureEnabled } from '@/lib/feature-flags'
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

const STAGES = [
  { key: 'OUTLINE_PLANNING', label: 'Paper Foundation', description: 'Set up paper type & structure' },
  { key: 'TOPIC_ENTRY', label: 'Research Topic', description: 'Define your research question' },
  { key: 'BLUEPRINT', label: 'Paper Blueprint', description: 'Define paper structure & dimensions' },
  { key: 'LITERATURE_SEARCH', label: 'Literature Search', description: 'Search and import citations' },
  { key: 'FULL_TEXT_EVIDENCE_EXTRACTION', label: 'Full-Text Evidence Extraction', description: 'Extract and validate grounded evidence from full text' },
  { key: 'FIGURE_PLANNER', label: 'Figure Planning', description: 'Plan figures and tables' },
  { key: 'SECTION_DRAFTING', label: 'Section Drafting', description: 'Generate and edit sections' },
  { key: 'MANUSCRIPT_REVIEW', label: 'Review', description: 'Audit the drafted manuscript' },
  { key: 'MANUSCRIPT_IMPROVE', label: 'Improve', description: 'Apply review recommendations with diff preview' },
  { key: 'HUMANIZATION', label: 'Humanization', description: 'Humanize sections and validate citations' },
  { key: 'REVIEW_EXPORT', label: 'Adaptive Export', description: 'Extract formatting and export' }
] as const

type StageKey = typeof STAGES[number]['key']

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onTopicSaved?: (topic: any) => void
  onNavigateToStage?: (stage: string) => void
  // For Section Drafting
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
  REVIEW_EXPORT: ReviewExportStage as any
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
  'REVIEW_EXPORT'
]

const HIDDEN_STAGE_KEYS = new Set<StageKey>([
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION'
])

const VISIBLE_STAGES = STAGES.filter(stage => !HIDDEN_STAGE_KEYS.has(stage.key))
const VISIBLE_STAGE_ORDER = STAGE_ORDER.filter(stage => !HIDDEN_STAGE_KEYS.has(stage))

interface PaperSession {
  id: string
  title?: string
  paperBlueprint?: {
    status?: string
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
  researchTopic?: any
  annexureDrafts?: any[]
  figurePlans?: any[]
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
  const { user } = useAuth()
  const paperId = params?.paperId as string

  const [session, setSession] = useState<PaperSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStage, setCurrentStage] = useState<StageKey>('OUTLINE_PLANNING')
  const [hasHydratedStage, setHasHydratedStage] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [stageWarning, setStageWarning] = useState<string | null>(null)
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false)
  const [selectedSection, setSelectedSection] = useState<string>('')
  const resolvedCurrentStage = VISIBLE_STAGE_ORDER.includes(currentStage)
    ? currentStage
    : VISIBLE_STAGE_ORDER[0]

  const authToken = useMemo(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('auth_token')
  }, [])

  const loadSession = useCallback(async () => {
    if (!paperId || !authToken) return

    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${paperId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load paper session')
      }

      setSession(data.session)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paper session')
    } finally {
      setLoading(false)
    }
  }, [paperId, authToken])

  useEffect(() => {
    setHasHydratedStage(false)
    if (!paperId) return

    const stored = typeof window !== 'undefined'
      ? localStorage.getItem(`paper_stage_${paperId}`)
      : null
    if (stored && VISIBLE_STAGES.some(stage => stage.key === stored)) {
      setCurrentStage(stored as StageKey)
    }
    setHasHydratedStage(true)
  }, [paperId])

  useEffect(() => {
    if (paperId && user && isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
      loadSession()
    }
  }, [paperId, user, loadSession])

  useEffect(() => {
    if (!paperId || !hasHydratedStage) return
    localStorage.setItem(`paper_stage_${paperId}`, currentStage)
  }, [paperId, currentStage, hasHydratedStage])

  // Calculate progress and statistics
  const paperStats = useMemo(() => {
    if (!session) return null

    const citationsCount = Array.isArray(session.citations) ? session.citations.length : 0
    const hasTopic = !!session.researchTopic?.researchQuestion
    const hasPaperType = !!session.paperType?.code

    // Calculate word count and sections from annexureDrafts
    let totalWords = 0
    const sections: Record<string, boolean> = {}
    
    if (session.annexureDrafts) {
      session.annexureDrafts.forEach((draft: any) => {
        if (draft.content) {
          totalWords += draft.content.split(/\s+/).filter((word: string) => word.length > 0).length
        }
        // Track which sections have content
        if (draft.sectionCode && draft.content) {
          sections[draft.sectionCode] = true
        }
      })
    }

    // Calculate overall progress
    const stagesComplete = [hasTopic, citationsCount >= 5, hasPaperType, Object.keys(sections).length > 0].filter(Boolean).length
    const progress = Math.round((stagesComplete / 4) * 100)

    return {
      citationsCount,
      totalWords,
      hasTopic,
      hasPaperType,
      sections,
      progress
    }
  }, [session])

  const citationsCount = Array.isArray(session?.citations) ? session.citations.length : 0
  const hasTopic = !!session?.researchTopic?.researchQuestion
  const hasPaperType = !!session?.paperType?.code
  const hasFrozenBlueprint = session?.paperBlueprint?.status === 'FROZEN'
  const deepCandidatesCount = Array.isArray(session?.citations)
    ? session.citations.filter((citation: any) => {
        const explicit = String(citation?.deepAnalysisLabel || '').trim().toUpperCase()
        const fromMeta = citation?.aiMeta && typeof citation.aiMeta === 'object'
          ? String((citation.aiMeta as any).deepAnalysisRecommendation || '').trim().toUpperCase()
          : ''
        const score = Number(citation?.aiMeta && typeof citation.aiMeta === 'object'
          ? (citation.aiMeta as any).relevanceScore
          : 0)
        const label = explicit
          || fromMeta
          || (score >= 85 ? 'DEEP_ANCHOR' : score >= 65 ? 'DEEP_SUPPORT' : score >= 45 ? 'DEEP_STRESS_TEST' : 'LIT_ONLY')
        return Boolean(label) && label !== 'LIT_ONLY'
      }).length
    : 0
  const paperDraftSections = useMemo(() => parsePaperDraftSections(session), [session])
  const hasDraftContent = useMemo(
    () => Object.values(paperDraftSections).some(value => countWords(String(value || '')) > 0),
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
    return requiredSectionKeys.every(sectionKey => countWords(paperDraftSections[sectionKey] || '') >= 20)
  }, [paperDraftSections, requiredSectionKeys])
  const latestReview = useMemo(() => getLatestPaperReview(session), [session])
  const hasReviewReport = !!latestReview

  const getStageLockReason = useCallback((stageKey: StageKey): string | null => {
    switch (stageKey) {
      case 'OUTLINE_PLANNING':
        return null
      case 'TOPIC_ENTRY':
        return hasPaperType ? null : 'Select a paper type first to define your research topic.'
      case 'LITERATURE_SEARCH':
        return hasTopic ? null : 'Define your research topic to begin literature search.'
      case 'FULL_TEXT_EVIDENCE_EXTRACTION':
        if (!hasTopic) return 'Define your research topic before extracting full-text evidence.'
        if (!hasFrozenBlueprint) return 'Freeze the blueprint before running full-text evidence extraction.'
        if (citationsCount === 0) return 'Import at least one citation in Literature Search before deep evidence extraction.'
        return deepCandidatesCount > 0
          ? null
          : 'Run Analyze & Map in Literature Search so papers are labeled for deep analysis.'
      case 'SECTION_DRAFTING':
        return hasPaperType ? null : 'Complete paper foundation setup before drafting sections.'
      case 'MANUSCRIPT_REVIEW':
        return hasDraftContent ? null : 'Draft at least one section before running manuscript review.'
      case 'MANUSCRIPT_IMPROVE':
        return hasReviewReport ? null : 'Run the Review stage first to generate a persisted review report.'
      case 'HUMANIZATION':
        return hasDraftContent ? null : 'Draft at least one section before starting humanization.'
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
    if (HIDDEN_STAGE_KEYS.has(nextStage)) {
      return
    }
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
    setAutoSaveStatus('saved')
  }, [])

  const handleTopicSaved = useCallback((topic: any) => {
    setSession(prev => prev ? { ...prev, researchTopic: topic } : null)
  }, [])

  // Check if paper writing feature is enabled
  if (!isFeatureEnabled('ENABLE_PAPER_WRITING_UI')) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpenCheck className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Paper Writing Feature</h2>
          <p className="text-slate-600">This feature is not currently available.</p>
        </div>
      </div>
    )
  }

  const handleTitleEdit = async (newTitle: string) => {
    if (!authToken || !session) return

    try {
      setAutoSaveStatus('saving')
      const response = await fetch(`/api/papers/${paperId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: newTitle
        })
      })

      if (response.ok) {
        setSession(prev => prev ? { ...prev, title: newTitle } : null)
        setAutoSaveStatus('saved')
      } else {
        setAutoSaveStatus('error')
      }
    } catch (error) {
      setAutoSaveStatus('error')
    }
  }

  // Get prev/next stages for navigation
  const getPrevNextStages = () => {
    const idx = STAGE_ORDER.indexOf(currentStage)
    const prev = idx > 0 ? STAGE_ORDER[idx - 1] : null
    const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null
    return { prev, next }
  }

  const { prev, next } = (() => {
    const idx = VISIBLE_STAGE_ORDER.indexOf(resolvedCurrentStage)
    const prevStage = idx > 0 ? VISIBLE_STAGE_ORDER[idx - 1] : null
    const nextStage = idx >= 0 && idx < VISIBLE_STAGE_ORDER.length - 1 ? VISIBLE_STAGE_ORDER[idx + 1] : null
    return { prev: prevStage, next: nextStage }
  })()

  const StageComponent = STAGE_COMPONENTS[resolvedCurrentStage]

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingBird message="Loading your paper workspace..." useKishoFallback={true} />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Unable to Load Paper</h2>
          <p className="text-slate-600 mb-4">{error || 'Paper not found'}</p>
          <button
            onClick={() => router.push('/papers')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Papers
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Vertical Stage Navigation Sidebar */}
      <PaperVerticalStageNav
        session={session}
        currentStage={resolvedCurrentStage}
        paperId={paperId}
        onNavigateToStage={handleNavigateToStage}
        selectedSection={selectedSection}
        onSectionSelect={setSelectedSection}
      />

      {/* Floating Navigation Buttons */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
                {prev && (
                  <button
                    onClick={() => handleNavigateToStage(prev)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-full shadow-lg hover:shadow-xl hover:border-slate-300 transition-all text-sm font-medium text-slate-700"
          >
            <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">{VISIBLE_STAGES.find(s => s.key === prev)?.label}</span>
                  </button>
                )}
        {next && (
          <button
            onClick={() => handleNavigateToStage(next)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-full shadow-lg hover:shadow-xl hover:bg-blue-700 transition-all text-sm font-medium"
          >
            <span className="hidden sm:inline">{VISIBLE_STAGES.find(s => s.key === next)?.label}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Content Area - Shifted right for sidebar */}
      <div className="pl-72 transition-all duration-300">
        {/* Header */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30">
          <div className="w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-14">
              {/* Left side - Back and Title */}
              <div className="flex items-center space-x-4 min-w-0 flex-1">
                <button
                  onClick={() => router.push('/papers')}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Back to Papers"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="h-4 w-px bg-slate-200 mx-2 hidden sm:block" />

                <div className="flex flex-col justify-center min-w-0">
                  <input
                    type="text"
                    value={session.title || session.researchTopic?.title || 'Untitled Paper'}
                    onChange={(e) => handleTitleEdit(e.target.value)}
                    className="text-sm font-semibold text-slate-900 bg-transparent border-none outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 rounded px-1 py-0.5 -mx-1 truncate max-w-md"
                    placeholder="Enter paper title..."
                  />
                  <div className="flex items-center gap-2 mt-0.5">
                    {session.paperType && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                        {session.paperType.name}
                      </span>
                    )}
                    {session.citationStyle && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                        {session.citationStyle.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right side - Status and Actions */}
              <div className="flex items-center space-x-3 flex-shrink-0">
                {/* Auto-save indicator */}
                <div className="flex items-center gap-1.5 text-xs">
                  {autoSaveStatus === 'saving' && (
                    <>
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-slate-500">Saving...</span>
                    </>
                  )}
                  {autoSaveStatus === 'saved' && (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-slate-500">Saved</span>
                    </>
                  )}
                  {autoSaveStatus === 'error' && (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-red-500">Error</span>
                    </>
                  )}
                </div>

                {/* Export button */}
                <button className="inline-flex items-center px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors">
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Export
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="w-full max-w-[1400px] mx-auto py-6 px-4 sm:px-6 lg:px-8">
          {stageWarning && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {stageWarning}
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStage}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-white rounded-xl border border-slate-200 shadow-sm min-h-[calc(100vh-160px)] overflow-hidden"
            >
              {StageComponent && (
                <StageComponent
                  sessionId={paperId}
                  authToken={authToken}
                  onSessionUpdated={handleSessionUpdated}
                  onTopicSaved={handleTopicSaved}
                  onNavigateToStage={handleNavigateToStage}
                  selectedSection={selectedSection}
                  onSectionSelect={setSelectedSection}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Floating AI Assistant Button */}
      <button
        onClick={() => setAiAssistantOpen(!aiAssistantOpen)}
        className={`
          fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
          bg-gradient-to-br from-indigo-500 to-purple-600
          text-white shadow-lg hover:shadow-xl
          flex items-center justify-center
          transition-all duration-200 hover:scale-105
          ${aiAssistantOpen ? 'rotate-45' : ''}
        `}
        title="AI Assistant"
      >
        {aiAssistantOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>

      {/* AI Assistant Panel */}
      <AnimatePresence>
        {aiAssistantOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-6 z-40 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="p-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
              <h3 className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Writing Assistant
              </h3>
              <p className="text-xs text-white/80 mt-1">Get help with your paper</p>
            </div>
            <div className="p-4 space-y-2">
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 text-sm text-slate-700 transition-colors">
                📝 Generate section content
              </button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 text-sm text-slate-700 transition-colors">
                ✨ Improve writing style
              </button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 text-sm text-slate-700 transition-colors">
                📚 Find relevant citations
              </button>
              <button className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 text-sm text-slate-700 transition-colors">
                🔍 Check for gaps
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
