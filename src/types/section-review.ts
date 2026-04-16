/**
 * Section-Level AI Review, Fix Tracking & Inline Diff System
 * 
 * This module defines types for:
 * - AI review items with status tracking
 * - Section-level review state
 * - Diff tracking for micro-versioning
 * - Fix history and audit trail
 */

// ============================================================================
// Review Item Types
// ============================================================================

export type ReviewSeverity = 'notice' | 'warning' | 'error'

export type ReviewItemStatus = 'pending' | 'fixed' | 'ignored' | 'reverted'

export type ReviewCategory = 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity' | 'format' | 'length'

export interface ReviewItem {
  id: string
  sectionKey: string
  sectionLabel: string
  severity: ReviewSeverity
  category: ReviewCategory
  issueCode: string
  message: string
  suggestedFix: string
  fixPrompt: string // Detailed instruction for correction model
  status: ReviewItemStatus
  relatedSections?: string[]
  // Timestamps
  createdAt: string
  resolvedAt?: string
  resolvedBy?: 'fix' | 'ignore' | 'revert'
}

// ============================================================================
// Diff Tracking Types
// ============================================================================

export type DiffChangeType = 'addition' | 'deletion' | 'modification' | 'unchanged'

export interface DiffSegment {
  type: DiffChangeType
  text: string
  originalText?: string // For modifications, stores what was replaced
}

export interface DiffData {
  beforeText: string
  afterText: string
  segments: DiffSegment[]
  summary: string // Human readable: "Added 15 words, removed 3 words"
}

// ============================================================================
// Fix History Types
// ============================================================================

export interface FixHistoryEntry {
  id: string
  issueId: string
  timestamp: string
  status: ReviewItemStatus
  changeSummary: string
  beforeText: string
  afterText: string
  diffData: DiffData
  // For audit trail
  issueCode?: string
  issueSeverity?: ReviewSeverity
}

// ============================================================================
// Section Review State
// ============================================================================

export type SectionStatusIndicator = 'all_fixed' | 'partial' | 'errors_pending' | 'no_issues'

export interface SectionReviewState {
  sectionKey: string
  sectionLabel: string
  currentText: string
  previousVersion?: string // Last saved version before any fixes
  
  // Review items for this section
  reviewItems: ReviewItem[]
  
  // Fix history with full diff data
  fixHistory: FixHistoryEntry[]
  
  // Computed status
  status: SectionStatusIndicator
  
  // Counts for quick display
  pendingCount: number
  fixedCount: number
  ignoredCount: number
  errorCount: number
  warningCount: number
  noticeCount: number
}

// ============================================================================
// Global Review State
// ============================================================================

export interface GlobalReviewState {
  sessionId: string
  jurisdiction: string
  reviewedAt: string
  
  // All sections with their review state
  sections: Record<string, SectionReviewState>
  
  // Overall summary
  summary: {
    totalIssues: number
    pendingIssues: number
    fixedIssues: number
    ignoredIssues: number
    errorCount: number
    warningCount: number
    noticeCount: number
    overallScore: number
    recommendation: string
  }
  
  // Milestone tracking
  milestoneVersion?: number
  milestoneType?: 'draft_start' | 'post_review' | 'pre_export'
  milestoneSnapshot?: Record<string, string> // Full text backup
}

// ============================================================================
// UI State Types
// ============================================================================

export interface SectionReviewUIState {
  isExpanded: boolean
  showDiff: boolean
  activeFixId?: string // Currently being processed
  isApplyingFix: boolean
  isReverting: boolean
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApplyFixRequest {
  sessionId: string
  jurisdiction: string
  sectionKey: string
  issueId: string
  currentContent: string
  suggestedFix: string
  fixPrompt: string
}

export interface ApplyFixResponse {
  success: boolean
  fixedContent?: string
  diffData?: DiffData
  error?: string
}

export interface RevertFixRequest {
  sessionId: string
  jurisdiction: string
  sectionKey: string
  fixHistoryId: string
}

export interface RevertFixResponse {
  success: boolean
  revertedContent?: string
  error?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate section status indicator based on review items
 * Properly accounts for pending, fixed, ignored, and reverted statuses
 */
export function calculateSectionStatus(reviewItems: ReviewItem[]): SectionStatusIndicator {
  if (reviewItems.length === 0) return 'no_issues'
  
  // Items that need attention (pending or reverted back to pending)
  const actionable = reviewItems.filter(i => i.status === 'pending' || i.status === 'reverted')
  const fixed = reviewItems.filter(i => i.status === 'fixed')
  const ignored = reviewItems.filter(i => i.status === 'ignored')
  
  // Check for pending errors (highest priority)
  const pendingErrors = actionable.filter(i => i.severity === 'error')
  const pendingWarnings = actionable.filter(i => i.severity === 'warning')
  
  // If there are any pending errors, show as errors_pending
  if (pendingErrors.length > 0) return 'errors_pending'
  
  // If there are pending warnings but no errors
  if (pendingWarnings.length > 0) {
    // If some are fixed/ignored, it's partial
    if (fixed.length > 0 || ignored.length > 0) return 'partial'
    // Otherwise still pending
    return 'errors_pending'
  }
  
  // If some items are actionable (pending notices or reverted) but we also have fixed/ignored
  if (actionable.length > 0) {
    if (fixed.length > 0 || ignored.length > 0) return 'partial'
    return 'errors_pending'
  }
  
  // No actionable items - check if we resolved any
  if (fixed.length > 0 || ignored.length > 0) return 'all_fixed'
  
  return 'no_issues'
}

/**
 * Get status indicator emoji and color
 */
export function getStatusIndicatorStyle(status: SectionStatusIndicator): {
  emoji: string
  color: string
  bgColor: string
  label: string
} {
  switch (status) {
    case 'all_fixed':
      return { emoji: '✔', color: 'text-emerald-600', bgColor: 'bg-emerald-50', label: 'All issues resolved' }
    case 'partial':
      return { emoji: '!', color: 'text-amber-600', bgColor: 'bg-amber-50', label: 'Partially resolved' }
    case 'errors_pending':
      return { emoji: '✖', color: 'text-red-600', bgColor: 'bg-red-50', label: 'Issues pending' }
    case 'no_issues':
    default:
      return { emoji: '—', color: 'text-gray-400', bgColor: 'bg-gray-50', label: 'No issues' }
  }
}

/**
 * Get severity styling
 */
export function getSeverityStyle(severity: ReviewSeverity): {
  color: string
  bgColor: string
  borderColor: string
  icon: string
} {
  switch (severity) {
    case 'error':
      return { color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', icon: '🔴' }
    case 'warning':
      return { color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', icon: '🟡' }
    case 'notice':
    default:
      return { color: 'text-slate-600', bgColor: 'bg-slate-50', borderColor: 'border-slate-200', icon: '🔵' }
  }
}

