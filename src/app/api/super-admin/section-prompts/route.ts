import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getSectionPrompt,
  getAllSectionPrompts,
  createSectionPrompt,
  updateSectionPrompt,
  archiveSectionPrompt,
  getSectionPromptHistory,
  seedPromptsFromJson,
  invalidateSectionPromptCache
} from '@/lib/section-prompt-service'
import { invalidateCountryProfileCache } from '@/lib/country-profile-service'
import { invalidateSupersetSectionsCache } from '@/lib/multi-jurisdiction-service'

// Verify super admin access
async function verifySuperAdmin(request: NextRequest): Promise<{ userId: string; email: string } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  
  if (!payload?.email) {
    return null
  }

  // Check if user is super admin - roles is a scalar array field, not a relation
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true }
  })

  if (!user?.roles?.includes('SUPER_ADMIN')) {
    return null
  }

  return { userId: user.id, email: user.email }
}

/**
 * GET /api/super-admin/section-prompts
 * Query params:
 * - countryCode: Filter by country
 * - sectionKey: Get specific section
 * - includeArchived: Include archived prompts
 * - history: Get version history
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('countryCode')
    const sectionKey = searchParams.get('sectionKey')
    const includeArchived = searchParams.get('includeArchived') === 'true'
    const getHistory = searchParams.get('history') === 'true'

    // Get version history for specific prompt
    if (getHistory && countryCode && sectionKey) {
      const history = await getSectionPromptHistory(countryCode, sectionKey)
      return NextResponse.json({ history })
    }

    // Get specific prompt
    if (countryCode && sectionKey) {
      const prompt = await getSectionPrompt(countryCode, sectionKey)
      return NextResponse.json({ prompt })
    }

    // Get all prompts for a country
    if (countryCode) {
      const prompts = await getAllSectionPrompts(countryCode, includeArchived)
      return NextResponse.json({ prompts })
    }

    // Get all prompts grouped by country
    const allPrompts = await prisma.countrySectionPrompt.findMany({
      where: includeArchived ? {} : { status: { not: 'ARCHIVED' } },
      orderBy: [{ countryCode: 'asc' }, { sectionKey: 'asc' }]
    })

    // Get superset sections (master source for labels and order)
    const supersetSections = await prisma.supersetSection.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    })
    
    // Build superset label map (canonical key -> label)
    const supersetLabels: Record<string, { label: string; order: number; required: boolean }> = {}
    for (const sec of supersetSections) {
      supersetLabels[sec.sectionKey] = {
        label: sec.label,
        order: sec.displayOrder,
        required: sec.isRequired
      }
    }

    // Get all country section mappings (country-specific headings)
    const allMappings = await prisma.countrySectionMapping.findMany({
      orderBy: [{ countryCode: 'asc' }, { sectionKey: 'asc' }]
    })
    
    // Build mapping lookup: { countryCode: { sectionKey: heading } }
    const countryHeadings: Record<string, Record<string, string>> = {}
    for (const mapping of allMappings) {
      if (!countryHeadings[mapping.countryCode]) {
        countryHeadings[mapping.countryCode] = {}
      }
      // Use the country-specific heading if it's not N/A or Implicit
      if (mapping.heading && mapping.heading !== '(N/A)' && mapping.heading !== '(Implicit)') {
        countryHeadings[mapping.countryCode][mapping.sectionKey] = mapping.heading
      }
    }

    // Group prompts by country
    const byCountry: Record<string, any[]> = {}
    for (const prompt of allPrompts) {
      if (!byCountry[prompt.countryCode]) {
        byCountry[prompt.countryCode] = []
      }
      
      // Get section label: country-specific heading > superset label > sectionKey
      const countryLabel = countryHeadings[prompt.countryCode]?.[prompt.sectionKey]
      const supersetInfo = supersetLabels[prompt.sectionKey]
      const displayLabel = countryLabel || supersetInfo?.label || prompt.sectionKey
      
      byCountry[prompt.countryCode].push({
        id: prompt.id,
        countryCode: prompt.countryCode,
        sectionKey: prompt.sectionKey,
        sectionLabel: displayLabel, // Add resolved label
        sectionOrder: supersetInfo?.order ?? 999,
        instruction: prompt.instruction,
        constraints: prompt.constraints,
        additions: prompt.additions,
        importFiguresDirectly: prompt.importFiguresDirectly || false, // Include import figures flag
        version: prompt.version,
        status: prompt.status,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
      })
    }
    
    // Sort prompts within each country by superset order
    for (const code of Object.keys(byCountry)) {
      byCountry[code].sort((a, b) => a.sectionOrder - b.sectionOrder)
    }

    // Get country names - try CountryName table first, fallback to CountryProfile
    const countryNames = await prisma.countryName.findMany()
    const countryNameMap: Record<string, string> = {}
    for (const cn of countryNames) {
      countryNameMap[cn.code] = cn.name
    }

    // Also get from CountryProfile as fallback
    const countryProfiles = await prisma.countryProfile.findMany({
      select: { countryCode: true, name: true }
    })
    for (const cp of countryProfiles) {
      if (!countryNameMap[cp.countryCode]) {
        countryNameMap[cp.countryCode] = cp.name
      }
    }

    // Default names for known countries
    const defaultNames: Record<string, string> = {
      'IN': 'India', 'US': 'United States', 'AU': 'Australia',
      'CA': 'Canada', 'JP': 'Japan', 'CN': 'China', 'EP': 'European Patent',
      'PCT': 'PCT (International)', 'UK': 'United Kingdom', 'DE': 'Germany',
      'FR': 'France', 'KR': 'South Korea', 'BR': 'Brazil'
    }
    for (const code of Object.keys(byCountry)) {
      if (!countryNameMap[code]) {
        countryNameMap[code] = defaultNames[code] || code
      }
    }

    return NextResponse.json({
      promptsByCountry: byCountry,
      countryNames: countryNameMap,
      totalPrompts: allPrompts.length,
      // Include superset sections for the frontend to use as master reference
      supersetSections: supersetSections.map(s => ({
        key: s.sectionKey,
        label: s.label,
        order: s.displayOrder,
        required: s.isRequired
      })),
      // Include country-specific headings for the frontend
      countryHeadings
    })
  } catch (error) {
    console.error('[SuperAdmin] Section prompts GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch section prompts' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/super-admin/section-prompts
 * Create new section prompt
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, ...data } = body

    // Handle special actions
    if (action === 'seed') {
      const { countryCode } = data
      if (!countryCode) {
        return NextResponse.json({ error: 'Country code required for seeding' }, { status: 400 })
      }
      const result = await seedPromptsFromJson(countryCode, admin.email)
      return NextResponse.json({ result })
    }

    if (action === 'clear-cache') {
      // Invalidate all prompt-related caches
      invalidateSectionPromptCache()       // CountrySectionPrompt cache (top-up prompts)
      invalidateCountryProfileCache()      // CountryProfile cache (merge strategies)
      invalidateSupersetSectionsCache()    // SupersetSection cache (base prompts)
      
      console.log('[SuperAdmin] ✅ All prompt caches invalidated by', admin.email)
      return NextResponse.json({ 
        success: true, 
        message: 'All caches cleared: Section Prompts, Country Profiles, Superset Sections' 
      })
    }

    // Create new prompt
    const { countryCode, sectionKey, instruction, constraints, additions } = data

    if (!countryCode || !sectionKey || !instruction) {
      return NextResponse.json(
        { error: 'countryCode, sectionKey, and instruction are required' },
        { status: 400 }
      )
    }

    const prompt = await createSectionPrompt({
      countryCode,
      sectionKey,
      instruction,
      constraints: constraints || [],
      additions: additions || [],
      createdBy: admin.email
    })

    return NextResponse.json({ prompt }, { status: 201 })
  } catch (error) {
    console.error('[SuperAdmin] Section prompts POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create section prompt' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/super-admin/section-prompts
 * Update existing section prompt
 */
export async function PUT(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, instruction, constraints, additions, importFiguresDirectly, changeReason } = body

    if (!id) {
      return NextResponse.json({ error: 'Prompt ID required' }, { status: 400 })
    }

    const prompt = await updateSectionPrompt(id, {
      instruction,
      constraints,
      additions,
      importFiguresDirectly,
      changeReason,
      updatedBy: admin.email
    })

    return NextResponse.json({ prompt })
  } catch (error) {
    console.error('[SuperAdmin] Section prompts PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update section prompt' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/super-admin/section-prompts
 * Archive (soft delete) section prompt
 */
export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const reason = searchParams.get('reason')

    if (!id) {
      return NextResponse.json({ error: 'Prompt ID required' }, { status: 400 })
    }

    await archiveSectionPrompt(id, admin.email, reason || undefined)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[SuperAdmin] Section prompts DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to archive section prompt' },
      { status: 500 }
    )
  }
}

