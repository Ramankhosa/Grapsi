import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { getActiveCountryProfiles } from '@/lib/country-profile-service'

const SHOULD_LOG_COUNTRY_PROFILES = process.env.COUNTRY_PROFILE_DEBUG_LOGS === 'true'

export async function GET(request: NextRequest) {
  try {
    if (SHOULD_LOG_COUNTRY_PROFILES) {
      console.log('[CountryProfiles] API called')
    }
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      if (SHOULD_LOG_COUNTRY_PROFILES) {
        console.log('[CountryProfiles] Auth failed:', authResult.error)
      }
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    if (SHOULD_LOG_COUNTRY_PROFILES) {
      console.log('[CountryProfiles] Auth successful for user:', authResult.user.id)
    }
    const profiles = await getActiveCountryProfiles()
    if (SHOULD_LOG_COUNTRY_PROFILES) {
      console.log('[CountryProfiles] Found profiles:', profiles.size)
    }

    const countries = Array.from(profiles.values()).map(profile => {
      const meta = profile.profileData?.meta || {}
      return {
        code: profile.countryCode,
        name: profile.name,
        continent: meta.continent || 'Unknown',
        office: meta.office || 'Patent Office',
        languages: meta.languages || [],
        applicationTypes: meta.applicationTypes || [],
        updatedAt: profile.updatedAt
      }
    })

    if (SHOULD_LOG_COUNTRY_PROFILES) {
      console.log('[CountryProfiles] Returning countries:', countries.length)
    }
    return NextResponse.json({ countries })
  } catch (error) {
    console.error('[CountryProfiles] Failed to fetch active country profiles', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
