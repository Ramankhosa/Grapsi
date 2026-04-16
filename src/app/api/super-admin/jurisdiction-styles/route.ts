import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

/**
 * Verify super admin access
 */
async function verifySuperAdmin(request: NextRequest): Promise<{ userId: string; email: string } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    console.log('[JurisdictionStyles] No auth header')
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  
  if (!payload?.email) {
    console.log('[JurisdictionStyles] Invalid JWT payload')
    return null
  }

  // Check if user is super admin
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true }
  })

  if (!user?.roles?.includes('SUPER_ADMIN')) {
    console.log('[JurisdictionStyles] User is not SUPER_ADMIN:', payload.email)
    return null
  }

  return { userId: user.id, email: user.email }
}

/**
 * GET /api/super-admin/jurisdiction-styles
 * Get all jurisdiction style configurations
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      console.log('[JurisdictionStyles] Unauthorized access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('[JurisdictionStyles] Fetching data for admin:', admin.email)

    // Get all diagram configs with hints
    const diagramConfigs = await prisma.countryDiagramConfig.findMany({
      where: { status: 'ACTIVE' },
      include: { diagramHints: true },
      orderBy: { countryCode: 'asc' }
    })
    console.log('[JurisdictionStyles] Found diagram configs:', diagramConfigs.length)

    // Get all export configs with headings
    const exportConfigs = await prisma.countryExportConfig.findMany({
      where: { status: 'ACTIVE' },
      include: { sectionHeadings: true },
      orderBy: { countryCode: 'asc' }
    })

    // Get all section validations
    const validations = await prisma.countrySectionValidation.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ countryCode: 'asc' }, { sectionKey: 'asc' }]
    })

    // Get all cross-validations
    const crossValidations = await prisma.countryCrossValidation.findMany({
      orderBy: [{ countryCode: 'asc' }, { checkId: 'asc' }]
    })

    // Get country names
    const countryNames = await prisma.countryName.findMany()
    const countryNameMap: Record<string, string> = {}
    for (const cn of countryNames) {
      countryNameMap[cn.code] = cn.name
    }

    // Also get from CountryProfile as fallback
    const countryProfiles = await prisma.countryProfile.findMany({
      select: { countryCode: true, name: true }
    })
    for (const cp of countryProfiles) {
      if (!countryNameMap[cp.countryCode]) {
        countryNameMap[cp.countryCode] = cp.name
      }
    }

    // Get unique country codes
    const allCountryCodes = new Set<string>()
    diagramConfigs.forEach(c => allCountryCodes.add(c.countryCode))
    exportConfigs.forEach(c => allCountryCodes.add(c.countryCode))
    validations.forEach(v => allCountryCodes.add(v.countryCode))
    crossValidations.forEach(cv => allCountryCodes.add(cv.countryCode))

    const countries = Array.from(allCountryCodes).sort()

    // Default names
    const defaultNames: Record<string, string> = {
      'IN': 'India', 'US': 'United States', 'AU': 'Australia',
      'CA': 'Canada', 'JP': 'Japan', 'CN': 'China', 
      'EP': 'European Patent', 'PCT': 'PCT (International)',
      'UK': 'United Kingdom', 'DE': 'Germany', 'FR': 'France',
      'KR': 'South Korea', 'BR': 'Brazil', 'CANADA': 'Canada'
    }
    for (const code of countries) {
      if (!countryNameMap[code]) {
        countryNameMap[code] = defaultNames[code] || code
      }
    }

    // Group data by country
    const diagramConfigsByCountry: Record<string, any> = {}
    for (const config of diagramConfigs) {
      diagramConfigsByCountry[config.countryCode] = {
        ...config,
        hints: config.diagramHints
      }
    }

    const exportConfigsByCountry: Record<string, any[]> = {}
    for (const config of exportConfigs) {
      if (!exportConfigsByCountry[config.countryCode]) {
        exportConfigsByCountry[config.countryCode] = []
      }
      exportConfigsByCountry[config.countryCode].push({
        ...config,
        sectionHeadings: config.sectionHeadings.reduce((acc: Record<string, string>, h) => {
          acc[h.sectionKey] = h.heading
          return acc
        }, {})
      })
    }

    const validationsByCountry: Record<string, any[]> = {}
    for (const v of validations) {
      if (!validationsByCountry[v.countryCode]) {
        validationsByCountry[v.countryCode] = []
      }
      validationsByCountry[v.countryCode].push(v)
    }

    const crossValidationsByCountry: Record<string, any[]> = {}
    for (const cv of crossValidations) {
      if (!crossValidationsByCountry[cv.countryCode]) {
        crossValidationsByCountry[cv.countryCode] = []
      }
      crossValidationsByCountry[cv.countryCode].push(cv)
    }

    return NextResponse.json({
      countries,
      countryNames: countryNameMap,
      diagramConfigs: diagramConfigsByCountry,
      exportConfigs: exportConfigsByCountry,
      validations: validationsByCountry,
      crossValidations: crossValidationsByCountry
    })
  } catch (error) {
    console.error('[SuperAdmin] Jurisdiction styles GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}

/**
 * POST /api/super-admin/jurisdiction-styles
 * Create new config
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, countryCode, ...data } = body

    switch (action) {
      case 'createDiagramConfig': {
        const existing = await prisma.countryDiagramConfig.findUnique({
          where: { countryCode }
        })
        if (existing) {
          return NextResponse.json({ error: 'Config already exists' }, { status: 400 })
        }

        const config = await prisma.countryDiagramConfig.create({
          data: {
            countryCode,
            requiredWhenApplicable: true,
            supportedDiagramTypes: ['block', 'flowchart', 'schematic'],
            figureLabelFormat: 'Fig. {number}',
            autoGenerateReferenceTable: true,
            paperSize: 'A4',
            colorAllowed: false,
            lineStyle: 'black_and_white_solid',
            referenceNumeralsMandatory: true,
            minReferenceTextSizePt: 8,
            drawingMarginTopCm: 2.5,
            drawingMarginBottomCm: 1.0,
            drawingMarginLeftCm: 2.5,
            drawingMarginRightCm: 1.5,
            defaultDiagramCount: 4,
            maxDiagramsRecommended: 10,
            createdBy: admin.userId,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ config })
      }

      case 'createDiagramHint': {
        const { configId, diagramType, hint, preferredSyntax, exampleCode } = data
        const hintRecord = await prisma.countryDiagramHint.create({
          data: {
            configId,
            diagramType,
            hint,
            preferredSyntax: preferredSyntax || 'plantuml',
            exampleCode: exampleCode || null,
            requireLabels: true
          }
        })
        return NextResponse.json({ hint: hintRecord })
      }

      case 'createExportConfig': {
        const { documentTypeId } = data
        const existing = await prisma.countryExportConfig.findUnique({
          where: {
            countryCode_documentTypeId: { countryCode, documentTypeId }
          }
        })
        if (existing) {
          return NextResponse.json({ error: 'Config already exists' }, { status: 400 })
        }

        const config = await prisma.countryExportConfig.create({
          data: {
            countryCode,
            documentTypeId,
            label: `${countryCode} Specification PDF`,
            pageSize: 'A4',
            marginTopCm: 2.5,
            marginBottomCm: 2.0,
            marginLeftCm: 2.5,
            marginRightCm: 2.0,
            fontFamily: 'Times New Roman',
            fontSizePt: 12,
            lineSpacing: 1.5,
            addPageNumbers: true,
            addParagraphNumbers: false,
            pageNumberFormat: 'Page {page} of {total}',
            pageNumberPosition: 'header-right',
            includesSections: [],
            sectionOrder: [],
            createdBy: admin.userId,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ config })
      }

      case 'createValidation': {
        const { sectionKey } = data
        const existing = await prisma.countrySectionValidation.findUnique({
          where: {
            countryCode_sectionKey: { countryCode, sectionKey }
          }
        })
        if (existing) {
          return NextResponse.json({ error: 'Validation already exists' }, { status: 400 })
        }

        const validation = await prisma.countrySectionValidation.create({
          data: {
            countryCode,
            sectionKey,
            createdBy: admin.userId,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ validation })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[SuperAdmin] Jurisdiction styles POST error:', error)
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}

/**
 * PUT /api/super-admin/jurisdiction-styles
 * Update config
 */
