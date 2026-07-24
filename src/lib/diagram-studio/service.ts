/**
 * Grant Diagram Studio — orchestration.
 *
 * create → (LLM spec) → deterministic render → persist GrantDiagram row.
 * Spec edits and theme changes re-render without touching the LLM.
 */

import { prisma } from '@/lib/prisma'
import { createPaperFigureImageAccessToken } from '@/lib/figure-generation/paper-figure-image'
import { generatePaperSketch } from '@/lib/figure-generation/paper-sketch-service'
import type { GrantDiagram, Prisma } from '@prisma/client'
import {
  CreatableDiagramKind,
  DiagramSpec,
  DiagramStudioKind,
  DIAGRAM_KIND_TO_DB,
  DB_TO_DIAGRAM_KIND,
  PlotSpec,
  diagramSpecSchema,
  parseDiagramSpec,
} from './spec-types'
import { resolveDiagramTheme, describeThemeForPrompt, DEFAULT_THEME_KEY } from './theme'
import {
  buildDiagramSectionContext,
  computeSourceFingerprint,
  extractDurationMonthsHint,
  DiagramGenerationContext,
} from './context'
import {
  generateDiagramSpec,
  refineDiagramSpec,
  generateFreeformDotCode,
  repairFreeformDotCode,
  refineFreeformDotCode,
  DiagramNoDataError,
} from './llm'
import {
  renderDiagramSpec,
  renderFreeformDot,
  saveDiagramAsset,
  deleteDiagramAsset,
  RenderedDiagram,
} from './render'

export interface GrantDiagramResponse {
  id: string
  sectionKey: string | null
  figureNo: number
  kind: DiagramStudioKind
  title: string
  caption: string | null
  themeKey: string
  spec: DiagramSpec | null
  status: string
  errorMessage: string | null
  imageUrl: string | null
  imageVersion: number
  isStale: boolean
  createdAt: string
  updatedAt: string
}

export function toGrantDiagramResponse(params: {
  diagram: GrantDiagram
  projectId: string
  grantId: string
}): GrantDiagramResponse {
  const { diagram, projectId, grantId } = params
  let imageUrl: string | null = null
  if (diagram.imagePath && diagram.status === 'READY') {
    const version = String(diagram.imageVersion)
    const token = createPaperFigureImageAccessToken({
      sessionId: diagram.grantSessionId,
      figureId: diagram.id,
      version,
    })
    const query = new URLSearchParams({ token, v: version })
    imageUrl = `/api/projects/${encodeURIComponent(projectId)}/grants/${encodeURIComponent(grantId)}/diagrams/${encodeURIComponent(diagram.id)}/image?${query.toString()}`
  }

  let spec: DiagramSpec | null = null
  if (diagram.specJson) {
    const parsed = diagramSpecSchema.safeParse(diagram.specJson)
    spec = parsed.success ? parsed.data : null
  }

  return {
    id: diagram.id,
    sectionKey: diagram.sectionKey,
    figureNo: diagram.figureNo,
    kind: DB_TO_DIAGRAM_KIND[diagram.kind] || 'flowchart',
    title: diagram.title,
    caption: diagram.caption,
    themeKey: diagram.themeKey,
    spec,
    status: diagram.status,
    errorMessage: diagram.errorMessage,
    imageUrl,
    imageVersion: diagram.imageVersion,
    isStale: diagram.isStale,
    createdAt: diagram.createdAt.toISOString(),
    updatedAt: diagram.updatedAt.toISOString(),
  }
}

/**
 * Next [Figure N] number: continues after both existing studio diagrams and
 * legacy figure-planner figures on the shadow session, so markers never clash.
 */
async function allocateFigureNo(grantSessionId: string, draftingSessionId?: string | null): Promise<number> {
  const [diagramMax, legacyMax] = await Promise.all([
    prisma.grantDiagram.aggregate({
      where: { grantSessionId },
      _max: { figureNo: true },
    }),
    draftingSessionId
      ? prisma.figurePlan.aggregate({
          where: { sessionId: draftingSessionId },
          _max: { figureNo: true },
        })
      : Promise.resolve({ _max: { figureNo: null } }),
  ])
  return Math.max(diagramMax._max.figureNo || 0, legacyMax._max.figureNo || 0) + 1
}

