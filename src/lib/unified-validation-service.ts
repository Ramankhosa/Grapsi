/**
 * Unified Validation Service
 * 
 * Combines DB-driven rule-based validation with AI review.
 * All validation is POST-generation - never blocks drafting.
 * 
 * Key principles:
 * 1. Never block LLM output
 * 2. Surface all issues as feedback (notice/warning/error)
 * 3. Pull thresholds from database (CountrySectionValidation)
 * 4. Provide actionable fixes
 */

import { prisma } from '@/lib/prisma'
import type { 
  ValidationIssue, 
  ValidationSeverity, 
  SectionValidationRules,
  ThresholdResult,
  ThresholdStatus,
  ValidationCategory,
  ValidationCode
} from '@/types/validation'
import { VALIDATION_CODES, SECTION_LABELS } from '@/types/validation'
import crypto from 'crypto'

// ============================================================================
// DB-Driven Validation Rules Fetching
// ============================================================================

/**
 * Fetch validation rules for a section from the database
 * Falls back to defaults if no rules exist
 */
export async function getSectionValidationRules(
  countryCode: string,
  sectionKey: string,
  userId?: string,
  sessionId?: string
): Promise<SectionValidationRules | null> {
  try {
    // Fetch base rules from CountrySectionValidation
    const baseRules = await prisma.countrySectionValidation.findUnique({
      where: {
        countryCode_sectionKey: {
          countryCode: countryCode.toUpperCase(),
          sectionKey
        }
      }
    })

    if (!baseRules) {
      return null
    }

    // Check for user overrides if sessionId provided
    let userOverride = null
    if (userId && sessionId) {
      userOverride = await prisma.userValidationOverride.findUnique({
        where: {
          sessionId_jurisdiction_sectionKey: {
            sessionId,
            jurisdiction: countryCode.toUpperCase(),
            sectionKey
          }
        }
      })
    }

    // Build rules with overrides applied
    const rules: SectionValidationRules = {
      sectionKey,
      jurisdiction: countryCode.toUpperCase(),
      maxWords: userOverride?.customMaxWords ?? baseRules.maxWords ?? undefined,
      minWords: baseRules.minWords ?? undefined,
      recommendedWords: baseRules.recommendedWords ?? undefined,
      maxChars: userOverride?.customMaxChars ?? baseRules.maxChars ?? undefined,
      minChars: baseRules.minChars ?? undefined,
      recommendedChars: baseRules.recommendedChars ?? undefined,
      maxCount: userOverride?.customMaxCount ?? baseRules.maxCount ?? undefined,
      maxIndependent: baseRules.maxIndependent ?? undefined,
      countBeforeExtraFee: baseRules.countBeforeExtraFee ?? undefined,
      wordLimitSeverity: mapSeverity(userOverride?.customSeverity ?? baseRules.wordLimitSeverity),
      charLimitSeverity: mapSeverity(userOverride?.customSeverity ?? baseRules.charLimitSeverity),
      countLimitSeverity: mapSeverity(userOverride?.customSeverity ?? baseRules.countLimitSeverity),
      wordLimitMessage: baseRules.wordLimitMessage ?? undefined,
      charLimitMessage: baseRules.charLimitMessage ?? undefined,
      countLimitMessage: baseRules.countLimitMessage ?? undefined,
      legalReference: baseRules.legalReference ?? undefined,
      additionalRules: baseRules.additionalRules as Record<string, unknown> ?? {}
    }

    return rules
  } catch (error) {
    console.error('Error fetching validation rules:', error)
    return null
  }
}

/**
 * Fetch all validation rules for a jurisdiction
 */
