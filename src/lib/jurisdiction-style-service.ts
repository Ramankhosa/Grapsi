/**
 * Jurisdiction Style Service
 * 
 * Provides unified access to diagram, export, and validation configurations
 * with cascading fallback logic:
 * 
 * Resolution Order:
 * 1. User session-specific override (if sessionId provided)
 * 2. User global preference (sessionId = null)
 * 3. Country/jurisdiction default from DB
 * 4. Hardcoded fallback defaults
 * 
 * This service is used by:
 * - Diagram generation LLM prompts
 * - Export engine (DOCX generation)
 * - Validation engine and AI reviewer
 */

import { PrismaClient, CountrySectionPromptStatus } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface DiagramConfig {
  countryCode: string
  requiredWhenApplicable: boolean
  supportedDiagramTypes: string[]
  figureLabelFormat: string
  autoGenerateReferenceTable: boolean
  
  // Drawing rules
  paperSize: string
  colorAllowed: boolean
  colorUsageNote: string | null
  lineStyle: string
  referenceNumeralsMandatory: boolean
  minReferenceTextSizePt: number
  
  // Margins
  drawingMarginTopCm: number
  drawingMarginBottomCm: number
  drawingMarginLeftCm: number
  drawingMarginRightCm: number
  
  // LLM settings
  defaultDiagramCount: number
  maxDiagramsRecommended: number
  
  // Per-type hints
  hints: Record<string, string>
  
  // Source tracking (for debugging)
  source: 'user-session' | 'user-global' | 'country' | 'fallback'
}

export interface ExportConfig {
  countryCode: string
  documentTypeId: string
  label: string
  
  // Page layout
  pageSize: string
  marginTopCm: number
  marginBottomCm: number
  marginLeftCm: number
  marginRightCm: number
  
  // Typography
  fontFamily: string
  fontSizePt: number
  lineSpacing: number
  headingFontFamily: string | null
  headingFontSizePt: number | null
  
  // Document options
  addPageNumbers: boolean
  addParagraphNumbers: boolean
  pageNumberFormat: string
  pageNumberPosition: string
  
  // Sections
  includesSections: string[]
  sectionHeadings: Record<string, string>
  
  // Source tracking
  source: 'user-session' | 'user-global' | 'country' | 'fallback'
}

export interface SectionValidation {
  countryCode: string
  sectionKey: string
  
  // Limits
  maxWords: number | null
  minWords: number | null
  recommendedWords: number | null
  maxChars: number | null
  minChars: number | null
  recommendedChars: number | null
  maxCount: number | null
  maxIndependent: number | null
  countBeforeExtraFee: number | null
  
  // Messaging
  wordLimitSeverity: string | null
  charLimitSeverity: string | null
  countLimitSeverity: string | null
  wordLimitMessage: string | null
  charLimitMessage: string | null
  countLimitMessage: string | null
  legalReference: string | null
  
  // Additional rules
  additionalRules: Record<string, any>
}

export interface CrossValidation {
  checkId: string
  checkType: string
  fromSection: string
  toSections: string[]
  severity: string
  message: string
  reviewPrompt: string | null
  legalBasis: string | null
  checkParams: Record<string, any>
  isEnabled: boolean
}

// ============================================================================
// FALLBACK DEFAULTS
// ============================================================================

const DEFAULT_DIAGRAM_CONFIG: Omit<DiagramConfig, 'countryCode' | 'source'> = {
  requiredWhenApplicable: true,
  supportedDiagramTypes: ['block', 'flowchart', 'schematic', 'perspective_view'],
  figureLabelFormat: 'Fig. {number}',
  autoGenerateReferenceTable: true,
  paperSize: 'A4',
  colorAllowed: false,
  colorUsageNote: null,
  lineStyle: 'black_and_white_solid',
  referenceNumeralsMandatory: true,
  minReferenceTextSizePt: 8,
  drawingMarginTopCm: 2.5,
  drawingMarginBottomCm: 1.0,
  drawingMarginLeftCm: 2.5,
  drawingMarginRightCm: 1.5,
  defaultDiagramCount: 4,
  maxDiagramsRecommended: 10,
  hints: {
    block: 'Use rectangles for components and arrows for data/control flow.',
    flowchart: 'Use standard flowchart symbols for processes and decisions.',
    schematic: 'Show functional relationships and reference numerals clearly.',
    perspective_view: 'Use where overall physical form is important.'
  }
}