export async function PUT(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, id, countryCode, ...data } = body

    switch (action) {
      case 'updateDiagramConfig': {
        const existing = await prisma.countryDiagramConfig.findUnique({
          where: { id }
        })
        if (!existing) {
          return NextResponse.json({ error: 'Config not found' }, { status: 404 })
        }

        const config = await prisma.countryDiagramConfig.update({
          where: { id },
          data: {
            figureLabelFormat: data.figureLabelFormat,
            paperSize: data.paperSize,
            colorAllowed: data.colorAllowed,
            colorUsageNote: data.colorUsageNote || null,
            lineStyle: data.lineStyle,
            referenceNumeralsMandatory: data.referenceNumeralsMandatory,
            minReferenceTextSizePt: data.minReferenceTextSizePt,
            defaultDiagramCount: data.defaultDiagramCount,
            maxDiagramsRecommended: data.maxDiagramsRecommended,
            supportedDiagramTypes: data.supportedDiagramTypes,
            drawingMarginTopCm: data.drawingMarginTopCm,
            drawingMarginBottomCm: data.drawingMarginBottomCm,
            drawingMarginLeftCm: data.drawingMarginLeftCm,
            drawingMarginRightCm: data.drawingMarginRightCm,
            version: existing.version + 1,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ config })
      }

      case 'updateDiagramHint': {
        const { configId, diagramType, hint, preferredSyntax, exampleCode } = data
        
        // Check if hint exists
        const existing = await prisma.countryDiagramHint.findUnique({
          where: {
            configId_diagramType: { configId, diagramType }
          }
        })

        if (existing && id) {
          // Update existing
          const hintRecord = await prisma.countryDiagramHint.update({
            where: { id },
            data: {
              hint,
              preferredSyntax: preferredSyntax || 'plantuml',
              exampleCode: exampleCode || null
            }
          })
          return NextResponse.json({ hint: hintRecord })
        } else if (existing) {
          // Update by composite key
          const hintRecord = await prisma.countryDiagramHint.update({
            where: {
              configId_diagramType: { configId, diagramType }
            },
            data: {
              hint,
              preferredSyntax: preferredSyntax || 'plantuml',
              exampleCode: exampleCode || null
            }
          })
          return NextResponse.json({ hint: hintRecord })
        } else {
          // Create new
          const hintRecord = await prisma.countryDiagramHint.create({
            data: {
              configId,
              diagramType,
              hint,
              preferredSyntax: preferredSyntax || 'plantuml',
              exampleCode: exampleCode || null,
              requireLabels: true
            }
          })
          return NextResponse.json({ hint: hintRecord })
        }
      }

      case 'updateExportConfig': {
        const existing = await prisma.countryExportConfig.findUnique({
          where: { id }
        })
        if (!existing) {
          return NextResponse.json({ error: 'Config not found' }, { status: 404 })
        }

        const config = await prisma.countryExportConfig.update({
          where: { id },
          data: {
            label: data.label,
            pageSize: data.pageSize,
            fontFamily: data.fontFamily,
            fontSizePt: data.fontSizePt,
            lineSpacing: data.lineSpacing,
            marginTopCm: data.marginTopCm,
            marginBottomCm: data.marginBottomCm,
            marginLeftCm: data.marginLeftCm,
            marginRightCm: data.marginRightCm,
            headingFontFamily: data.headingFontFamily || null,
            headingFontSizePt: data.headingFontSizePt || null,
            addPageNumbers: data.addPageNumbers,
            addParagraphNumbers: data.addParagraphNumbers,
            pageNumberFormat: data.pageNumberFormat || 'Page {page} of {total}',
            pageNumberPosition: data.pageNumberPosition || 'header-right',
            version: existing.version + 1,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ config })
      }

      case 'updateValidation': {
        const existing = await prisma.countrySectionValidation.findUnique({
          where: { id }
        })
        if (!existing) {
          return NextResponse.json({ error: 'Validation not found' }, { status: 404 })
        }

        const validation = await prisma.countrySectionValidation.update({
          where: { id },
          data: {
            maxWords: data.maxWords,
            minWords: data.minWords,
            maxChars: data.maxChars,
            minChars: data.minChars,
            maxCount: data.maxCount,
            maxIndependent: data.maxIndependent,
            wordLimitSeverity: data.wordLimitSeverity,
            charLimitSeverity: data.charLimitSeverity,
            countLimitSeverity: data.countLimitSeverity,
            wordLimitMessage: data.wordLimitMessage,
            charLimitMessage: data.charLimitMessage,
            countLimitMessage: data.countLimitMessage,
            legalReference: data.legalReference,
            version: existing.version + 1,
            updatedBy: admin.userId
          }
        })
        return NextResponse.json({ validation })
      }

      case 'updateCrossValidation': {
        const existing = await prisma.countryCrossValidation.findUnique({
          where: { id }
        })
        if (!existing) {
          return NextResponse.json({ error: 'Cross-validation not found' }, { status: 404 })
        }

        const crossValidation = await prisma.countryCrossValidation.update({
          where: { id },
          data: {
            checkType: data.checkType,
            fromSection: data.fromSection,
            toSections: data.toSections,
            severity: data.severity,
            message: data.message,
            reviewPrompt: data.reviewPrompt,
            legalBasis: data.legalBasis,
            checkParams: data.checkParams || {},
            isEnabled: data.isEnabled,
            version: existing.version + 1
          }
        })
        return NextResponse.json({ crossValidation })
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[SuperAdmin] Jurisdiction styles PUT error:', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

/**
 * DELETE /api/super-admin/jurisdiction-styles
 * Delete config
 */
export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const id = searchParams.get('id')

    if (!action || !id) {
      return NextResponse.json({ error: 'Action and ID required' }, { status: 400 })
    }

    switch (action) {
      case 'deleteDiagramConfig':
        await prisma.countryDiagramConfig.delete({ where: { id } })
        return NextResponse.json({ success: true })

      case 'deleteDiagramHint':
        await prisma.countryDiagramHint.delete({ where: { id } })
        return NextResponse.json({ success: true })

      case 'deleteExportConfig':
        await prisma.countryExportConfig.delete({ where: { id } })
        return NextResponse.json({ success: true })

      case 'deleteValidation':
        await prisma.countrySectionValidation.delete({ where: { id } })
        return NextResponse.json({ success: true })

      case 'deleteCrossValidation':
        await prisma.countryCrossValidation.delete({ where: { id } })
        return NextResponse.json({ success: true })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('[SuperAdmin] Jurisdiction styles DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}