export async function getAllValidationRules(
  countryCode: string
): Promise<SectionValidationRules[]> {
  try {
    const rules = await prisma.countrySectionValidation.findMany({
      where: {
        countryCode: countryCode.toUpperCase(),
        status: 'ACTIVE'
      }
    })

    return rules.map(r => ({
      sectionKey: r.sectionKey,
      jurisdiction: r.countryCode,
      maxWords: r.maxWords ?? undefined,
      minWords: r.minWords ?? undefined,
      recommendedWords: r.recommendedWords ?? undefined,
      maxChars: r.maxChars ?? undefined,
      minChars: r.minChars ?? undefined,
      recommendedChars: r.recommendedChars ?? undefined,
      maxCount: r.maxCount ?? undefined,
      maxIndependent: r.maxIndependent ?? undefined,
      countBeforeExtraFee: r.countBeforeExtraFee ?? undefined,
      wordLimitSeverity: mapSeverity(r.wordLimitSeverity),
      charLimitSeverity: mapSeverity(r.charLimitSeverity),
      countLimitSeverity: mapSeverity(r.countLimitSeverity),
      wordLimitMessage: r.wordLimitMessage ?? undefined,
      charLimitMessage: r.charLimitMessage ?? undefined,
      countLimitMessage: r.countLimitMessage ?? undefined,
      legalReference: r.legalReference ?? undefined,
      additionalRules: r.additionalRules as Record<string, unknown> ?? {}
    }))
  } catch (error) {
    console.error('Error fetching all validation rules:', error)
    return []
  }
}

/**
 * Fetch cross-section validation rules for a jurisdiction
 */
export async function getCrossValidationRules(countryCode: string) {
  try {
    const rules = await prisma.countryCrossValidation.findMany({
      where: {
        countryCode: countryCode.toUpperCase(),
        isEnabled: true
      }
    })

    return rules.map(r => ({
      checkId: r.checkId,
      checkType: r.checkType,
      fromSection: r.fromSection,
      toSections: r.toSections,
      severity: mapSeverity(r.severity),
      message: r.message,
      reviewPrompt: r.reviewPrompt,
      legalBasis: r.legalBasis,
      checkParams: r.checkParams as Record<string, unknown> ?? {}
    }))
  } catch (error) {
    console.error('Error fetching cross-validation rules:', error)
    return []
  }
}

// ============================================================================
// Rule-Based Validation (Non-blocking)
// ============================================================================

/**
 * Run rule-based validation on a draft section
 * Returns issues but never blocks
 */
export async function validateSection(
  sectionKey: string,
  content: string,
  countryCode: string,
  options?: {
    userId?: string
    sessionId?: string
  }
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  
  // Get rules from DB
  const rules = await getSectionValidationRules(
    countryCode, 
    sectionKey,
    options?.userId,
    options?.sessionId
  )

  if (!rules) {
    // No rules defined - nothing to validate
    return []
  }

  const wordCount = countWords(content)
  const charCount = content.length

  // Word count validation
  if (rules.maxWords) {
    const result = checkThreshold(wordCount, rules.maxWords, rules.recommendedWords)
    if (result.status !== 'ok') {
      issues.push({
        id: `rule-${sectionKey}-words-${Date.now()}`,
        sectionId: sectionKey,
        severity: result.status === 'error' ? rules.wordLimitSeverity : 'notice',
        code: VALIDATION_CODES.WORD_COUNT_EXCEEDED,
        message: rules.wordLimitMessage || 
          `Section exceeds word limit: ${wordCount} words (limit: ${rules.maxWords})${rules.legalReference ? ` per ${rules.legalReference}` : ''}`,
        suggestedFix: `Reduce the word count from ${wordCount} to ${rules.maxWords} words or less. Focus on removing redundant phrases and tightening the language.`,
        category: 'length',
        metadata: {
          actual: wordCount,
          limit: rules.maxWords,
          recommended: rules.recommendedWords,
          legalReference: rules.legalReference
        }
      })
    }
  }

  // Min word count validation
  if (rules.minWords && wordCount < rules.minWords) {
    issues.push({
      id: `rule-${sectionKey}-minwords-${Date.now()}`,
      sectionId: sectionKey,
      severity: 'notice',
      code: VALIDATION_CODES.WORD_COUNT_BELOW_MIN,
      message: `Section is below recommended minimum: ${wordCount} words (minimum: ${rules.minWords})`,
      suggestedFix: `Consider expanding this section to at least ${rules.minWords} words for adequate coverage.`,
      category: 'length',
      metadata: {
        actual: wordCount,
        minimum: rules.minWords
      }
    })
  }

  // Character count validation
  if (rules.maxChars) {
    const result = checkThreshold(charCount, rules.maxChars, rules.recommendedChars)
    if (result.status !== 'ok') {
      issues.push({
        id: `rule-${sectionKey}-chars-${Date.now()}`,
        sectionId: sectionKey,
        severity: result.status === 'error' ? rules.charLimitSeverity : 'notice',
        code: VALIDATION_CODES.CHAR_COUNT_EXCEEDED,
        message: rules.charLimitMessage ||
          `Section exceeds character limit: ${charCount} characters (limit: ${rules.maxChars})`,
        suggestedFix: `Reduce the character count from ${charCount} to ${rules.maxChars} characters or less.`,
        category: 'length',
        metadata: {
          actual: charCount,
          limit: rules.maxChars
        }
      })
    }
  }

  // Section-specific validations
  if (sectionKey === 'claims') {
    const claimIssues = validateClaims(content, rules)
    issues.push(...claimIssues)
  }

  if (sectionKey === 'abstract') {
    const abstractIssues = validateAbstract(content, countryCode)
    issues.push(...abstractIssues)
  }

  return issues
}