const DEFAULT_EXPORT_CONFIG: Omit<ExportConfig, 'countryCode' | 'documentTypeId' | 'label' | 'source' | 'sectionHeadings'> = {
  pageSize: 'A4',
  marginTopCm: 2.5,
  marginBottomCm: 2.0,
  marginLeftCm: 2.5,
  marginRightCm: 2.0,
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 1.5,
  headingFontFamily: null,
  headingFontSizePt: null,
  addPageNumbers: true,
  addParagraphNumbers: false,
  pageNumberFormat: 'Page {page} of {total}',
  pageNumberPosition: 'header-right',
  includesSections: ['title', 'field', 'background', 'summary', 'brief_drawings', 'detailed_description', 'claims', 'abstract']
}

// ============================================================================
// DIAGRAM CONFIG RESOLUTION
// ============================================================================

/**
 * Get merged diagram configuration for a jurisdiction
 * Cascades: User Session → User Global → Country Default → Fallback
 */
export async function getDiagramConfig(
  countryCode: string,
  userId?: string,
  sessionId?: string
): Promise<DiagramConfig> {
  
  // 1. Get country default from DB
  const countryConfig = await prisma.countryDiagramConfig.findUnique({
    where: { countryCode },
    include: { diagramHints: true }
  })

  // Build base config from country or fallback
  let config: DiagramConfig = {
    countryCode,
    ...DEFAULT_DIAGRAM_CONFIG,
    source: 'fallback'
  }

  if (countryConfig) {
    config = {
      countryCode,
      requiredWhenApplicable: countryConfig.requiredWhenApplicable,
      supportedDiagramTypes: countryConfig.supportedDiagramTypes,
      figureLabelFormat: countryConfig.figureLabelFormat,
      autoGenerateReferenceTable: countryConfig.autoGenerateReferenceTable,
      paperSize: countryConfig.paperSize,
      colorAllowed: countryConfig.colorAllowed,
      colorUsageNote: countryConfig.colorUsageNote,
      lineStyle: countryConfig.lineStyle,
      referenceNumeralsMandatory: countryConfig.referenceNumeralsMandatory,
      minReferenceTextSizePt: countryConfig.minReferenceTextSizePt,
      drawingMarginTopCm: countryConfig.drawingMarginTopCm,
      drawingMarginBottomCm: countryConfig.drawingMarginBottomCm,
      drawingMarginLeftCm: countryConfig.drawingMarginLeftCm,
      drawingMarginRightCm: countryConfig.drawingMarginRightCm,
      defaultDiagramCount: countryConfig.defaultDiagramCount,
      maxDiagramsRecommended: countryConfig.maxDiagramsRecommended,
      hints: countryConfig.diagramHints.reduce((acc, h) => {
        acc[h.diagramType] = h.hint
        return acc
      }, {} as Record<string, string>),
      source: 'country'
    }
  }

  // 2. Apply user global preferences (if userId provided)
  if (userId) {
    const userGlobalStyle = await prisma.userDiagramStyle.findFirst({
      where: {
        userId,
        sessionId: null, // Global preference
        isActive: true,
        OR: [
          { jurisdiction: '*' },
          { jurisdiction: countryCode }
        ]
      },
      orderBy: [
        { jurisdiction: 'desc' } // Specific jurisdiction takes precedence over '*'
      ]
    })

    if (userGlobalStyle) {
      config = applyUserDiagramOverrides(config, userGlobalStyle, 'user-global')
    }
  }

  // 3. Apply session-specific overrides (if sessionId provided)
  if (userId && sessionId) {
    const userSessionStyles = await prisma.userDiagramStyle.findMany({
      where: {
        userId,
        sessionId,
        isActive: true,
        OR: [
          { jurisdiction: '*' },
          { jurisdiction: countryCode }
        ]
      },
      orderBy: [
        { jurisdiction: 'desc' }
      ]
    })

    for (const style of userSessionStyles) {
      config = applyUserDiagramOverrides(config, style, 'user-session')
    }
  }

  return config
}

/**
 * Apply user overrides to diagram config
 */
