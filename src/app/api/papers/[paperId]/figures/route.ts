import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { resolvePaperFigureImageUrl } from '@/lib/figure-generation/paper-figure-image';
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureCaptionSeed,
  getPaperFigureGenerationPrompt,
  getPaperFigureImageVersion,
  getPaperFigureSafeDescription,
  getPaperFigureStatus,
  getPaperFigureStoredImagePath,
  isPaperFigureDeleted,
} from '@/lib/figure-generation/paper-figure-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const createSchema = z.object({
  title: z.string().min(1),
  caption: z.string().optional().default(''),
  generationPrompt: z.string().optional().default(''),
  figureType: z.string().min(1),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATED_FIGURE', 'ILLUSTRATION', 'SKETCH', 'CUSTOM']).optional(),
  notes: z.string().optional(),
  figureNo: z.number().optional(),
  status: z.enum(['PLANNED', 'GENERATING', 'GENERATED', 'FAILED']).optional(),
  suggestionMeta: z.object({
    relevantSection: z.string().optional().nullable(),
    figureRole: z.enum(['ORIENT', 'POSITION', 'EXPLAIN_METHOD', 'SHOW_RESULTS', 'INTERPRET']).optional().nullable(),
    sectionFitJustification: z.string().optional().nullable(),
    expectedByReviewers: z.boolean().optional().nullable(),
    importance: z.enum(['required', 'recommended', 'optional']).optional().nullable(),
    dataNeeded: z.string().optional().nullable(),
    whyThisFigure: z.string().optional().nullable(),
    rendererPreference: z.enum(['plantuml', 'mermaid', 'auto']).optional().nullable(),
    diagramSpec: z.object({
      layout: z.enum(['LR', 'TD']).optional(),
      nodes: z.array(z.object({
        idHint: z.string(),
        label: z.string(),
        group: z.string().optional()
      })).optional(),
      edges: z.array(z.object({
        fromHint: z.string(),
        toHint: z.string(),
        label: z.string().optional(),
        type: z.enum(['solid', 'dashed', 'async']).optional()
      })).optional(),
      groups: z.array(z.object({
        name: z.string(),
        nodeIds: z.array(z.string()).optional(),
        description: z.string().optional()
      })).optional(),
      splitSuggestion: z.string().optional()
    }).optional().nullable(),
    chartSpec: z.object({
      chartType: z.string().optional(),
      xAxisLabel: z.string().optional(),
      yAxisLabel: z.string().optional(),
      xField: z.string().optional(),
      yField: z.string().optional(),
      series: z.array(z.object({
        label: z.string(),
        yField: z.string(),
        confidenceField: z.string().optional()
      })).optional(),
      aggregation: z.string().optional(),
      baselineLabel: z.string().optional(),
      placeholderPolicy: z.object({
        allowed: z.boolean().optional(),
        label: z.string().optional(),
        shape: z.string().optional(),
        rangeHint: z.string().optional()
      }).optional(),
      notes: z.string().optional()
    }).optional().nullable(),
    illustrationSpec: z.object({
      layout: z.enum(['PANELS', 'STRIP']).optional(),
      panelCount: z.number().int().optional(),
      stepCount: z.number().int().optional(),
      flowDirection: z.enum(['LR', 'TD']).optional(),
      panels: z.array(z.object({
        idHint: z.string(),
        title: z.string(),
        elements: z.array(z.string()).optional()
      })).optional(),
      elements: z.array(z.string()).optional(),
      steps: z.array(z.string()).optional(),
      captionDraft: z.string().optional(),
      splitSuggestion: z.string().optional()
    }).optional().nullable(),
    illustrationSpecV2: z.object({
      layout: z.enum(['PANELS', 'STRIP']).optional(),
      panelCount: z.number().int().optional(),
      stepCount: z.number().int().optional(),
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
      renderDirectives: z.object({
        aspectRatio: z.string().optional(),
        fillCanvasPercentMin: z.number().optional(),
        whitespaceMaxPercent: z.number().optional(),
        textPolicy: z.object({
          maxLabelsTotal: z.number().int().optional(),
          maxWordsPerLabel: z.number().int().optional(),
          forbidAllCaps: z.boolean().optional(),
          titlesOnlyPreferred: z.boolean().optional()
        }).optional(),
        stylePolicy: z.object({
          noGradients: z.boolean().optional(),
          no3D: z.boolean().optional(),
          noClipart: z.boolean().optional(),
          whiteBackground: z.boolean().optional(),
          paletteMode: z.string().optional()
        }).optional(),
        compositionPolicy: z.object({
          layoutMode: z.enum(['PANELS', 'STRIP']).optional(),
          equalPanels: z.boolean().optional(),
          noTextOutsidePanels: z.boolean().optional()
        }).optional()
      }).optional(),
      actors: z.array(z.string()).optional(),
      props: z.array(z.string()).optional(),
      forbiddenElements: z.array(z.string()).optional()
    }).optional().nullable(),
    renderSpec: z.object({
      kind: z.enum(['chart', 'diagram', 'illustration']),
      chartSpec: z.any().optional(),
      diagramSpec: z.any().optional(),
      illustrationSpecV2: z.any().optional()
    }).optional().nullable(),
    figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional().nullable(),
    renderDirectives: z.object({
      aspectRatio: z.string().optional(),
      fillCanvasPercentMin: z.number().optional(),
      whitespaceMaxPercent: z.number().optional(),
      textPolicy: z.any().optional(),
      stylePolicy: z.any().optional(),
      compositionPolicy: z.any().optional()
    }).optional().nullable(),
    paperProfile: z.object({
      paperGenre: z.string(),
      studyType: z.enum(['experimental', 'survey', 'qualitative', 'mixed-methods', 'simulation', 'theoretical', 'unknown']),
      dataAvailability: z.enum(['provided', 'partial', 'none'])
    }).optional().nullable(),
    // Sketch/illustration-specific fields
    sketchStyle: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional().nullable(),
    sketchPrompt: z.string().optional().nullable(),
    sketchMode: z.enum(['SUGGEST', 'GUIDED']).optional().nullable()
  }).optional().nullable()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where
  });
}

