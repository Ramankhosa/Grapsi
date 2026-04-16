/**
 * Country Profile Type Definitions
 * 
 * These types define the structure of country profile JSON files
 * used for multi-jurisdiction patent drafting.
 * 
 * Architecture:
 * - Base superset prompts (SupersetSection database table) provide generic drafting instructions
 * - Country top-up prompts (CountrySectionPrompt database table) customize for jurisdiction
 * - The prompt-merger-service combines both at runtime
 */

// ============================================================================
// Meta Information
// ============================================================================

export interface CountryProfileMeta {
  /** Unique identifier (typically same as code) */
  id: string
  /** ISO country code (e.g., "IN", "US", "EP") */
  code: string
  /** Full country name */
  name: string
  /** Continent for grouping */
  continent: 'Asia' | 'Europe' | 'North America' | 'South America' | 'Africa' | 'Oceania' | 'International'
  /** Official patent office name */
  office: string
  /** Patent office website URL */
  officeUrl: string
  /** Supported application types */
  applicationTypes: ApplicationType[]
  /** Supported languages (ISO 639-1 codes) */
  languages: string[]
  /** Profile version for tracking updates */
  version: number
  /** Profile status */
  status: 'active' | 'inactive' | 'draft'
  /** Parent profile for inheritance (e.g., "EP" for EU member states) */
  inheritsFrom: string | null
  /**
   * Strategy for merging base superset prompts with country top-ups
   * - 'append': Base first, then country additions (default)
   * - 'prepend': Country guidance first, then base
   * - 'replace': Country completely overrides base
   */
  promptMergeStrategy?: 'append' | 'prepend' | 'replace'
  /** Tags for categorization and search */
  tags: string[]
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
}

export type ApplicationType = 
  | 'ordinary'
  | 'convention'
  | 'PCT national phase'
  | 'PCT international'
  | 'divisional'
  | 'continuation'
  | 'CIP'

// ============================================================================
// Structure Definition
// ============================================================================

export interface CountryProfileStructure {
  /** Default variant ID */
  defaultVariant: string
  /** Available specification variants */
  variants: SpecificationVariant[]
}

export interface SpecificationVariant {
  /** Unique variant identifier */
  id: string
  /** Display label */
  label: string
  /** Variant description */
  description: string
  /** Sections included in this variant */
  sections: SectionDefinition[]
}

export interface SectionDefinition {
  /** Section identifier (country-specific) */
  id: string
  /** Display label */
  label: string
  /** Order in the specification */
  order: number
  /**
   * Canonical keys mapping to superset sections
   * Used for linking country sections to SupersetSection database entries
   */
  canonicalKeys: CanonicalSectionKey[]
  /** Whether this section is required */
  required: boolean
  /** Grouping for UI organization */
  group: 'header' | 'body' | 'claims' | 'abstract'
  /** UI configuration */
  ui?: SectionUI
}

export interface SectionUI {
  /** Placeholder text for input */
  placeholder?: string
  /** Help text for users */
  helpText?: string
}

/**
 * Canonical section keys that map to database prompts
 * These are the normalized keys used across the system
 */
export type CanonicalSectionKey = 
  | 'title'
  | 'preamble'
  | 'cross_reference'
  | 'field_of_invention'
  | 'background'
  | 'objects_of_invention'
  | 'summary_of_invention'
  | 'technical_problem'
  | 'technical_solution'
  | 'advantageous_effects'
  | 'brief_description_of_drawings'
  | 'detailed_description'
  | 'best_method'
  | 'industrial_applicability'
  | 'claims'
  | 'abstract'

// ============================================================================
// Rules Configuration
// ============================================================================

export interface CountryProfileRules {
  /** Global rules applicable to all sections */
  global?: GlobalRules
  /** Abstract-specific rules */
  abstract?: AbstractRules
  /** Claims-specific rules */
  claims?: ClaimsRules
  /** Description-specific rules */
  description?: DescriptionRules
  /** Drawings-specific rules */
  drawings?: DrawingsRules
  /** Procedural rules */
  procedural?: ProceduralRules
  /** Language requirements */
  language?: LanguageRules
  /** Sequence listing rules */
  sequenceListing?: SequenceListingRules
  /** Page layout rules */
  pageLayout?: PageLayoutRules
}

export interface GlobalRules {
  paragraphNumberingRequired: boolean
  maxPagesRecommended: number
  allowEquations: boolean
  allowTables: boolean
}

export interface AbstractRules {
  wordLimit: number
  noBenefitsOrAdvantages: boolean
  noClaimLanguage: boolean
  singleParagraph: boolean
}

export interface ClaimsRules {
  twoPartFormPreferred: boolean
  allowMultipleDependent: boolean
  prohibitMultipleDependentOnMultipleDependent: boolean
  preferredConnectors: string[]
  discouragedConnectors: string[]
  forbiddenPhrases: string[]
  maxIndependentClaimsBeforeExtraFee: number
  maxTotalClaimsRecommended: number
  allowReferenceNumeralsInClaims: boolean
  requireSupportInDescription: boolean
  unityStandard: string
}

export interface DescriptionRules {
  requireBestModeDisclosure: boolean
  avoidClaimLanguage: boolean
  allowReferenceNumerals: boolean
  requireEmbodimentSupportForAllClaims: boolean
  industrialApplicabilitySectionRequired: boolean
}