function applyUserDiagramOverrides(
  config: DiagramConfig,
  override: any,
  source: 'user-global' | 'user-session'
): DiagramConfig {
  const result = { ...config, source }

  if (override.customColorAllowed !== null) result.colorAllowed = override.customColorAllowed
  if (override.customLineStyle) result.lineStyle = override.customLineStyle
  if (override.customMinRefTextSizePt !== null) result.minReferenceTextSizePt = override.customMinRefTextSizePt
  if (override.customFigureLabelFormat) result.figureLabelFormat = override.customFigureLabelFormat
  if (override.preferredDiagramCount !== null) result.defaultDiagramCount = override.preferredDiagramCount

  // Apply per-type hint override
  if (override.diagramType && override.customHint) {
    result.hints = { ...result.hints, [override.diagramType]: override.customHint }
  }

  return result
}

/**
 * Get diagram generation hint for a specific diagram type
 */
export async function getDiagramHint(
  countryCode: string,
  diagramType: string,
  userId?: string,
  sessionId?: string
): Promise<string> {
  const config = await getDiagramConfig(countryCode, userId, sessionId)
  return config.hints[diagramType] || config.hints['block'] || DEFAULT_DIAGRAM_CONFIG.hints.block
}

// ============================================================================
// EXPORT CONFIG RESOLUTION
// ============================================================================

/**
 * Get merged export configuration for a jurisdiction
 */
export async function getExportConfig(
  countryCode: string,
  documentTypeId: string = 'spec_pdf',
  userId?: string,
  sessionId?: string
): Promise<ExportConfig> {
  
  // Normalize country code
  const normalizedCountryCode = countryCode.toUpperCase()
  
  // 1. Get country default - try exact match first
  let countryConfig = await prisma.countryExportConfig.findUnique({
    where: {
      countryCode_documentTypeId: { countryCode: normalizedCountryCode, documentTypeId }
    },
    include: { sectionHeadings: true }
  })
  
  // Fallback 1: if DOCX config is missing, try the PDF variant
  if (!countryConfig && documentTypeId === 'spec_docx') {
    countryConfig = await prisma.countryExportConfig.findUnique({
      where: {
        countryCode_documentTypeId: { countryCode: normalizedCountryCode, documentTypeId: 'spec_pdf' }
      },
      include: { sectionHeadings: true }
    })
    if (countryConfig) {
      console.log(`[ExportConfig] Using PDF export config as fallback for DOCX for ${normalizedCountryCode}`)
    }
  }
  
  // Fallback 2: if still not found, try country-specific prefixed document type IDs
  // (e.g., "in_spec_pdf" for India, "au_spec_pdf" for Australia)
  if (!countryConfig) {
    const countryLower = normalizedCountryCode.toLowerCase()
    const prefixedDocType = documentTypeId.includes('docx') 
      ? `${countryLower}_spec_docx`
      : `${countryLower}_spec_pdf`
    
    countryConfig = await prisma.countryExportConfig.findUnique({
      where: {
        countryCode_documentTypeId: { countryCode: normalizedCountryCode, documentTypeId: prefixedDocType }
      },
      include: { sectionHeadings: true }
    })
    if (countryConfig) {
      console.log(`[ExportConfig] Found country-prefixed config ${prefixedDocType} for ${normalizedCountryCode}`)
    }
  }
  
  // Fallback 3: if still not found, get ANY active export config for this country
  if (!countryConfig) {
    countryConfig = await prisma.countryExportConfig.findFirst({
      where: { 
        countryCode: normalizedCountryCode,
        status: 'ACTIVE'
      },
      include: { sectionHeadings: true },
      orderBy: { createdAt: 'desc' }
    })
    if (countryConfig) {
      console.log(`[ExportConfig] Using first available config (${countryConfig.documentTypeId}) for ${normalizedCountryCode}`)
    }
  }

  // Build base config
  let config: ExportConfig = {
    countryCode: normalizedCountryCode,
    documentTypeId,
    label: `${normalizedCountryCode} Specification`,
    ...DEFAULT_EXPORT_CONFIG,
    sectionHeadings: {},
    source: 'fallback'
  }

  if (countryConfig) {
    console.log(`[ExportConfig] Loaded config for ${normalizedCountryCode}: fontSizePt=${countryConfig.fontSizePt}, addParagraphNumbers=${countryConfig.addParagraphNumbers}, margins=[${countryConfig.marginTopCm},${countryConfig.marginBottomCm},${countryConfig.marginLeftCm},${countryConfig.marginRightCm}]`)
    config = {
      countryCode: normalizedCountryCode,
      documentTypeId: countryConfig.documentTypeId,
      label: countryConfig.label,
      pageSize: countryConfig.pageSize,
      marginTopCm: countryConfig.marginTopCm,
      marginBottomCm: countryConfig.marginBottomCm,
      marginLeftCm: countryConfig.marginLeftCm,
      marginRightCm: countryConfig.marginRightCm,
      fontFamily: countryConfig.fontFamily,
      fontSizePt: countryConfig.fontSizePt,
      lineSpacing: countryConfig.lineSpacing,
      headingFontFamily: countryConfig.headingFontFamily,
      headingFontSizePt: countryConfig.headingFontSizePt,
      addPageNumbers: countryConfig.addPageNumbers,
      addParagraphNumbers: countryConfig.addParagraphNumbers,
      pageNumberFormat: countryConfig.pageNumberFormat,
      pageNumberPosition: countryConfig.pageNumberPosition,
      includesSections: countryConfig.includesSections,
      sectionHeadings: countryConfig.sectionHeadings.reduce((acc, h) => {
        acc[h.sectionKey] = h.heading
        return acc
      }, {} as Record<string, string>),
      source: 'country'
    }
  }

  // 2. Apply user global preferences
  if (userId) {
    const userGlobalStyle = await prisma.userExportStyle.findFirst({
      where: {
        userId,
        sessionId: null,
        isActive: true,
        OR: [
          { jurisdiction: '*' },
          { jurisdiction: normalizedCountryCode }
        ]
      },
      orderBy: [{ jurisdiction: 'desc' }]
    })

    if (userGlobalStyle) {
      config = applyUserExportOverrides(config, userGlobalStyle, 'user-global')
    }
  }

  // 3. Apply session-specific overrides
  if (userId && sessionId) {
    const userSessionStyle = await prisma.userExportStyle.findFirst({
      where: {
        userId,
        sessionId,
        isActive: true,
        OR: [
          { jurisdiction: '*' },
          { jurisdiction: normalizedCountryCode }
        ]
      },
      orderBy: [{ jurisdiction: 'desc' }]
    })

    if (userSessionStyle) {
      config = applyUserExportOverrides(config, userSessionStyle, 'user-session')
    }
  }

  return config
}

