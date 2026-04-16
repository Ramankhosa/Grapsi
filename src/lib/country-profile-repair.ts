import { validateCountryProfile, ValidationResult } from './country-profile-validation'

/**
 * Repair result interface
 */
export interface RepairResult {
  success: boolean
  repairedProfile: any | null
  repairs: RepairAction[]
  validationResult: ValidationResult
  errors: string[]
}

/**
 * Individual repair action
 */
export interface RepairAction {
  type: 'added' | 'fixed' | 'converted' | 'normalized'
  field: string
  description: string
  oldValue?: any
  newValue?: any
}

/**
 * Default values for optional fields
 */
const DEFAULT_VALUES = {
  // Meta defaults
  meta: {
    version: 1,
    status: 'active',
    inheritsFrom: null,
    tags: []
  },

  // Rules defaults
  rules: {
    global: {
      paragraphNumberingRequired: false,
      maxPagesRecommended: 100,
      allowEquations: true,
      allowTables: true
    },
    abstract: {
      wordLimit: 150,
      noBenefitsOrAdvantages: true,
      noClaimLanguage: true,
      singleParagraph: true
    },
    claims: {
      twoPartFormPreferred: false,
      allowMultipleDependent: true,
      prohibitMultipleDependentOnMultipleDependent: true,
      preferredConnectors: ['comprising'],
      discouragedConnectors: ['consisting of'],
      forbiddenPhrases: [],
      maxIndependentClaimsBeforeExtraFee: 3,
      maxTotalClaimsRecommended: 20,
      allowReferenceNumeralsInClaims: true,
      requireSupportInDescription: true,
      unityStandard: 'PCT_UNITY_OF_INVENTION'
    },
    description: {
      requireBestModeDisclosure: true,
      avoidClaimLanguage: true,
      allowReferenceNumerals: true,
      requireEmbodimentSupportForAllClaims: true,
      industrialApplicabilitySectionRequired: false
    },
    drawings: {
      requiredWhenApplicable: true,
      paperSize: 'A4',
      colorAllowed: false,
      lineStyle: 'black_and_white_solid',
      referenceNumeralsMandatoryWhenDrawings: true,
      minReferenceTextSizePt: 8,
      marginTopCm: 2.5,
      marginBottomCm: 1.0,
      marginLeftCm: 2.5,
      marginRightCm: 1.5
    },
    procedural: {
      gracePeriodMonths: 12,
      foreignFilingLicenseRequired: false,
      idsRequired: false,
      priorArtDisclosureThreshold: 'any_relevant_to_novelty_or_inventive_step',
      allowProvisionalPriority: true
    },
    language: {
      allowedLanguages: ['en'],
      requiresOfficialTranslation: false
    }
  },

  // Export defaults
  export: {
    documentTypes: [{
      id: 'spec_pdf',
      label: 'Specification PDF',
      includesSections: ['title', 'field', 'background', 'summary', 'brief_drawings', 'detailed_description', 'claims', 'abstract'],
      pageSize: 'A4',
      lineSpacing: 1.5,
      fontFamily: 'Times New Roman',
      fontSizePt: 12,
      addPageNumbers: true,
      addParagraphNumbers: false
    }],
    sectionHeadings: {
      field: 'FIELD OF THE INVENTION',
      background: 'BACKGROUND',
      summary: 'SUMMARY',
      brief_drawings: 'BRIEF DESCRIPTION OF THE DRAWINGS',
      detailed_description: 'DETAILED DESCRIPTION',
      claims: 'CLAIMS',
      abstract: 'ABSTRACT'
    }
  },

  // Diagrams defaults
  diagrams: {
    requiredWhenApplicable: true,
    supportedDiagramTypes: ['block', 'flowchart', 'schematic'],
    figureLabelFormat: 'Fig. {number}',
    autoGenerateReferenceTable: true,
    diagramGenerationHints: {}
  },

  // Cross-checks defaults
  crossChecks: {
    enableSemanticCrossCheck: true,
    checkList: []
  }
}