export interface DrawingsRules {
  requiredWhenApplicable: boolean
  paperSize: 'A4' | 'Letter'
  colorAllowed: boolean
  colorUsageNote?: string
  lineStyle: string
  referenceNumeralsMandatoryWhenDrawings: boolean
  minReferenceTextSizePt: number
  marginTopCm: number
  marginBottomCm: number
  marginLeftCm: number
  marginRightCm: number
}

export interface ProceduralRules {
  gracePeriodMonths: number
  gracePeriodNotes?: string
  foreignFilingLicenseRequired: boolean
  idsRequired: boolean
  priorArtDisclosureThreshold: string
  allowProvisionalPriority: boolean
  completeSpecificationDueMonths: number
}

export interface LanguageRules {
  allowedLanguages: string[]
  requiresOfficialTranslation: boolean
}

export interface SequenceListingRules {
  requiredIfSeqDisclosed: boolean
  format: string
  allowLateFurnishing: boolean
  lateFurnishingNotes?: string
  affectsFilingDate: boolean
  additionalFormatsAllowedForReference?: string[]
}

export interface PageLayoutRules {
  defaultPageSize: 'A4' | 'Letter'
  allowedPageSizes: string[]
  minMarginTopCm: number
  minMarginBottomCm: number
  minMarginLeftCm: number
  minMarginRightCm: number
  recommendedFontFamily: string
  recommendedFontSizePt: number
  recommendedLineSpacing: number
}

// ============================================================================
// Validation Configuration
// ============================================================================

export interface CountryProfileValidation {
  sectionChecks: Record<string, SectionCheck[]>
  crossSectionChecks: CrossSectionCheck[]
}

export interface SectionCheck {
  id: string
  type: 'maxWords' | 'maxChars' | 'maxCount' | 'minWords' | 'pattern'
  limit?: number
  pattern?: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface CrossSectionCheck {
  id: string
  type: 'support' | 'consistency'
  from: string
  mustBeSupportedBy?: string[]
  mustBeConsistentWith?: string[]
  severity: 'error' | 'warning' | 'info'
  message: string
}

// ============================================================================
// Prompts Configuration
// ============================================================================

export interface CountryProfilePrompts {
  /** Base style for all sections */
  baseStyle: BaseStyle
  /** Section-specific prompts (top-up or override) */
  sections: Record<string, SectionPromptConfig>
}

export interface BaseStyle {
  /** Writing tone */
  tone: string
  /** Narrative voice */
  voice: 'impersonal_third_person' | 'first_person' | 'passive'
  /** Phrases/styles to avoid */
  avoid: string[]
}

/**
 * Section prompt configuration
 * Can be either legacy format (direct instruction/constraints)
 * or new topUp format for merging with superset
 */
export type SectionPromptConfig = LegacySectionPrompt | TopUpSectionPrompt

export interface LegacySectionPrompt {
  instruction: string
  constraints: string[]
}

export interface TopUpSectionPrompt {
  topUp: {
    /** Jurisdiction-specific instruction to append/merge with base */
    instruction: string
    /** Additional constraints for this jurisdiction */
    constraints: string[]
    /** Extra items to add (separate from constraints) */
    additions?: string[]
  }
}

// ============================================================================
// Export Configuration
// ============================================================================

export interface CountryProfileExport {
  documentTypes: DocumentType[]
  sectionHeadings: Record<string, string>
}

export interface DocumentType {
  id: string
  label: string
  includesSections: string[]
  pageSize: 'A4' | 'Letter'
  marginTopCm: number
  marginBottomCm: number
  marginLeftCm: number
  marginRightCm: number
  fontFamily: string
  fontSizePt: number
  lineSpacing: number
  addPageNumbers: boolean
  addParagraphNumbers: boolean
}

// ============================================================================
// Diagrams Configuration
// ============================================================================

export interface CountryProfileDiagrams {
  requiredWhenApplicable: boolean
  supportedDiagramTypes: DiagramType[]
  figureLabelFormat: string
  autoGenerateReferenceTable: boolean
  diagramGenerationHints: Record<DiagramType, string>
}

export type DiagramType = 'block' | 'flowchart' | 'schematic' | 'perspective_view' | 'cross_section'

// ============================================================================
// Cross-Checks Configuration
// ============================================================================

export interface CountryProfileCrossChecks {
  enableSemanticCrossCheck: boolean
  checkList: CrossCheck[]
}

export interface CrossCheck {
  id: string
  description: string
  from: string
  mustBeExplainedIn?: string[]
  mustBeShownIn?: string[]
}

// ============================================================================
// Complete Country Profile
// ============================================================================

export interface CountryProfile {
  meta: CountryProfileMeta
  structure: CountryProfileStructure
  rules: CountryProfileRules
  validation: CountryProfileValidation
  prompts: CountryProfilePrompts
  export: CountryProfileExport
  diagrams: CountryProfileDiagrams
  crossChecks: CountryProfileCrossChecks
}

// ============================================================================
// Helper Types for Runtime
// ============================================================================

/**
 * Flattened section info for runtime use
 */
export interface ResolvedSection {
  sectionKey: string
  countryHeading: string
  canonicalKey: CanonicalSectionKey
  isRequired: boolean
  isApplicable: boolean
  rules: any
  prompt: {
    instruction: string
    constraints: string[]
  }
}

/**
 * Country drafting context for a session
 */
export interface CountryDraftingContext {
  countryCode: string
  countryName: string
  office: string
  language: string
  mergeStrategy: 'append' | 'prepend' | 'replace'
  baseStyle: BaseStyle
  applicableSections: string[]
  requiredSections: string[]
  rules: CountryProfileRules
}

