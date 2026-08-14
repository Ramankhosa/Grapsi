import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { SECTION_WORD_LIMITS, DEFAULT_LIMITS, MAX_CHARS } from './constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/writing-samples/limits
 *
 * Returns validation limits for writing samples.
 * Used by frontend to show appropriate guidance without making assumptions.
 *
 * Query params:
 * - sectionKey: optional (get limits for specific section)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const sectionKey = url.searchParams.get('sectionKey')

    if (sectionKey) {
      // Return limits for specific section
      const limits = SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS
      return NextResponse.json({
        sectionKey,
        limits,
        maxChars: MAX_CHARS
      })
    }

    // Return all limits
    return NextResponse.json({
      limits: SECTION_WORD_LIMITS,
      default: DEFAULT_LIMITS,
      maxChars: MAX_CHARS,
      tips: {
        tooShort: 'A sample that is too short may not capture enough of your writing patterns.',
        tooLong: 'Very long samples can confuse the AI. Focus on your most characteristic patterns.',
        optimal: 'The recommended range gives the AI enough context to learn your style effectively.'
      }
    })
  } catch (error) {
    console.error('[WritingSamples:Limits] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
