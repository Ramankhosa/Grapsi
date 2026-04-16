import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { generateFigureSuggestions } from '@/lib/figure-generation/llm-figure-service';
import { FigureSuggestion, type DataChartType } from '@/lib/figure-generation/types';
import { chooseDiagramRenderer } from '@/lib/figure-generation/diagram-renderer-policy';
import {
  normalizeFigurePreferences,
  DEFAULT_FIGURE_SUGGESTION_PREFERENCES,
  type FigureSuggestionPreferences
} from '@/lib/figure-generation/preferences';

export const runtime = 'nodejs';

// ── Types for persisted suggestion cache ────────────────────────────
type CachedSuggestionStatus = 'pending' | 'used' | 'dismissed';

interface CachedSuggestionItem {
  id: string;
  status: CachedSuggestionStatus;
  usedByFigureId?: string | null;
  usedAt?: string | null;
  // All original FigureSuggestion fields
  title: string;
  description: string;
  category: string;
  suggestedType?: string;
  rendererPreference?: string;
  relevantSection?: string;
  figureRole?: string;
  sectionFitJustification?: string;
  expectedByReviewers?: boolean;
  importance?: string;
  dataNeeded?: string;
  whyThisFigure?: string;
  renderSpec?: unknown;
  chartSpec?: unknown;
  diagramSpec?: unknown;
  illustrationSpec?: unknown;
  illustrationSpecV2?: unknown;
  figureGenre?: string;
  renderDirectives?: unknown;
  paperProfile?: unknown;
  sketchStyle?: string;
  sketchPrompt?: string;
  sketchMode?: string;
}

interface SuggestionCache {
  generatedAt: string;
  usedLLM: boolean;
  preferences?: unknown;
  items: CachedSuggestionItem[];
}

type FocusHints = {
  entities?: string[];
  metrics?: string[];
  verbs?: string[];
};

const suggestSchema = z.object({
  paperTitle: z.string().optional(),
  paperAbstract: z.string().optional(),
  sections: z.record(z.string()).optional(),
  researchType: z.string().optional(),
  datasetDescription: z.string().optional(),
  blueprint: z.object({
    thesisStatement: z.string().optional(),
    centralObjective: z.string().optional(),
    keyContributions: z.array(z.string()).optional(),
    sectionPlan: z.array(z.object({
      sectionKey: z.string(),
      mustCover: z.array(z.string()).optional(),
      mustAvoid: z.array(z.string()).optional()
    })).optional()
  }).optional(),
  preferences: z.object({
    stylePreset: z.enum(['auto', 'ieee_clean', 'nature_minimal', 'industrial_dashboard', 'technical_blueprint', 'conceptual_storyboard']).optional(),
    outputMix: z.enum(['auto', 'balanced', 'charts_first', 'diagrams_first', 'include_sketches']).optional(),
    chartPreference: z.enum(['auto', 'bar_line', 'distribution', 'correlation', 'comparative']).optional(),
    diagramPreference: z.enum(['auto', 'flow', 'architecture', 'sequence', 'conceptual']).optional(),
    visualTone: z.enum(['auto', 'formal', 'minimal', 'high_contrast', 'presentation_ready']).optional(),
    colorMode: z.enum(['auto', 'color', 'grayscale', 'colorblind_safe']).optional(),
    detailLevel: z.enum(['auto', 'simple', 'moderate', 'advanced']).optional(),
    annotationDensity: z.enum(['auto', 'light', 'balanced', 'detailed']).optional(),
    targetAudience: z.enum(['auto', 'academic', 'industry', 'mixed']).optional(),
    exportFormat: z.enum(['auto', 'png', 'svg', 'pdf']).optional(),
    strictness: z.enum(['soft', 'strict']).optional()
  }).optional(),
  // Whether to use LLM for suggestions (default true)
  useLLM: z.boolean().optional().default(true),
  // Focus mode: when provided, suggestions are constrained to this specific text
  focusText: z.string().max(5000).optional(),
  focusSection: z.string().optional(),
  focusMode: z.enum(['selection', 'section']).optional(),
  focusHints: z.object({
    entities: z.array(z.string().max(120)).max(20).optional(),
    metrics: z.array(z.string().max(120)).max(20).optional(),
    verbs: z.array(z.string().max(80)).max(20).optional()
  }).optional()
});


