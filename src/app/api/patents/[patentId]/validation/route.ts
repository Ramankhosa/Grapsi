/**
 * Validation API Endpoint
 * 
 * Provides section-specific validation rules from the database
 * and runs validation checks on draft content.
 * 
 * All validation is POST-generation feedback - never blocks drafting.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'
import { 
  getSectionValidationRules, 
  getAllValidationRules,
  getCrossValidationRules,
  validateSection,
  validateFullDraft,
  convertLegacyIssue
} from '@/lib/unified-validation-service'
import type { ValidationIssue } from '@/types/validation'

// ============================================================================
// GET - Fetch validation rules for a jurisdiction
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const jurisdiction = searchParams.get('jurisdiction') || 'IN'
    const sectionKey = searchParams.get('sectionKey')

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: params.patentId,
        project: {
          userId: authResult.user.id
        }
      }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    // Fetch session if available for user overrides
    const session = await prisma.draftingSession.findFirst({
      where: { patentId: params.patentId },
      orderBy: { updatedAt: 'desc' }
    })

    if (sectionKey) {
      // Fetch rules for specific section
      const rules = await getSectionValidationRules(
        jurisdiction,
        sectionKey,
        authResult.user.id,
        session?.id
      )

      return NextResponse.json({
        success: true,
        rules,
        jurisdiction,
        sectionKey
      })
    } else {
      // Fetch all rules for jurisdiction
      const [sectionRules, crossRules] = await Promise.all([
        getAllValidationRules(jurisdiction),
        getCrossValidationRules(jurisdiction)
      ])

      return NextResponse.json({
        success: true,
        sectionRules,
        crossRules,
        jurisdiction
      })
    }
  } catch (error) {
    console.error('Validation rules fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch validation rules' },
      { status: 500 }
    )
  }
}

// ============================================================================
// POST - Run validation on draft content
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const body = await request.json()
    const { 
      action,
      jurisdiction = 'IN',
      sessionId,
      sectionKey,
      content,
      draft,
      includeAIReview = false
    } = body

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: params.patentId,
        project: {
          userId: authResult.user.id
        }
      }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    // Get session data for context
    const session = sessionId 
      ? await prisma.draftingSession.findUnique({
          where: { id: sessionId },
          include: {
            referenceMap: true,
            figurePlans: true
          }
        })
      : null

    // Build options from session
    const options = {
      userId: authResult.user.id,
      sessionId: session?.id,
      referenceNumerals: session?.referenceMap?.components 
        ? new Set((session.referenceMap.components as any[]).map(c => c.numeral as number))
        : undefined,
      figurePlans: session?.figurePlans?.map(f => ({ figureNo: f.figureNo }))
    }

    switch (action) {
      case 'validate_section': {
        // Validate a single section
        if (!sectionKey || !content) {
          return NextResponse.json(
            { error: 'Missing sectionKey or content' },
            { status: 400 }
          )
        }

        const issues = await validateSection(
          sectionKey,
          content,
          jurisdiction,
          options
        )

        return NextResponse.json({
          success: true,
          sectionKey,
          jurisdiction,
          issues,
          issueCount: issues.length,
          hasErrors: issues.some(i => i.severity === 'error'),
          hasWarnings: issues.some(i => i.severity === 'warning')
        })
      }

      case 'validate_draft': {
        // Validate entire draft
        if (!draft || typeof draft !== 'object') {
          return NextResponse.json(
            { error: 'Missing draft object' },
            { status: 400 }
          )
        }

        const issues = await validateFullDraft(
          draft,
          jurisdiction,
          options
        )

        // Group issues by section
        const issuesBySection: Record<string, ValidationIssue[]> = {}
        for (const issue of issues) {
          if (!issuesBySection[issue.sectionId]) {
            issuesBySection[issue.sectionId] = []
          }
          issuesBySection[issue.sectionId].push(issue)
        }

        // Calculate summary
        const summary = {
          totalIssues: issues.length,
          errors: issues.filter(i => i.severity === 'error').length,
          warnings: issues.filter(i => i.severity === 'warning').length,
          notices: issues.filter(i => i.severity === 'notice').length,
          sectionsWithIssues: Object.keys(issuesBySection).length
        }

        return NextResponse.json({
          success: true,
          jurisdiction,
          issues,
          issuesBySection,
          summary
        })
      }

      case 'get_rules': {
        // Get validation rules for section(s)
        if (sectionKey) {
          const rules = await getSectionValidationRules(
            jurisdiction,
            sectionKey,
            authResult.user.id,
            session?.id
          )
          return NextResponse.json({ success: true, rules })
        } else {
          const [sectionRules, crossRules] = await Promise.all([
            getAllValidationRules(jurisdiction),
            getCrossValidationRules(jurisdiction)
          ])
          return NextResponse.json({ success: true, sectionRules, crossRules })
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Validation error:', error)
    return NextResponse.json(
      { error: 'Validation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

