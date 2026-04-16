import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { computeDynamicSuperset, isNonApplicableHeading } from '@/lib/multi-jurisdiction-service'
import { resolveDisplayOrder } from '@/lib/section-display-order'

// ============================================================================
// REFERENCE Pseudo-Country Profile
// This is a synthetic "country" that represents the superset of all sections
// Used in multi-jurisdiction filing as the source draft before translation
// 
// DYNAMIC MODE: When ?jurisdictions=IN,US,PCT is provided, returns only
// the sections required by those jurisdictions (optimized)
// 
// DATABASE IS THE ONLY SOURCE OF TRUTH
// All section definitions come from SupersetSection table
// ============================================================================

/**
 * Get full superset sections from database
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 */
async function getFullSupersetSections(): Promise<Array<{ id: string; label: string; order: number; required: boolean }>> {
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' }
  })
  
  if (sections.length === 0) {
    throw new Error(
      '[CountryProfile:REFERENCE] CRITICAL: No SupersetSection entries found in database. ' +
      'Please seed the superset_sections table via /super-admin/superset-sections.'
    )
  }
  
  return sections.map(s => ({
    id: s.sectionKey,
    label: s.label,
    order: s.displayOrder,
    required: s.isRequired
  }))
}

/**
 * Get section label from database
 * Falls back to sectionKey if not found
 */
async function getSectionLabel(sectionKey: string): Promise<string> {
  const section = await prisma.supersetSection.findUnique({
    where: { sectionKey },
    select: { label: true }
  })
  return section?.label || sectionKey
}

// Build profile from section list
function buildReferenceProfile(
  sections: Array<{ id: string; label: string; order: number; required: boolean; requiredBy?: string[] }>,
  isOptimized: boolean,
  jurisdictions?: string[]
) {
  const description = isOptimized && jurisdictions
    ? `Dynamic reference draft containing ${sections.length} sections required by: ${jurisdictions.join(', ')}`
    : 'Universal reference draft containing all superset sections. Used as the source for translating to country-specific drafts.'

  return {
    code: 'REFERENCE',
    name: 'Reference Draft (Multi-Jurisdiction)',
    meta: {
      languages: ['English'],
      description,
      isReferenceDraft: true,
      isOptimized,
      targetJurisdictions: jurisdictions || [],
      sectionCount: sections.length
    },
    structure: {
      defaultVariant: 'reference',
      variants: [{
        id: 'reference',
        name: 'Reference Draft',
        sections: sections.map(s => ({
          id: s.id,
          label: s.label,
          order: s.order,
          required: s.required,
          canonicalKeys: [s.id],
          requiredBy: s.requiredBy || []
        }))
      }]
    },
    prompts: {
      sections: sections.reduce((acc, s) => {
        acc[s.id] = {
          required: s.required,
          label: s.label,
          description: s.requiredBy?.length
            ? `Required by: ${s.requiredBy.join(', ')}`
            : `Reference draft section: ${s.label}`
        }
        return acc
      }, {} as Record<string, any>)
    },
    rules: {
      claims: { maxIndependent: 20, maxTotal: 50 },
      drawings: { colorAllowed: true, paperSize: 'A4' }
    },
    export: {
      format: 'docx',
      templateId: 'reference'
    },
    sectionMappings: sections.map(s => ({
      sectionKey: s.id,
      heading: s.label.toUpperCase(),
      displayOrder: s.order,
      isRequired: s.required,
      isEnabled: true,
      requiredBy: s.requiredBy || []
    }))
  }
}

// Get static full profile (no optimization)
// DATABASE IS THE ONLY SOURCE OF TRUTH
async function getFullReferenceProfile() {
  const fullSections = await getFullSupersetSections()
  const sections = fullSections.map(s => ({
    ...s,
    requiredBy: ['ALL'] as string[]
  }))
  return buildReferenceProfile(sections, false)
}

