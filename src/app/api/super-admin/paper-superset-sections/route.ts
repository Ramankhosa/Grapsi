import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/super-admin/paper-superset-sections
 * Returns all paper superset sections
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sections = await prisma.paperSupersetSection.findMany({
      orderBy: { displayOrder: 'asc' },
      include: {
        paperTypePrompts: {
          where: { status: 'ACTIVE' },
          select: {
            paperTypeCode: true,
            sectionKey: true
          }
        }
      }
    })

    // Get all active paper types for reference
    const paperTypes = await prisma.paperTypeDefinition.findMany({
      where: { isActive: true },
      select: { code: true, name: true }
    })

    return NextResponse.json({
      sections: sections.map(s => ({
        id: s.id,
        sectionKey: s.sectionKey,
        displayOrder: s.displayOrder,
        label: s.label,
        description: s.description,
        instruction: s.instruction,
        instructionPreview: s.instruction.substring(0, 200) + (s.instruction.length > 200 ? '...' : ''),
        constraints: s.constraints,
        isRequired: s.isRequired,
        isActive: s.isActive,
        requiresBlueprint: s.requiresBlueprint,
        requiresPreviousSections: s.requiresPreviousSections,
        requiresCitations: s.requiresCitations,
        // Paper types that have overrides for this section
        overriddenBy: s.paperTypePrompts.map(p => p.paperTypeCode),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString()
      })),
      paperTypes: paperTypes.map(pt => ({
        code: pt.code,
        name: pt.name
      }))
    })
  } catch (error) {
    console.error('Failed to fetch paper superset sections:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/super-admin/paper-superset-sections
 * Create or update paper superset sections
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, sectionKey, ...data } = body

    if (!sectionKey) {
      return NextResponse.json({ error: 'Missing sectionKey' }, { status: 400 })
    }

    // Validate sectionKey format (lowercase, underscores only)
    if (!/^[a-z][a-z0-9_]*$/.test(sectionKey)) {
      return NextResponse.json({ 
        error: 'Section key must be lowercase letters, numbers, and underscores, starting with a letter' 
      }, { status: 400 })
    }

    switch (action) {
      case 'create': {
        // Validate instruction is provided and meaningful
        if (!data.instruction || typeof data.instruction !== 'string' || data.instruction.trim().length < 50) {
          return NextResponse.json({ 
            error: 'Instruction is required and must be at least 50 characters' 
          }, { status: 400 })
        }

        // Validate label is provided
        if (!data.label || typeof data.label !== 'string' || data.label.trim().length < 2) {
          return NextResponse.json({ 
            error: 'Label is required and must be at least 2 characters' 
          }, { status: 400 })
        }

        // Create new section
        const existing = await prisma.paperSupersetSection.findUnique({
          where: { sectionKey }
        })
        if (existing) {
          return NextResponse.json({ error: 'Section already exists' }, { status: 400 })
        }

        const newSection = await prisma.paperSupersetSection.create({
          data: {
            sectionKey,
            displayOrder: data.displayOrder ?? 50,
            label: data.label.trim(),
            description: data.description?.trim() || null,
            instruction: data.instruction.trim(),
            constraints: data.constraints || {},
            isRequired: data.isRequired ?? false,
            isActive: true,
            requiresBlueprint: data.requiresBlueprint ?? true,
            requiresPreviousSections: data.requiresPreviousSections ?? true,
            requiresCitations: data.requiresCitations ?? false,
            createdBy: authResult.user.id
          }
        })

        return NextResponse.json({
          success: true,
          message: `Created section "${sectionKey}"`,
          section: newSection
        })
      }

      case 'update': {
        const section = await prisma.paperSupersetSection.findUnique({
          where: { sectionKey }
        })
        if (!section) {
          return NextResponse.json({ error: 'Section not found' }, { status: 404 })
        }

        // Validate instruction if provided
        if (data.instruction !== undefined) {
          if (typeof data.instruction !== 'string' || data.instruction.trim().length < 50) {
            return NextResponse.json({ 
              error: 'Instruction must be at least 50 characters' 
            }, { status: 400 })
          }
        }

        // Validate label if provided
        if (data.label !== undefined) {
          if (typeof data.label !== 'string' || data.label.trim().length < 2) {
            return NextResponse.json({ 
              error: 'Label must be at least 2 characters' 
            }, { status: 400 })
          }
        }

        const updateData: Record<string, any> = {
          updatedBy: authResult.user.id
        }

        // Only update provided fields (with trimming for strings)
        if (data.label !== undefined) updateData.label = data.label.trim()
        if (data.description !== undefined) updateData.description = data.description?.trim() || null
        if (data.instruction !== undefined) updateData.instruction = data.instruction.trim()
        if (data.constraints !== undefined) updateData.constraints = data.constraints
        if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder
        if (data.isRequired !== undefined) updateData.isRequired = data.isRequired
        if (data.requiresBlueprint !== undefined) updateData.requiresBlueprint = data.requiresBlueprint
        if (data.requiresPreviousSections !== undefined) updateData.requiresPreviousSections = data.requiresPreviousSections
        if (data.requiresCitations !== undefined) updateData.requiresCitations = data.requiresCitations

        const updated = await prisma.paperSupersetSection.update({
          where: { sectionKey },
          data: updateData
        })

        return NextResponse.json({
          success: true,
          message: `Updated section "${sectionKey}"`,
          section: updated
        })
      }

      case 'toggle_active': {
        const section = await prisma.paperSupersetSection.findUnique({
          where: { sectionKey }
        })
        if (!section) {
          return NextResponse.json({ error: 'Section not found' }, { status: 404 })
        }

        const newIsActive = typeof data.isActive === 'boolean' ? data.isActive : !section.isActive

        await prisma.paperSupersetSection.update({
          where: { sectionKey },
          data: {
            isActive: newIsActive,
            updatedBy: authResult.user.id
          }
        })

        return NextResponse.json({
          success: true,
          message: `Section ${newIsActive ? 'activated' : 'deactivated'}`
        })
      }

      case 'update_context_flags': {
        const section = await prisma.paperSupersetSection.findUnique({
          where: { sectionKey }
        })
        if (!section) {
          return NextResponse.json({ error: 'Section not found' }, { status: 404 })
        }

        const updateData: Record<string, any> = {
          updatedBy: authResult.user.id
        }

        if (typeof data.requiresBlueprint === 'boolean') {
          updateData.requiresBlueprint = data.requiresBlueprint
        }
        if (typeof data.requiresPreviousSections === 'boolean') {
          updateData.requiresPreviousSections = data.requiresPreviousSections
        }
        if (typeof data.requiresCitations === 'boolean') {
          updateData.requiresCitations = data.requiresCitations
        }

        await prisma.paperSupersetSection.update({
          where: { sectionKey },
          data: updateData
        })

        return NextResponse.json({
          success: true,
          message: `Updated context flags for ${sectionKey}`
        })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Failed to update paper superset section:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