/**
 * Canonical keys mapping for sections
 */
const CANONICAL_KEYS_MAP: { [key: string]: string[] } = {
  title: ['title'],
  field: ['field_of_invention', 'technical_field'],
  background: ['background', 'background_art'],
  summary: ['summary_of_invention', 'disclosure_of_invention'],
  brief_drawings: ['brief_description_of_drawings'],
  detailed_description: ['detailed_description', 'modes_for_carrying_out_invention'],
  claims: ['claims'],
  abstract: ['abstract'],
  cross_reference: ['cross_reference', 'priority_data'],
  industrial_applicability: ['industrial_applicability']
}

/**
 * Attempt to repair a country profile JSON with non-essential fixes
 */
export async function repairCountryProfile(originalProfile: any): Promise<RepairResult> {
  const repairs: RepairAction[] = []
  const errors: string[] = []

  try {
    let profile = JSON.parse(JSON.stringify(originalProfile)) // Deep clone

    // 1. Fix meta section
    repairs.push(...repairMetaSection(profile))

    // 2. Fix structure section
    repairs.push(...repairStructureSection(profile))

    // 3. Fix rules section
    repairs.push(...repairRulesSection(profile))

    // 4. Fix validation section
    repairs.push(...repairValidationSection(profile))

    // 5. Fix prompts section
    repairs.push(...repairPromptsSection(profile))

    // 6. Fix export section
    repairs.push(...repairExportSection(profile))

    // 7. Fix diagrams section
    repairs.push(...repairDiagramsSection(profile))

    // 8. Fix cross-checks section
    repairs.push(...repairCrossChecksSection(profile))

    // 9. Fix data types
    repairs.push(...fixDataTypes(profile))

    // Validate the repaired profile
    const validationResult = validateCountryProfile(profile)

    return {
      success: validationResult.errors.length === 0,
      repairedProfile: profile,
      repairs,
      validationResult,
      errors
    }

  } catch (error) {
    errors.push(`Repair failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      success: false,
      repairedProfile: null,
      repairs,
      validationResult: { valid: false, errors: [], warnings: [] },
      errors
    }
  }
}

/**
 * Repair meta section
 */
function repairMetaSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.meta) {
    profile.meta = {}
    repairs.push({
      type: 'added',
      field: 'meta',
      description: 'Added missing meta section'
    })
  }

  // Ensure required meta fields
  if (!profile.meta.id && profile.meta.code) {
    profile.meta.id = profile.meta.code
    repairs.push({
      type: 'added',
      field: 'meta.id',
      description: 'Set meta.id to match meta.code',
      newValue: profile.meta.code
    })
  }

  // Add default values for missing optional fields
  Object.entries(DEFAULT_VALUES.meta).forEach(([key, defaultValue]) => {
    if (profile.meta[key] === undefined) {
      profile.meta[key] = defaultValue
      repairs.push({
        type: 'added',
        field: `meta.${key}`,
        description: `Added default value for optional field`,
        newValue: defaultValue
      })
    }
  })

  return repairs
}

/**
 * Repair structure section
 */
function repairStructureSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.structure) {
    profile.structure = { defaultVariant: 'standard', variants: [] }
    repairs.push({
      type: 'added',
      field: 'structure',
      description: 'Added missing structure section'
    })
  }

  if (!profile.structure.defaultVariant) {
    profile.structure.defaultVariant = 'standard'
    repairs.push({
      type: 'added',
      field: 'structure.defaultVariant',
      description: 'Added default variant',
      newValue: 'standard'
    })
  }

  if (!Array.isArray(profile.structure.variants)) {
    profile.structure.variants = []
    repairs.push({
      type: 'fixed',
      field: 'structure.variants',
      description: 'Converted variants to array',
      newValue: []
    })
  }

  // Fix canonical keys for sections
  profile.structure.variants.forEach((variant: any, variantIndex: number) => {
    if (variant.sections && Array.isArray(variant.sections)) {
      variant.sections.forEach((section: any, sectionIndex: number) => {
        const sectionId = section.id
        const expectedKeys = CANONICAL_KEYS_MAP[sectionId]

        if (expectedKeys && (!section.canonicalKeys || !Array.isArray(section.canonicalKeys))) {
          section.canonicalKeys = expectedKeys
          repairs.push({
            type: 'fixed',
            field: `structure.variants[${variantIndex}].sections[${sectionIndex}].canonicalKeys`,
            description: `Fixed canonical keys for section ${sectionId}`,
            newValue: expectedKeys
          })
        }
      })
    }
  })

  return repairs
}

/**
 * Repair rules section
 */
function repairRulesSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.rules) {
    profile.rules = {}
    repairs.push({
      type: 'added',
      field: 'rules',
      description: 'Added missing rules section'
    })
  }

  // Add missing required rule blocks with defaults
  Object.entries(DEFAULT_VALUES.rules).forEach(([ruleType, defaults]) => {
    if (!profile.rules[ruleType]) {
      profile.rules[ruleType] = { ...defaults }
      repairs.push({
        type: 'added',
        field: `rules.${ruleType}`,
        description: `Added missing ${ruleType} rules with defaults`,
        newValue: defaults
      })
    }
  })

  return repairs
}

/**
 * Repair validation section
 */
function repairValidationSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.validation) {
    profile.validation = { sectionChecks: {}, crossSectionChecks: [] }
    repairs.push({
      type: 'added',
      field: 'validation',
      description: 'Added missing validation section'
    })
  }

  if (!profile.validation.sectionChecks) {
    profile.validation.sectionChecks = {}
    repairs.push({
      type: 'added',
      field: 'validation.sectionChecks',
      description: 'Added missing sectionChecks object'
    })
  }

  if (!Array.isArray(profile.validation.crossSectionChecks)) {
    profile.validation.crossSectionChecks = []
    repairs.push({
      type: 'fixed',
      field: 'validation.crossSectionChecks',
      description: 'Converted crossSectionChecks to array'
    })
  }

  return repairs
}

/**
 * Repair prompts section
 */
function repairPromptsSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.prompts) {
    profile.prompts = { baseStyle: {}, sections: {} }
    repairs.push({
      type: 'added',
      field: 'prompts',
      description: 'Added missing prompts section'
    })
  }

  if (!profile.prompts.baseStyle) {
    profile.prompts.baseStyle = {
      tone: 'technical, neutral, precise',
      voice: 'impersonal_third_person',
      avoid: ['marketing language', 'unsupported advantages']
    }
    repairs.push({
      type: 'added',
      field: 'prompts.baseStyle',
      description: 'Added default baseStyle configuration'
    })
  }

  if (!profile.prompts.sections) {
    profile.prompts.sections = {}
    repairs.push({
      type: 'added',
      field: 'prompts.sections',
      description: 'Added missing sections object'
    })
  }

  return repairs
}

/**
 * Repair export section
 */
function repairExportSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.export) {
    profile.export = DEFAULT_VALUES.export
    repairs.push({
      type: 'added',
      field: 'export',
      description: 'Added default export configuration'
    })
    return repairs
  }

  if (!Array.isArray(profile.export.documentTypes)) {
    profile.export.documentTypes = DEFAULT_VALUES.export.documentTypes
    repairs.push({
      type: 'fixed',
      field: 'export.documentTypes',
      description: 'Fixed documentTypes to be an array'
    })
  }

  // Ensure each document type has required fields
  profile.export.documentTypes.forEach((docType: any, index: number) => {
    const requiredFields = ['id', 'label', 'includesSections', 'pageSize', 'lineSpacing', 'fontFamily', 'fontSizePt', 'addPageNumbers', 'addParagraphNumbers']

    requiredFields.forEach(field => {
      if ((docType as any)[field] === undefined) {
        const defaultDocType = DEFAULT_VALUES.export.documentTypes[0]
        ;(docType as any)[field] = (defaultDocType as any)[field]
        repairs.push({
          type: 'added',
          field: `export.documentTypes[${index}].${field}`,
          description: `Added missing required field ${field}`,
          newValue: (defaultDocType as any)[field]
        })
      }
    })
  })

  return repairs
}

/**
 * Repair diagrams section
 */
function repairDiagramsSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.diagrams) {
    profile.diagrams = DEFAULT_VALUES.diagrams
    repairs.push({
      type: 'added',
      field: 'diagrams',
      description: 'Added default diagrams configuration'
    })
    return repairs
  }

  // Ensure arrays are arrays
  if (!Array.isArray(profile.diagrams.supportedDiagramTypes)) {
    profile.diagrams.supportedDiagramTypes = DEFAULT_VALUES.diagrams.supportedDiagramTypes
    repairs.push({
      type: 'fixed',
      field: 'diagrams.supportedDiagramTypes',
      description: 'Fixed supportedDiagramTypes to be an array'
    })
  }

  return repairs
}

/**
 * Repair cross-checks section
 */
function repairCrossChecksSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.crossChecks) {
    profile.crossChecks = DEFAULT_VALUES.crossChecks
    repairs.push({
      type: 'added',
      field: 'crossChecks',
      description: 'Added default crossChecks configuration'
    })
    return repairs
  }

  if (!Array.isArray(profile.crossChecks.checkList)) {
    profile.crossChecks.checkList = []
    repairs.push({
      type: 'fixed',
      field: 'crossChecks.checkList',
      description: 'Fixed checkList to be an array'
    })
  }

  return repairs
}

/**
 * Fix common data type issues
 */
function fixDataTypes(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  // Convert string numbers to actual numbers where expected
  const numberFields = [
    'meta.version',
    'rules.global.maxPagesRecommended',
    'rules.abstract.wordLimit',
    'rules.claims.maxIndependentClaimsBeforeExtraFee',
    'rules.claims.maxTotalClaimsRecommended',
    'rules.drawings.minReferenceTextSizePt',
    'rules.drawings.marginTopCm',
    'rules.drawings.marginBottomCm',
    'rules.drawings.marginLeftCm',
    'rules.drawings.marginRightCm',
    'rules.procedural.gracePeriodMonths'
  ]

  numberFields.forEach(fieldPath => {
    const value = getNestedValue(profile, fieldPath)
    if (typeof value === 'string' && !isNaN(Number(value))) {
      setNestedValue(profile, fieldPath, Number(value))
      repairs.push({
        type: 'converted',
        field: fieldPath,
        description: 'Converted string number to number',
        oldValue: value,
        newValue: Number(value)
      })
    }
  })

  // Ensure boolean fields are actually booleans
  const booleanFields = [
    'rules.global.paragraphNumberingRequired',
    'rules.global.allowEquations',
    'rules.global.allowTables',
    'rules.abstract.noBenefitsOrAdvantages',
    'rules.abstract.noClaimLanguage',
    'rules.abstract.singleParagraph'
  ]

  booleanFields.forEach(fieldPath => {
    const value = getNestedValue(profile, fieldPath)
    if (typeof value === 'string') {
      const boolValue = value.toLowerCase() === 'true'
      setNestedValue(profile, fieldPath, boolValue)
      repairs.push({
        type: 'converted',
        field: fieldPath,
        description: 'Converted string boolean to boolean',
        oldValue: value,
        newValue: boolValue
      })
    }
  })

  return repairs
}

/**
 * Get nested object value by dot notation path
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

/**
 * Set nested object value by dot notation path
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.')
  const lastKey = keys.pop()!
  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {}
    return current[key]
  }, obj)
  target[lastKey] = value
}