/** Lightweight session lookup – only checks ownership, returns figureSuggestionCache */
async function getSessionLight(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    select: { id: true, figureSuggestionCache: true }
  });
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      researchTopic: true,
      paperType: true,
      paperBlueprint: true,
      paperSections: {
        orderBy: { updatedAt: 'desc' }
      },
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  });
}

function extractSectionMap(session: any, overrideSections?: Record<string, string>): Record<string, string> {
  if (overrideSections && Object.keys(overrideSections).length > 0) {
    return overrideSections;
  }

  const fromPaperSections = Array.isArray(session?.paperSections)
    ? session.paperSections.reduce((acc: Record<string, string>, section: any) => {
        if (section?.sectionKey && typeof section?.content === 'string' && section.content.trim()) {
          acc[section.sectionKey] = section.content;
        }
        return acc;
      }, {})
    : {};

  if (Object.keys(fromPaperSections).length > 0) {
    return fromPaperSections;
  }

  return (session?.annexureDrafts?.[0] as any)?.extraSections || {};
}

function extractBlueprintContext(session: any) {
  const blueprint = session?.paperBlueprint;
  if (!blueprint) {
    return undefined;
  }

  const sectionPlanRaw = Array.isArray(blueprint.sectionPlan) ? blueprint.sectionPlan : [];
  return {
    thesisStatement: blueprint.thesisStatement || undefined,
    centralObjective: blueprint.centralObjective || undefined,
    keyContributions: Array.isArray(blueprint.keyContributions) ? blueprint.keyContributions : undefined,
    sectionPlan: sectionPlanRaw
      .filter((section: any) => section?.sectionKey)
      .map((section: any) => ({
        sectionKey: section.sectionKey,
        mustCover: Array.isArray(section.mustCover) ? section.mustCover : [],
        mustAvoid: Array.isArray(section.mustAvoid) ? section.mustAvoid : []
      }))
  };
}

function dedupeList(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function extractMetricHints(text: string): string[] {
  const hits: string[] = [];
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:%|ms|s|sec|seconds|min|minutes|hours|hz|khz|mhz|ghz|fps|mb|gb|tb)\b/gi,
    /\b(?:accuracy|precision|recall|f1|f1-score|auc|roc-auc|latency|throughput|loss|rmse|mae|mape|iou|bleu|rouge|perplexity)\b(?:\s*[:=]\s*\d+(?:\.\d+)?(?:\s*%|\s*ms|\s*s)?)?/gi,
    /\bp\s*[<=>]\s*0?\.\d+\b/gi,
    /\bN\s*=\s*\d+\b/gi
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) hits.push(...matches.map(m => m.trim()));
  }
  return dedupeList(hits, 10);
}

function extractVerbHints(text: string): string[] {
  const verbPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: 'compare', pattern: /\bcompar(?:e|es|ed|ing|ison)\b/gi },
    { label: 'classify', pattern: /\bclassif(?:y|ies|ied|ying|ication)\b/gi },
    { label: 'predict', pattern: /\bpredict(?:s|ed|ing|ion)\b/gi },
    { label: 'detect', pattern: /\bdetect(?:s|ed|ing|ion)\b/gi },
    { label: 'optimize', pattern: /\boptimi[sz](?:e|es|ed|ing|ation)\b/gi },
    { label: 'evaluate', pattern: /\bevaluat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'benchmark', pattern: /\bbenchmark(?:s|ed|ing)?\b/gi },
    { label: 'aggregate', pattern: /\baggregat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'train', pattern: /\btrain(?:s|ed|ing)?\b/gi },
    { label: 'infer', pattern: /\binfer(?:s|red|ring|ence)\b/gi },
    { label: 'segment', pattern: /\bsegment(?:s|ed|ing|ation)\b/gi },
    { label: 'cluster', pattern: /\bcluster(?:s|ed|ing)?\b/gi },
    { label: 'rank', pattern: /\brank(?:s|ed|ing)?\b/gi },
    { label: 'retrieve', pattern: /\bretriev(?:e|es|ed|ing|al)\b/gi },
    { label: 'summarize', pattern: /\bsummariz(?:e|es|ed|ing|ation)\b/gi },
    { label: 'generate', pattern: /\bgenerat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'analyze', pattern: /\banaly[sz](?:e|es|ed|ing|is)\b/gi }
  ];

  const scored: Array<{ label: string; count: number }> = [];
  for (const item of verbPatterns) {
    const matches = text.match(item.pattern);
    if (!matches || matches.length === 0) continue;
    scored.push({ label: item.label, count: matches.length });
  }
  scored.sort((a, b) => b.count - a.count);
  return scored.slice(0, 8).map(item => item.label);
}

