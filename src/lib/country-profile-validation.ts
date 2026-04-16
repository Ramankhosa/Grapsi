import { z } from 'zod'

// Define the comprehensive schema for country_profile.json
const countryProfileSchema = z.object({
  meta: z.object({
    id: z.string().min(1).max(10),
    name: z.string().min(1).max(100),
    code: z.string().min(2).max(3).toUpperCase(),
    continent: z.string().min(1).max(50),
    office: z.string().min(1).max(100),
    officeUrl: z.string().url(),
    applicationTypes: z.array(z.string()).min(1),
    languages: z.array(z.string()).min(1),
    version: z.number().int().min(1),
    status: z.enum(['active', 'inactive', 'draft']),
    inheritsFrom: z.string().nullable(),
    tags: z.array(z.string()),
    createdAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid ISO date string"
    }),
    updatedAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid ISO date string"
    })
  }),

  structure: z.object({
    defaultVariant: z.string().min(1),
    variants: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().min(1),
      sections: z.array(z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        order: z.number().int().min(1),
        canonicalKeys: z.array(z.string()).min(1),
        required: z.boolean(),
        group: z.enum(['header', 'body', 'claims', 'abstract']),
        maxLengthChars: z.number().int().min(0).optional(),
        ui: z.object({
          placeholder: z.string(),
          helpText: z.string().optional()
        }).optional()
      })).min(1)
    })).min(1)
  }),

  rules: z.object({
    global: z.object({
      paragraphNumberingRequired: z.boolean(),
      maxPagesRecommended: z.number().int().min(1),
      allowEquations: z.boolean(),
      allowTables: z.boolean()
    }),

    abstract: z.object({
      wordLimit: z.number().int().min(1),
      noBenefitsOrAdvantages: z.boolean(),
      noClaimLanguage: z.boolean(),
      singleParagraph: z.boolean()
    }),

    claims: z.object({
      twoPartFormPreferred: z.boolean(),
      allowMultipleDependent: z.boolean(),
      prohibitMultipleDependentOnMultipleDependent: z.boolean(),
      preferredConnectors: z.array(z.string()),
      discouragedConnectors: z.array(z.string()),
      forbiddenPhrases: z.array(z.string()),
      maxIndependentClaimsBeforeExtraFee: z.number().int().min(0),
      maxTotalClaimsRecommended: z.number().int().min(1),
      allowReferenceNumeralsInClaims: z.boolean(),
      requireSupportInDescription: z.boolean(),
      unityStandard: z.string().min(1)
    }),

    description: z.object({
      requireBestModeDisclosure: z.boolean(),
      avoidClaimLanguage: z.boolean(),
      allowReferenceNumerals: z.boolean(),
      requireEmbodimentSupportForAllClaims: z.boolean(),
      industrialApplicabilitySectionRequired: z.boolean()
    }),

    drawings: z.object({
      requiredWhenApplicable: z.boolean(),
      paperSize: z.string().min(1),
      colorAllowed: z.boolean(),
      lineStyle: z.string().min(1),
      referenceNumeralsMandatoryWhenDrawings: z.boolean(),
      minReferenceTextSizePt: z.number().min(1),
      marginTopCm: z.number().min(0),
      marginBottomCm: z.number().min(0),
      marginLeftCm: z.number().min(0),
      marginRightCm: z.number().min(0)
    }),

    procedural: z.object({
      gracePeriodMonths: z.number().int().min(0),
      foreignFilingLicenseRequired: z.boolean(),
      idsRequired: z.boolean(),
      priorArtDisclosureThreshold: z.string().min(1),
      allowProvisionalPriority: z.boolean()
    }),

    language: z.object({
      allowedLanguages: z.array(z.string()).min(1),
      requiresOfficialTranslation: z.boolean()
    }),

    // Optional: sequence listing rules (especially for PCT, biotech-heavy offices)
    sequenceListing: z.object({
      requiredIfSeqDisclosed: z.boolean(),
      format: z.string().min(1),
      allowLateFurnishing: z.boolean(),
      lateFurnishingNotes: z.string().optional(),
      affectsFilingDate: z.boolean(),
      additionalFormatsAllowedForReference: z.array(z.string()).optional()
    }).optional(),

    // Optional: generic page layout rules for textual parts
    pageLayout: z.object({
      defaultPageSize: z.string().min(1),
      allowedPageSizes: z.array(z.string()).min(1),
      minMarginTopCm: z.number().min(0),
      minMarginBottomCm: z.number().min(0),
      minMarginLeftCm: z.number().min(0),
      minMarginRightCm: z.number().min(0),
      recommendedFontFamily: z.string().min(1),
      recommendedFontSizePt: z.number().min(1),
      recommendedLineSpacing: z.number().min(0.1)
    }).optional(),

    // Optional: PCT/regional logic for designated states
    designatedStates: z.object({
      mode: z.enum(['all_by_default', 'explicit_selection']),
      totalStates: z.number().int().min(1),
      electionAllowed: z.boolean(),
      electionRequiredForChapterII: z.boolean().optional(),
      chapterIIDeadlineMonths: z.number().int().min(1).optional(),
      notes: z.string().optional()
    }).optional()
  }),

  validation: z.object({
    sectionChecks: z.record(z.array(z.object({
      id: z.string().min(1),
      type: z.enum(['maxWords', 'maxCount', 'required', 'format', 'maxChars']),
      limit: z.number().min(0).optional(),
      severity: z.enum(['error', 'warning', 'info']),
      message: z.string().min(1)
    }))),

    crossSectionChecks: z.array(z.object({
      id: z.string().min(1),
      type: z.enum(['support', 'consistency', 'reference', 'uniqueness']),
      from: z.string().min(1),
      mustBeSupportedBy: z.array(z.string()).optional(),
      mustBeConsistentWith: z.array(z.string()).optional(),
      mustReference: z.array(z.string()).optional(),
      severity: z.enum(['error', 'warning', 'info']),
      message: z.string().min(1)
    }))
  }),

  prompts: z.object({
    baseStyle: z.object({
      tone: z.string().min(1),
      voice: z.string().min(1),
      avoid: z.array(z.string())
    }),

    sections: z.record(z.object({
      instruction: z.string().min(1),
      constraints: z.array(z.string())
    }))
  }),

  export: z.object({
    documentTypes: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      includesSections: z.array(z.string()).min(1),
      pageSize: z.string().min(1),
      lineSpacing: z.number().min(0.1),
      fontFamily: z.string().min(1),
      fontSizePt: z.number().int().min(8),
      addPageNumbers: z.boolean(),
      addParagraphNumbers: z.boolean(),
      // Optional margin fields for precise export
      marginTopCm: z.number().min(0).optional(),
      marginBottomCm: z.number().min(0).optional(),
      marginLeftCm: z.number().min(0).optional(),
      marginRightCm: z.number().min(0).optional()
    })).min(1),

    sectionHeadings: z.record(z.string())
  }),

  diagrams: z.object({
    requiredWhenApplicable: z.boolean(),
    supportedDiagramTypes: z.array(z.string()).min(1),
    figureLabelFormat: z.string().min(1),
    autoGenerateReferenceTable: z.boolean(),
    diagramGenerationHints: z.record(z.string())
  }),

  crossChecks: z.object({
    enableSemanticCrossCheck: z.boolean(),
    checkList: z.array(z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      from: z.string().min(1),
      mustBeExplainedIn: z.array(z.string()).optional(),
      mustBeShownIn: z.array(z.string()).optional(),
      mustBeSupportedBy: z.array(z.string()).optional()
    }))
  })
})

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates a country profile JSON object against the required schema
 */
