/**
 * Paper Writing Sample Service
 * 
 * Fetches user's writing samples for example-based style mimicry in academic papers.
 * 
 * Supports:
 * - Persona-based samples (Journal Style, Conference Style, etc.)
 * - Primary + Secondary personas for multidisciplinary papers
 * - Organization-shared personas
 * - Paper-type-specific > universal priority
 */

import { prisma } from './prisma'

// Cache for paper writing samples (5 minute TTL)
const sampleCache = new Map<string, { samples: Map<string, string>, timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export interface PaperWritingSampleContext {
  sampleText: string
  paperTypeCode: string
  isUniversal: boolean
  personaName?: string
  personaId?: string
}

export interface PaperPersonaSelection {
  primaryPersonaId?: string    // Main style - structure and tone
  secondaryPersonaIds?: string[] // Additional styles - domain terminology
}

/**
 * Get writing sample for a paper section with persona support
 * 
 * Priority:
 * 1. Primary persona + paper-type-specific
 * 2. Primary persona + universal
 * 3. Any persona + paper-type-specific (backward compat)
 * 4. Any persona + universal (backward compat)
 * 
 * @param userId - User ID
 * @param sectionKey - Canonical section key (e.g., "abstract", "introduction")
 * @param paperTypeCode - Target paper type (e.g., "JOURNAL_ARTICLE", "CONFERENCE_PAPER")
 * @param personaSelection - Optional persona selection (primary + secondary)
 * @returns PaperWritingSampleContext or null if no sample found
 */
export async function getPaperWritingSample(
  userId: string,
  sectionKey: string,
  paperTypeCode: string,
  personaSelection?: PaperPersonaSelection
): Promise<PaperWritingSampleContext | null> {
  const normalizedType = paperTypeCode.toUpperCase()
  
  // If persona selection provided, use persona-aware fetching
  if (personaSelection?.primaryPersonaId) {
    return getPaperWritingSampleWithPersona(userId, sectionKey, normalizedType, personaSelection)
  }

  const cacheKey = `paper:${userId}:${normalizedType}`
  
  // Check cache (only for non-persona requests)
  const cached = sampleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Try paper-type-specific first
    const typeSample = cached.samples.get(`${sectionKey}:${normalizedType}`)
    if (typeSample) {
      return {
        sampleText: typeSample,
        paperTypeCode: normalizedType,
        isUniversal: false
      }
    }
    // Fall back to universal
    const universalSample = cached.samples.get(`${sectionKey}:*`)
    if (universalSample) {
      return {
        sampleText: universalSample,
        paperTypeCode: '*',
        isUniversal: true
      }
    }
    return null
  }

  // Load from database
  try {
    // Try paper-type-specific first
    let sample = await prisma.paperWritingSample.findFirst({
      where: {
        userId,
        sectionKey,
        paperTypeCode: normalizedType,
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        paperTypeCode: normalizedType,
        isUniversal: false,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined
      }
    }

    // Fall back to universal
    sample = await prisma.paperWritingSample.findFirst({
      where: {
        userId,
        sectionKey,
        paperTypeCode: '*',
        isActive: true
      },
      include: { persona: { select: { name: true } } }
    })

    if (sample) {
      return {
        sampleText: sample.sampleText,
        paperTypeCode: '*',
        isUniversal: true,
        personaName: sample.persona?.name || sample.personaName,
        personaId: sample.personaId || undefined
      }
    }
  } catch (error) {
    console.warn(`[PaperWritingSampleService] Failed to get sample for ${userId}/${sectionKey}/${paperTypeCode}:`, error)
  }

  return null
}

/**
 * Get writing sample with persona selection support
 * Supports Primary + Secondary personas for multidisciplinary papers
 */
async function getPaperWritingSampleWithPersona(
  userId: string,
  sectionKey: string,
  paperTypeCode: string,
  personaSelection: PaperPersonaSelection
): Promise<PaperWritingSampleContext | null> {
  try {
    const { primaryPersonaId, secondaryPersonaIds = [] } = personaSelection

    // Get primary persona sample (for structure and tone)
    let primarySample = await prisma.paperWritingSample.findFirst({
      where: {
        personaId: primaryPersonaId,
        sectionKey,
        paperTypeCode,
        isActive: true
      },
      include: { persona: { select: { name: true, createdBy: true } } }
    })

    // Fall back to universal for primary
    if (!primarySample) {
      primarySample = await prisma.paperWritingSample.findFirst({
        where: {
          personaId: primaryPersonaId,
          sectionKey,
          paperTypeCode: '*',
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
      const secondaries = await prisma.paperWritingSample.findMany({
        where: {
          personaId: { in: secondaryPersonaIds },
          sectionKey,
          paperTypeCode: { in: [paperTypeCode, '*'] },
          isActive: true
        },
        include: { persona: { select: { name: true } } }
      })

      // Group by persona and take type-specific over universal
      const byPersona = new Map<string, typeof secondaries[0]>()
      for (const s of secondaries) {
        const existing = byPersona.get(s.personaId!)
        if (!existing || (s.paperTypeCode !== '*' && existing.paperTypeCode === '*')) {
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
      paperTypeCode: primarySample.paperTypeCode,
      isUniversal: primarySample.paperTypeCode === '*',
      personaName: primarySample.persona?.name || primarySample.personaName,
      personaId: primarySample.personaId || undefined
    }

  } catch (error) {
    console.warn('[PaperWritingSampleService] Failed to get persona sample:', error)
    return null
  }
}

/**
 * Get all active paper writing samples for a user
 */
export async function getAllPaperWritingSamples(
  userId: string,
  paperTypeCode?: string
): Promise<Map<string, PaperWritingSampleContext>> {
  const result = new Map<string, PaperWritingSampleContext>()

  try {
    const where: any = {
      userId,
      isActive: true
    }

    if (paperTypeCode) {
      // Get both type-specific and universal
      where.paperTypeCode = { in: [paperTypeCode.toUpperCase(), '*'] }
    }

    const samples = await prisma.paperWritingSample.findMany({
      where,
      orderBy: { paperTypeCode: 'desc' } // Universal (*) comes after specific types
    })

    // Build map with type-specific taking priority over universal
    for (const sample of samples) {
      const key = sample.sectionKey
      // Only add if not already present (type-specific added first due to ordering)
      if (!result.has(key) || sample.paperTypeCode !== '*') {
        result.set(key, {
          sampleText: sample.sampleText,
          paperTypeCode: sample.paperTypeCode,
          isUniversal: sample.paperTypeCode === '*'
        })
      }
    }

    // Update cache
    const normalizedType = paperTypeCode?.toUpperCase() || 'ALL'
    const cacheKey = `paper:${userId}:${normalizedType}`
    const sampleMap = new Map<string, string>()
    for (const sample of samples) {
      sampleMap.set(`${sample.sectionKey}:${sample.paperTypeCode}`, sample.sampleText)
    }
    sampleCache.set(cacheKey, { samples: sampleMap, timestamp: Date.now() })
  } catch (error) {
    console.error('[PaperWritingSampleService] Failed to get all samples:', error)
  }

  return result
}

/**
 * Invalidate cache for a user
 */
export function invalidatePaperWritingSampleCache(userId: string): void {
  for (const key of Array.from(sampleCache.keys())) {
    if (key.startsWith(`paper:${userId}:`)) {
      sampleCache.delete(key)
    }
  }
}

/**
 * Build the prompt block for writing sample injection
 * 
 * Creates a strong few-shot prompt that instructs the LLM to mimic the user's style
 */
export function buildPaperWritingSampleBlock(
  sample: PaperWritingSampleContext,
  sectionKey: string
): string {
  if (!sample || !sample.sampleText) return ''

  const typeNote = sample.isUniversal 
    ? '(universal style, applies to all paper types)'
    : `(${sample.paperTypeCode}-specific style)`

  const personaNote = sample.personaName 
    ? `Style: "${sample.personaName}"`
    : ''

  // Check if this is a multi-persona sample (contains secondary styles)
  const hasSecondaryStyles = sample.sampleText.includes('--- ADDITIONAL DOMAIN STYLES ---')

  const styleExplanation = hasSecondaryStyles
    ? `The user has selected a PRIMARY style for structure and tone, plus ADDITIONAL domain styles.
You MUST:
• Follow the PRIMARY style for overall structure, sentence patterns, and voice
• Incorporate terminology and domain-specific phrases from the ADDITIONAL styles`
    : `The user has provided an example of their preferred academic writing style.
You MUST closely mimic their style, including:

• **Word choices and academic register** - Match their vocabulary and formality level
• **Sentence length and complexity** - Mirror their complexity and readability
• **Active/passive voice preference** - Follow their voice patterns
• **Hedging and certainty language** - Match their assertion strength
• **Citation integration style** - Follow their citation placement patterns
• **Paragraph structure** - Mirror their paragraph organization`

  const formattedLines = sample.sampleText.split('\n').map(line => `│ ${line}`).join('\n')

  return `

╔═══════════════════════════════════════════════════════════════════════════╗
║  YOUR ACADEMIC WRITING STYLE - MIMIC THIS EXACTLY                         ║
║  ${typeNote.padEnd(69)}║
${personaNote ? `║  ${personaNote.padEnd(69)}║\n` : ''}╚═══════════════════════════════════════════════════════════════════════════╝

${styleExplanation}

USER'S STYLE EXAMPLE:
┌─────────────────────────────────────────────────────────────────────────────
${formattedLines}
└─────────────────────────────────────────────────────────────────────────────

⚠️ CRITICAL: Generate content that reads as if written by the SAME AUTHOR as the example above.
   Do NOT use generic academic language. Instead, mirror the specific style shown.
`
}

/**
 * Get section-specific style hints for academic writing
 */
export function getPaperSectionStyleHints(sectionKey: string): string {
  const hints: Record<string, string> = {
    abstract: 'Pay special attention to: opening phrase, how contributions are stated, and conclusion phrasing.',
    introduction: 'Pay special attention to: problem framing, gap identification, and contribution enumeration style.',
    literature_review: 'Pay special attention to: synthesis vs summary balance, citation integration, and critical analysis tone.',
    methodology: 'Pay special attention to: justification style, procedural clarity, and validity discussion.',
    results: 'Pay special attention to: data presentation style, statistical reporting, and objectivity.',
    discussion: 'Pay special attention to: interpretation confidence, limitation acknowledgment, and comparison style.',
    conclusion: 'Pay special attention to: contribution recap, implication scope, and future work framing.'
  }

  return hints[sectionKey] || ''
}

/**
 * Get all personas available to a user (own + org-shared)
 */
export async function getAvailablePaperPersonas(
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
    const personas = await prisma.paperWritingPersona.findMany({
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
    console.error('[PaperWritingSampleService] Failed to get personas:', error)
    return []
  }
}

/**
 * Check if user has any active paper writing samples
 */
export async function hasActivePaperWritingSamples(userId: string): Promise<boolean> {
  try {
    const count = await prisma.paperWritingSample.count({
      where: {
        userId,
        isActive: true
      }
    })
    return count > 0
  } catch (error) {
    console.warn('[PaperWritingSampleService] Failed to check samples:', error)
    return false
  }
}

/**
 * Get sample coverage report for paper sections
 */
export async function getPaperSampleCoverage(userId: string): Promise<{
  sections: string[]
  paperTypes: string[]
  coverage: Record<string, string[]> // section -> paper types that have samples
}> {
  try {
    const samples = await prisma.paperWritingSample.findMany({
      where: { userId, isActive: true },
      select: { sectionKey: true, paperTypeCode: true }
    })

    const coverage: Record<string, string[]> = {}
    const sections = new Set<string>()
    const paperTypes = new Set<string>()

    for (const sample of samples) {
      sections.add(sample.sectionKey)
      paperTypes.add(sample.paperTypeCode)
      
      if (!coverage[sample.sectionKey]) {
        coverage[sample.sectionKey] = []
      }
      coverage[sample.sectionKey].push(sample.paperTypeCode)
    }

    return {
      sections: Array.from(sections),
      paperTypes: Array.from(paperTypes),
      coverage
    }
  } catch (error) {
    console.error('[PaperWritingSampleService] Failed to get coverage:', error)
    return { sections: [], paperTypes: [], coverage: {} }
  }
}