// Get dynamic optimized profile based on jurisdictions
// DATABASE IS THE ONLY SOURCE OF TRUTH
async function getDynamicReferenceProfile(jurisdictions: string[]) {
  try {
    const result = await computeDynamicSuperset(jurisdictions)
    
    // Get labels from database for all section keys
    const supersetSections = await prisma.supersetSection.findMany({
      where: { sectionKey: { in: result.sections } },
      select: { sectionKey: true, label: true }
    })
    const labelMap = new Map(supersetSections.map(s => [s.sectionKey, s.label]))
    
    // Build sections from dynamic computation
    const sections = result.sections.map((sectionKey, index) => {
      const details = result.sectionDetails[sectionKey]
      return {
        id: sectionKey,
        label: details?.label || labelMap.get(sectionKey) || sectionKey,
        order: index + 1,
        required: true, // If it's in the dynamic superset, it's required by at least one jurisdiction
        requiredBy: details?.requiredBy || []
      }
    })
    
    console.log(`[CountryProfile:REFERENCE] Dynamic profile: ${sections.length} sections for ${jurisdictions.join(', ')}`)
    
    return buildReferenceProfile(sections, true, jurisdictions)
  } catch (error) {
    console.error('[CountryProfile:REFERENCE] Failed to compute dynamic superset:', error)
    // Re-throw - database is the only source of truth, no fallbacks
    throw error
  }
}