/**
 * Apply user overrides to export config
 */
function applyUserExportOverrides(
  config: ExportConfig,
  override: any,
  source: 'user-global' | 'user-session'
): ExportConfig {
  const result = { ...config, source }

  if (override.fontFamily) result.fontFamily = override.fontFamily
  if (override.fontSizePt !== null) result.fontSizePt = override.fontSizePt
  if (override.lineSpacing !== null) result.lineSpacing = override.lineSpacing
  if (override.marginTopCm !== null) result.marginTopCm = override.marginTopCm
  if (override.marginBottomCm !== null) result.marginBottomCm = override.marginBottomCm
  if (override.marginLeftCm !== null) result.marginLeftCm = override.marginLeftCm
  if (override.marginRightCm !== null) result.marginRightCm = override.marginRightCm
  if (override.addPageNumbers !== null) result.addPageNumbers = override.addPageNumbers
  if (override.addParagraphNumbers !== null) result.addParagraphNumbers = override.addParagraphNumbers

  return result
}

// ============================================================================
// VALIDATION CONFIG
// ============================================================================

/**
 * Get section validation rules for a jurisdiction
 */
export async function getSectionValidation(
  countryCode: string,
  sectionKey: string,
  userId?: string,
  sessionId?: string
): Promise<SectionValidation | null> {
  
  // 1. Get country default
  const countryValidation = await prisma.countrySectionValidation.findUnique({
    where: {
      countryCode_sectionKey: { countryCode, sectionKey }
    }
  })

  if (!countryValidation) return null

  let validation: SectionValidation = {
    countryCode,
    sectionKey,
    maxWords: countryValidation.maxWords,
    minWords: countryValidation.minWords,
    recommendedWords: countryValidation.recommendedWords,
    maxChars: countryValidation.maxChars,
    minChars: countryValidation.minChars,
    recommendedChars: countryValidation.recommendedChars,
    maxCount: countryValidation.maxCount,
    maxIndependent: countryValidation.maxIndependent,
    countBeforeExtraFee: countryValidation.countBeforeExtraFee,
    wordLimitSeverity: countryValidation.wordLimitSeverity,
    charLimitSeverity: countryValidation.charLimitSeverity,
    countLimitSeverity: countryValidation.countLimitSeverity,
    wordLimitMessage: countryValidation.wordLimitMessage,
    charLimitMessage: countryValidation.charLimitMessage,
    countLimitMessage: countryValidation.countLimitMessage,
    legalReference: countryValidation.legalReference,
    additionalRules: countryValidation.additionalRules as Record<string, any> || {}
  }

  // 2. Apply user session overrides
  if (userId && sessionId) {
    const override = await prisma.userValidationOverride.findUnique({
      where: {
        sessionId_jurisdiction_sectionKey: {
          sessionId,
          jurisdiction: countryCode,
          sectionKey
        }
      }
    })

    // Also check for wildcard jurisdiction override
    const wildcardOverride = await prisma.userValidationOverride.findUnique({
      where: {
        sessionId_jurisdiction_sectionKey: {
          sessionId,
          jurisdiction: '*',
          sectionKey
        }
      }
    })

    const effectiveOverride = override || wildcardOverride

    if (effectiveOverride && effectiveOverride.isActive) {
      if (effectiveOverride.customMaxWords !== null) validation.maxWords = effectiveOverride.customMaxWords
      if (effectiveOverride.customMaxChars !== null) validation.maxChars = effectiveOverride.customMaxChars
      if (effectiveOverride.customMaxCount !== null) validation.maxCount = effectiveOverride.customMaxCount
      if (effectiveOverride.customSeverity) {
        validation.wordLimitSeverity = effectiveOverride.customSeverity
        validation.charLimitSeverity = effectiveOverride.customSeverity
        validation.countLimitSeverity = effectiveOverride.customSeverity
      }
    }
  }

  return validation
}

