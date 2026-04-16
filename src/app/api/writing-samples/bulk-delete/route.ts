import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/writing-samples/bulk-delete
 * 
 * Delete all writing samples for a specific persona + jurisdiction combination.
 * Used when user wants to clear all samples for a jurisdiction without deleting the persona.
 * 
 * Security:
 * - Only persona owner can delete samples
 * - Cannot delete samples from org personas you don't own
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
        error: 'Invalid request body',
        code: 'INVALID_JSON'
      }, { status: 400 })
    }

    const { personaId, jurisdiction } = body

    // Validate required fields
    if (!personaId || typeof personaId !== 'string') {
      return NextResponse.json({ 
        error: 'personaId is required',
        code: 'MISSING_PERSONA_ID'
      }, { status: 400 })
    }

    if (!jurisdiction || typeof jurisdiction !== 'string') {
      return NextResponse.json({ 
        error: 'jurisdiction is required (e.g., "IN", "US", "*")',
        code: 'MISSING_JURISDICTION'
      }, { status: 400 })
    }

    // Validate jurisdiction format
    const normalizedJurisdiction = jurisdiction.toUpperCase()
    if (normalizedJurisdiction !== '*' && !/^[A-Z]{2,3}$/.test(normalizedJurisdiction)) {
      return NextResponse.json({ 
        error: 'Invalid jurisdiction format. Use "*" for universal or 2-3 letter code (e.g., "IN", "US")',
        code: 'INVALID_JURISDICTION'
      }, { status: 400 })
    }

    // Verify persona exists and get ownership info
    const persona = await prisma.writingPersona.findFirst({
      where: {
        id: personaId,
        isActive: true // Only allow operations on active personas
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
        error: 'Persona not found or has been deleted',
        code: 'PERSONA_NOT_FOUND'
      }, { status: 404 })
    }

    // Security: Only persona owner can delete samples
    const isOwner = persona.createdBy === authResult.user.id
    const isOrgPersona = persona.visibility === 'ORGANIZATION'
    const isSameTenant = persona.tenantId === authResult.user.tenantId

    if (!isOwner) {
      if (isOrgPersona && isSameTenant) {
        // User can see this persona but can't modify it
        return NextResponse.json({ 
          error: 'You cannot delete samples from organization personas you did not create. To customize, copy the persona first.',
          code: 'ORG_PERSONA_READONLY'
        }, { status: 403 })
      }
      // User doesn't have access at all
      return NextResponse.json({ 
        error: 'Permission denied. You can only delete samples from your own personas.',
        code: 'PERMISSION_DENIED'
      }, { status: 403 })
    }

    // Count samples before deletion (for better feedback)
    const countBefore = await prisma.writingSample.count({
      where: {
        personaId,
        jurisdiction: normalizedJurisdiction
      }
    })

    if (countBefore === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        message: `No samples found for ${normalizedJurisdiction === '*' ? 'Universal' : normalizedJurisdiction} jurisdiction`
      })
    }

    // Delete all samples for this persona + jurisdiction
    const deleteResult = await prisma.writingSample.deleteMany({
      where: {
        personaId,
        jurisdiction: normalizedJurisdiction
      }
    })

    // Audit log for bulk deletion
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: authResult.user.id,
          tenantId: authResult.user.tenantId || 'default',
          action: 'SAMPLES_BULK_DELETE',
          resource: `persona:${personaId}`,
          meta: { 
            personaName: persona.name,
            jurisdiction: normalizedJurisdiction,
            deletedCount: deleteResult.count
          }
        }
      })
    } catch (auditError) {
      // Don't fail the operation if audit logging fails
      console.warn('[WritingSamples:BulkDelete] Audit log failed:', auditError)
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `Deleted ${deleteResult.count} sample${deleteResult.count !== 1 ? 's' : ''} for ${normalizedJurisdiction === '*' ? 'Universal' : normalizedJurisdiction} jurisdiction`
    })
  } catch (error: any) {
    console.error('[WritingSamples:BulkDelete] error:', error)
    
    return NextResponse.json({ 
      error: 'Failed to delete samples. Please try again.',
      code: 'INTERNAL_ERROR'
    }, { status: 500 })
  }
}