export function validateCountryProfile(profileData: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    // Validate basic schema structure
    const result = countryProfileSchema.safeParse(profileData)

    if (!result.success) {
      // Format Zod errors into readable messages
      result.error.errors.forEach(error => {
        const path = error.path.join('.')
        const message = `${path}: ${error.message}`
        errors.push(message)
      })
      return { valid: false, errors, warnings }
    }

    // Additional semantic validations
    const profile = result.data

    // Check meta consistency
    if (profile.meta.id !== profile.meta.code) {
      warnings.push('meta.id should typically match meta.code for consistency')
    }

    // Check that default variant exists
    const variantIds = profile.structure.variants.map(v => v.id)
    if (!variantIds.includes(profile.structure.defaultVariant)) {
      errors.push(`structure.defaultVariant "${profile.structure.defaultVariant}" not found in variants array`)
    }

    // Check section canonical keys consistency
    const canonicalKeyMap: { [key: string]: string[] } = {}
    profile.structure.variants.forEach(variant => {
      variant.sections.forEach(section => {
        section.canonicalKeys.forEach(key => {
          if (!canonicalKeyMap[key]) {
            canonicalKeyMap[key] = []
          }
          canonicalKeyMap[key].push(section.id)
        })
      })
    })

    // Check for duplicate canonical keys across sections
    Object.entries(canonicalKeyMap).forEach(([key, sections]) => {
      if (sections.length > 1) {
        warnings.push(`Canonical key "${key}" is used in multiple sections: ${sections.join(', ')}`)
      }
    })

    // Check that validation sectionChecks reference valid sections
    const allSectionIds = new Set(
      profile.structure.variants.flatMap(v => v.sections.map(s => s.id))
    )

    Object.keys(profile.validation.sectionChecks).forEach(sectionId => {
      if (!allSectionIds.has(sectionId)) {
        warnings.push(`validation.sectionChecks references unknown section "${sectionId}"`)
      }
    })

    // Check cross-section checks reference valid sections
    profile.validation.crossSectionChecks.forEach(check => {
      if (!allSectionIds.has(check.from)) {
        warnings.push(`validation.crossSectionChecks "${check.id}" references unknown section "${check.from}"`)
      }

      const checkArrays = [check.mustBeSupportedBy, check.mustBeConsistentWith, check.mustReference]
      checkArrays.forEach(array => {
        if (array) {
          array.forEach(sectionId => {
            if (!allSectionIds.has(sectionId)) {
              warnings.push(`validation.crossSectionChecks "${check.id}" references unknown section "${sectionId}"`)
            }
          })
        }
      })
    })

    // Check prompts.sections reference valid sections
    Object.keys(profile.prompts.sections).forEach(sectionId => {
      if (!allSectionIds.has(sectionId)) {
        warnings.push(`prompts.sections references unknown section "${sectionId}"`)
      }
    })

    // Check export section headings reference valid sections
    Object.keys(profile.export.sectionHeadings).forEach(sectionId => {
      if (!allSectionIds.has(sectionId)) {
        warnings.push(`export.sectionHeadings references unknown section "${sectionId}"`)
      }
    })

    // Check export document types reference valid sections
    profile.export.documentTypes.forEach(docType => {
      docType.includesSections.forEach(sectionId => {
        if (!allSectionIds.has(sectionId)) {
          warnings.push(`export.documentTypes "${docType.id}" references unknown section "${sectionId}"`)
        }
      })
    })

    // Check cross-checks reference valid sections
    profile.crossChecks.checkList.forEach(check => {
      if (!allSectionIds.has(check.from)) {
        warnings.push(`crossChecks.checkList "${check.id}" references unknown section "${check.from}"`)
      }

      const checkArrays = [check.mustBeExplainedIn, check.mustBeShownIn, check.mustBeSupportedBy]
      checkArrays.forEach(array => {
        if (array) {
          array.forEach(sectionId => {
            if (!allSectionIds.has(sectionId)) {
              warnings.push(`crossChecks.checkList "${check.id}" references unknown section "${sectionId}"`)
            }
          })
        }
      })
    })

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }

  } catch (error) {
    errors.push(`Validation failed with error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { valid: false, errors, warnings }
  }
}

/**
 * Validates that a country code is unique (doesn't already exist in the database)
 */
export async function validateCountryCodeUnique(countryCode: string, excludeId?: string): Promise<{ valid: boolean; message?: string }> {
  try {
    // This would be implemented with database check
    // For now, return valid since we're focusing on structure validation
    return { valid: true }
  } catch (error) {
    return { valid: false, message: 'Database validation failed' }
  }
}