export async function GET(request: NextRequest, { params }: { params: { countryCode: string } }) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const code = (params.countryCode || '').toUpperCase()
    if (!code) {
      return NextResponse.json({ error: 'countryCode required' }, { status: 400 })
    }

    // Handle REFERENCE pseudo-country specially
    // This is used in multi-jurisdiction filing for the reference draft
    // 
    // DYNAMIC MODE: Pass ?jurisdictions=IN,US,PCT to get optimized section list
    // containing only sections required by those specific jurisdictions
    if (code === 'REFERENCE') {
      // Check for jurisdictions query parameter for dynamic optimization
      const { searchParams } = new URL(request.url)
      const jurisdictionsParam = searchParams.get('jurisdictions')
      
      if (jurisdictionsParam) {
        // Parse comma-separated jurisdictions (e.g., "IN,US,PCT")
        const jurisdictions = jurisdictionsParam
          .split(',')
          .map(j => j.trim().toUpperCase())
          .filter(j => j && j !== 'REFERENCE') // Exclude REFERENCE itself
        
        if (jurisdictions.length > 0) {
          console.log(`[CountryProfile:REFERENCE] Dynamic mode with ${jurisdictions.length} jurisdictions: ${jurisdictions.join(', ')}`)
          const dynamicProfile = await getDynamicReferenceProfile(jurisdictions)
          return NextResponse.json({ profile: dynamicProfile })
        }
      }
      
      // Fallback: Return full superset when no jurisdictions specified
      console.log('[CountryProfile:REFERENCE] Returning full superset (no jurisdictions specified)')
      return NextResponse.json({ profile: getFullReferenceProfile() })
    }

    // Fetch profile and section mappings in parallel
    const [profile, sectionMappings] = await Promise.all([
      prisma.countryProfile.findFirst({
      where: { countryCode: code, status: 'ACTIVE' as any }
      }),
      prisma.countrySectionMapping.findMany({
        where: { countryCode: code, isEnabled: true },
        orderBy: { displayOrder: 'asc' }
    })
    ])

    if (!profile) {
      return NextResponse.json({ error: 'Country profile not found' }, { status: 404 })
    }

    // Normalize mappings: drop non-applicable headings
    const resolvedMappings = sectionMappings.filter(m => !isNonApplicableHeading(m.heading))
    if (resolvedMappings.length === 0) {
      return NextResponse.json({ error: `No section mappings configured for ${code}. Please configure via /super-admin/jurisdiction-config.` }, { status: 400 })
    }
    
    // Resolve displayOrder for each mapping:
    // - If country mapping displayOrder is null, inherit from SupersetSection.displayOrder (still DB-driven)
    // - As a last resort, parse from supersetCode like "07. Summary"
    const supersetSections = await prisma.supersetSection.findMany({
      where: { sectionKey: { in: resolvedMappings.map(m => m.sectionKey) } },
      select: { sectionKey: true, displayOrder: true }
    })
    const supersetOrderByKey = new Map(supersetSections.map(s => [s.sectionKey, s.displayOrder]))

    // Create a map of sectionKey -> mapping for quick lookup
    const mappingByKey = new Map(resolvedMappings.map(m => [m.sectionKey, m]))

    // Return only the data needed for drafting UI (structure/prompts/rules/meta)
    const profileData = profile.profileData as any
    
    // Process structure to apply country-specific ordering from mappings
    // AND add sections from CountrySectionMapping that are missing from the profile structure
    let structure = profileData?.structure || null
    if (structure?.variants) {
      structure = {
        ...structure,
        variants: structure.variants.map((variant: any) => {
          if (!variant.sections) return variant
          
          // Track which sectionKeys are already in the profile
          const existingSectionKeys = new Set<string>()
          
          // Map sections with their country-specific displayOrder
          const sectionsWithOrder = variant.sections.map((sec: any) => {
            // Try to find mapping by section ID or canonical keys
            let mapping = mappingByKey.get(sec.id)
            if (!mapping && sec.canonicalKeys) {
              for (const key of sec.canonicalKeys) {
                mapping = mappingByKey.get(key)
                if (mapping) break
              }
            }
            
            // DB mapping is authoritative: if no mapping exists, this section should not appear
            if (!mapping) {
              return null
            }

            const order = resolveDisplayOrder({
              countryDisplayOrder: mapping.displayOrder,
              supersetDisplayOrder: supersetOrderByKey.get(mapping.sectionKey),
              supersetCode: mapping.supersetCode,
              context: `${code}:${String(mapping.sectionKey)}`
            })
            
            // Track this section's key
            existingSectionKeys.add(sec.id)
            if (sec.canonicalKeys) {
              sec.canonicalKeys.forEach((k: string) => existingSectionKeys.add(k))
            }
            if (mapping?.sectionKey) {
              existingSectionKeys.add(mapping.sectionKey)
            }
            
            return {
              ...sec,
              // Use mapping's displayOrder ONLY (database is source of truth)
              order,
              // Use mapping heading for display (jurisdiction-config)
              label: mapping.heading,
              // Include mapping metadata
              _mapping: mapping ? {
                heading: mapping.heading,
                isRequired: mapping.isRequired,
                isEnabled: mapping.isEnabled,
                displayOrder: order
              } : null
            }
          })
          .filter(Boolean)
          
          // Add sections from CountrySectionMapping that are missing from the profile
          // but are applicable (heading is not N/A)
          for (const mapping of resolvedMappings) {
            // Skip if this section is already in the profile
            if (existingSectionKeys.has(mapping.sectionKey)) continue
            
            // Skip disabled sections
            if (!mapping.isEnabled) continue
            
            // Add the section from the mapping
            const order = resolveDisplayOrder({
              countryDisplayOrder: mapping.displayOrder,
              supersetDisplayOrder: supersetOrderByKey.get(mapping.sectionKey),
              supersetCode: mapping.supersetCode,
              context: `${code}:${String(mapping.sectionKey)}`
            })
            sectionsWithOrder.push({
              id: mapping.sectionKey,
              label: mapping.heading,
              order,
              required: mapping.isRequired,
              canonicalKeys: [mapping.sectionKey],
              _mapping: {
                heading: mapping.heading,
                isRequired: mapping.isRequired,
                isEnabled: mapping.isEnabled,
                displayOrder: order
              },
              _fromMapping: true // Flag to indicate this was added from CountrySectionMapping
            })
          }
          
          // Sort sections by the resolved order
          sectionsWithOrder.sort((a: any, b: any) => a.order - b.order)
          
          return {
            ...variant,
            sections: sectionsWithOrder
          }
        })
      }
    }
    
    const payload = {
      code: profile.countryCode,
      name: profile.name,
      meta: profileData?.meta || {},
      structure,
      prompts: profileData?.prompts || null,
      rules: profileData?.rules || null,
      export: profileData?.export || null,
      // Include mappings for reference
      sectionMappings: resolvedMappings
        .map(m => {
          const order = resolveDisplayOrder({
            countryDisplayOrder: m.displayOrder,
            supersetDisplayOrder: supersetOrderByKey.get(m.sectionKey),
            supersetCode: m.supersetCode,
            context: `${code}:${String(m.sectionKey)}`
          })
          return {
            sectionKey: m.sectionKey,
            heading: m.heading,
            displayOrder: order,
            isRequired: m.isRequired,
            isEnabled: m.isEnabled
          }
        })
        .sort((a, b) => a.displayOrder - b.displayOrder)
    }

    return NextResponse.json({ profile: payload })
  } catch (error) {
    console.error('[CountryProfile:getByCode] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