export interface GrantSessionBundle {
  id: string
  projectId: string
  tenantId: string
  draftingSessionId: string | null
  fundingCall?: {
    title?: string | null
    extractedFacts?: unknown
    normalizedMetadata?: unknown
    project_duration_max_months?: number | null
    project_duration_min_months?: number | null
  } | null
}

async function buildContextForSections(
  grantSessionId: string,
  sectionKeys: string[],
  fundingCall?: GrantSessionBundle['fundingCall']
): Promise<DiagramGenerationContext> {
  const drafts = await prisma.grantSectionDraft.findMany({
    where: { grantSessionId, sectionKey: { in: sectionKeys } },
    orderBy: { sectionOrder: 'asc' },
  })
  return {
    callTitle: fundingCall?.title || undefined,
    durationMonthsHint: extractDurationMonthsHint(fundingCall),
    sections: drafts.map(buildDiagramSectionContext),
  }
}

export class DiagramStudioError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = 'DiagramStudioError'
  }
}

/**
 * Plot pipeline: studio spec (plot type + verbatim data extraction) → LLM
 * writes matplotlib code (llm-plot-service, sandbox-validated) → python
 * server executes it.
 */
async function generatePlotAndRender(params: {
  plotBrief: PlotSpec
  title?: string
  requestHeaders: Record<string, string>
}): Promise<{ spec: PlotSpec; rendered: RenderedDiagram }> {
  const { generateStatisticalPlotSpec } = await import('@/lib/figure-generation/llm-plot-service')
  const { generatePythonChart } = await import('@/lib/figure-generation/python-chart-service')

  const llmPlot = await generateStatisticalPlotSpec(
    {
      plotType: params.plotBrief.plotType,
      title: params.title || params.plotBrief.title,
      description: [
        params.plotBrief.description,
        params.plotBrief.dataText
          ? `\nDATA (verbatim from the grant sections — use ONLY these values):\n${params.plotBrief.dataText}`
          : '',
      ].join('\n'),
      rawDataText: params.plotBrief.dataText || null,
      journal: 'default',
    },
    params.requestHeaders
  )
  if (!llmPlot.success || !llmPlot.spec) {
    throw new Error(llmPlot.error || 'Statistical plot code generation failed')
  }

  const result = await generatePythonChart(llmPlot.spec)
  if (!result.success || !result.imageBase64) {
    throw new Error(result.error || 'Statistical plot rendering failed')
  }
  return {
    spec: { ...params.plotBrief, pythonSpec: llmPlot.spec },
    rendered: {
      buffer: Buffer.from(result.imageBase64, 'base64'),
      format: 'png',
      generatedCode: llmPlot.spec.code,
    },
  }
}

async function requirePythonPlotServer(): Promise<void> {
  const { isPythonChartServerHealthy } = await import('@/lib/figure-generation/python-chart-service')
  if (!(await isPythonChartServerHealthy())) {
    throw new DiagramStudioError(
      'The statistical plot service (matplotlib server) is offline. Start it to generate plots, or use a chart instead.',
      503
    )
  }
}