function extractEntityHints(text: string, metricHints: string[], verbHints: string[]): string[] {
  const candidates = new Map<string, { value: string; score: number }>();
  const metricSet = new Set(metricHints.map(v => v.toLowerCase()));
  const verbSet = new Set(verbHints);
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'those', 'these', 'using', 'use', 'used', 'our', 'their',
    'into', 'onto', 'across', 'within', 'between', 'through', 'under', 'over', 'after', 'before', 'about', 'results',
    'result', 'paper', 'section', 'method', 'methods', 'approach', 'approaches', 'model', 'models', 'system', 'systems',
    'data', 'dataset', 'datasets', 'analysis', 'performance', 'value', 'values', 'table', 'figure'
  ]);

  const pushCandidate = (raw: string, bonus: number) => {
    const value = raw.replace(/[^\w\s\-\/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const lower = value.toLowerCase();
    if (stopwords.has(lower) || metricSet.has(lower) || verbSet.has(lower)) return;
    if (lower.length < 3) return;
    if (/^\d/.test(lower)) return;
    const current = candidates.get(lower);
    candidates.set(lower, {
      value,
      score: (current?.score || 0) + 1 + bonus
    });
  };

  const acronymMatches = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) || [];
  acronymMatches.forEach((hit) => pushCandidate(hit, 3));

  const properNounMatches = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) || [];
  properNounMatches.forEach((hit) => pushCandidate(hit, 2));

  const taggedPhraseMatches = text.match(/\b(?:dataset|model|algorithm|framework|module|component|pipeline|architecture|network|baseline|variant|classifier|encoder|decoder|protocol)\s+[A-Za-z0-9][A-Za-z0-9\-_/]*(?:\s+[A-Za-z0-9][A-Za-z0-9\-_/]*)?/gi) || [];
  taggedPhraseMatches.forEach((hit) => pushCandidate(hit, 2));

  const tokens = text.match(/\b[a-zA-Z][a-zA-Z0-9\-_]{3,}\b/g) || [];
  tokens.forEach((token) => pushCandidate(token, /[A-Z]/.test(token) ? 1 : 0));

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(item => item.value);
}

function extractFocusHints(text: string): FocusHints {
  const metricHints = extractMetricHints(text);
  const verbHints = extractVerbHints(text);
  const entityHints = extractEntityHints(text, metricHints, verbHints);
  return {
    entities: entityHints,
    metrics: metricHints,
    verbs: verbHints
  };
}

function mergeFocusHints(provided?: FocusHints, extracted?: FocusHints): FocusHints | undefined {
  const entities = dedupeList([...(provided?.entities || []), ...(extracted?.entities || [])], 10);
  const metrics = dedupeList([...(provided?.metrics || []), ...(extracted?.metrics || [])], 10);
  const verbs = dedupeList([...(provided?.verbs || []), ...(extracted?.verbs || [])], 8);
  if (entities.length === 0 && metrics.length === 0 && verbs.length === 0) return undefined;
  return { entities, metrics, verbs };
}

