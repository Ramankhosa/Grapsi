import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { NA_HEADINGS, isNonApplicableHeading } from '@/lib/multi-jurisdiction-service'
import { resolveDisplayOrder } from '@/lib/section-display-order'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/sections/by-jurisdiction?jurisdiction=IN
 * 
 * Returns sections available for a specific jurisdiction based on CountrySectionMapping.
 * 
 * For specific jurisdictions:
 * - Returns mapped sections where heading is NOT "NA" or "N/A"
 * - Sections with NA/N/A heading are not applicable for that country
 * 
 * For universal (*):
 * - Returns superset sections that are mapped to at least one country
 * - Includes info about which countries use each section
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const jurisdiction = url.searchParams.get('jurisdiction')?.toUpperCase() || '*'

    // Use centralized NA_HEADINGS from multi-jurisdiction-service for consistency
    
    // For universal jurisdiction, return superset sections that have at least one valid country mapping
    if (jurisdiction === '*') {
      // Get all country section mappings (excluding NA/N/A headings)
      const allMappings = await prisma.countrySectionMapping.findMany({
        where: {
          isEnabled: true,
          NOT: {
            heading: { in: NA_HEADINGS }
          }
        },
        select: {
          sectionKey: true,
          countryCode: true
        }
      })

      // Group by sectionKey to find which sections are used by at least one country
      const sectionCountries: Record<string, string[]> = {}
      for (const mapping of allMappings) {
        if (!sectionCountries[mapping.sectionKey]) {
          sectionCountries[mapping.sectionKey] = []
        }
        if (!sectionCountries[mapping.sectionKey].includes(mapping.countryCode)) {
          sectionCountries[mapping.sectionKey].push(mapping.countryCode)
        }
      }

      // Get superset sections that have at least one country mapping
      const supersetSections = await prisma.supersetSection.findMany({
        where: { 
          isActive: true,
          sectionKey: { in: Object.keys(sectionCountries) }
        },
        orderBy: { displayOrder: 'asc' },
        select: {
          sectionKey: true,
          label: true,
          displayOrder: true
        }
      })

      return NextResponse.json({
        jurisdiction: '*',
        note: 'Universal persona samples apply to all countries that use this section',
        sections: supersetSections.map(s => ({
          key: s.sectionKey,
          label: s.label,
          displayOrder: s.displayOrder,
          usedBy: sectionCountries[s.sectionKey] || []
        }))
      })
    }

    // For specific jurisdiction, get mapped sections (excluding NA/N/A and other non-applicable headings)
    const mappings = await prisma.countrySectionMapping.findMany({
      where: {
        countryCode: jurisdiction,
        isEnabled: true,
        NOT: {
          heading: { in: NA_HEADINGS }
        }
      },
      orderBy: { displayOrder: 'asc' },
      select: {
        sectionKey: true,
        heading: true,
        displayOrder: true,
        isRequired: true,
        supersetCode: true
      }
    })

    // Filter out any lingering non-applicable headings; order is defined by DB
    const resolvedMappings = mappings.filter(m => !isNonApplicableHeading(m.heading))
    const supersetSections = await prisma.supersetSection.findMany({
      where: { sectionKey: { in: resolvedMappings.map(m => m.sectionKey) } },
      select: { sectionKey: true, displayOrder: true }
    })
    const supersetOrderByKey = new Map(supersetSections.map(s => [s.sectionKey, s.displayOrder]))

    // If no mappings found, return explicit error (no fallback)
    if (resolvedMappings.length === 0) {
      return NextResponse.json({
        error: `No section mappings configured for ${jurisdiction}. Please configure via /super-admin/jurisdiction-config.`
      }, { status: 400 })
    }

    return NextResponse.json({
      jurisdiction,
      sections: resolvedMappings
        .map(m => ({
          key: m.sectionKey,
          label: m.heading,
          displayOrder: resolveDisplayOrder({
            countryDisplayOrder: m.displayOrder,
            supersetDisplayOrder: supersetOrderByKey.get(m.sectionKey),
            supersetCode: m.supersetCode,
            context: `${jurisdiction}:${String(m.sectionKey)}`
          }),
          isRequired: m.isRequired
        }))
        // Sort by resolved order so clients can preserve array order without fallbacks
        .sort((a, b) => a.displayOrder - b.displayOrder)
    })
  } catch (error) {
    console.error('[Sections:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