/** Freeform: LLM writes DOT directly; one error-informed repair pass on render failure. */
async function generateFreeformAndRender(params: {
  context: DiagramGenerationContext
  guidance?: string
  title?: string
  themeKey: string
  requestHeaders: Record<string, string>
}): Promise<{ spec: DiagramSpec; rendered: RenderedDiagram; promptUsed: string }> {
  const themeHints = describeThemeForPrompt(resolveDiagramTheme(params.themeKey))
  let codeResult = await generateFreeformDotCode({
    context: params.context,
    guidance: params.guidance,
    title: params.title,
    themeHints,
    requestHeaders: params.requestHeaders,
  })
  let rendered: RenderedDiagram
  try {
    rendered = await renderFreeformDot(codeResult.code)
  } catch (renderError) {
    codeResult = await repairFreeformDotCode({
      code: codeResult.code,
      renderError: renderError instanceof Error ? renderError.message : String(renderError),
      requestHeaders: params.requestHeaders,
    })
    rendered = await renderFreeformDot(codeResult.code)
  }
  return {
    spec: {
      kind: 'freeform',
      language: 'dot',
      title: params.title?.trim() || 'Diagram',
      code: codeResult.code,
    },
    rendered,
    promptUsed: codeResult.promptUsed,
  }
}

