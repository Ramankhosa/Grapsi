import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { hasActiveWritingSamples, getAvailablePersonas } from '@/lib/writing-sample-service'

/**
 * GET /api/patents/[patentId]/drafting/style-status
 * 
 * Returns the status of the user's writing style settings.
 * Uses the new Writing Personas system (not the old document-based StyleProfile).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const { patentId } = params

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: auth.user.id },
          {
            project: {
              OR: [
                { userId: auth.user.id },
                { collaborators: { some: { userId: auth.user.id } } }
              ]
            }
          }
        ]
      },
      select: { id: true }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 })
    }

    // Check if user has writing samples (new persona system)
    const hasSamples = await hasActiveWritingSamples(auth.user.id)
    
    // Get available personas
    let personas: any[] = []
    if (auth.user.tenantId) {
      personas = await getAvailablePersonas(auth.user.id, auth.user.tenantId)
    }

    // Count samples per section
    const sampleCounts = await prisma.writingSample.groupBy({
      by: ['sectionKey'],
      where: {
        userId: auth.user.id,
        isActive: true
      },
      _count: { sectionKey: true }
    })

    return NextResponse.json({
      enabled: hasSamples,
      system: 'writing_personas', // Indicate new system is in use
      personas: personas.map(p => ({
        id: p.id,
        name: p.name,
        isOwn: p.isOwn,
        sampleCount: p.sampleCount
      })),
      sections: sampleCounts.map(s => s.sectionKey),
      sampleCounts: sampleCounts.reduce((acc, s) => {
        acc[s.sectionKey] = s._count.sectionKey
        return acc
      }, {} as Record<string, number>)
    })
  } catch (e) {
    console.error('style-status error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