/**
 * Run full validation on entire draft
 */
export async function validateFullDraft(
  draft: Record<string, string>,
  countryCode: string,
  options?: {
    userId?: string
    sessionId?: string
    referenceNumerals?: Set<number>
    figurePlans?: Array<{ figureNo: number }>
  }
): Promise<ValidationIssue[]> {
  const allIssues: ValidationIssue[] = []

  // Validate each section
  for (const [sectionKey, content] of Object.entries(draft)) {
    if (!content || content.trim().length === 0) continue
    
    const sectionIssues = await validateSection(sectionKey, content, countryCode, options)
    allIssues.push(...sectionIssues)
  }

  // Cross-section validation
  const crossIssues = await validateCrossSections(draft, countryCode, options)
  allIssues.push(...crossIssues)

  return allIssues
}

// ============================================================================
// Section-Specific Validators
// ============================================================================

function validateClaims(content: string, rules: SectionValidationRules): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  
  // Count claims
  const claimMatches = content.match(/^\s*\d+\.\s/gm) || []
  const claimCount = claimMatches.length

  // Check total claim count
  if (rules.maxCount && claimCount > rules.maxCount) {
    issues.push({
      id: `rule-claims-count-${Date.now()}`,
      sectionId: 'claims',
      severity: rules.countLimitSeverity,
      code: VALIDATION_CODES.CLAIM_COUNT_EXCEEDED,
      message: rules.countLimitMessage ||
        `Total claims (${claimCount}) exceeds limit of ${rules.maxCount}${rules.legalReference ? ` per ${rules.legalReference}` : ''}`,
      suggestedFix: `Reduce the number of claims from ${claimCount} to ${rules.maxCount} or less. Consider consolidating dependent claims.`,
      category: 'count',
      metadata: {
        actual: claimCount,
        limit: rules.maxCount
      }
    })
  }

  // Count independent claims
  const independentPattern = /^\s*\d+\.\s+(?!The\s+\w+\s+(?:of|according to)\s+claim)/gmi
  const independentMatches = content.match(independentPattern) || []
  const independentCount = independentMatches.length

  if (rules.maxIndependent && independentCount > rules.maxIndependent) {
    issues.push({
      id: `rule-claims-independent-${Date.now()}`,
      sectionId: 'claims',
      severity: 'warning',
      code: VALIDATION_CODES.INDEPENDENT_CLAIM_EXCEEDED,
      message: `Independent claims (${independentCount}) exceed recommended limit of ${rules.maxIndependent}. Additional fees may apply.`,
      suggestedFix: `Consider restructuring to reduce independent claims to ${rules.maxIndependent}. Merge similar independent claims into a single broader claim.`,
      category: 'count',
      metadata: {
        actual: independentCount,
        limit: rules.maxIndependent
      }
    })
  }

  // Check for forbidden terms in claims
  const forbiddenTerms = ['and/or', 'approximately', 'substantially', 'about', 'etc.', 'e.g.', 'i.e.']
  for (const term of forbiddenTerms) {
    if (content.toLowerCase().includes(term)) {
      issues.push({
        id: `rule-claims-forbidden-${term}-${Date.now()}`,
        sectionId: 'claims',
        severity: 'warning',
        code: VALIDATION_CODES.FORBIDDEN_TERM_USED,
        message: `Claims contain potentially indefinite term: "${term}"`,
        suggestedFix: `Replace "${term}" with more precise language. For numerical values, use specific ranges instead of "approximately" or "about".`,
        category: 'legal'
      })
    }
  }

  return issues
}