export async function createAndGenerateDiagram(params: {
  grantSession: GrantSessionBundle
  projectId: string
  grantId: string
  kind: CreatableDiagramKind
  mode?: 'structured' | 'freeform'
  sectionKeys: string[]
  title?: string
  guidance?: string
  themeKey?: string
  userId: string
  requestHeaders: Record<string, string>
}): Promise<GrantDiagramResponse> {
  const { grantSession, projectId, grantId, kind, sectionKeys, userId } = params
  const themeKey = params.themeKey && resolveDiagramTheme(params.themeKey).key === params.themeKey
    ? params.themeKey
    : DEFAULT_THEME_KEY

  if (kind === 'plot') {
    await requirePythonPlotServer()
  }
  if (sectionKeys.length === 0) {
    throw new DiagramStudioError('Select at least one section to ground the diagram in.')
  }

  const context = await buildContextForSections(grantSession.id, sectionKeys, grantSession.fundingCall)
  if (context.sections.length === 0) {
    throw new DiagramStudioError('No matching sections found for this grant.')
  }
  const draftedSections = context.sections.filter(section => section.content.trim().length > 40)
  if (kind !== 'sketch' && draftedSections.length === 0) {
    throw new DiagramStudioError(
      'The selected sections have no drafted content yet. Draft the section first so the diagram is grounded in real text.'
    )
  }

  const figureNo = await allocateFigureNo(grantSession.id, grantSession.draftingSessionId)
  const diagram = await prisma.grantDiagram.create({
    data: {
      grantSessionId: grantSession.id,
      tenantId: grantSession.tenantId,
      projectId: grantSession.projectId,
      sectionKey: sectionKeys[0],
      figureNo,
      kind: DIAGRAM_KIND_TO_DB[kind] as GrantDiagram['kind'],
      title: params.title?.trim() || 'Untitled diagram',
      themeKey,
      status: 'GENERATING',
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  })

  try {
    if (kind === 'sketch') {
      return await generateSketchDiagram({
        diagram,
        grantSession,
        projectId,
        grantId,
        title: params.title,
        guidance: params.guidance,
        context,
        userId,
      })
    }

    let finalSpec: DiagramSpec
    let rendered: RenderedDiagram
    let promptUsed: string

    if (kind === 'plot') {
      const specResult = await generateDiagramSpec({
        kind: 'plot',
        context,
        guidance: params.guidance,
        requestHeaders: params.requestHeaders,
      })
      promptUsed = specResult.promptUsed
      const plotResult = await generatePlotAndRender({
        plotBrief: specResult.spec as PlotSpec,
        title: params.title,
        requestHeaders: params.requestHeaders,
      })
      finalSpec = plotResult.spec
      rendered = plotResult.rendered
    } else if (kind === 'flowchart' && params.mode === 'freeform') {
      const freeform = await generateFreeformAndRender({
        context,
        guidance: params.guidance,
        title: params.title,
        themeKey,
        requestHeaders: params.requestHeaders,
      })
      finalSpec = freeform.spec
      rendered = freeform.rendered
      promptUsed = freeform.promptUsed
    } else {
      const specResult = await generateDiagramSpec({
        kind,
        context,
        guidance: params.guidance,
        requestHeaders: params.requestHeaders,
      })
      finalSpec = specResult.spec
      promptUsed = specResult.promptUsed
      rendered = await renderDiagramSpec(finalSpec, resolveDiagramTheme(themeKey))
    }

    const imageVersion = diagram.imageVersion + 1
    const imagePath = await saveDiagramAsset({
      diagramId: diagram.id,
      version: imageVersion,
      buffer: rendered.buffer,
      format: rendered.format,
    })

    const updated = await prisma.grantDiagram.update({
      where: { id: diagram.id },
      data: {
        title: params.title?.trim() || finalSpec.title,
        specJson: finalSpec as unknown as Prisma.InputJsonValue,
        status: 'READY',
        errorMessage: null,
        imagePath,
        imageFormat: rendered.format,
        imageVersion,
        generationPrompt: promptUsed.slice(0, 20000),
        sourceFingerprint: computeSourceFingerprint(context.sections),
        isStale: false,
        updatedByUserId: userId,
      },
    })
    return toGrantDiagramResponse({ diagram: updated, projectId, grantId })
  } catch (error) {
    const message =
      error instanceof DiagramNoDataError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Diagram generation failed'
    const failed = await prisma.grantDiagram.update({
      where: { id: diagram.id },
      data: { status: 'FAILED', errorMessage: message.slice(0, 2000), updatedByUserId: userId },
    })
    if (error instanceof DiagramNoDataError || error instanceof DiagramStudioError) {
      return toGrantDiagramResponse({ diagram: failed, projectId, grantId })
    }
    return toGrantDiagramResponse({ diagram: failed, projectId, grantId })
  }
}

async function generateSketchDiagram(params: {
  diagram: GrantDiagram
  grantSession: GrantSessionBundle
  projectId: string
  grantId: string
  title?: string
  guidance?: string
  context: DiagramGenerationContext
  userId: string
  /** When set, used verbatim (sketch refine re-uses the stored prompt). */
  overrideUserPrompt?: string
}): Promise<GrantDiagramResponse> {
  const { diagram, grantSession, projectId, grantId, userId } = params
  if (!grantSession.draftingSessionId) {
    throw new DiagramStudioError('Sketches need a launched drafting workspace for this grant.', 409)
  }

  const sectionText = params.context.sections
    .map(section => `${section.label}:\n${section.content}`)
    .join('\n\n')
    .slice(0, 6000)
  const userPrompt = params.overrideUserPrompt?.trim() || [
    params.guidance?.trim(),
    sectionText ? `Ground the illustration in this grant proposal content:\n${sectionText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const result = await generatePaperSketch(
    {
      paperId: grantSession.draftingSessionId,
      sessionId: grantSession.draftingSessionId,
      mode: 'GUIDED',
      title: params.title || diagram.title,
      userPrompt,
      style: 'conceptual',
    },
    userId,
    grantSession.tenantId
  )

  if (!result.success || !result.imagePath) {
    throw new Error(result.error || 'Sketch generation failed')
  }

  const imageVersion = diagram.imageVersion + 1
  const updated = await prisma.grantDiagram.update({
    where: { id: diagram.id },
    data: {
      status: 'READY',
      errorMessage: null,
      imagePath: result.imagePath,
      imageFormat: 'png',
      imageVersion,
      specJson: {
        kind: 'sketch',
        title: params.title || diagram.title,
        prompt: userPrompt.slice(0, 2400) || 'Concept sketch',
      } as unknown as Prisma.InputJsonValue,
      sourceFingerprint: computeSourceFingerprint(params.context.sections),
      isStale: false,
      updatedByUserId: userId,
    },
  })
  return toGrantDiagramResponse({ diagram: updated, projectId, grantId })
}

/** Deterministic re-render after a spec/theme edit — no LLM involved. */
export async function updateDiagramSpecAndRender(params: {
  diagram: GrantDiagram
  projectId: string
  grantId: string
  spec?: unknown
  themeKey?: string
  title?: string
  caption?: string | null
  userId: string
}): Promise<GrantDiagramResponse> {
  const { diagram, projectId, grantId, userId } = params
  const kind = DB_TO_DIAGRAM_KIND[diagram.kind]
  if (!kind) throw new DiagramStudioError('Unknown diagram kind.')

  const themeKey = params.themeKey && resolveDiagramTheme(params.themeKey).key === params.themeKey
    ? params.themeKey
    : diagram.themeKey

  let spec: DiagramSpec | null = null
  if (params.spec !== undefined) {
    spec = parseDiagramSpec(kind, params.spec)
  } else if (diagram.specJson) {
    const parsed = diagramSpecSchema.safeParse(diagram.specJson)
    spec = parsed.success ? parsed.data : null
  }

  const metaOnly = params.spec === undefined && (params.themeKey === undefined || params.themeKey === diagram.themeKey)
  if (metaOnly || kind === 'sketch') {
    const updated = await prisma.grantDiagram.update({
      where: { id: diagram.id },
      data: {
        title: params.title?.trim() || diagram.title,
        caption: params.caption !== undefined ? params.caption : diagram.caption,
        themeKey,
        ...(spec && params.spec !== undefined
          ? { specJson: spec as unknown as Prisma.InputJsonValue }
          : {}),
        updatedByUserId: userId,
      },
    })
    return toGrantDiagramResponse({ diagram: updated, projectId, grantId })
  }

  if (!spec) throw new DiagramStudioError('This diagram has no editable spec.')

  const rendered = await renderDiagramSpec(spec, resolveDiagramTheme(themeKey))
  const imageVersion = diagram.imageVersion + 1
  const imagePath = await saveDiagramAsset({
    diagramId: diagram.id,
    version: imageVersion,
    buffer: rendered.buffer,
    format: rendered.format,
  })
  await deleteDiagramAsset(diagram.imagePath)

  const updated = await prisma.grantDiagram.update({
    where: { id: diagram.id },
    data: {
      title: params.title?.trim() || spec.title,
      caption: params.caption !== undefined ? params.caption : diagram.caption,
      themeKey,
      specJson: spec as unknown as Prisma.InputJsonValue,
      status: 'READY',
      errorMessage: null,
      imagePath,
      imageFormat: rendered.format,
      imageVersion,
      updatedByUserId: userId,
    },
  })
  return toGrantDiagramResponse({ diagram: updated, projectId, grantId })
}

/**
 * AI refinement. Structured specs get a minimal LLM patch + deterministic
 * re-render; freeform diagrams get an LLM code rewrite (with a repair pass);
 * plots re-run the matplotlib code pipeline; sketches regenerate from the
 * stored prompt plus the refinement instruction.
 */
export async function refineDiagramWithAI(params: {
  diagram: GrantDiagram
  grantSession: GrantSessionBundle
  projectId: string
  grantId: string
  instruction: string
  userId: string
  requestHeaders: Record<string, string>
}): Promise<GrantDiagramResponse> {
  const { diagram, grantSession, projectId, grantId, userId } = params
  const kind = DB_TO_DIAGRAM_KIND[diagram.kind]
  if (!kind) throw new DiagramStudioError('Unknown diagram kind.')
  if (!diagram.specJson) throw new DiagramStudioError('This diagram has no spec to refine.')

  const currentSpec = parseDiagramSpec(kind, diagram.specJson)
  const sectionKeys = diagram.sectionKey ? [diagram.sectionKey] : []
  const context = sectionKeys.length
    ? await buildContextForSections(grantSession.id, sectionKeys, grantSession.fundingCall)
    : { sections: [] }

  if (currentSpec.kind === 'sketch') {
    const combinedPrompt = [
      currentSpec.prompt,
      `REFINEMENT (apply to the previous illustration request): ${params.instruction}`,
    ].join('\n\n')
    return generateSketchDiagram({
      diagram,
      grantSession,
      projectId,
      grantId,
      title: diagram.title,
      context,
      userId,
      overrideUserPrompt: combinedPrompt,
    })
  }

  if (currentSpec.kind === 'freeform') {
    const themeHints = describeThemeForPrompt(resolveDiagramTheme(diagram.themeKey))
    let codeResult = await refineFreeformDotCode({
      code: currentSpec.code,
      instruction: params.instruction,
      context,
      themeHints,
      requestHeaders: params.requestHeaders,
    })
    try {
      await renderFreeformDot(codeResult.code)
    } catch (renderError) {
      codeResult = await repairFreeformDotCode({
        code: codeResult.code,
        renderError: renderError instanceof Error ? renderError.message : String(renderError),
        requestHeaders: params.requestHeaders,
      })
    }
    return updateDiagramSpecAndRender({
      diagram,
      projectId,
      grantId,
      spec: { ...currentSpec, code: codeResult.code },
      userId,
    })
  }

  if (currentSpec.kind === 'plot') {
    await requirePythonPlotServer()
    const plotResult = await generatePlotAndRender({
      plotBrief: {
        ...currentSpec,
        description: [
          currentSpec.description,
          `USER MODIFICATION REQUEST (apply these changes): ${params.instruction}`,
        ].join('\n\n'),
        pythonSpec: undefined,
      },
      title: diagram.title,
      requestHeaders: params.requestHeaders,
    })
    const imageVersion = diagram.imageVersion + 1
    const imagePath = await saveDiagramAsset({
      diagramId: diagram.id,
      version: imageVersion,
      buffer: plotResult.rendered.buffer,
      format: plotResult.rendered.format,
    })
    await deleteDiagramAsset(diagram.imagePath)
    const updated = await prisma.grantDiagram.update({
      where: { id: diagram.id },
      data: {
        specJson: plotResult.spec as unknown as Prisma.InputJsonValue,
        status: 'READY',
        errorMessage: null,
        imagePath,
        imageFormat: plotResult.rendered.format,
        imageVersion,
        updatedByUserId: userId,
      },
    })
    return toGrantDiagramResponse({ diagram: updated, projectId, grantId })
  }

  const specResult = await refineDiagramSpec({
    kind: currentSpec.kind,
    currentSpec,
    instruction: params.instruction,
    context,
    requestHeaders: params.requestHeaders,
  })

  return updateDiagramSpecAndRender({
    diagram,
    projectId,
    grantId,
    spec: specResult.spec,
    userId,
  })
}

export async function deleteDiagram(diagram: GrantDiagram): Promise<void> {
  await deleteDiagramAsset(diagram.imagePath)
  await prisma.grantDiagram.delete({ where: { id: diagram.id } })
}

/** Flag diagrams whose source section content changed since generation. */
export async function markStaleDiagrams(grantSessionId: string): Promise<void> {
  const diagrams = await prisma.grantDiagram.findMany({
    where: { grantSessionId, status: 'READY', sourceFingerprint: { not: null } },
    select: { id: true, sectionKey: true, sourceFingerprint: true },
  })
  if (diagrams.length === 0) return

  const sectionKeys = Array.from(
    new Set(diagrams.map(d => d.sectionKey).filter((key): key is string => Boolean(key)))
  )
  if (sectionKeys.length === 0) return

  const drafts = await prisma.grantSectionDraft.findMany({
    where: { grantSessionId, sectionKey: { in: sectionKeys } },
  })
  const draftsByKey = new Map(drafts.map(d => [d.sectionKey, d]))

  const staleIds: string[] = []
  for (const diagram of diagrams) {
    if (!diagram.sectionKey) continue
    const draft = draftsByKey.get(diagram.sectionKey)
    if (!draft) continue
    const fingerprint = computeSourceFingerprint([buildDiagramSectionContext(draft)])
    if (fingerprint !== diagram.sourceFingerprint) staleIds.push(diagram.id)
  }
  if (staleIds.length > 0) {
    await prisma.grantDiagram.updateMany({
      where: { id: { in: staleIds } },
      data: { isStale: true },
    })
  }
}
