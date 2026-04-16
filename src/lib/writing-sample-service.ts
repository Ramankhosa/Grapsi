/**
 * Writing Sample Service
 * 
 * Fetches user's writing samples for example-based style mimicry.
 * 
 * Supports:
 * - Persona-based samples (CSE Patents, Bio Patents, etc.)
 * - Primary + Secondary personas for multidisciplinary patents
 * - Organization-shared personas
 * - Jurisdiction-specific > universal priority
 */

import { prisma } from './prisma'

// Cache for writing samples (5 minute TTL)
const sampleCache = new Map<string, { samples: Map<string, string>, timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export interface WritingSampleContext {
  sampleText: string
  jurisdiction: string
  isUniversal: boolean
  personaName?: string
  personaId?: string
}

export interface PersonaSelection {
  primaryPersonaId?: string    // Main style - structure and tone
  secondaryPersonaIds?: string[] // Additional styles - domain terminology
}

/**
 * Get writing sample for a specific section with persona support
 * 
 * Priority:
 * 1. Primary persona + jurisdiction-specific
 * 2. Primary persona + universal
 * 3. Any persona + jurisdiction-specific (backward compat)
 * 4. Any persona + universal (backward compat)
 * 
 * @param userId - User ID
 * @param sectionKey - Canonical section key (e.g., "claims", "detailedDescription")
 * @param jurisdiction - Target jurisdiction (e.g., "IN", "US")
 * @param personaSelection - Optional persona selection (primary + secondary)
 * @returns WritingSampleContext or null if no sample found
 */
export async function getWritingSample(
  userId: string,
  sectionKey: string,
  jurisdiction: string,
  personaSelection?: PersonaSelection
): Promise<WritingSampleContext | null> {
  const normalizedJurisdiction = jurisdiction.toUpperCase()
  
  // If persona selection provided, use persona-aware fetching
  if (personaSelection?.primaryPersonaId) {
    return getWritingSampleWithPersona(userId, sectionKey, normalizedJurisdiction, personaSelection)
  }

  const cacheKey = `${userId}:${normalizedJurisdiction}`
  
  // Check cache (only for non-persona requests)
  const cached = sampleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Try jurisdiction-specific first
    const jurisdictionSample = cached.samples.get(`${sectionKey}:${normalizedJurisdiction}`)
    if (jurisdictionSample) {
      return {
        sampleText: jurisdictionSample,
        jurisdiction: normalizedJurisdiction,
        isUniversal: false
      }
    }
    // Fall back to universal
    const universalSample = cached.samples.get(`${sectionKey}:*`)
    if (universalSample) {
      return {
        sampleText: universalSample,
        jurisdiction: '*',
        isUniversal: true
      }
    }
    return null
  }

  // Load from database
  try {
    // Try jurisdiction-specific first
    let sample = await prisma.writingSample.findFirst({
      where: {
        userId,
        sectionKey,
        jurisdiction: normalizedJurisdiction,
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        jurisdiction: normalizedJurisdiction,
        isUniversal: false,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined
      }
    }

    // Fall back to universal
    sample = await prisma.writingSample.findFirst({
      where: {
        userId,
        sectionKey,
        jurisdiction: '*',
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        jurisdiction: '*',
        isUniversal: true,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined
      }
    }
  } catch (error) {
    console.warn(`[WritingSampleService] Failed to get sample for ${userId}/${sectionKey}/${jurisdiction}:`, error)
  }

  return null
}

/**
 * Get writing sample with persona selection support
 * Supports Primary + Secondary personas for multidisciplinary patents
 */
async function getWritingSampleWithPersona(
  userId: string,
  sectionKey: string,
  jurisdiction: string,
  personaSelection: PersonaSelection
): Promise<WritingSampleContext | null> {
  try {
    const { primaryPersonaId, secondaryPersonaIds = [] } = personaSelection

    // Get primary persona sample (for structure and tone)
    let primarySample = await prisma.writingSample.findFirst({
      where: {
        personaId: primaryPersonaId,
        sectionKey,
        jurisdiction,
        isActive: true
      },
      include: { persona: { select: { name: true, createdBy: true } } }
    })

    // Fall back to universal for primary
    if (!primarySample) {
      primarySample = await prisma.writingSample.findFirst({
        where: {
          personaId: primaryPersonaId,
          sectionKey,
          jurisdiction: '*',
          isActive: true
        },
        include: { persona: { select: { name: true, createdBy: true } } }
      })
    }

    if (!primarySample) {
      return null
    }

    // Get secondary persona samples (for domain terminology)
    const secondarySamples: string[] = []
    
    if (secondaryPersonaIds.length > 0) {
      const secondaries = await prisma.writingSample.findMany({
        where: {
          personaId: { in: secondaryPersonaIds },
          sectionKey,
          jurisdiction: { in: [jurisdiction, '*'] },
          isActive: true
        },
        include: { persona: { select: { name: true } } }
      })

      // Group by persona and take jurisdiction-specific over universal
      const byPersona = new Map<string, typeof secondaries[0]>()
      for (const s of secondaries) {
        const existing = byPersona.get(s.personaId!)
        if (!existing || (s.jurisdiction !== '*' && existing.jurisdiction === '*')) {
          byPersona.set(s.personaId!, s)
        }
      }

      for (const s of Array.from(byPersona.values())) {
        secondarySamples.push(`[${s.persona?.name || 'Additional Style'}]: ${s.sampleText}`)
      }
    }

    // Build combined sample text
    let combinedText = primarySample.sampleText
    if (secondarySamples.length > 0) {
      combinedText += '\n\n--- ADDITIONAL DOMAIN STYLES ---\n' + secondarySamples.join('\n\n')
    }

    return {
      sampleText: combinedText,
      jurisdiction: primarySample.jurisdiction,
      isUniversal: primarySample.jurisdiction === '*',
      personaName: primarySample.persona?.name || primarySample.personaName,
      personaId: primarySample.personaId || undefined
    }

  } catch (error) {
    console.warn('[WritingSampleService] Failed to get persona sample:', error)
    return null
  }
}

/**
 * Get all active writing samples for a user
 * Used for caching and bulk operations
 */
export async function getAllWritingSamples(
  userId: string,
  jurisdiction?: string
): Promise<Map<string, WritingSampleContext>> {
  const result = new Map<string, WritingSampleContext>()

  try {
    const where: any = {
      userId,
      isActive: true
    }

    if (jurisdiction) {
      // Get both jurisdiction-specific and universal
      where.jurisdiction = { in: [jurisdiction.toUpperCase(), '*'] }
    }

    const samples = await prisma.writingSample.findMany({
      where,
      orderBy: { jurisdiction: 'desc' } // Universal (*) comes after specific jurisdictions
    })

    // Build map with jurisdiction-specific taking priority over universal
    for (const sample of samples) {
      const key = sample.sectionKey
      // Only add if not already present (jurisdiction-specific added first due to ordering)
      if (!result.has(key) || sample.jurisdiction !== '*') {
        result.set(key, {
          sampleText: sample.sampleText,
          jurisdiction: sample.jurisdiction,
          isUniversal: sample.jurisdiction === '*'
        })
      }
    }

    // Update cache
    const normalizedJurisdiction = jurisdiction?.toUpperCase() || 'ALL'
    const cacheKey = `${userId}:${normalizedJurisdiction}`
    const sampleMap = new Map<string, string>()
    for (const sample of samples) {
      sampleMap.set(`${sample.sectionKey}:${sample.jurisdiction}`, sample.sampleText)
    }
    sampleCache.set(cacheKey, { samples: sampleMap, timestamp: Date.now() })
  } catch (error) {
    console.error('[WritingSampleService] Failed to get all samples:', error)
  }

  return result
}

/**
 * Invalidate cache for a user
 */
export function invalidateWritingSampleCache(userId: string): void {
  // Remove all cache entries for this user
  for (const key of Array.from(sampleCache.keys())) {
    if (key.startsWith(`${userId}:`)) {
      sampleCache.delete(key)
    }
  }
}

/**
 * Build the prompt block for writing sample injection
 * 
 * This creates a strong few-shot prompt that instructs the LLM to mimic the user's style
 * Supports multi-persona with primary (structure) + secondary (terminology)
 */
export function buildWritingSampleBlock(
  sample: WritingSampleContext,
  sectionKey: string
): string {
  if (!sample || !sample.sampleText) return ''

  const jurisdictionNote = sample.isUniversal 
    ? '(universal style, applies to all jurisdictions)'
    : `(${sample.jurisdiction}-specific style)`

  const personaNote = sample.personaName 
    ? `Style: "${sample.personaName}"`
    : ''

  // Check if this is a multi-persona sample (contains secondary styles)
  const hasSecondaryStyles = sample.sampleText.includes('--- ADDITIONAL DOMAIN STYLES ---')

  const styleExplanation = hasSecondaryStyles
    ? `The user has selected a PRIMARY style for structure and tone, plus ADDITIONAL domain styles for terminology.
You MUST:
• Follow the PRIMARY style for overall structure, sentence patterns, and voice
• Incorporate terminology and domain-specific phrases from the ADDITIONAL styles`
    : `The user has provided an example of their preferred writing style for this section.
You MUST closely mimic their style, including:

• **Word choices and phrasing patterns** - Use similar vocabulary and expressions
• **Sentence length and structure** - Match their complexity level
• **Active/passive voice preference** - Mirror their voice usage
• **Technical terminology style** - Follow their terminology patterns
• **Punctuation and connectors** - Use similar punctuation and transition words
• **Opening patterns** - Start sections/paragraphs similarly`

  // Build visual box without truncating content - preserve full sample for style learning
  const lines = sample.sampleText.split('\n')
  // Don't truncate lines - long lines are important for capturing writing style patterns
  const formattedLines = lines.map(line => `│ ${line}`).join('\n')

  return `

╔═══════════════════════════════════════════════════════════════════════════╗
║  YOUR WRITING STYLE - MIMIC THIS EXACTLY                                  ║
║  ${jurisdictionNote.padEnd(69)}║
${personaNote ? `║  ${personaNote.padEnd(69)}║\n` : ''}╚═══════════════════════════════════════════════════════════════════════════╝

${styleExplanation}

USER'S STYLE EXAMPLE:
┌─────────────────────────────────────────────────────────────────────────────
${formattedLines}
└─────────────────────────────────────────────────────────────────────────────

⚠️ CRITICAL: Generate content that reads as if written by the SAME AUTHOR as the example above.
   Do NOT use generic patent language. Instead, mirror the specific style shown.
`
}

/**
 * Get section-specific style guidance based on sample analysis
 * This provides additional hints to the LLM about what to focus on
 */
export function getSectionStyleHints(sectionKey: string): string {
  const hints: Record<string, string> = {
    claims: 'Pay special attention to: preamble style, transition words, element numbering, and claim structure.',
    detailedDescription: 'Pay special attention to: figure references, embodiment introductions, technical detail level, and cross-linking style.',
    abstract: 'Pay special attention to: opening phrase, sentence structure, and how technical terms are introduced.',
    background: 'Pay special attention to: prior art discussion tone, problem statement style, and transition to invention.',
    summary: 'Pay special attention to: how advantages are described and how the invention is characterized.',
    briefDescriptionOfDrawings: 'Pay special attention to: figure caption format and consistency.',
    fieldOfInvention: 'Pay special attention to: technical field phrasing and scope indication.',
    objectsOfInvention: 'Pay special attention to: objective listing style and language patterns.'
  }

  return hints[sectionKey] || ''
}

/**
 * Get samples from an organization-shared persona
 * Used when user selects an org persona they don't own
 */
export async function getOrgPersonaSample(
  personaId: string,
  tenantId: string,
  sectionKey: string,
  jurisdiction: string
): Promise<WritingSampleContext | null> {
  try {
    // Verify persona is org-visible
    const persona = await prisma.writingPersona.findFirst({
      where: {
        id: personaId,
        tenantId,
        visibility: 'ORGANIZATION',
        isActive: true
      }
    })

    if (!persona) {
      return null
    }

    // Get sample
    let sample = await prisma.writingSample.findFirst({
      where: {
        personaId,
        sectionKey,
        jurisdiction: jurisdiction.toUpperCase(),
        isActive: true
      }
    })

    // Fall back to universal
    if (!sample) {
      sample = await prisma.writingSample.findFirst({
        where: {
          personaId,
          sectionKey,
          jurisdiction: '*',
          isActive: true
        }
      })
    }

    if (!sample) {
      return null
    }

    return {
      sampleText: sample.sampleText,
      jurisdiction: sample.jurisdiction,
      isUniversal: sample.jurisdiction === '*',
      personaName: persona.name,
      personaId: persona.id
    }

  } catch (error) {
    console.warn('[WritingSampleService] Failed to get org persona sample:', error)
    return null
  }
}

/**
 * Get all personas available to a user (own + org-shared)
 */
export async function getAvailablePersonas(
  userId: string,
  tenantId: string
): Promise<Array<{
  id: string
  name: string
  description: string | null
  isOwn: boolean
  isTemplate: boolean
  sampleCount: number
}>> {
  try {
    const personas = await prisma.writingPersona.findMany({
      where: {
        OR: [
          { createdBy: userId, isActive: true },
          { tenantId, visibility: 'ORGANIZATION', isActive: true }
        ]
      },
      include: {
        _count: { select: { samples: true } }
      },
      orderBy: [
        { isTemplate: 'desc' },
        { name: 'asc' }
      ]
    })

    return personas.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isOwn: p.createdBy === userId,
      isTemplate: p.isTemplate,
      sampleCount: p._count.samples
    }))

  } catch (error) {
    console.error('[WritingSampleService] Failed to get personas:', error)
    return []
  }
}