export async function POST(
  request: NextRequest, 
  context: { params: Promise<{ paperId: string }> }
) {
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
    const data = suggestSchema.parse(body);
    const preferences: FigureSuggestionPreferences = normalizeFigurePreferences(
      data.preferences || DEFAULT_FIGURE_SUGGESTION_PREFERENCES
    );

    // Get existing figures to avoid duplicates
    const existingFigures = await prisma.figurePlan.findMany({
      where: { sessionId },
      select: { title: true, nodes: true }
    });
    
    const existingFigureList = existingFigures.map(f => ({
      title: f.title,
      type: (f.nodes as any)?.figureType || 'unknown'
    }));

    let suggestions: import('@/lib/figure-generation/types').FigureSuggestion[];
    let llmMetadata: { tokensUsed?: number; model?: string } = {};

    // Check if we should use LLM for suggestions
    if (data.useLLM !== false) {
      console.log('[PaperFigures] Using LLM for figure suggestions...');
      
      // Get request headers for LLM call
      const requestHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });

      // Extract paper content from session if not provided
      const paperTitle = data.paperTitle || session.researchTopic?.title || '';
      const paperAbstract = data.paperAbstract || session.researchTopic?.abstractDraft || '';
      const sections = extractSectionMap(session, data.sections);
      const researchType = data.researchType || session.paperType?.name || 'research article';
      const datasetDescription = data.datasetDescription || session.researchTopic?.datasetDescription || '';
      const paperBlueprint = data.blueprint || extractBlueprintContext(session);

      const isFocused = !!data.focusText?.trim();
      const focusHints = isFocused
        ? mergeFocusHints(data.focusHints, extractFocusHints(data.focusText || ''))
        : undefined;
      const llmResult = await generateFigureSuggestions(
        {
          paperTitle,
          paperAbstract,
          sections,
          researchType,
          datasetDescription,
          paperBlueprint,
          preferences,
          existingFigures: existingFigureList,
          maxSuggestions: isFocused ? 4 : 8,
          // Focus fields – when present, the LLM constrains suggestions to this excerpt
          focusText: data.focusText,
          focusSection: data.focusSection,
          focusMode: data.focusMode,
          focusHints
        },
        requestHeaders
      );

      if (llmResult.success && llmResult.suggestions) {
        suggestions = llmResult.suggestions;
        llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
        console.log(`[PaperFigures] LLM generated ${suggestions.length} suggestions using ${llmResult.model}`);
      } else {
        // Fall back to rule-based suggestions
        console.log('[PaperFigures] LLM failed, using rule-based suggestions:', llmResult.error);
        suggestions = generateRuleBasedSuggestions(
          paperTitle,
          paperAbstract,
          sections,
          session
        );
      }
    } else {
      // Use rule-based suggestions
      const paperTitle = data.paperTitle || session.researchTopic?.title || '';
      const paperAbstract = data.paperAbstract || session.researchTopic?.abstractDraft || '';
      const sections = extractSectionMap(session, data.sections);
      suggestions = generateRuleBasedSuggestions(
        paperTitle,
        paperAbstract,
        sections,
        session
      );
    }

    // ── Persist suggestions to session cache ─────────────────────────
    // Each suggestion gets a stable UUID so the UI can track status.
    const cachedItems: CachedSuggestionItem[] = suggestions.map((s, idx) => ({
      id: `sug-${Date.now()}-${idx}`,
      status: 'pending' as CachedSuggestionStatus,
      usedByFigureId: null,
      usedAt: null,
      title: s.title,
      description: s.description,
      category: s.category,
      suggestedType: s.suggestedType,
      rendererPreference: s.rendererPreference,
      relevantSection: s.relevantSection,
      figureRole: (s as any).figureRole,
      sectionFitJustification: (s as any).sectionFitJustification,
      expectedByReviewers: (s as any).expectedByReviewers,
      importance: s.importance,
      dataNeeded: s.dataNeeded,
      whyThisFigure: s.whyThisFigure,
      renderSpec: (s as any).renderSpec,
      chartSpec: (s as any).chartSpec,
      diagramSpec: s.diagramSpec,
      illustrationSpec: (s as any).illustrationSpec,
      illustrationSpecV2: (s as any).illustrationSpecV2,
      figureGenre: (s as any).figureGenre,
      renderDirectives: (s as any).renderDirectives,
      paperProfile: (s as any).paperProfile,
      sketchStyle: s.sketchStyle,
      sketchPrompt: s.sketchPrompt,
      sketchMode: s.sketchMode
    }));

    const cache: SuggestionCache = {
      generatedAt: new Date().toISOString(),
      usedLLM: !!llmMetadata.model,
      preferences,
      items: cachedItems
    };

    // Fire-and-forget – don't block the response for a cache write
    prisma.draftingSession
      .update({
        where: { id: sessionId },
        data: { figureSuggestionCache: cache as any }
      })
      .catch(err => console.error('[PaperFigures] Failed to persist suggestion cache:', err));

    return NextResponse.json({ 
      suggestions: cachedItems,   // return items with stable IDs + status
      meta: {
        usedLLM: !!llmMetadata.model,
        preferences,
        ...llmMetadata
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Suggest error:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestions' },
      { status: 500 }
    );
  }
}

