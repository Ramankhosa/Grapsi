'use client'

/**
 * PaperVerticalStageNav - Left-rail stage navigation for paper writing.
 * Hierarchical navigation with expandable stages and sub-stages.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Moon,
  Sun,
  Lightbulb,
  Search,
  ListOrdered,
  PenTool,
  CheckCircle,
  Sparkles,
  BookOpen,
  Target
} from 'lucide-react'
import { isGrantBackedPaperTypeCode } from '@/lib/grants/blueprintMetadata'
import { getGrantBackedSectionPlan } from '@/lib/grants/paperSectionConfig'
import { countPendingRewriteIssues, getLatestPaperReview } from '@/lib/paper-review-utils'

// ============================================================================
// Types
// ============================================================================

type DraftingFilter = 'all' | 'app_draft' | 'team_draft' | 'evidence'

interface PaperVerticalStageNavProps {
  session: any
  currentStage: string
  paperId: string
  onNavigateToStage: (stage: string) => Promise<void> | void
  workspaceTitle?: string
  visibleStageKeys?: string[]
  stageMetaOverrides?: Record<string, Partial<Pick<StageDefinition, 'label' | 'description' | 'groupLabel'>>>
  draftingSections?: Array<{
    key: string
    label: string
    description?: string
    required?: boolean
    status: SubStageStatus
    workflowMode?: 'app_draft' | 'app_support' | 'team_manual'
    sectionType?: string
    dimensions?: string[]
  }>
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
  sectionFilter?: DraftingFilter
  onSectionFilterChange?: (filter: DraftingFilter) => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  allowCollapse?: boolean
}

type NavTheme = 'dark' | 'light'

type SubStageStatus = 'completed' | 'in_progress' | 'pending' | 'skipped'

interface SubStageDefinition {
  key: string
  label: string
  icon: any
  description: string
  required: boolean
  getStatus: (session: any) => SubStageStatus
}

interface StageDefinition {
  key: string
  label: string
  icon: any
  description: string
  groupLabel?: string
  subStages: SubStageDefinition[]
  weight: number
  getSubStages?: (session: any) => SubStageDefinition[]
}

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  THEME: 'paper_writing_nav_theme',
  EXPANDED_STAGES: 'paper_writing_nav_expanded_stages'
}

// ============================================================================
// Helper Functions
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
  const grantPaperTypeCode = session?.paperBlueprint?.paperTypeCode || session?.paperType?.code
  if (isGrantBackedPaperTypeCode(grantPaperTypeCode)) {
    const sections = getGrantBackedSectionPlan(grantPaperTypeCode, session?.paperBlueprint?.sectionPlan)
    const sectionOrder = sections.map((section) => section.sectionKey)
    const requiredSections = sections
      .filter((section) => section.required === true)
      .map((section) => section.sectionKey)
    const optionalSections = sections
      .filter((section) => section.required !== true)
      .map((section) => section.sectionKey)
    return { requiredSections, optionalSections, sectionOrder }
  }

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
  const grantPaperTypeCode = session?.paperBlueprint?.paperTypeCode || session?.paperType?.code
  if (isGrantBackedPaperTypeCode(grantPaperTypeCode)) {
    const sections = getGrantBackedSectionPlan(grantPaperTypeCode, session?.paperBlueprint?.sectionPlan)
    return sections.map((section) => ({
      key: section.sectionKey,
      label: section.displayLabel || formatSectionLabel(section.sectionKey),
      icon: FileText,
      description: section.required ? 'Required section' : 'Optional section',
      required: section.required === true,
      getStatus: (currentSession: any) => getPaperSectionStatus(currentSession, section.sectionKey).status
    }))
  }

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
  if (status === 'failed' || status === 'processing') return 'in_progress'

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
  const grantPaperTypeCode = session?.paperBlueprint?.paperTypeCode || session?.paperType?.code
  if (isGrantBackedPaperTypeCode(grantPaperTypeCode)) {
    const sections = getGrantBackedSectionPlan(grantPaperTypeCode, session?.paperBlueprint?.sectionPlan)
    return sections.map((section) => ({
      key: section.sectionKey,
      label: section.displayLabel || formatSectionLabel(section.sectionKey),
      icon: FileText,
      description: section.required ? 'Required section' : 'Optional section',
      required: section.required === true,
      getStatus: (currentSession: any) => getHumanizationSectionStatus(currentSession, section.sectionKey)
    }))
  }

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
  const explicit = String(citation?.deepAnalysisLabel || '').trim().toUpperCase()
  if (explicit) {
    return explicit
  }

  const fromMeta = citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? String((citation.aiMeta as any).deepAnalysisRecommendation || '').trim().toUpperCase()
    : ''
  if (fromMeta) {
    return fromMeta
  }

  const score = Number(citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? (citation.aiMeta as any).relevanceScore
    : 0)
  if (score >= 85) return 'DEEP_ANCHOR'
  if (score >= 65) return 'DEEP_SUPPORT'
  if (score >= 45) return 'DEEP_STRESS_TEST'
  return 'LIT_ONLY'
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
  const sections = getPaperDraftSections(session)
  const hasContent = Object.values(sections).some(content => computeWordCount(String(content)) > 0)
  return hasContent ? 'completed' : 'pending'
}

function getPaperReviewStatus(session: any): SubStageStatus {
  return getLatestPaperReview(session) ? 'completed' : 'pending'
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

  const manualPendingIssues = latestReview.issues.filter(
    issue => issue.fixType !== 'rewrite_fixable' && issue.status === 'pending'
  ).length

  return manualPendingIssues > 0 ? 'in_progress' : 'completed'
}

// ============================================================================
// Stage Definitions
// ============================================================================

const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    key: 'GRANTMENTOR',
    label: 'GrantMentor',
    icon: Sparkles,
    description: 'Grant prep and mentoring',
    weight: 14,
    subStages: [
      {
        key: 'prep_session',
        label: 'Grant Prep Session',
        icon: FileText,
        description: 'Collect call context and draft foundations',
        required: true,
        getStatus: (session) => {
          const hasBlueprint = Boolean(session?.paperBlueprint?.id)
          return hasBlueprint ? 'completed' : 'in_progress'
        }
      }
    ]
  },
  {
    key: 'OUTLINE_PLANNING',
    label: 'Paper Foundation',
    icon: ListOrdered,
    description: 'Set up paper type & structure',
    weight: 20,
    subStages: [
      {
        key: 'paper_type',
        label: 'Paper Type',
        icon: FileText,
        description: 'Select a paper type',
        required: true,
        getStatus: (session) => {
          const paperTypeCode = session?.paperBlueprint?.paperTypeCode || session?.paperType?.code
          return paperTypeCode || session?.paperTypeId ? 'completed' : 'pending'
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
      }
    ]
  },
  {
    key: 'TOPIC_ENTRY',
    label: 'Research Topic',
    icon: Lightbulb,
    description: 'Define your research question',
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
        icon: BookOpen,
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
  {
    key: 'FULL_TEXT_EVIDENCE_EXTRACTION',
    label: 'Full-Text Evidence Extraction',
    icon: BookOpen,
    description: 'Retrieve full text and validate evidence coverage',
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
          const count = getCitationsCount(session)
          if (count === 0) return 'pending'
          const summary = getDeepAnalysisSummary(session)
          if (summary.eligible > 0) return 'completed'
          return 'in_progress'
        }
      },
      {
        key: 'extraction_progress',
        label: 'Extraction Progress',
        icon: FileText,
        description: 'Track extraction and mapping job statuses',
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
        description: 'Review extracted cards and coverage',
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
    key: 'REVIEWER',
    label: 'Reviewer',
    icon: BookOpen,
    description: 'Map grant sections into the reviewer workspace',
    weight: 10,
    subStages: [
      {
        key: 'reviewer_mapping',
        label: 'Reviewer Mapping',
        icon: FileText,
        description: 'Prepare mapped reviewer sections',
        required: true,
        getStatus: () => 'pending'
      }
    ]
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
        icon: FileText,
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
  {
    key: 'HUMANIZATION',
    label: 'Humanization',
    icon: Sparkles,
    description: 'Humanize drafts and verify citations',
    weight: 13,
    subStages: [],
    getSubStages: getHumanizationSubStages
  },
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

const HIDDEN_STAGE_KEYS = new Set([
  'GRANTMENTOR',
  'MANUSCRIPT_REVIEW',
  'MANUSCRIPT_IMPROVE',
  'HUMANIZATION'
])

// ============================================================================
// Calculation Functions
// ============================================================================

function getStageSubStages(stage: StageDefinition, session: any): SubStageDefinition[] {
  if (stage.getSubStages) {
    return stage.getSubStages(session)
  }
  return stage.subStages
}

function calculateStageCompletion(
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

function calculateOverallProgress(session: any, currentStage: string, stageDefinitions: StageDefinition[]): number {
  const currentIndex = stageDefinitions.findIndex(s => s.key === currentStage)
  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex

  let totalWeight = 0
  let completedWeight = 0

  stageDefinitions.forEach((stage, index) => {
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

// ============================================================================
// Sub-Components
// ============================================================================

interface StatusIconProps {
  status: SubStageStatus
  size?: 'sm' | 'md'
}

function StatusIcon({ status, size = 'md' }: StatusIconProps) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  switch (status) {
    case 'completed':
      return <Check className={`${sizeClass} text-emerald-500`} />
    case 'in_progress':
      return <Loader2 className={`${sizeClass} text-amber-500 animate-spin`} />
    case 'skipped':
      return <Circle className={`${sizeClass} text-slate-400`} />
    default:
      return <Circle className={`${sizeClass} text-slate-300`} />
  }
}

// ============================================================================
// Main Component
// ============================================================================

function isDraftingSectionAppDraft(section: { workflowMode?: string; sectionType?: string }): boolean {
  return section.workflowMode === 'app_draft' && (section.sectionType === 'narrative' || section.sectionType === 'short_answer')
}

function draftingFilterMatches(
  section: { workflowMode?: string; sectionType?: string; dimensions?: string[] },
  filter: DraftingFilter
): boolean {
  if (filter === 'app_draft') return isDraftingSectionAppDraft(section)
  if (filter === 'team_draft') return !isDraftingSectionAppDraft(section)
  if (filter === 'evidence') return isDraftingSectionAppDraft(section) && (section.dimensions || []).length > 0
  return true
}

export default function PaperVerticalStageNav({
  session,
  currentStage,
  paperId: _paperId,
  onNavigateToStage,
  workspaceTitle = 'Research Paper',
  visibleStageKeys,
  stageMetaOverrides,
  draftingSections,
  selectedSection,
  onSectionSelect,
  sectionFilter = 'all',
  onSectionFilterChange,
  collapsed = false,
  onCollapsedChange,
  allowCollapse = false
}: PaperVerticalStageNavProps) {
  const [theme, setTheme] = useState<NavTheme>('light')
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  const visibleStageDefinitions = useMemo(() => {
    const customDraftSubStages = Array.isArray(draftingSections)
      ? draftingSections.map((section) => ({
          key: section.key,
          label: section.label,
          icon: FileText,
          description: section.description || (section.required ? 'Required section' : 'Optional section'),
          required: section.required === true,
          getStatus: () => section.status,
        }))
      : null

    return STAGE_DEFINITIONS
      .map((stage) => {
        const overrides = stageMetaOverrides?.[stage.key] || {}
        const nextStage = {
          ...stage,
          ...overrides,
        }

        if (stage.key === 'SECTION_DRAFTING' && customDraftSubStages) {
          return {
            ...nextStage,
            getSubStages: () => customDraftSubStages,
          }
        }

        return nextStage
      })
      .filter((stage) => {
        // If the caller explicitly provides a stage list (grant workspace),
        // it fully controls what is visible (even for normally-hidden stages).
        if (visibleStageKeys) {
          return visibleStageKeys.includes(stage.key)
        }
        return !HIDDEN_STAGE_KEYS.has(stage.key)
      })
  }, [draftingSections, stageMetaOverrides, visibleStageKeys])

  const resolvedCurrentStage = useMemo(() => {
    const keys = visibleStageDefinitions.map(stage => stage.key)
    return keys.includes(currentStage) ? currentStage : keys[0]
  }, [currentStage, visibleStageDefinitions])

  // ============================================================================
  // Initialize from localStorage
  // ============================================================================

  useEffect(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) as NavTheme
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme)
    } else {
      localStorage.setItem(STORAGE_KEYS.THEME, 'light')
    }

    try {
      const savedStages = localStorage.getItem(STORAGE_KEYS.EXPANDED_STAGES)
      if (savedStages) {
        setExpandedStages(new Set(JSON.parse(savedStages)))
      }
    } catch {
      setExpandedStages(new Set())
    }
  }, [])

  useEffect(() => {
    if (!resolvedCurrentStage) return
    setExpandedStages(prev => {
      const next = new Set(prev)
      next.add(resolvedCurrentStage)
      return next
    })
  }, [resolvedCurrentStage])

  // ============================================================================
  // Persist to localStorage
  // ============================================================================

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EXPANDED_STAGES, JSON.stringify(Array.from(expandedStages)))
  }, [expandedStages])

  // ============================================================================
  // Derived State
  // ============================================================================

  const overallProgress = useMemo(
    () => calculateOverallProgress(session, resolvedCurrentStage || '', visibleStageDefinitions),
    [session, resolvedCurrentStage, visibleStageDefinitions]
  )

  const themeClasses = useMemo(() => ({
    container: theme === 'dark'
      ? 'bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-slate-700'
      : 'bg-white border-slate-200',
    text: theme === 'dark' ? 'text-white' : 'text-slate-900',
    textMuted: theme === 'dark' ? 'text-slate-400' : 'text-slate-600',
    textSubtle: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    border: theme === 'dark' ? 'border-slate-700' : 'border-slate-200',
    hover: theme === 'dark' ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50',
    activeStage: theme === 'dark'
      ? 'bg-blue-500/20 border-blue-400/30'
      : 'bg-blue-50 border-blue-200',
    activeText: theme === 'dark' ? 'text-blue-400' : 'text-blue-600',
    completedText: theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600',
    progressBg: theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200',
    progressFill: theme === 'dark'
      ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
      : 'bg-gradient-to-r from-blue-500 to-blue-400',
    subStageBorder: theme === 'dark' ? 'border-slate-700' : 'border-slate-200'
  }), [theme])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const toggleStageExpansion = useCallback((stageKey: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageKey)) {
        next.delete(stageKey)
      } else {
        next.add(stageKey)
      }
      return next
    })
  }, [])

  const handleStageClick = useCallback(async (stageKey: string) => {
    await onNavigateToStage(stageKey)
  }, [onNavigateToStage])

  const toggleCollapsed = useCallback(() => {
    if (!allowCollapse || !onCollapsedChange) return
    onCollapsedChange(!collapsed)
  }, [allowCollapse, collapsed, onCollapsedChange])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <aside
      className={`
        fixed left-0 top-0 h-screen z-40 flex flex-col
        border-r transition-colors duration-300 shadow-sm
        ${collapsed ? 'w-20' : 'w-72'}
        ${themeClasses.container}
      `}
    >
      {allowCollapse ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`
            absolute -right-3 top-28 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm
            ${theme === 'dark' ? 'border-slate-600 bg-slate-800 text-slate-300' : 'border-slate-200 bg-white text-slate-500'}
          `}
          title={collapsed ? 'Expand workspace rail' : 'Collapse workspace rail'}
          aria-label={collapsed ? 'Expand workspace rail' : 'Collapse workspace rail'}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      ) : null}

      {/* Header */}
      <div className={`p-4 border-b ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`
              w-10 h-10 rounded-xl flex items-center justify-center
              ${theme === 'dark'
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                : 'bg-gradient-to-br from-blue-500 to-blue-600'
              }
            `}>
              <FileText className="w-5 h-5 text-white" />
            </div>
            {!collapsed ? (
              <div>
                <div className={`text-sm font-semibold ${themeClasses.text}`}>
                  {workspaceTitle}
                </div>
                <div className={`text-xs ${themeClasses.textMuted}`}>
                  {overallProgress}% complete
                </div>
              </div>
            ) : null}
          </div>

          {!collapsed ? (
            <button
              onClick={toggleTheme}
              className={`
                p-2 rounded-lg transition-colors
                ${themeClasses.hover}
              `}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark'
                ? <Sun className={`w-4 h-4 ${themeClasses.textMuted}`} />
                : <Moon className={`w-4 h-4 ${themeClasses.textMuted}`} />
              }
            </button>
          ) : null}
        </div>

        {collapsed ? (
          <div className="mt-3 flex items-center justify-center">
            <button
              onClick={toggleTheme}
              className={`
                p-2 rounded-lg transition-colors
                ${themeClasses.hover}
              `}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark'
                ? <Sun className={`w-4 h-4 ${themeClasses.textMuted}`} />
                : <Moon className={`w-4 h-4 ${themeClasses.textMuted}`} />
              }
            </button>
          </div>
        ) : null}

        {/* Progress bar */}
        {!collapsed ? (
          <div className={`mt-3 h-1.5 rounded-full ${themeClasses.progressBg}`}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${themeClasses.progressFill}`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        ) : (
          <div className="mt-3 flex justify-center">
            <div className={`h-10 w-1.5 overflow-hidden rounded-full ${themeClasses.progressBg}`}>
              <div
                className={`w-full rounded-full transition-all duration-500 ${themeClasses.progressFill}`}
                style={{
                  height: `${Math.max(10, overallProgress)}%`,
                  marginTop: `${100 - Math.max(10, overallProgress)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Stage List */}
      <nav className={`flex-1 overflow-y-auto py-3 px-2 ${theme === 'dark' ? 'dark-scrollbar' : 'light-scrollbar'}`}>
        {visibleStageDefinitions.map((stage, stageIndex) => {
          const StageIcon = stage.icon
          const previousGroup = stageIndex > 0 ? visibleStageDefinitions[stageIndex - 1]?.groupLabel : undefined
          const showGroupLabel = !collapsed && Boolean(stage.groupLabel && stage.groupLabel !== previousGroup)
          const isExpanded = expandedStages.has(stage.key)
          const completion = calculateStageCompletion(stage, session)
          const currentIndex = Math.max(0, visibleStageDefinitions.findIndex(s => s.key === resolvedCurrentStage))
          const isCurrent = stage.key === resolvedCurrentStage
          const isPast = stageIndex < currentIndex
          const isFullyComplete = completion.requiredTotal > 0 && completion.requiredCompleted === completion.requiredTotal
          const isCompleted = isPast && isFullyComplete
          const subStages = getStageSubStages(stage, session)

          if (collapsed) {
            return (
              <div key={stage.key} className="mb-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  title={`${stage.label}: ${stage.description}`}
                  className={`
                    relative flex h-12 w-12 items-center justify-center rounded-2xl border transition-all duration-200
                    ${isCurrent ? themeClasses.activeStage : `${themeClasses.hover} border-transparent`}
                  `}
                >
                  <StageIcon className={`h-5 w-5 ${isCompleted ? themeClasses.completedText : isCurrent ? themeClasses.activeText : themeClasses.textMuted}`} />
                  <span
                    className={`
                      absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2
                      ${theme === 'dark' ? 'border-slate-900' : 'border-white'}
                      ${isCompleted ? 'bg-emerald-500' : isCurrent ? 'bg-blue-500' : completion.completedCount > 0 ? 'bg-amber-500' : 'bg-slate-300'}
                    `}
                  />
                </button>
              </div>
            )
          }

          return (
            <div key={stage.key} className="mb-1">
              {showGroupLabel && (
                <div className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide ${themeClasses.textSubtle}`}>
                  {stage.groupLabel}
                </div>
              )}
              {/* Stage Header */}
              <div
                className={`
                  w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
                  transition-all duration-200 text-left border
                  ${isCurrent ? themeClasses.activeStage : themeClasses.hover + ' border-transparent'}
                `}
              >
                {/* Progress Ring */}
                <div className="relative w-9 h-9 flex-shrink-0">
                  <svg className="w-9 h-9 transform -rotate-90">
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={themeClasses.progressBg}
                    />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray={`${completion.percentage * 0.94} 94`}
                      strokeLinecap="round"
                      className={`
                        transition-all duration-500
                        ${isCompleted ? 'text-emerald-500' : isCurrent ? themeClasses.activeText : themeClasses.textSubtle}
                      `}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {isCompleted ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <StageIcon className={`w-4 h-4 ${isCurrent ? themeClasses.activeText : themeClasses.textMuted}`} />
                    )}
                  </div>
                </div>

                {/* Stage Label */}
                <button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  className="flex-1 min-w-0 text-left"
                  title={stage.description}
                >
                  <div className="flex items-center gap-2">
                    <span className={`
                      text-sm font-medium truncate
                      ${isCompleted ? themeClasses.completedText : isCurrent ? themeClasses.activeText : themeClasses.textMuted}
                    `}>
                      {stage.label}
                    </span>
                    {completion.totalCount > 0 && (
                      <span className={`text-[10px] ${themeClasses.textSubtle}`}>
                        {completion.completedCount}/{completion.totalCount}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expand/Collapse Button */}
                {subStages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleStageExpansion(stage.key)}
                    className={`p-1 rounded-md ${themeClasses.hover}`}
                    aria-label={isExpanded ? 'Collapse stage' : 'Expand stage'}
                  >
                    <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                      <ChevronRight className={`w-4 h-4 ${themeClasses.textSubtle}`} />
                    </div>
                  </button>
                )}
              </div>

              {/* Sub-stages (expandable) */}
              {isExpanded && subStages.length > 0 && (
                <div className={`ml-5 pl-4 border-l ${themeClasses.subStageBorder} py-1 mt-1 space-y-0.5`}>
                  {/* Section Drafting filter pills */}
                  {stage.key === 'SECTION_DRAFTING' && draftingSections && onSectionFilterChange && (
                    <div className="flex flex-wrap gap-1 pb-2 mb-1 border-b border-slate-100">
                      {(['all', 'app_draft', 'team_draft', 'evidence'] as const).map((filterKey) => {
                        const isActive = sectionFilter === filterKey
                        const labels: Record<DraftingFilter, string> = {
                          all: 'All',
                          app_draft: 'App',
                          team_draft: 'Team',
                          evidence: 'Evidence',
                        }
                        const count = filterKey === 'all'
                          ? draftingSections.length
                          : draftingSections.filter((s) => draftingFilterMatches(s, filterKey)).length
                        return (
                          <button
                            key={filterKey}
                            type="button"
                            onClick={() => onSectionFilterChange(filterKey)}
                            className={`
                              rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors
                              ${isActive
                                ? 'bg-slate-800 text-white'
                                : theme === 'dark'
                                  ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }
                            `}
                          >
                            {labels[filterKey]} {count}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {subStages.map((subStage, subIdx) => {
                    const SubIcon = subStage.icon
                    const status = subStage.getStatus(session)
                    const isSectionDrafting = stage.key === 'SECTION_DRAFTING'
                    const isSelectedSection = isSectionDrafting && selectedSection === subStage.key
                    const canClickSection = isSectionDrafting && onSectionSelect

                    const draftMeta = isSectionDrafting && draftingSections
                      ? draftingSections.find((s) => s.key === subStage.key)
                      : null
                    const isAppDraft = draftMeta ? isDraftingSectionAppDraft(draftMeta) : false

                    if (isSectionDrafting && draftMeta && !draftingFilterMatches(draftMeta, sectionFilter)) {
                      return null
                    }

                    return (
                      <button
                        key={subStage.key}
                        type="button"
                        onClick={() => {
                          if (canClickSection) {
                            if (currentStage !== 'SECTION_DRAFTING') {
                              onNavigateToStage('SECTION_DRAFTING')
                            }
                            onSectionSelect(subStage.key)
                            const anchor = document.getElementById(`section-${subStage.key}`)
                            if (anchor) {
                              anchor.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }
                          }
                        }}
                        disabled={!canClickSection}
                        className={`
                          w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left
                          ${isSelectedSection
                            ? theme === 'dark'
                              ? 'bg-blue-500/20 border border-blue-400/30'
                              : 'bg-blue-50 border border-blue-200'
                            : isSectionDrafting && isAppDraft
                              ? theme === 'dark'
                                ? 'bg-emerald-900/20 border border-emerald-800/30 hover:bg-emerald-900/30'
                                : 'bg-emerald-50/60 border border-emerald-200/60 hover:bg-emerald-50'
                              : `${themeClasses.hover} border border-transparent`
                          }
                          ${canClickSection ? 'cursor-pointer' : 'cursor-default'}
                        `}
                        title={subStage.description}
                      >
                        {isSectionDrafting ? (
                          <span className={`
                            flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold
                            ${status === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : status === 'in_progress'
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-slate-100 text-slate-500'
                            }
                          `}>
                            {subIdx + 1}
                          </span>
                        ) : (
                          <StatusIcon status={status} size="sm" />
                        )}
                        <span className={`
                          text-xs flex-1 truncate
                          ${isSelectedSection
                            ? themeClasses.activeText
                            : status === 'completed' ? themeClasses.completedText :
                              status === 'skipped' ? themeClasses.textSubtle + ' line-through' :
                              themeClasses.textMuted}
                        `}>
                          {subStage.label}
                        </span>
                        {isSectionDrafting && (
                          <span className={`
                            h-2 w-2 shrink-0 rounded-full
                            ${status === 'completed' ? 'bg-emerald-500' : status === 'in_progress' ? 'bg-sky-500' : 'bg-slate-300'}
                          `} />
                        )}
                        {!isSectionDrafting && !isSelectedSection && <SubIcon className={`w-3 h-3 ${themeClasses.textSubtle}`} />}
                        {!isSectionDrafting && isSelectedSection && <ChevronRight className={`w-3 h-3 ${themeClasses.activeText}`} />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={`p-3 border-t ${themeClasses.border}`}>
        {collapsed ? (
          <div className="flex justify-center">
            <span className={`text-[10px] ${themeClasses.textSubtle}`}>
              {Math.max(1, visibleStageDefinitions.findIndex(s => s.key === resolvedCurrentStage) + 1)}/{visibleStageDefinitions.length}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className={`text-xs ${themeClasses.textSubtle}`}>
              Stage {Math.max(1, visibleStageDefinitions.findIndex(s => s.key === resolvedCurrentStage) + 1)} of {visibleStageDefinitions.length}
            </span>
            <button
              onClick={() => resolvedCurrentStage && handleStageClick(resolvedCurrentStage)}
              className={`
                text-xs px-2 py-1 rounded
                ${theme === 'dark'
                  ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                }
                transition-colors
              `}
            >
              Current Stage
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