/**
 * Check if user has any active writing samples
 */
export async function hasActiveWritingSamples(userId: string): Promise<boolean> {
  try {
    const count = await prisma.writingSample.count({
      where: {
        userId,
        isActive: true
      }
    })
    return count > 0
  } catch (error) {
    console.warn('[WritingSampleService] Failed to check samples:', error)
    return false
  }
}

/**
 * Get sample coverage report for a user
 * Shows which sections have samples for which jurisdictions
 */
export async function getSampleCoverage(userId: string): Promise<{
  sections: string[]
  jurisdictions: string[]
  coverage: Record<string, string[]> // section -> jurisdictions that have samples
}> {
  try {
    const samples = await prisma.writingSample.findMany({
      where: { userId, isActive: true },
      select: { sectionKey: true, jurisdiction: true }
    })

    const coverage: Record<string, string[]> = {}
    const sections = new Set<string>()
    const jurisdictions = new Set<string>()

    for (const sample of samples) {
      sections.add(sample.sectionKey)
      jurisdictions.add(sample.jurisdiction)
      
      if (!coverage[sample.sectionKey]) {
        coverage[sample.sectionKey] = []
      }
      coverage[sample.sectionKey].push(sample.jurisdiction)
    }

    return {
      sections: Array.from(sections),
      jurisdictions: Array.from(jurisdictions),
      coverage
    }
  } catch (error) {
    console.error('[WritingSampleService] Failed to get coverage:', error)
    return { sections: [], jurisdictions: [], coverage: {} }
  }
}

