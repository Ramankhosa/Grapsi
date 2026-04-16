import type {
  PaperReviewDimension,
  PaperReviewFixType,
  PaperReviewMode,
  PaperReviewSeverity,
} from '@/types/paper-review'

const REVIEW_MODE_STORAGE_PREFIX = 'paper_review_mode_'

const DIMENSION_LABELS: Record<PaperReviewDimension, string> = {
  section_quality: 'Section Quality',
  cross_section_consistency: 'Cross-Section Consistency',
  claim_evidence_alignment: 'Claim-Evidence Alignment',
  figure_text_alignment: 'Figure-Text Alignment',
  methodology_rigor: 'Methodology Rigor',
  novelty_positioning: 'Novelty Positioning',
  citation_audit: 'Citation Audit',
  language_style: 'Language & Style',
  publication_risk: 'Publication Risk',
}

const FIX_TYPE_META: Record<PaperReviewFixType, { label: string; helper: string }> = {
  rewrite_fixable: {
    label: 'AI can fix this',
    helper: 'Preview and apply a section rewrite in this stage.',
  },
  evidence_fixable: {
    label: 'Needs evidence',
    helper: 'Requires citations, data, or manuscript evidence from you.',
  },
  manual_decision_required: {
    label: 'Needs your input',
    helper: 'Requires an author decision or manual revision.',
  },
}

const MODE_META: Record<PaperReviewMode, { label: string; title: string; description: string }> = {
  quick: {
    label: 'Quick Review',
    title: 'Whole-manuscript fast pass',
    description: 'Run one reviewer across the full draft for a fast triage report.',
  },
  section_by_section: {
    label: 'Section-by-Section',
    title: 'Detailed section reviewers',
    description: 'Review each section independently, then aggregate manuscript-level findings.',
  },
}

const READINESS_META: Record<string, { label: string; description: string; tone: string; icon: string }> = {
  near_submission_ready: {
    label: 'Near Ready',
    description: 'Mostly polish and targeted cleanup remain.',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: 'CheckCircle2',
  },
  requires_moderate_revision: {
    label: 'Needs Revision',
    description: 'Solid draft, but several substantive fixes remain.',
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: 'AlertTriangle',
  },
  requires_major_revision: {
    label: 'Major Revision',
    description: 'Core reviewer concerns still need coordinated revision.',
    tone: 'border-orange-200 bg-orange-50 text-orange-700',
    icon: 'ShieldAlert',
  },
  not_submission_ready: {
    label: 'Not Ready',
    description: 'Major structural or content gaps block submission.',
    tone: 'border-rose-200 bg-rose-50 text-rose-700',
    icon: 'ShieldAlert',
  },
}

export function getPaperReviewModeStorageKey(sessionId: string) {
  return `${REVIEW_MODE_STORAGE_PREFIX}${sessionId}`
}

export function readPersistedPaperReviewMode(sessionId: string): PaperReviewMode | null {
  if (typeof window === 'undefined' || !sessionId) return null

  const rawValue = window.localStorage.getItem(getPaperReviewModeStorageKey(sessionId))
  return rawValue === 'section_by_section' || rawValue === 'quick'
    ? rawValue
    : null
}

export function persistPaperReviewMode(sessionId: string, reviewMode: PaperReviewMode) {
  if (typeof window === 'undefined' || !sessionId) return
  window.localStorage.setItem(getPaperReviewModeStorageKey(sessionId), reviewMode)
}

export function getPaperReviewModeMeta(reviewMode: PaperReviewMode) {
  return MODE_META[reviewMode]
}

export function formatPaperReviewDimension(reviewDimension: PaperReviewDimension) {
  return DIMENSION_LABELS[reviewDimension] || reviewDimension.replace(/_/g, ' ')
}

export function getPaperReviewFixTypeMeta(fixType: PaperReviewFixType) {
  return FIX_TYPE_META[fixType]
}

export function getPaperReviewReadinessMeta(readiness: string) {
  return READINESS_META[readiness] || {
    label: readiness.replace(/_/g, ' '),
    description: 'Readiness returned by the review service.',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    icon: 'Info',
  }
}

export function getPaperReviewSeverityMeta(severity: PaperReviewSeverity) {
  switch (severity) {
    case 'critical':
      return {
        label: 'Critical',
        tone: 'border-rose-200 bg-rose-50 text-rose-700',
        rail: 'bg-rose-500',
      }
    case 'major':
      return {
        label: 'Major',
        tone: 'border-amber-200 bg-amber-50 text-amber-700',
        rail: 'bg-amber-500',
      }
    case 'moderate':
      return {
        label: 'Moderate',
        tone: 'border-sky-200 bg-sky-50 text-sky-700',
        rail: 'bg-sky-500',
      }
    default:
      return {
        label: 'Minor',
        tone: 'border-slate-200 bg-slate-50 text-slate-700',
        rail: 'bg-slate-400',
      }
  }
}

export function getPaperReviewScoreMeta(score: number) {
  if (score >= 85) {
    return {
      label: 'Strong',
      tone: 'text-emerald-700',
      ring: 'stroke-emerald-500',
      bg: 'bg-emerald-50',
    }
  }
  if (score >= 70) {
    return {
      label: 'Needs Work',
      tone: 'text-amber-700',
      ring: 'stroke-amber-500',
      bg: 'bg-amber-50',
    }
  }

  return {
    label: 'Critical',
    tone: 'text-rose-700',
    ring: 'stroke-rose-500',
    bg: 'bg-rose-50',
  }
}

export function formatPaperReviewDateTime(value: string) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString()
}