/**
 * Generates exactly 5-6 figure suggestions based on paper content.
 * This is a rule-based fallback implementation when LLM is unavailable or disabled.
 */
function generateRuleBasedSuggestions(
  title: string,
  abstract: string,
  sections: Record<string, string>,
  session: any
): FigureSuggestion[] {
  const content = `${title} ${abstract} ${Object.values(sections).join(' ')}`.toLowerCase();
  const isSystemPaper = hasKeywords(content, ['system', 'architecture', 'framework', 'module', 'deployment', 'service']);
  const suggestions: FigureSuggestion[] = [
    {
      title: 'Figure 1: Research Overview Infographic',
      description: 'A compact infographic overview (4 panels) that orients readers to the paper: problem context, input data, core method, and expected outputs/evaluation. Keep labels short and schematic so it functions as an introduction-level Figure 1 without replacing methodological detail.',
      category: 'ILLUSTRATED_FIGURE',
      suggestedType: 'sketch-guided',
      relevantSection: 'introduction',
      figureRole: 'ORIENT',
      sectionFitJustification: 'Introduction figures should orient readers at a high level.',
      expectedByReviewers: false,
      importance: 'recommended',
      dataNeeded: 'Named problem statement, high-level method stages, output artifacts, and headline evaluation targets.',
      whyThisFigure: 'It quickly orients readers before technical detail.',
      illustrationSpec: {
        layout: 'PANELS',
        panelCount: 4,
        flowDirection: 'LR',
        panels: [
          { idHint: 'problem', title: 'Problem', elements: ['Challenge', 'Context'] },
          { idHint: 'input', title: 'Inputs', elements: ['Dataset', 'Signals'] },
          { idHint: 'method', title: 'Method', elements: ['Pipeline', 'Core Model'] },
          { idHint: 'output', title: 'Outputs', elements: ['Metrics', 'Use Case'] }
        ],
        elements: ['icons', 'boxes', 'arrows', 'badges'],
        steps: ['Context', 'Input', 'Method', 'Output'],
        captionDraft: 'Infographic overview of problem context, method, and expected outcomes.'
      },
      illustrationSpecV2: {
        layout: 'PANELS',
        panelCount: 4,
        flowDirection: 'LR',
        figureGenre: 'METHOD_BLOCK',
        panels: [
          { idHint: 'problem', title: 'Problem', elements: ['Challenge', 'Context'] },
          { idHint: 'input', title: 'Inputs', elements: ['Dataset', 'Signals'] },
          { idHint: 'method', title: 'Method', elements: ['Pipeline', 'Core Model'] },
          { idHint: 'output', title: 'Outputs', elements: ['Metrics', 'Use Case'] }
        ],
        elements: ['icons', 'boxes', 'arrows', 'badges'],
        steps: ['Context', 'Input', 'Method', 'Output'],
        renderDirectives: {
          aspectRatio: '3:1',
          fillCanvasPercentMin: 85,
          whitespaceMaxPercent: 15,
          textPolicy: { maxLabelsTotal: 4, maxWordsPerLabel: 3, forbidAllCaps: true, titlesOnlyPreferred: true },
          stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'grayscale_plus_one_accent' },
          compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: true }
        },
        captionDraft: 'Infographic overview of problem context, method, and expected outcomes.'
      },
      figureGenre: 'METHOD_BLOCK',
      renderDirectives: {
        aspectRatio: '3:1',
        fillCanvasPercentMin: 85,
        whitespaceMaxPercent: 15,
        textPolicy: { maxLabelsTotal: 4, maxWordsPerLabel: 3, forbidAllCaps: true, titlesOnlyPreferred: true },
        stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'grayscale_plus_one_accent' },
        compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: true }
      },
      renderSpec: {
        kind: 'illustration',
        illustrationSpecV2: {
          layout: 'PANELS',
          panelCount: 4,
          flowDirection: 'LR',
          figureGenre: 'METHOD_BLOCK',
          panels: [
            { idHint: 'problem', title: 'Problem', elements: ['Challenge', 'Context'] },
            { idHint: 'input', title: 'Inputs', elements: ['Dataset', 'Signals'] },
            { idHint: 'method', title: 'Method', elements: ['Pipeline', 'Core Model'] },
            { idHint: 'output', title: 'Outputs', elements: ['Metrics', 'Use Case'] }
          ],
          elements: ['icons', 'boxes', 'arrows', 'badges'],
          steps: ['Context', 'Input', 'Method', 'Output'],
          renderDirectives: {
            aspectRatio: '3:1',
            fillCanvasPercentMin: 85,
            whitespaceMaxPercent: 15,
            textPolicy: { maxLabelsTotal: 4, maxWordsPerLabel: 3, forbidAllCaps: true, titlesOnlyPreferred: true },
            stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'grayscale_plus_one_accent' },
            compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: true }
          }
        }
      },
      sketchStyle: 'academic',
      sketchMode: 'GUIDED',
      sketchPrompt: `Create a flat-vector academic infographic for "${title}" with four left-to-right panels: Problem, Inputs, Method, Outputs. Use icons, boxes, and arrows only. Keep labels under four words each. White background, restrained color palette, consistent stroke weights, and clean spacing. No photorealism, no 3D effects, no people, no overlaid title/caption text, and no figure numbering.`
    },
    {
      title: 'Methodology Pipeline Diagram',
      description: 'A deterministic flowchart of the end-to-end methodology showing input acquisition, preprocessing, core model/algorithm stage, validation, and output generation. Include explicit transitions and any feedback loop used in training/tuning.',
      category: 'DIAGRAM',
      suggestedType: 'flowchart',
      relevantSection: 'methodology',
      figureRole: 'EXPLAIN_METHOD',
      sectionFitJustification: 'Methodology requires reproducible, stepwise pipeline visualization.',
      expectedByReviewers: true,
      importance: 'required',
      dataNeeded: 'Ordered method stages, stage inputs/outputs, optional branch conditions, and validation criteria.',
      whyThisFigure: 'It provides the reproducibility-focused method blueprint reviewers expect.',
      diagramSpec: buildRuleDiagramSpec('flowchart', 'Methodology Pipeline')
    },
    {
      title: 'Results: Baseline vs Proposed Comparison',
      description: 'A results bar chart comparing baseline methods against the proposed method across all reported datasets/tasks. Use consistent metric orientation and include one grouped bar set per dataset or evaluation condition.',
      category: 'DATA_CHART',
      suggestedType: 'bar',
      relevantSection: 'results',
      figureRole: 'SHOW_RESULTS',
      sectionFitJustification: 'Results must foreground quantitative evidence and direct comparisons.',
      expectedByReviewers: true,
      importance: 'required',
      dataNeeded: 'Metric values for each method (baseline and proposed) per dataset/condition.',
      whyThisFigure: 'It directly demonstrates relative performance gains or tradeoffs.',
      chartSpec: buildRuleChartSpec('bar', 'Dataset / Condition', 'Primary Metric (%)', 'dataset', 'metric_value')
    },
    {
      title: 'Results: Ablation or Sensitivity Analysis',
      description: 'A line or grouped chart showing how performance changes when key components/hyperparameters are removed or varied. Ensure each variant is explicitly labeled and aligned with the ablation narrative in the text.',
      category: 'STATISTICAL_PLOT',
      suggestedType: 'line',
      relevantSection: 'results',
      figureRole: 'SHOW_RESULTS',
      sectionFitJustification: 'Ablation/sensitivity evidence is expected in experimental results.',
      expectedByReviewers: true,
      importance: 'required',
      dataNeeded: 'Variant name, component toggle/parameter value, and resulting metric per run/condition.',
      whyThisFigure: 'It validates which components drive performance.',
      chartSpec: buildRuleChartSpec('line', 'Variant / Parameter', 'Performance Metric (%)', 'variant', 'metric_value')
    },
    {
      title: 'Results: Error Breakdown by Category',
      description: 'A chart showing error or failure distribution across classes, cohorts, or operating ranges to reveal boundary behavior and weaknesses.',
      category: 'DATA_CHART',
      suggestedType: 'scatter',
      relevantSection: 'results',
      figureRole: 'SHOW_RESULTS',
      sectionFitJustification: 'Error analysis strengthens quantitative claims in results.',
      expectedByReviewers: true,
      importance: 'recommended',
      dataNeeded: 'Category identifier, error rate/count, optional confidence interval or per-run variance.',
      whyThisFigure: 'It makes failure patterns explicit and supports balanced interpretation.',
      chartSpec: buildRuleChartSpec('scatter', 'Category / Range', 'Error Metric', 'category', 'error_value')
    },
    {
      title: isSystemPaper ? 'Methodology: System Architecture View' : 'Discussion: Limitations and Implications Map',
      description: isSystemPaper
        ? 'A high-level architecture diagram of major subsystems and data/control flow, kept within compact node/edge limits.'
        : 'A compact implication/limitations map showing where the method works, fails, and key threats to validity.',
      category: 'DIAGRAM',
      suggestedType: isSystemPaper ? 'architecture' : 'flowchart',
      relevantSection: isSystemPaper ? 'methodology' : 'discussion',
      figureRole: isSystemPaper ? 'EXPLAIN_METHOD' : 'INTERPRET',
      sectionFitJustification: isSystemPaper
        ? 'System papers benefit from architecture context in methodology.'
        : 'Discussion should interpret limits and implications of findings.',
      expectedByReviewers: false,
      importance: 'recommended',
      dataNeeded: isSystemPaper
        ? 'Named subsystems/modules, interfaces, and deployment boundaries.'
        : 'Failure modes, limitation categories, and implication statements supported by results.',
      whyThisFigure: isSystemPaper
        ? 'It clarifies component boundaries and interfaces.'
        : 'It helps readers translate findings into practical boundaries.',
      diagramSpec: buildRuleDiagramSpec(isSystemPaper ? 'architecture' : 'flowchart', isSystemPaper ? 'System Architecture' : 'Limitations Map')
    }
  ];

  return suggestions.map((suggestion) => {
    if (suggestion.category === 'DIAGRAM') {
      const rendererDecision = chooseDiagramRenderer({
        diagramType: suggestion.suggestedType || 'flowchart',
        title: suggestion.title,
        description: suggestion.description
      });
      return {
        ...suggestion,
        rendererPreference: rendererDecision.renderer
      };
    }
    return suggestion;
  });
}