function validateAbstract(content: string, countryCode: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Check for forbidden terms in abstract
  const forbiddenInAbstract = ['novel', 'inventive', 'unique', 'best', 'advantage', 'benefit']
  for (const term of forbiddenInAbstract) {
    if (content.toLowerCase().includes(term)) {
      issues.push({
        id: `rule-abstract-forbidden-${term}-${Date.now()}`,
        sectionId: 'abstract',
        severity: 'warning',
        code: VALIDATION_CODES.FORBIDDEN_TERM_USED,
        message: `Abstract contains term "${term}" which may be considered promotional language.`,
        suggestedFix: `Remove or replace "${term}" with objective, technical language. Abstracts should be factual descriptions, not promotional text.`,
        category: 'legal'
      })
    }
  }

  // Check for claim references in abstract
  if (/\bclaim\b/i.test(content)) {
    issues.push({
      id: `rule-abstract-claim-ref-${Date.now()}`,
      sectionId: 'abstract',
      severity: 'warning',
      code: VALIDATION_CODES.FORMAT_VIOLATION,
      message: 'Abstract should not reference claims',
      suggestedFix: 'Remove any references to specific claims from the abstract.',
      category: 'format'
    })
  }

  return issues
}

// ============================================================================
// Cross-Section Validation
// ============================================================================

async function validateCrossSections(
  draft: Record<string, string>,
  countryCode: string,
  options?: {
    referenceNumerals?: Set<number>
    figurePlans?: Array<{ figureNo: number }>
  }
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []

  // Numeral consistency check
  if (options?.referenceNumerals && options.referenceNumerals.size > 0) {
    const fullText = Object.values(draft).join('\n')
    const numeralRegex = /\((\d{2,3})\)/g
    const usedNumerals = new Set<number>()
    let match
    while ((match = numeralRegex.exec(fullText)) !== null) {
      usedNumerals.add(parseInt(match[1]))
    }

    // Find undeclared numerals
    for (const numeral of Array.from(usedNumerals)) {
      if (!options.referenceNumerals.has(numeral)) {
        issues.push({
          id: `cross-numeral-undeclared-${numeral}-${Date.now()}`,
          sectionId: 'detailedDescription',
          severity: 'warning',
          code: VALIDATION_CODES.NUMERAL_NOT_DECLARED,
          message: `Reference numeral (${numeral}) is used but not declared in component list`,
          suggestedFix: `Either add (${numeral}) to the component list or remove this reference from the draft.`,
          category: 'consistency'
        })
      }
    }

    // Find unused declared numerals
    for (const numeral of Array.from(options.referenceNumerals)) {
      if (!usedNumerals.has(numeral)) {
        issues.push({
          id: `cross-numeral-unused-${numeral}-${Date.now()}`,
          sectionId: 'detailedDescription',
          severity: 'notice',
          code: VALIDATION_CODES.NUMERAL_NOT_USED,
          message: `Declared component (${numeral}) is not referenced in the draft`,
          suggestedFix: `Add references to (${numeral}) in the detailed description, or remove it from the component list if not needed.`,
          category: 'completeness'
        })
      }
    }
  }

  // Figure reference validation
  if (options?.figurePlans && options.figurePlans.length > 0) {
    const fullText = Object.values(draft).join('\n')
    const figureRegex = /\bFig\.?\s*(\d+)\b/gi
    const referencedFigures = new Set<number>()
    let match
    while ((match = figureRegex.exec(fullText)) !== null) {
      referencedFigures.add(parseInt(match[1]))
    }

    const plannedFigures = new Set(options.figurePlans.map(f => f.figureNo))

    // Check for references to non-existent figures
    for (const figNo of Array.from(referencedFigures)) {
      if (!plannedFigures.has(figNo)) {
        issues.push({
          id: `cross-figure-invalid-${figNo}-${Date.now()}`,
          sectionId: 'briefDescriptionOfDrawings',
          severity: 'error',
          code: VALIDATION_CODES.MISSING_FIGURE_REFERENCE,
          message: `Reference to Figure ${figNo} but no such figure exists`,
          suggestedFix: `Either create Figure ${figNo} or correct the reference to an existing figure number.`,
          category: 'diagram',
          relatedSections: ['detailedDescription']
        })
      }
    }

    // Check for unreferenced figures
    for (const figNo of Array.from(plannedFigures)) {
      if (!referencedFigures.has(figNo)) {
        issues.push({
          id: `cross-figure-unreferenced-${figNo}-${Date.now()}`,
          sectionId: 'briefDescriptionOfDrawings',
          severity: 'notice',
          code: VALIDATION_CODES.FIGURE_NOT_DESCRIBED,
          message: `Figure ${figNo} exists but is not referenced in the specification`,
          suggestedFix: `Add references to Figure ${figNo} in the detailed description and brief description of drawings.`,
          category: 'completeness'
        })
      }
    }
  }

  return issues
}

