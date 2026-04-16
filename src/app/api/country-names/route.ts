import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

// Returns only countries that have active profiles in the database
// This ensures the country selector shows only usable jurisdictions
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    // Get only active profiles from database - these are the only draftable jurisdictions
    const profiles = await prisma.countryProfile.findMany({
      where: { status: 'ACTIVE' as any },
      orderBy: { countryCode: 'asc' }
    })

    // Get country names for display
    const countryNames = await prisma.countryName.findMany()
    const nameByCode = new Map<string, string>()
    for (const cn of countryNames) {
      nameByCode.set(cn.code.toUpperCase(), cn.name)
    }

    // Only return countries that have active profiles
    const countries = profiles.map((profile) => {
      const meta = (profile as any)?.profileData?.meta || {}
      const code = profile.countryCode.toUpperCase()
      return {
        code,
        name: nameByCode.get(code) || profile.name || meta.name || code,
        continent: meta.continent || 'Unknown',
        office: meta.office || 'Patent Office',
        languages: meta.languages || [],
        applicationTypes: meta.applicationTypes || [],
        hasProfile: true,
        // Include section count for UI info
        sectionCount: (profile as any)?.profileData?.structure?.variants?.[0]?.sections?.length || 0
      }
    })

    return NextResponse.json({ 
      countries,
      // Include count for debugging
      totalProfiles: profiles.length
    })
  } catch (error) {
    console.error('[CountryNames] Failed to fetch countries', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