function buildRuleChartSpec(
  chartType: DataChartType,
  xAxisLabel: string,
  yAxisLabel: string,
  xField: string,
  yField: string
) {
  return {
    chartType,
    xAxisLabel,
    yAxisLabel,
    xField,
    yField,
    series: [
      { label: 'Primary', yField },
      { label: 'Baseline', yField: `baseline_${yField}` }
    ],
    aggregation: 'mean',
    baselineLabel: 'Baseline'
  };
}

function buildRuleDiagramSpec(type: string, title: string) {
  const normalizedType = (type || '').toLowerCase();
  if (normalizedType === 'sequence') {
    return {
      layout: 'LR' as const,
      nodes: [
        { idHint: 'actorA', label: 'Actor A', group: 'Participants' },
        { idHint: 'serviceB', label: 'Service B', group: 'Participants' },
        { idHint: 'storeC', label: 'Store C', group: 'Participants' }
      ],
      edges: [
        { fromHint: 'actorA', toHint: 'serviceB', label: 'request', type: 'solid' as const },
        { fromHint: 'serviceB', toHint: 'storeC', label: 'query', type: 'solid' as const },
        { fromHint: 'storeC', toHint: 'serviceB', label: 'response', type: 'dashed' as const }
      ],
      groups: [
        { name: 'Participants', nodeIds: ['actorA', 'serviceB', 'storeC'] }
      ],
      splitSuggestion: `If ${title} is too complex, split into interaction request path and response path.`
    };
  }

  return {
    layout: 'LR' as const,
    nodes: [
      { idHint: 'inputStage', label: 'Input Stage', group: 'Input' },
      { idHint: 'processStage', label: 'Processing Stage', group: 'Processing' },
      { idHint: 'validationStage', label: 'Validation Stage', group: 'Processing' },
      { idHint: 'outputStage', label: 'Output Stage', group: 'Output' }
    ],
    edges: [
      { fromHint: 'inputStage', toHint: 'processStage', label: 'feeds', type: 'solid' as const },
      { fromHint: 'processStage', toHint: 'validationStage', label: 'checks', type: 'solid' as const },
      { fromHint: 'validationStage', toHint: 'outputStage', label: 'outputs', type: 'solid' as const }
    ],
    groups: [
      { name: 'Input', nodeIds: ['inputStage'] },
      { name: 'Processing', nodeIds: ['processStage', 'validationStage'] },
      { name: 'Output', nodeIds: ['outputStage'] }
    ],
    splitSuggestion: `If ${title} exceeds complexity budget, split into process and validation subfigures.`
  };
}