// ============================================================================
// Utility Functions
// ============================================================================

function countWords(text: string): number {
  return (text || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0)
    .length
}

function mapSeverity(severity: string | null | undefined): ValidationSeverity {
  switch (severity?.toLowerCase()) {
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'notice':
    case 'info':
    default:
      return 'notice'
  }
}

function checkThreshold(
  actual: number,
  hardLimit: number,
  softLimit?: number
): ThresholdResult {
  const percentage = (actual / hardLimit) * 100

  if (actual > hardLimit) {
    return {
      status: 'error',
      actual,
      limit: hardLimit,
      softLimit,
      percentage,
      message: `Exceeds limit by ${actual - hardLimit}`
    }
  }

  // Soft warning if above recommended (or 90% of hard limit if no soft limit)
  const effectiveSoftLimit = softLimit || (hardLimit * 0.9)
  if (actual > effectiveSoftLimit) {
    return {
      status: 'soft_warning',
      actual,
      limit: hardLimit,
      softLimit: effectiveSoftLimit,
      percentage,
      message: `Approaching limit (${percentage.toFixed(0)}%)`
    }
  }

  return {
    status: 'ok',
    actual,
    limit: hardLimit,
    percentage
  }
}

// ============================================================================
// Convert Legacy Issues to New Format
// ============================================================================

export function convertLegacyIssue(legacyIssue: {
  sectionKey: string
  type: 'error' | 'warning' | 'suggestion'
  category: string
  title: string
  description: string
  suggestion: string
  fixPrompt: string
  relatedSections?: string[]
  severity: number
}): ValidationIssue {
  // Map old type to new severity
  let severity: ValidationSeverity = 'notice'
  if (legacyIssue.type === 'error' || legacyIssue.severity >= 4) {
    severity = 'error'
  } else if (legacyIssue.type === 'warning' || legacyIssue.severity >= 2) {
    severity = 'warning'
  }

  // Map category to code
  const codeMap: Record<string, ValidationCode> = {
    consistency: 'description_claim_mismatch',
    diagram: 'diagram_mismatch',
    completeness: 'incomplete_disclosure',
    legal: 'missing_antecedent_basis',
    clarity: 'format_violation'
  }

  return {
    id: `converted-${crypto.randomUUID()}`,
    sectionId: legacyIssue.sectionKey,
    severity,
    code: codeMap[legacyIssue.category] || 'format_violation',
    message: legacyIssue.description || legacyIssue.title,
    suggestedFix: legacyIssue.suggestion || legacyIssue.fixPrompt,
    category: legacyIssue.category as ValidationCategory,
    relatedSections: legacyIssue.relatedSections
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  type ValidationIssue,
  type ValidationSeverity,
  type SectionValidationRules
}

