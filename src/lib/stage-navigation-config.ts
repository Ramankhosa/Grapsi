/**
 * Stage Navigation Configuration (Research Paper Flow)
 *
 * This file defines the structure of stages and sub-stages for paper drafting.
 * Data comes from the session object and paper-type configuration in the database.
 */

import {
  BookOpen,
  CheckCircle,
  FileText,
  Lightbulb,
  ListOrdered,
  PenTool,
  Search,
  Sparkles,
  Target,
  type LucideIcon
} from 'lucide-react'
import { countPendingRewriteIssues, getLatestPaperReview } from '@/lib/paper-review-utils'

// ============================================================================
// Types
// ============================================================================

export type SubStageStatus = 'completed' | 'in_progress' | 'pending' | 'skipped'

export interface SubStageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  required: boolean
  getStatus: (session: any) => SubStageStatus
}

export interface StageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  groupLabel?: string
  subStages: SubStageDefinition[]
  weight: number
  getSubStages?: (session: any) => SubStageDefinition[]
}

// ============================================================================
// Helpers
// ============================================================================

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(Boolean)
  }
  if (typeof value === 'string') {
    const parsed = safeJsonParse<unknown>(value, [])
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item)).filter(Boolean)
    }
  }
  return []
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function normalizeSectionKey(sectionKey: string): string {
  return sectionKey.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function computeContentFingerprint(content: string): string {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()

  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0
  }

  const positive = hash >>> 0
  return `${positive.toString(16)}_${normalized.length}`
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

function getLatestPaperDraft(session: any): any | null {
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const paperDraft = drafts
    .filter((draft: any) => (draft?.jurisdiction || '').toUpperCase() === 'PAPER')
    .sort((a: any, b: any) => (b?.version || 0) - (a?.version || 0))[0]

  return paperDraft || null
}

function getPaperDraftSections(session: any): Record<string, string> {
  const paperDraft = getLatestPaperDraft(session)
  if (!paperDraft) return {}

  const extraSections = paperDraft.extraSections
  if (!extraSections) return {}
  if (typeof extraSections === 'string') {
    return safeJsonParse<Record<string, string>>(extraSections, {})
  }
  if (typeof extraSections === 'object') {
    return extraSections as Record<string, string>
  }
  return {}
}

function getHumanizedSections(session: any): Record<string, any> {
  const rows = Array.isArray(session?.paperSectionHumanizations)
    ? session.paperSectionHumanizations
    : []
  if (rows.length === 0) return {}

  const map: Record<string, any> = {}
  for (const row of rows) {
    const sectionKey = normalizeSectionKey(String(row?.sectionKey || ''))
    if (!sectionKey) continue
    map[sectionKey] = {
      ...row,
      sourceDraftFingerprint: row?.sourceDraftFingerprint || '',
      humanizedContent: row?.humanizedContent || ''
    }
  }

  return map
}

function getPaperSectionStatus(session: any, sectionKey: string): { status: SubStageStatus; wordCount: number } {
  const sections = getPaperDraftSections(session)
  const content = sections[sectionKey] || ''
  const wordCount = computeWordCount(typeof content === 'string' ? content : '')

  if (wordCount >= 20) return { status: 'completed', wordCount }
  if (wordCount > 0) return { status: 'in_progress', wordCount }
  return { status: 'pending', wordCount }
}

function getPaperTypeSectionConfig(session: any): {
  requiredSections: string[]
  optionalSections: string[]
  sectionOrder: string[]
} {
  const paperType = session?.paperType
  const requiredSections = normalizeStringArray(paperType?.requiredSections)
  const optionalSections = normalizeStringArray(paperType?.optionalSections)
  const sectionOrder = normalizeStringArray(paperType?.sectionOrder)

  if (sectionOrder.length > 0) {
    return { requiredSections, optionalSections, sectionOrder }
  }

  const combined = [...requiredSections, ...optionalSections]
  const unique = Array.from(new Set(combined))
  return { requiredSections, optionalSections, sectionOrder: unique }
}

function getDraftSectionSubStages(session: any): SubStageDefinition[] {
  const { requiredSections, sectionOrder } = getPaperTypeSectionConfig(session)
  if (sectionOrder.length === 0) return []

  return sectionOrder.map(sectionKey => {
    const isRequired = requiredSections.includes(sectionKey)
    return {
      key: sectionKey,
      label: formatSectionLabel(sectionKey),
      icon: FileText,
      description: isRequired ? 'Required section' : 'Optional section',
      required: isRequired,
      getStatus: (currentSession: any) => getPaperSectionStatus(currentSession, sectionKey).status
    }
  })
}

function getHumanizationSectionStatus(session: any, sectionKey: string): SubStageStatus {
  const normalizedKey = normalizeSectionKey(sectionKey)
  const draftSections = getPaperDraftSections(session)
  const draftContent = String(draftSections[normalizedKey] || '')
  const draftWordCount = computeWordCount(draftContent)
  if (draftWordCount === 0) return 'pending'

  const humanizedSections = getHumanizedSections(session)
  const record = humanizedSections[normalizedKey]
  if (!record || typeof record !== 'object') return 'pending'

  const status = String((record as any).status || '').toLowerCase()
  if (status === 'failed') return 'in_progress'
  if (status === 'processing') return 'in_progress'

  const humanizedContent = typeof (record as any).humanizedContent === 'string'
    ? (record as any).humanizedContent
    : ''
  if (!humanizedContent.trim()) return 'pending'

  const sourceDraftFingerprint = typeof (record as any).sourceDraftFingerprint === 'string'
    ? (record as any).sourceDraftFingerprint
    : ''
  if (sourceDraftFingerprint && sourceDraftFingerprint !== computeContentFingerprint(draftContent)) {
    return 'in_progress'
  }

  return 'completed'
}

function getHumanizationSubStages(session: any): SubStageDefinition[] {
  const { requiredSections, sectionOrder } = getPaperTypeSectionConfig(session)
  if (sectionOrder.length === 0) return []

  return sectionOrder.map(sectionKey => {
    const isRequired = requiredSections.includes(sectionKey)
    return {
      key: sectionKey,
      label: formatSectionLabel(sectionKey),
      icon: FileText,
      description: isRequired ? 'Required section' : 'Optional section',
      required: isRequired,
      getStatus: (currentSession: any) => getHumanizationSectionStatus(currentSession, sectionKey)
    }
  })
}

function getCitationsCount(session: any): number {
  return Array.isArray(session?.citations) ? session.citations.length : 0
}

function getDeepAnalysisJobs(session: any): any[] {
  return Array.isArray(session?.deepAnalysisJobs) ? session.deepAnalysisJobs : []
}

function estimateDeepLabelFromCitation(citation: any): string {
  const explicit = String(citation?.deepAnalysisLabel || '').trim().toUpperCase();
  if (explicit) {
    return explicit;
  }

  const fromMeta = citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? String((citation.aiMeta as any).deepAnalysisRecommendation || '').trim().toUpperCase()
    : '';
  if (fromMeta) {
    return fromMeta;
  }

  const score = Number(citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? (citation.aiMeta as any).relevanceScore
    : 0);
  if (score >= 85) return 'DEEP_ANCHOR';
  if (score >= 65) return 'DEEP_SUPPORT';
  if (score >= 45) return 'DEEP_STRESS_TEST';
  return 'LIT_ONLY';
}

function getDeepAnalysisSummary(session: any): {
  eligible: number
  completed: number
  failed: number
  running: number
  cards: number
} {
  const citations = Array.isArray(session?.citations) ? session.citations : []
  const jobs = getDeepAnalysisJobs(session)

  const eligible = citations.filter((citation: any) => {
    const label = estimateDeepLabelFromCitation(citation)
    return Boolean(label) && label !== 'LIT_ONLY'
  }).length

  const runningStatuses = new Set(['PENDING', 'PREPARING', 'EXTRACTING', 'MAPPING'])
  const completed = jobs.filter((job: any) => String(job?.status || '') === 'COMPLETED').length
  const failed = jobs.filter((job: any) => String(job?.status || '') === 'FAILED').length
  const running = jobs.filter((job: any) => runningStatuses.has(String(job?.status || ''))).length

  const citationCards = citations.reduce((sum: number, citation: any) => {
    const count = Number(citation?.evidenceCardCount || 0)
    return sum + (Number.isFinite(count) ? count : 0)
  }, 0)

  const jobCards = jobs.reduce((sum: number, job: any) => {
    const count = Number(job?._count?.cards || 0)
    return sum + (Number.isFinite(count) ? count : 0)
  }, 0)

  return {
    eligible,
    completed,
    failed,
    running,
    cards: Math.max(citationCards, jobCards)
  }
}

function getRequiredSectionsCompletion(session: any): SubStageStatus {
  const { requiredSections } = getPaperTypeSectionConfig(session)
  if (requiredSections.length === 0) return 'pending'

  const statuses = requiredSections.map(sectionKey => getPaperSectionStatus(session, sectionKey).status)
  if (statuses.every(status => status === 'completed')) return 'completed'
  if (statuses.some(status => status !== 'pending')) return 'in_progress'
  return 'pending'
}

function getDraftReadyStatus(session: any): SubStageStatus {
  if (typeof session?.currentWordCount === 'number' && session.currentWordCount > 0) {
    return 'completed'
  }

  const sections = getPaperDraftSections(session)
  const hasContent = Object.values(sections).some(content => computeWordCount(String(content)) > 0)
  return hasContent ? 'completed' : 'pending'
}

function getPaperReviewStatus(session: any): SubStageStatus {
  const latestReview = getLatestPaperReview(session)
  if (!latestReview) return 'pending'
  return 'completed'
}

function getPaperImproveStatus(session: any): SubStageStatus {
  const latestReview = getLatestPaperReview(session)
  if (!latestReview) return 'pending'

  const pendingRewriteIssues = countPendingRewriteIssues(latestReview)
  const fixedRewriteIssues = latestReview.issues.filter(
    issue => issue.fixType === 'rewrite_fixable' && issue.status === 'fixed'
  ).length

  if (pendingRewriteIssues === 0) return 'completed'
  if (fixedRewriteIssues > 0) return 'in_progress'
  return 'pending'
}

function getManualFollowUpStatus(session: any): SubStageStatus {
  const latestReview = getLatestPaperReview(session)
  if (!latestReview) return 'pending'

  const pendingManualIssues = latestReview.issues.filter(
    issue => issue.fixType !== 'rewrite_fixable' && issue.status === 'pending'
  ).length

  return pendingManualIssues > 0 ? 'in_progress' : 'completed'
}

// ============================================================================
// Stage Definitions
// ============================================================================

export const STAGE_DEFINITIONS: StageDefinition[] = [
  // Stage 1: Paper Foundation (OUTLINE_PLANNING) - Configure paper type & structure first
  {
    key: 'OUTLINE_PLANNING',
    label: 'Paper Foundation',
    icon: ListOrdered,
    description: 'Configure paper type & structure',
    weight: 15,
    subStages: [
      {
        key: 'paper_type',
        label: 'Paper Type',
        icon: FileText,
        description: 'Select a paper type',
        required: true,
        getStatus: (session) => {
          return session?.paperType?.code || session?.paperTypeId ? 'completed' : 'pending'
        }
      },
      {
        key: 'citation_style',
        label: 'Citation Style',
        icon: FileText,
        description: 'Choose a citation style',
        required: true,
        getStatus: (session) => {
          return session?.citationStyle?.code || session?.citationStyleId ? 'completed' : 'pending'
        }
      },
      {
        key: 'venue',
        label: 'Publication Venue',
        icon: FileText,
        description: 'Optional venue selection',
        required: false,
        getStatus: (session) => {
          return session?.publicationVenue?.code || session?.publicationVenueId ? 'completed' : 'pending'
        }
      },
      {
        key: 'word_target',
        label: 'Target Word Count',
        icon: FileText,
        description: 'Set a word count target',
        required: false,
        getStatus: (session) => {
          return session?.targetWordCount ? 'completed' : 'pending'
        }
      }
    ]
  },
  // Stage 2: Research Topic (TOPIC_ENTRY) - Define research question
  {
    key: 'TOPIC_ENTRY',
    label: 'Research Topic',
    icon: Lightbulb,
    description: 'Define your research topic',
    weight: 15,
    subStages: [
      {
        key: 'title',
        label: 'Paper Title',
        icon: FileText,
        description: 'Set the paper title',
        required: true,
        getStatus: (session) => {
          const title = session?.researchTopic?.title
          return title && String(title).trim() ? 'completed' : 'pending'
        }
      },
      {
        key: 'research_question',
        label: 'Research Question',
        icon: FileText,
        description: 'Define a clear research question',
        required: true,
        getStatus: (session) => {
          const question = session?.researchTopic?.researchQuestion
          const length = question ? String(question).trim().length : 0
          if (length >= 20) return 'completed'
          if (length > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'keywords',
        label: 'Keywords',
        icon: FileText,
        description: 'Add at least 3 keywords',
        required: true,
        getStatus: (session) => {
          const keywords = Array.isArray(session?.researchTopic?.keywords)
            ? session.researchTopic.keywords
            : []
          if (keywords.length >= 3) return 'completed'
          if (keywords.length > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'methodology',
        label: 'Methodology',
        icon: FileText,
        description: 'Select methodology type',
        required: true,
        getStatus: (session) => {
          return session?.researchTopic?.methodology ? 'completed' : 'pending'
        }
      }
    ]
  },
  // Stage 3: Paper Blueprint (BLUEPRINT) - Define paper structure & dimensions
  {
    key: 'BLUEPRINT',
    label: 'Paper Blueprint',
    icon: Target,
    description: 'Define paper structure & dimensions',
    weight: 12,
    subStages: [
      {
        key: 'blueprint_generated',
        label: 'Blueprint Generated',
        icon: Target,
        description: 'Generate a blueprint from your topic',
        required: true,
        getStatus: (session) => {
          const hasBlueprint = !!session?.paperBlueprint?.id
          return hasBlueprint ? 'completed' : 'pending'
        }
      },
      {
        key: 'blueprint_frozen',
        label: 'Blueprint Frozen',
        icon: FileText,
        description: 'Freeze blueprint to proceed',
        required: true,
        getStatus: (session) => {
          const isFrozen = session?.paperBlueprint?.status === 'FROZEN'
          return isFrozen ? 'completed' : 'pending'
        }
      }
    ]
  },
  // Stage 4: Literature Search (LITERATURE_SEARCH) - Search and import citations
  {
    key: 'LITERATURE_SEARCH',
    label: 'Literature Search',
    icon: Search,
    description: 'Search and import citations',
    groupLabel: 'Literature Review',
    weight: 8,
    subStages: [
      {
        key: 'citations_imported',
        label: 'Imported Citations',
        icon: FileText,
        description: 'Import at least 5 citations',
        required: true,
        getStatus: (session) => {
          const count = getCitationsCount(session)
          if (count >= 5) return 'completed'
          if (count > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'literature_status',
        label: 'Review Progress',
        icon: FileText,
        description: 'Track literature review status',
        required: false,
        getStatus: (session) => {
          const status = session?.literatureReviewStatus
          if (status === 'COMPLETED') return 'completed'
          if (status === 'IN_PROGRESS') return 'in_progress'
          return 'pending'
        }
      }
    ]
  },
  // Stage 5: Full-Text Evidence Extraction (FULL_TEXT_EVIDENCE_EXTRACTION)
  {
    key: 'FULL_TEXT_EVIDENCE_EXTRACTION',
    label: 'Full-Text Evidence Extraction',
    icon: FileText,
    description: 'Retrieve full text and verify evidence coverage',
    groupLabel: 'Literature Review',
    weight: 7,
    subStages: [
      {
        key: 'paper_selection',
        label: 'Paper Selection',
        icon: FileText,
        description: 'Select eligible papers for deep extraction',
        required: true,
        getStatus: (session) => {
          const citationCount = getCitationsCount(session)
          if (citationCount === 0) return 'pending'
          const summary = getDeepAnalysisSummary(session)
          if (summary.eligible > 0) return 'completed'
          return 'in_progress'
        }
      },
      {
        key: 'extraction_progress',
        label: 'Extraction Progress',
        icon: FileText,
        description: 'Track deep-analysis extraction and mapping jobs',
        required: true,
        getStatus: (session) => {
          const summary = getDeepAnalysisSummary(session)
          if (summary.eligible === 0) return 'pending'
          if (summary.running > 0) return 'in_progress'
          if (summary.completed >= summary.eligible && summary.failed === 0) return 'completed'
          if (summary.completed > 0 || summary.failed > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'evidence_review',
        label: 'Evidence Review',
        icon: FileText,
        description: 'Review extracted evidence cards and coverage',
        required: false,
        getStatus: (session) => {
          const summary = getDeepAnalysisSummary(session)
          if (summary.cards > 0) return 'completed'
          if (summary.completed > 0 || summary.running > 0 || summary.failed > 0) return 'in_progress'
          return 'pending'
        }
      }
    ]
  },
  // Stage 6: Figure Planning (FIGURE_PLANNER) - Plan figures and tables
  {
    key: 'FIGURE_PLANNER',
    label: 'Figure Planning',
    icon: PenTool,
    description: 'Plan figures and tables',
    weight: 10,
    subStages: [
      {
        key: 'figures',
        label: 'Figure Plan',
        icon: FileText,
        description: 'Optional figure planning',
        required: false,
        getStatus: (session) => {
          const hasFigures = Array.isArray(session?.figurePlans) && session.figurePlans.length > 0
          return hasFigures ? 'completed' : 'pending'
        }
      }
    ]
  },
  // Stage 7: Section Drafting (SECTION_DRAFTING) - Write the paper
  {
    key: 'SECTION_DRAFTING',
    label: 'Section Drafting',
    icon: FileText,
    description: 'Draft each section',
    weight: 24,
    subStages: [],
    getSubStages: getDraftSectionSubStages
  },
  {
    key: 'MANUSCRIPT_REVIEW',
    label: 'Review',
    icon: BookOpen,
    description: 'Audit the drafted manuscript',
    weight: 10,
    subStages: [
      {
        key: 'review_report',
        label: 'Review Report',
        icon: FileText,
        description: 'Generate the structured manuscript review',
        required: true,
        getStatus: (session) => getPaperReviewStatus(session)
      },
      {
        key: 'readiness_assessment',
        label: 'Readiness Assessment',
        icon: CheckCircle,
        description: 'Classify submission readiness and risk',
        required: true,
        getStatus: (session) => getPaperReviewStatus(session)
      }
    ]
  },
  {
    key: 'MANUSCRIPT_IMPROVE',
    label: 'Improve',
    icon: Sparkles,
    description: 'Apply review recommendations',
    weight: 10,
    subStages: [
      {
        key: 'rewrite_fixes',
        label: 'Rewrite Fixes',
        icon: FileText,
        description: 'Apply rewrite-fixable improvements',
        required: true,
        getStatus: (session) => getPaperImproveStatus(session)
      },
      {
        key: 'manual_follow_up',
        label: 'Manual Follow-Up',
        icon: FileText,
        description: 'Track evidence-dependent and manual issues',
        required: false,
        getStatus: (session) => getManualFollowUpStatus(session)
      }
    ]
  },
  // Stage 8: Humanization (HUMANIZATION) - Humanize sections
  {
    key: 'HUMANIZATION',
    label: 'Humanization',
    icon: Sparkles,
    description: 'Humanize section drafts',
    weight: 12,
    subStages: [],
    getSubStages: getHumanizationSubStages
  },
  // Stage 9: Adaptive Export (REVIEW_EXPORT) - Finalize and export
  {
    key: 'REVIEW_EXPORT',
    label: 'Adaptive Export',
    icon: CheckCircle,
    description: 'Extract formatting, validate, and export',
    weight: 15,
    subStages: [
      {
        key: 'required_sections',
        label: 'Required Sections',
        icon: FileText,
        description: 'Ensure required sections are complete',
        required: true,
        getStatus: (session) => getRequiredSectionsCompletion(session)
      },
      {
        key: 'export_ready',
        label: 'Draft Ready',
        icon: FileText,
        description: 'Draft has content for export',
        required: true,
        getStatus: (session) => getDraftReadyStatus(session)
      }
    ]
  }
]

// ============================================================================
// Stage Order
// ============================================================================

const HIDDEN_STAGE_KEYS = new Set([
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION'
])

// Paper drafting stage order - Paper Foundation (OUTLINE_PLANNING) comes first
const ALL_STAGE_ORDER = [
  'OUTLINE_PLANNING',  // Paper Foundation - configure paper type & structure first
  'TOPIC_ENTRY',       // Research Topic - define research question
  'BLUEPRINT',         // Paper Blueprint - define paper structure & dimensions
  'LITERATURE_SEARCH', // Literature Review -> Literature Search
  'FULL_TEXT_EVIDENCE_EXTRACTION', // Literature Review -> Full-Text Evidence Extraction
  'FIGURE_PLANNER',    // Figure Planning - plan figures and tables
  'SECTION_DRAFTING',  // Section Drafting - write the paper
  'MANUSCRIPT_REVIEW', // Review - audit manuscript quality and readiness
  'MANUSCRIPT_IMPROVE', // Improve - execute review recommendations
  'HUMANIZATION',      // Humanization - preserve draft and humanized versions
  'REVIEW_EXPORT'      // Adaptive Export - finalize and export
]

export const STAGE_ORDER = ALL_STAGE_ORDER.filter(stage => !HIDDEN_STAGE_KEYS.has(stage))

// ============================================================================
// Helpers for Navigation
// ============================================================================

export function getStageSubStages(stage: StageDefinition, session: any): SubStageDefinition[] {
  if (stage.getSubStages) {
    return stage.getSubStages(session)
  }
  return stage.subStages
}

export function getVisibleStages(_session: any): StageDefinition[] {
  return STAGE_DEFINITIONS.filter(stage => !HIDDEN_STAGE_KEYS.has(stage.key))
}

export function calculateStageCompletion(
  stage: StageDefinition,
  session: any
): {
  completedCount: number
  totalCount: number
  requiredCompleted: number
  requiredTotal: number
  percentage: number
} {
  const subStages = getStageSubStages(stage, session)
  if (subStages.length === 0) {
    return { completedCount: 0, totalCount: 0, requiredCompleted: 0, requiredTotal: 0, percentage: 0 }
  }

  const statuses = subStages.map(sub => ({
    status: sub.getStatus(session),
    required: sub.required
  }))

  const completedCount = statuses.filter(s => s.status === 'completed').length
  const totalCount = statuses.filter(s => s.status !== 'skipped').length
  const requiredCompleted = statuses.filter(s => s.required && s.status === 'completed').length
  const requiredTotal = statuses.filter(s => s.required && s.status !== 'skipped').length

  return {
    completedCount,
    totalCount,
    requiredCompleted,
    requiredTotal,
    percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  }
}

export function getStageStatus(
  stage: StageDefinition,
  session: any,
  currentStage: string
): 'completed' | 'current' | 'pending' | 'skipped' {
  const visibleStages = getVisibleStages(session)
  const currentIndex = Math.max(0, visibleStages.findIndex(s => s.key === currentStage))
  const stageIndex = visibleStages.findIndex(s => s.key === stage.key)

  if (stage.key === currentStage) return 'current'
  if (stageIndex !== -1 && stageIndex < currentIndex) return 'completed'
  return 'pending'
}

export function calculateOverallProgress(session: any, currentStage: string): number {
  const visibleStages = getVisibleStages(session)
  const currentIndex = visibleStages.findIndex(s => s.key === currentStage)
  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex

  let totalWeight = 0
  let completedWeight = 0

  visibleStages.forEach((stage, index) => {
    totalWeight += stage.weight

    if (index < resolvedIndex) {
      completedWeight += stage.weight
    } else if (index === resolvedIndex) {
      const completion = calculateStageCompletion(stage, session)
      completedWeight += (stage.weight * completion.percentage) / 100
    }
  })

  return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0
}