function toResponse(plan: any) {
  const meta = asPaperFigureMeta(plan.nodes);
  const rawImagePath = getPaperFigureStoredImagePath(meta);
  const imageVersion = getPaperFigureImageVersion(meta, rawImagePath);
  const imagePath = resolvePaperFigureImageUrl(plan.sessionId, plan.id, rawImagePath, imageVersion);
  const status = getPaperFigureStatus(meta, rawImagePath);
  
  // Map figureType to category
  const typeToCategory: Record<string, string> = {
    'bar': 'DATA_CHART',
    'line': 'DATA_CHART',
    'pie': 'DATA_CHART',
    'scatter': 'DATA_CHART',
    'radar': 'DATA_CHART',
    'doughnut': 'DATA_CHART',
    'horizontalBar': 'DATA_CHART',
    'flowchart': 'DIAGRAM',
    'sequence': 'DIAGRAM',
    'class': 'DIAGRAM',
    'er': 'DIAGRAM',
    'gantt': 'DIAGRAM',
    'state': 'DIAGRAM',
    'architecture': 'DIAGRAM',
    'plantuml': 'DIAGRAM',
    'histogram': 'STATISTICAL_PLOT',
    'boxplot': 'STATISTICAL_PLOT',
    'heatmap': 'STATISTICAL_PLOT',
    'sketch-auto': 'ILLUSTRATED_FIGURE',
    'sketch-guided': 'ILLUSTRATED_FIGURE',
    'sketch-refine': 'ILLUSTRATED_FIGURE',
    'sketch': 'ILLUSTRATED_FIGURE',
    'custom': 'CUSTOM'
  };
  
  const figureType = typeof meta.figureType === 'string' && meta.figureType.trim()
    ? meta.figureType.trim()
    : 'flowchart';
  const category = typeof meta.category === 'string' && meta.category.trim()
    ? meta.category.trim()
    : typeToCategory[figureType] || 'DIAGRAM';
  const caption = getPaperFigureCaption(meta, plan.description || '');
  const generationPrompt = getPaperFigureGenerationPrompt(meta, plan.description || '');
  
  return {
    id: plan.id,
    figureNo: plan.figureNo,
    title: plan.title,
    caption,
    description: getPaperFigureSafeDescription(meta, plan.description || ''),
    generationPrompt,
    figureType,
    category,
    notes: meta.notes || '',
    status,
    imagePath,
    generatedCode: meta.generatedCode || null,
    suggestionMeta: meta.suggestionMeta || null,
    inferredImageMeta: meta.inferredImageMeta || null,
    updatedAt: plan.updatedAt instanceof Date ? plan.updatedAt.toISOString() : null
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ paperId: string }> }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId } = await context.params;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const plans = await prisma.figurePlan.findMany({
      where: { sessionId },
      orderBy: { figureNo: 'asc' }
    });

    // Backward-compatible guard for any legacy soft-delete markers in nodes JSON.
    const visiblePlans = plans.filter((plan: any) => {
      const meta = asPaperFigureMeta(plan.nodes);
      return !isPaperFigureDeleted(meta);
    });

    return NextResponse.json(
      { figures: visiblePlans.map(toResponse) },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      }
    );
  } catch (error) {
    console.error('[PaperFigures] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch figures' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ paperId: string }> }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId } = await context.params;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = createSchema.parse(body);

    const latest = await prisma.figurePlan.findFirst({
      where: { sessionId },
      orderBy: { figureNo: 'desc' }
    });
    const nextFigureNo = data.figureNo || (latest?.figureNo || 0) + 1;
    const initialCaption = data.caption.trim() || getPaperFigureCaptionSeed({
      suggestionMeta: data.suggestionMeta || null
    });

    const meta = {
      figureType: data.figureType,
      category: data.category || 'DIAGRAM',
      caption: initialCaption,
      generationPrompt: data.generationPrompt.trim() || undefined,
      notes: data.notes || '',
      status: data.status || 'PLANNED',
      suggestionMeta: data.suggestionMeta || null
    };

    const plan = await prisma.figurePlan.create({
      data: {
        sessionId,
        figureNo: nextFigureNo,
        title: data.title,
        description: initialCaption || '',
        nodes: meta,
        edges: []
      }
    });

    return NextResponse.json({ figure: toResponse(plan) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[PaperFigures] POST error:', error);
    return NextResponse.json({ error: 'Failed to create figure' }, { status: 500 });
  }
}
