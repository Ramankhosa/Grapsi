/**
 * Unified Validation Types
 * 
 * These types power the inline section-level validation system.
 * Validation is surfaced as feedback after generation, not as blocking rules.
 */

// ============================================================================
// Severity Scale (3-tier as per UX requirements)
// ============================================================================

export type ValidationSeverity = 'notice' | 'warning' | 'error'

// ============================================================================
// Validation Issue Structure
// ============================================================================

/**
 * Standard validation issue format returned by AI Review
 * Used for both rule-based and AI-powered validation
 */
export interface ValidationIssue {
  /** Unique identifier for the issue */
  id: string
  
  /** Section this issue belongs to (e.g., 'claims', 'abstract', 'detailedDescription') */
  sectionId: string
  
  /** Severity level for UI display */
  severity: ValidationSeverity
  
  /** Machine-readable issue code for categorization */
  code: string
  
  /** Human-readable explanation of the issue */
  message: string
  
  /** AI-generated recommendation for fixing the issue */
  suggestedFix: string
  
  /** Category for grouping similar issues */
  category: ValidationCategory
  
  /** Related sections affected by this issue */
  relatedSections?: string[]
  
  /** Whether this issue has been fixed */
  isFixed?: boolean
  
  /** Whether this issue has been ignored by the user */
  isIgnored?: boolean
  
  /** Timestamp when the issue was identified */
  identifiedAt?: string
  
  /** Metadata for audit trail */
  metadata?: Record<string, unknown>
}

// ============================================================================
// Validation Categories
// ============================================================================

export type ValidationCategory =
  | 'length'           // Word/character count violations
  | 'count'            // Claim count, figure count limits
  | 'consistency'      // Cross-section consistency issues
  | 'antecedent'       // Antecedent basis problems in claims
  | 'legal'            // Legal compliance issues
  | 'format'           // Formatting violations
  | 'diagram'          // Diagram-description alignment
  | 'completeness'     // Missing required content
  | 'clarity'          // Ambiguous or unclear language
  | 'terminology'      // Forbidden terms, style issues

// ============================================================================
// Section Validation Rules (DB-Driven)
// ============================================================================

/**
 * Validation thresholds from database configuration
 * Pulled from CountrySectionValidation table
 */
export interface SectionValidationRules {
  sectionKey: string
  jurisdiction: string
  
  // Word limits
  maxWords?: number
  minWords?: number
  recommendedWords?: number
  
  // Character limits
  maxChars?: number
  minChars?: number
  recommendedChars?: number
  
  // Count limits (for claims)
  maxCount?: number
  maxIndependent?: number
  countBeforeExtraFee?: number
  
  // Severity configuration
  wordLimitSeverity: ValidationSeverity
  charLimitSeverity: ValidationSeverity
  countLimitSeverity: ValidationSeverity
  
  // Custom messages
  wordLimitMessage?: string
  charLimitMessage?: string
  countLimitMessage?: string
  
  // Legal reference for citations
  legalReference?: string
  
  // Additional rules
  additionalRules?: Record<string, unknown>
}

// ============================================================================
// Threshold Enforcement Types
// ============================================================================

export type ThresholdStatus = 'ok' | 'soft_warning' | 'error'

export interface ThresholdResult {
  status: ThresholdStatus
  actual: number
  limit?: number
  softLimit?: number
  percentage?: number
  message?: string
}

// ============================================================================
// Validation Panel State
// ============================================================================

export interface SectionValidationState {
  sectionKey: string
  issues: ValidationIssue[]
  isExpanded: boolean
  lastCheckedAt?: string
  isLoading?: boolean
}

export interface ValidationPanelState {
  sections: Record<string, SectionValidationState>
  overallScore: number
  totalIssues: number
  errorCount: number
  warningCount: number
  noticeCount: number
  lastReviewedAt?: string
}

// ============================================================================
// Fix Request/Response
// ============================================================================

export interface FixRequest {
  issueId: string
  sectionKey: string
  currentContent: string
  suggestedFix: string
  relatedContent?: Record<string, string>
}

export interface FixResponse {
  success: boolean
  fixedContent?: string
  error?: string
  tokensUsed?: number
}

// ============================================================================
// AI Review Result (Enhanced Format)
// ============================================================================

export interface AIReviewResultEnhanced {
  success: boolean
  reviewId: string
  issues: ValidationIssue[]
  summary: {
    totalIssues: number
    errors: number
    warnings: number
    notices: number
    overallScore: number
    recommendation: string
  }
  reviewedAt: string
  tokensUsed?: number
  validationRulesUsed?: string[] // Which DB rules were checked
}

// ============================================================================
// Severity Color Mapping (for UI)
// ============================================================================

export const SEVERITY_COLORS: Record<ValidationSeverity, {
  bg: string
  text: string
  border: string
  badge: string
  icon: string
}> = {
  notice: {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    badge: 'bg-slate-100 text-slate-600',
    icon: 'text-slate-400'
  },
  warning: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    icon: 'text-amber-500'
  },
  error: {
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    badge: 'bg-rose-100 text-rose-700',
    icon: 'text-rose-500'
  }
}

// ============================================================================
// Section Display Labels
// ============================================================================

export const SECTION_LABELS: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  field: 'Field of Invention',
  fieldOfInvention: 'Field of Invention',
  background: 'Background',
  technicalProblem: 'Technical Problem',
  objectsOfInvention: 'Objects of Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method / Mode',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals'
}

// ============================================================================
// Validation Issue Codes
// ============================================================================

export const VALIDATION_CODES = {
  // Length-related
  WORD_COUNT_EXCEEDED: 'word_count_exceeded',
  WORD_COUNT_BELOW_MIN: 'word_count_below_min',
  CHAR_COUNT_EXCEEDED: 'char_count_exceeded',
  
  // Claims-related
  CLAIM_COUNT_EXCEEDED: 'claim_count_exceeded',
  INDEPENDENT_CLAIM_EXCEEDED: 'independent_claim_exceeded',
  MISSING_ANTECEDENT_BASIS: 'missing_antecedent_basis',
  CLAIM_DEPENDENCY_ERROR: 'claim_dependency_error',
  
  // Consistency-related
  DESCRIPTION_CLAIM_MISMATCH: 'description_claim_mismatch',
  NUMERAL_NOT_DECLARED: 'numeral_not_declared',
  NUMERAL_NOT_USED: 'numeral_not_used',
  FIGURE_NOT_DESCRIBED: 'figure_not_described',
  
  // Format-related
  FORBIDDEN_TERM_USED: 'forbidden_term_used',
  FORMAT_VIOLATION: 'format_violation',
  
  // Completeness-related
  MISSING_REQUIRED_SECTION: 'missing_required_section',
  INCOMPLETE_DISCLOSURE: 'incomplete_disclosure',
  
  // Diagram-related
  DIAGRAM_MISMATCH: 'diagram_mismatch',
  MISSING_FIGURE_REFERENCE: 'missing_figure_reference'
} as const

export type ValidationCode = typeof VALIDATION_CODES[keyof typeof VALIDATION_CODES]

