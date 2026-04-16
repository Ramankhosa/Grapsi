import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

const currentYear = new Date().getFullYear()
const emptyUrl = z.string().url().or(z.literal(''))

const requestSchema = z.object({
  profile: z.object({
    displayName: z.string().max(120),
    birthYear: z.number().int().min(1900).max(currentYear).nullable(),
    countryOfResidence: z.string().max(120),
    citizenshipCountries: z.array(z.string().max(120)).max(12),
    institutionName: z.string().max(200),
    institutionType: z.string().max(120),
    department: z.string().max(160),
    careerStage: z.string().max(120),
    yearsOfExperience: z.number().int().min(0).max(80).nullable(),
    applicationLanguages: z.array(z.string().max(120)).max(12),
    researchSummary: z.string().max(4000),
    researchAreas: z.array(z.string().max(240)).max(20),
    keywords: z.array(z.string().max(120)).max(40),
    linkedinUrl: emptyUrl,
    googleScholarUrl: emptyUrl,
    scopusUrl: emptyUrl,
    orcidUrl: emptyUrl,
  }),
  notificationPreferences: z.object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    whatsappEnabled: z.boolean(),
    emailAddress: z.string().email().or(z.literal('')),
    whatsappNumber: z.string().max(30),
    whatsappVerified: z.boolean(),
    notificationFrequency: z.enum(['instant', 'daily', 'weekly']),
    digestEnabled: z.boolean(),
    quietHoursStart: z.string().max(10),
    quietHoursEnd: z.string().max(10),
    timezone: z.string().max(100),
    alertKeywords: z.array(z.string().max(120)).max(40),
  }),
})

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await researcherProfileService.getProfile(auth.userId)
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load researcher profile',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const payload = await researcherProfileService.updateProfile(auth.userId, parsed)
    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid profile payload', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to update researcher profile',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