/**
 * Get all section validations for a jurisdiction
 */
export async function getAllSectionValidations(countryCode: string): Promise<SectionValidation[]> {
  const validations = await prisma.countrySectionValidation.findMany({
    where: { countryCode, status: 'ACTIVE' }
  })

  return validations.map(v => ({
    countryCode,
    sectionKey: v.sectionKey,
    maxWords: v.maxWords,
    minWords: v.minWords,
    recommendedWords: v.recommendedWords,
    maxChars: v.maxChars,
    minChars: v.minChars,
    recommendedChars: v.recommendedChars,
    maxCount: v.maxCount,
    maxIndependent: v.maxIndependent,
    countBeforeExtraFee: v.countBeforeExtraFee,
    wordLimitSeverity: v.wordLimitSeverity,
    charLimitSeverity: v.charLimitSeverity,
    countLimitSeverity: v.countLimitSeverity,
    wordLimitMessage: v.wordLimitMessage,
    charLimitMessage: v.charLimitMessage,
    countLimitMessage: v.countLimitMessage,
    legalReference: v.legalReference,
    additionalRules: v.additionalRules as Record<string, any> || {}
  }))
}

/**
 * Get cross-section validations for AI reviewer
 */
export async function getCrossValidations(countryCode: string): Promise<CrossValidation[]> {
  const validations = await prisma.countryCrossValidation.findMany({
    where: { countryCode, isEnabled: true }
  })

  return validations.map(v => ({
    checkId: v.checkId,
    checkType: v.checkType,
    fromSection: v.fromSection,
    toSections: v.toSections,
    severity: v.severity,
    message: v.message,
    reviewPrompt: v.reviewPrompt,
    legalBasis: v.legalBasis,
    checkParams: v.checkParams as Record<string, any> || {},
    isEnabled: v.isEnabled
  }))
}

// ============================================================================
// AI REVIEWER CONTEXT BUILDER
// ============================================================================

/**
 * Build complete validation context for AI reviewer
 */
