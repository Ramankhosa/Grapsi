import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { addAlias, removeAlias, invalidateAliasCache } from '@/lib/section-alias-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/super-admin/superset-sections
 * Returns all superset sections with their aliases
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sections = await prisma.supersetSection.findMany({
      orderBy: { displayOrder: 'asc' }
    })

    return NextResponse.json({ 
      sections: sections.map(s => ({
        id: s.id,
        sectionKey: s.sectionKey,
        aliases: s.aliases || [],
        displayOrder: s.displayOrder,
        label: s.label,
        description: s.description,
        instruction: s.instruction.substring(0, 200) + '...', // Truncate for UI
        constraints: s.constraints,
        isRequired: s.isRequired,
        isActive: s.isActive,
        // Context injection flags - determines what data to inject into section prompts
        requiresPriorArt: (s as any).requiresPriorArt ?? false,
        requiresFigures: (s as any).requiresFigures ?? false,
        requiresClaims: (s as any).requiresClaims ?? false,
        requiresComponents: (s as any).requiresComponents ?? false,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString()
      }))
    })
  } catch (error) {
    console.error('Failed to fetch superset sections:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/super-admin/superset-sections
 * Manage superset sections (add/remove alias, toggle active)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, sectionKey, alias, isActive } = body

    if (!sectionKey) {
      return NextResponse.json({ error: 'Missing sectionKey' }, { status: 400 })
    }

    // Verify section exists
    const section = await prisma.supersetSection.findUnique({
      where: { sectionKey }
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    switch (action) {
      case 'add_alias': {
        if (!alias || typeof alias !== 'string') {
          return NextResponse.json({ error: 'Invalid alias' }, { status: 400 })
        }

        // Check if alias already exists in any section
        const existingSection = await prisma.supersetSection.findFirst({
          where: {
            OR: [
              { sectionKey: alias },
              { aliases: { has: alias } }
            ]
          }
        })

        if (existingSection) {
          return NextResponse.json({ 
            error: `Alias "${alias}" is already used by section "${existingSection.sectionKey}"` 
          }, { status: 400 })
        }

        const success = await addAlias(sectionKey, alias)
        if (!success) {
          return NextResponse.json({ error: 'Failed to add alias' }, { status: 500 })
        }

        return NextResponse.json({ 
          success: true, 
          message: `Added alias "${alias}" to ${sectionKey}` 
        })
      }

      case 'remove_alias': {
        if (!alias || typeof alias !== 'string') {
          return NextResponse.json({ error: 'Invalid alias' }, { status: 400 })
        }

        const success = await removeAlias(sectionKey, alias)
        if (!success) {
          return NextResponse.json({ error: 'Failed to remove alias' }, { status: 500 })
        }

        return NextResponse.json({ 
          success: true, 
          message: `Removed alias "${alias}" from ${sectionKey}` 
        })
      }

      case 'toggle_active': {
        const newIsActive = typeof isActive === 'boolean' ? isActive : !section.isActive

        await prisma.supersetSection.update({
          where: { sectionKey },
          data: {
            isActive: newIsActive,
            updatedBy: authResult.user.id
          }
        })

        // Invalidate alias cache since active sections changed
        invalidateAliasCache()

        return NextResponse.json({ 
          success: true, 
          message: `Section ${newIsActive ? 'activated' : 'deactivated'}` 
        })
      }

      case 'update_context_flags': {
        // Update context injection flags for a section
        const { requiresPriorArt, requiresFigures, requiresClaims, requiresComponents } = body
        
        const updateData: Record<string, any> = {
          updatedBy: authResult.user.id
        }
        
        // Only update fields that are explicitly provided
        if (typeof requiresPriorArt === 'boolean') {
          updateData.requiresPriorArt = requiresPriorArt
        }
        if (typeof requiresFigures === 'boolean') {
          updateData.requiresFigures = requiresFigures
        }
        if (typeof requiresClaims === 'boolean') {
          updateData.requiresClaims = requiresClaims
        }
        if (typeof requiresComponents === 'boolean') {
          updateData.requiresComponents = requiresComponents
        }

        await prisma.supersetSection.update({
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
    console.error('Failed to update superset section:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