/**
 * Helper to check if content contains any of the keywords
 */
function hasKeywords(content: string, keywords: string[]): boolean {
  return keywords.some(keyword => content.includes(keyword));
}

// ── GET: Retrieve persisted suggestion cache ──────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { paperId: sessionId } = await context.params;
    const session = await getSessionLight(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const cache = session.figureSuggestionCache as SuggestionCache | null;
    if (!cache || !Array.isArray(cache.items)) {
      return NextResponse.json({ suggestions: [], meta: { cached: false } });
    }

    return NextResponse.json({
      suggestions: cache.items,
      meta: {
        cached: true,
        generatedAt: cache.generatedAt,
        usedLLM: cache.usedLLM,
        preferences: cache.preferences
      }
    });
  } catch (err) {
    console.error('[PaperFigures] GET suggestion cache error:', err);
    return NextResponse.json({ error: 'Failed to load suggestion cache' }, { status: 500 });
  }
}

// ── PATCH: Update suggestion statuses ─────────────────────────────
const patchSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    status: z.enum(['pending', 'used', 'dismissed']),
    usedByFigureId: z.string().optional().nullable()
  })).min(1)
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { paperId: sessionId } = await context.params;
    const session = await getSessionLight(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = patchSchema.parse(body);

    const cache = (session.figureSuggestionCache as SuggestionCache | null) || {
      generatedAt: new Date().toISOString(),
      usedLLM: false,
      items: []
    };

    // Build a lookup map for the updates
    const updateMap = new Map(data.updates.map(u => [u.id, u]));
    const now = new Date().toISOString();

    const updatedItems = cache.items.map(item => {
      const update = updateMap.get(item.id);
      if (!update) return item;
      return {
        ...item,
        status: update.status,
        usedByFigureId: update.usedByFigureId ?? item.usedByFigureId ?? null,
        usedAt: update.status === 'used' ? now : item.usedAt
      };
    });

    const updatedCache: SuggestionCache = { ...cache, items: updatedItems };
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { figureSuggestionCache: updatedCache as any }
    });

    return NextResponse.json({ success: true, suggestions: updatedItems });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }
    console.error('[PaperFigures] PATCH suggestion cache error:', err);
    return NextResponse.json({ error: 'Failed to update suggestion cache' }, { status: 500 });
  }
}

