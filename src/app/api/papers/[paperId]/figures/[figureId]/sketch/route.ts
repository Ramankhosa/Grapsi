/**
 * Paper Sketch Generation API Route
 * 
 * Handles AI-powered sketch generation for research paper figures.
 * Supports three modes: SUGGEST (AI-driven), GUIDED (user-directed), REFINE (from image)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'
import { generatePaperSketch, modifyPaperSketch, PaperSketchMode } from '@/lib/figure-generation/paper-sketch-service'
import { resolvePaperFigureImageUrl } from '@/lib/figure-generation/paper-figure-image'
import { scheduleStoredPaperFigureMetadataRefresh } from '@/lib/figure-generation/paper-figure-metadata-refresh'
import {
  asPaperFigureMeta,
  getPaperFigureImageVersion,
  getPaperFigureStoredImagePath,
} from '@/lib/figure-generation/paper-figure-record'

// Schema for sketch generation request
const sketchGenerateSchema = z.object({
  mode: z.enum(['SUGGEST', 'GUIDED', 'REFINE']),
  title: z.string().optional(),
  userPrompt: z.string().optional(),
  suggestionMeta: z.record(z.any()).optional(),
  illustrationSpecV2: z.object({
    layout: z.enum(['PANELS', 'STRIP']).optional(),
    panelCount: z.number().int().min(1).max(8).optional(),
    stepCount: z.number().int().min(1).max(10).optional(),
    flowDirection: z.enum(['LR', 'TD']).optional(),
    panels: z.array(z.object({
      idHint: z.string(),
      title: z.string(),
      elements: z.array(z.string()).optional()
    })).optional(),
    elements: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
    captionDraft: z.string().optional(),
    splitSuggestion: z.string().optional(),
    figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
    renderDirectives: z.any().optional(),
    actors: z.array(z.string()).optional(),
    props: z.array(z.string()).optional(),
    forbiddenElements: z.array(z.string()).optional()
  }).optional(),
  figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
  renderDirectives: z.any().optional(),
  uploadedImageBase64: z.string().optional(),
  uploadedImageMimeType: z.string().optional(),
  modificationRequest: z.string().optional(),
  style: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional()
})

// Schema for sketch modification request
const sketchModifySchema = z.object({
  modificationRequest: z.string().min(1, 'Modification request is required')
})

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id }

  return prisma.draftingSession.findFirst({ where })
}

async function getFigureForSession(sessionId: string, figureId: string) {
  return prisma.figurePlan.findFirst({
    where: { id: figureId, sessionId }
  })
}

function buildRequestHeaders(request: NextRequest): Record<string, string> {
  const requestHeaders: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    requestHeaders[key] = value
  })
  return requestHeaders
}

/**
 * POST - Generate a new sketch or update existing figure with sketch
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const params = await context.params
    const { paperId, figureId } = params

    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
    }

    const session = await getSessionForUser(paperId, user)
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 })
    }

    // Parse and validate body
    const body = await request.json()
    const validation = sketchGenerateSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const data = validation.data
    
    // Validate REFINE mode has image
    if (data.mode === 'REFINE' && !data.uploadedImageBase64) {
      return NextResponse.json(
        { error: 'REFINE mode requires an uploaded image' },
        { status: 400 }
      )
    }

    // Validate GUIDED mode has prompt
    if (data.mode === 'GUIDED' && (!data.userPrompt || data.userPrompt.length < 10)) {
      return NextResponse.json(
        { error: 'GUIDED mode requires at least 10 characters of instructions' },
        { status: 400 }
      )
    }

    // Generate sketch
    // Note: figureId can be 'new' for creating a new figure
    const isNewFigure = figureId === 'new'
    if (!isNewFigure) {
      const figure = await getFigureForSession(paperId, figureId)
      if (!figure) {
        return NextResponse.json({ error: 'Figure not found' }, { status: 404 })
      }
    }
    
    const result = await generatePaperSketch({
      paperId,
      sessionId: paperId, // In paper context, paperId is the sessionId
      figureId: isNewFigure ? undefined : figureId,
      mode: data.mode as PaperSketchMode,
      title: data.title,
      userPrompt: data.userPrompt,
      illustrationSpecV2: data.illustrationSpecV2,
      figureGenre: data.figureGenre || data.illustrationSpecV2?.figureGenre,
      renderDirectives: data.renderDirectives || data.illustrationSpecV2?.renderDirectives,
      uploadedImageBase64: data.uploadedImageBase64,
      uploadedImageMimeType: data.uploadedImageMimeType,
      modificationRequest: data.modificationRequest,
      style: data.style
    }, user.id, session.tenantId || undefined)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const targetFigureId = result.figureId || (!isNewFigure ? figureId : undefined)
    let latestFigure = null
    if (targetFigureId) {
      scheduleStoredPaperFigureMetadataRefresh({
        requestHeaders: buildRequestHeaders(request),
        sessionId: paperId,
        figureId: targetFigureId,
        fallbackTitle: data.title,
        fallbackPrompt: data.userPrompt,
        fallbackCategory: 'ILLUSTRATED_FIGURE',
        fallbackFigureType: 'sketch',
        overrideSuggestionMeta: data.suggestionMeta || null
      }, 'PaperSketchAPI')
      latestFigure = await getFigureForSession(paperId, targetFigureId)
    }
    const latestNodes = asPaperFigureMeta(latestFigure?.nodes)
    const latestImagePath = getPaperFigureStoredImagePath(latestNodes) || result.imagePath
    const imageVersion = getPaperFigureImageVersion(latestNodes, latestImagePath) || result.imagePath

    return NextResponse.json({
      success: true,
      figureId: result.figureId,
      imagePath: resolvePaperFigureImageUrl(paperId, result.figureId || figureId, latestImagePath, imageVersion),
      inferredImageMeta: null,
      metadataQueued: true
    })

  } catch (error: any) {
    console.error('[PaperSketchAPI] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH - Modify an existing sketch with user feedback
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const params = await context.params
    const { paperId, figureId } = params

    const { user, error } = await authenticateUser(request)
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
    }

    const session = await getSessionForUser(paperId, user)
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 })
    }

    const figure = await getFigureForSession(paperId, figureId)
    if (!figure) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 })
    }

    // Parse and validate body
    const body = await request.json()
    const validation = sketchModifySchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { modificationRequest } = validation.data

    // Modify existing sketch
    const result = await modifyPaperSketch(
      figureId,
      modificationRequest,
      user.id,
      session.tenantId || undefined
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    scheduleStoredPaperFigureMetadataRefresh({
      requestHeaders: buildRequestHeaders(request),
      sessionId: paperId,
      figureId,
      fallbackTitle: figure.title,
      fallbackPrompt: undefined,
      fallbackCategory: String((figure.nodes as any)?.category || 'ILLUSTRATED_FIGURE'),
      fallbackFigureType: String((figure.nodes as any)?.figureType || 'sketch')
    }, 'PaperSketchAPI')
    const refreshedFigure = await getFigureForSession(paperId, result.figureId || figureId)
    const refreshedNodes = asPaperFigureMeta(refreshedFigure?.nodes)
    const refreshedImagePath = getPaperFigureStoredImagePath(refreshedNodes) || result.imagePath
    const imageVersion = getPaperFigureImageVersion(refreshedNodes, refreshedImagePath) || result.imagePath

    return NextResponse.json({
      success: true,
      figureId: result.figureId,
      imagePath: resolvePaperFigureImageUrl(paperId, result.figureId || figureId, refreshedImagePath, imageVersion),
      inferredImageMeta: null,
      metadataQueued: true
    })

  } catch (error: any) {
    console.error('[PaperSketchAPI] Modify error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

