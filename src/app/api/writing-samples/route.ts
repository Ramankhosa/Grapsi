import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { SECTION_WORD_LIMITS, DEFAULT_LIMITS, MAX_CHARS } from './limits/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Get limits for a specific section
function getSectionLimits(sectionKey: string) {
  return SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS
}

// Helper to count words (handles multi-language content)
function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0
  // Clean up excessive whitespace and count meaningful words
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

// Helper to validate jurisdiction
function isValidJurisdiction(j: string): boolean {
  if (!j || typeof j !== 'string') return false
  // "*" for universal, or 2-3 letter country codes
  return j === '*' || /^[A-Z]{2,3}$/.test(j.toUpperCase())
}

// Fetch valid section keys dynamically from database
async function getValidSectionKeys(): Promise<string[]> {
  try {
    // Get section keys from superset sections (source of truth)
    const sections = await prisma.supersetSection.findMany({
      where: { isActive: true },
      select: { sectionKey: true }
    })
    
    if (sections.length > 0) {
      return sections.map(s => s.sectionKey)
    }
    
    // Fallback to hardcoded list if DB query fails or empty
    return Object.keys(SECTION_WORD_LIMITS)
  } catch (error) {
    console.warn('[WritingSamples] Failed to fetch section keys from DB, using fallback')
    return Object.keys(SECTION_WORD_LIMITS)
  }
}

// Validate sample text content
function validateSampleText(
  sampleText: string, 
  sectionKey: string
): { valid: boolean; error?: string; warning?: string; wordCount: number } {
  if (!sampleText || typeof sampleText !== 'string') {
    return { valid: false, error: 'Sample text is required', wordCount: 0 }
  }
  
  const trimmedText = sampleText.trim()
  
  if (trimmedText.length === 0) {
    return { valid: false, error: 'Sample text cannot be empty', wordCount: 0 }
  }
  
  const wordCount = countWords(trimmedText)
  const limits = getSectionLimits(sectionKey)
  
  // Hard validation - reject if outside absolute limits
  if (wordCount < limits.min) {
    return { 
      valid: false, 
      error: `Sample too short for ${sectionKey}. Minimum ${limits.min} words required (you have ${wordCount} words)`,
      wordCount 
    }
  }
  
  if (wordCount > limits.max) {
    return { 
      valid: false, 
      error: `Sample too long for ${sectionKey}. Maximum ${limits.max} words allowed (you have ${wordCount} words). Try using a more concise example.`,
      wordCount 
    }
  }
  
  // Character limit (generous but prevents abuse)
  if (trimmedText.length > MAX_CHARS) {
    return { 
      valid: false, 
      error: `Sample exceeds maximum character limit (${MAX_CHARS}). Please use a shorter example.`,
      wordCount 
    }
  }
  
  // Soft validation - warn if outside recommended range
  let warning: string | undefined
  if (wordCount < limits.recommended.min) {
    warning = `Sample is shorter than recommended (${limits.recommended.min}-${limits.recommended.max} words). It may not provide enough context for the AI to learn your style.`
  } else if (wordCount > limits.recommended.max) {
    warning = `Sample is longer than recommended (${limits.recommended.min}-${limits.recommended.max} words). The AI works best with focused examples.`
  }
  
  return { valid: true, warning, wordCount }
}