export async function buildAIReviewerContext(countryCode: string): Promise<{
  sectionValidations: SectionValidation[]
  crossValidations: CrossValidation[]
  systemPrompt: string
}> {
  const [sectionValidations, crossValidations] = await Promise.all([
    getAllSectionValidations(countryCode),
    getCrossValidations(countryCode)
  ])

  // Build system prompt for AI reviewer
  const systemPrompt = `You are an expert patent reviewer for the ${countryCode} jurisdiction.

SECTION VALIDATION RULES:
${sectionValidations.map(v => `
${v.sectionKey.toUpperCase()}:
${v.maxWords ? `- Maximum words: ${v.maxWords} (${v.wordLimitSeverity || 'warning'})` : ''}
${v.maxChars ? `- Maximum characters: ${v.maxChars} (${v.charLimitSeverity || 'warning'})` : ''}
${v.maxCount ? `- Maximum count: ${v.maxCount} (${v.countLimitSeverity || 'warning'})` : ''}
${v.legalReference ? `- Legal basis: ${v.legalReference}` : ''}
`).join('')}

CROSS-SECTION VALIDATION CHECKS:
${crossValidations.map(v => `
${v.checkId}:
- Type: ${v.checkType}
- From: ${v.fromSection} → To: ${v.toSections.join(', ')}
- Severity: ${v.severity}
- Instructions: ${v.reviewPrompt || v.message}
${v.legalBasis ? `- Legal basis: ${v.legalBasis}` : ''}
`).join('')}

Review the patent draft section by section and flag any violations of the above rules.
For each issue found, provide:
1. Section name
2. Issue type (word_limit, char_limit, support, consistency, etc.)
3. Severity (error, warning, info)
4. Specific message explaining the issue
5. Suggested remediation
`

  return { sectionValidations, crossValidations, systemPrompt }
}

// ============================================================================
// LLM PROMPT INJECTION HELPERS
// ============================================================================

/**
 * Generate diagram style instructions for LLM prompt
 */
export async function generateDiagramPromptInstructions(
  countryCode: string,
  diagramType: string,
  userId?: string,
  sessionId?: string
): Promise<string> {
  const config = await getDiagramConfig(countryCode, userId, sessionId)
  const hint = config.hints[diagramType] || config.hints['block'] || ''

  return `
JURISDICTION: ${countryCode}
DIAGRAM TYPE: ${diagramType}

JURISDICTION-SPECIFIC INSTRUCTIONS:
${hint}

DRAWING REQUIREMENTS FOR ${countryCode}:
- Figure label format: ${config.figureLabelFormat}
- Color allowed: ${config.colorAllowed ? 'Yes' : 'No (black and white only)'}
${config.colorUsageNote ? `- Color note: ${config.colorUsageNote}` : ''}
- Line style: ${config.lineStyle}
- Reference numerals: ${config.referenceNumeralsMandatory ? 'Required' : 'Optional'}
- Minimum text size: ${config.minReferenceTextSizePt}pt
- Paper size: ${config.paperSize}
`.trim()
}

/**
 * Generate validation rules summary for section drafting
 */
export async function generateValidationRulesForSection(
  countryCode: string,
  sectionKey: string
): Promise<string | null> {
  const validation = await getSectionValidation(countryCode, sectionKey)
  if (!validation) return null

  const rules: string[] = []
  
  if (validation.maxWords) {
    rules.push(`Maximum ${validation.maxWords} words${validation.legalReference ? ` (${validation.legalReference})` : ''}`)
  }
  if (validation.maxChars) {
    rules.push(`Maximum ${validation.maxChars} characters`)
  }
  if (validation.minWords) {
    rules.push(`Minimum ${validation.minWords} words recommended`)
  }
  if (validation.maxCount) {
    rules.push(`Maximum ${validation.maxCount} items`)
  }
  if (validation.maxIndependent) {
    rules.push(`Maximum ${validation.maxIndependent} independent claims before extra fees`)
  }

  return rules.length > 0 ? rules.join('\n') : null
}

const jurisdictionStyleService = {
  getDiagramConfig,
  getDiagramHint,
  getExportConfig,
  getSectionValidation,
  getAllSectionValidations,
  getCrossValidations,
  buildAIReviewerContext,
  generateDiagramPromptInstructions,
  generateValidationRulesForSection
}

export default jurisdictionStyleService