/**
 * GET /api/writing-samples
 * Get all writing samples for the current user
 * 
 * Query params:
 * - jurisdiction: optional (filter by jurisdiction)
 * - sectionKey: optional (filter by section)
 * - includeInactive: optional (include inactive samples)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')
    const personaId = url.searchParams.get('personaId')
    const includeInactive = url.searchParams.get('includeInactive') === 'true'

    // If personaId is provided, fetch samples for that persona (could be org-shared)
    // Otherwise, fetch only the user's own samples
    let where: any = {
      ...(includeInactive ? {} : { isActive: true })
    }

    if (personaId) {
      // Verify the user has access to this persona (own or org-shared)
      const persona = await prisma.writingPersona.findFirst({
        where: {
          id: personaId,
          OR: [
            { createdBy: authResult.user.id },
            { tenantId: authResult.user.tenantId, visibility: 'ORGANIZATION' }
          ]
        }
      })
      
      if (!persona) {
        return NextResponse.json({ error: 'Persona not found or access denied' }, { status: 404 })
      }
      
      where.personaId = personaId
    } else {
      // No persona specified - only return user's own samples
      where.userId = authResult.user.id
    }

    if (jurisdiction) {
      where.jurisdiction = jurisdiction.toUpperCase()
    }
    if (sectionKey) {
      where.sectionKey = sectionKey
    }

    const samples = await prisma.writingSample.findMany({
      where,
      orderBy: [
        { jurisdiction: 'asc' },
        { sectionKey: 'asc' }
      ]
    })

    // Group by jurisdiction for easier frontend consumption
    const grouped: Record<string, Record<string, any>> = {}
    for (const sample of samples) {
      if (!grouped[sample.jurisdiction]) {
        grouped[sample.jurisdiction] = {}
      }
      grouped[sample.jurisdiction][sample.sectionKey] = {
        id: sample.id,
        sampleText: sample.sampleText,
        notes: sample.notes,
        wordCount: sample.wordCount,
        isActive: sample.isActive,
        updatedAt: sample.updatedAt
      }
    }

    return NextResponse.json({
      samples,
      grouped,
      meta: {
        totalCount: samples.length,
        activeCount: samples.filter(s => s.isActive).length,
        jurisdictions: Array.from(new Set(samples.map(s => s.jurisdiction))),
        sections: Array.from(new Set(samples.map(s => s.sectionKey)))
      }
    })
  } catch (error) {
    console.error('[WritingSamples:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/writing-samples
 * Create or update a writing sample
 * 
 * Supports:
 * - Personal samples (no personaId) 
 * - Persona-linked samples (with personaId)
 * - Permission checking for org personas
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any
    try {
      body = await request.json()
    } catch (parseError) {
      return NextResponse.json({ 
        error: 'Invalid request body. Please send valid JSON.' 
      }, { status: 400 })
    }

    const { jurisdiction, sectionKey, sampleText, notes, isActive, personaId, personaName: providedPersonaName } = body

    // === BASIC VALIDATION ===
    if (!jurisdiction || typeof jurisdiction !== 'string') {
      return NextResponse.json({ 
        error: 'jurisdiction is required (e.g., "IN", "US", "*" for universal)' 
      }, { status: 400 })
    }
    
    if (!sectionKey || typeof sectionKey !== 'string') {
      return NextResponse.json({ 
        error: 'sectionKey is required (e.g., "claims", "abstract", "detailedDescription")' 
      }, { status: 400 })
    }
    
    if (!sampleText) {
      return NextResponse.json({ 
        error: 'sampleText is required' 
      }, { status: 400 })
    }

    const normalizedJurisdiction = jurisdiction.toUpperCase()
    
    if (!isValidJurisdiction(normalizedJurisdiction)) {
      return NextResponse.json({ 
        error: 'Invalid jurisdiction. Use "*" for universal or 2-3 letter country code (e.g., "US", "IN", "EP", "PCT")' 
      }, { status: 400 })
    }

    // === VALIDATE SECTION KEY (Dynamic from DB) ===
    const validSectionKeys = await getValidSectionKeys()
    if (!validSectionKeys.includes(sectionKey)) {
      // Be permissive - log warning but allow unknown sections
      console.warn(`[WritingSamples] Unknown section key "${sectionKey}" - allowing but may not be used`)
    }

    // === VALIDATE SAMPLE TEXT CONTENT ===
    const validation = validateSampleText(sampleText, sectionKey)
    if (!validation.valid) {
      return NextResponse.json({ 
        error: validation.error,
        wordCount: validation.wordCount,
        limits: getSectionLimits(sectionKey)
      }, { status: 400 })
    }

    const trimmedText = sampleText.trim()
    const wordCount = validation.wordCount

    // === PERSONA PERMISSION CHECK ===
    let targetPersonaId = personaId || null
    let effectivePersonaName = providedPersonaName || 'Default'
    let isOrgPersonaSample = false

    if (personaId) {
      // Verify persona exists and user has access
      const persona = await prisma.writingPersona.findFirst({
        where: {
          id: personaId,
          isActive: true,
          OR: [
            { createdBy: authResult.user.id }, // User's own persona
            { 
              tenantId: authResult.user.tenantId, 
              visibility: 'ORGANIZATION' 
            } // Org persona
          ]
        },
        select: { 
          id: true, 
          name: true, 
          createdBy: true, 
          visibility: true,
          tenantId: true 
        }
      })

      if (!persona) {
        return NextResponse.json({ 
          error: 'Persona not found or you do not have access to it',
          code: 'PERSONA_NOT_FOUND'
        }, { status: 404 })
      }

      // Check if this is an org persona they don't own
      isOrgPersonaSample = persona.visibility === 'ORGANIZATION' && persona.createdBy !== authResult.user.id
      
      // For org personas: only the creator can add/edit samples
      // This prevents random users from modifying shared persona samples
      if (isOrgPersonaSample) {
        return NextResponse.json({ 
          error: 'You cannot add samples to organization personas you did not create. Copy the persona first to create your own version.',
          code: 'ORG_PERSONA_READONLY'
        }, { status: 403 })
      }

      effectivePersonaName = persona.name
    }

    // === UPSERT SAMPLE ===
    // Handle the unique constraint properly for null personaId case
    let existing
    if (targetPersonaId) {
      // With persona - use compound unique key
      existing = await prisma.writingSample.findUnique({
        where: {
          userId_jurisdiction_personaId_sectionKey: {
            userId: authResult.user.id,
            jurisdiction: normalizedJurisdiction,
            personaId: targetPersonaId,
            sectionKey
          }
        }
      })
    } else {
      // Without persona - find any sample without a persona for this user/jurisdiction/section
      // Note: NULL personaId doesn't participate in unique constraint properly in some DBs
      existing = await prisma.writingSample.findFirst({
        where: {
          userId: authResult.user.id,
          jurisdiction: normalizedJurisdiction,
          personaId: null,
          sectionKey
        }
      })
    }

    let result
    if (existing) {
      result = await prisma.writingSample.update({
        where: { id: existing.id },
        data: {
          sampleText: trimmedText,
          notes: notes?.trim() || null,
          wordCount,
          personaName: effectivePersonaName,
          isActive: isActive !== undefined ? isActive : true,
          updatedAt: new Date()
        }
      })
    } else {
      result = await prisma.writingSample.create({
        data: {
          userId: authResult.user.id,
          tenantId: authResult.user.tenantId || 'default',
          personaId: targetPersonaId,
          personaName: effectivePersonaName,
          jurisdiction: normalizedJurisdiction,
          sectionKey,
          sampleText: trimmedText,
          notes: notes?.trim() || null,
          wordCount,
          isActive: isActive !== undefined ? isActive : true
        }
      })
    }

    const response: any = {
      success: true,
      sample: result,
      message: `Writing sample ${existing ? 'updated' : 'created'} for ${sectionKey} (${normalizedJurisdiction === '*' ? 'universal' : normalizedJurisdiction})`,
      wordCount
    }
    
    // Include warning if sample is outside recommended range
    if (validation.warning) {
      response.warning = validation.warning
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('[WritingSamples:POST] error:', error)
    
    // Handle unique constraint violations gracefully
    if (error?.code === 'P2002') {
      return NextResponse.json({ 
        error: 'A sample for this section and jurisdiction already exists. Try updating instead.',
        code: 'DUPLICATE_SAMPLE'
      }, { status: 409 })
    }
    
    return NextResponse.json({ 
      error: 'Failed to save writing sample. Please try again.',
      code: 'INTERNAL_ERROR'
    }, { status: 500 })
  }
}

/**
 * DELETE /api/writing-samples
 * Delete a writing sample
 * 
 * Query params:
 * - id: sample ID (required)
 * OR
 * - jurisdiction + sectionKey: to delete by composite key
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')

    if (id) {
      // Delete by ID
      const sample = await prisma.writingSample.findFirst({
        where: { id, userId: authResult.user.id }
      })

      if (!sample) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      await prisma.writingSample.delete({ where: { id } })
      return NextResponse.json({ success: true, message: 'Sample deleted' })
    }

    if (jurisdiction && sectionKey) {
      // Delete by composite key
      const normalizedJurisdiction = jurisdiction.toUpperCase()
      
      const deleted = await prisma.writingSample.deleteMany({
        where: {
          userId: authResult.user.id,
          jurisdiction: normalizedJurisdiction,
          sectionKey
        }
      })

      if (deleted.count === 0) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true, message: 'Sample deleted' })
    }

    return NextResponse.json({ 
      error: 'Provide either id or (jurisdiction + sectionKey)' 
    }, { status: 400 })
  } catch (error) {
    console.error('[WritingSamples:DELETE] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/writing-samples
 * Toggle active status or bulk operations
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, id, jurisdiction, sectionKey, isActive } = body

    // Toggle single sample
    if (action === 'toggle' && id) {
      const sample = await prisma.writingSample.findFirst({
        where: { id, userId: authResult.user.id }
      })

      if (!sample) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      const updated = await prisma.writingSample.update({
        where: { id },
        data: { isActive: isActive !== undefined ? isActive : !sample.isActive }
      })

      return NextResponse.json({ success: true, sample: updated })
    }

    // Enable/disable all samples for a jurisdiction
    if (action === 'bulk_toggle' && jurisdiction !== undefined) {
      const normalizedJurisdiction = jurisdiction === '*' ? '*' : jurisdiction.toUpperCase()
      
      const updated = await prisma.writingSample.updateMany({
        where: {
          userId: authResult.user.id,
          ...(jurisdiction !== 'all' ? { jurisdiction: normalizedJurisdiction } : {})
        },
        data: { isActive: isActive }
      })

      return NextResponse.json({ 
        success: true, 
        message: `${updated.count} samples ${isActive ? 'enabled' : 'disabled'}` 
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[WritingSamples:PATCH] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

