import crypto from 'crypto';
import { prisma } from '../prisma';
import { resolvePaperFigureImageUrl } from '../figure-generation/paper-figure-image';
import { refreshStoredPaperFigureMetadata } from '../figure-generation/paper-figure-metadata-refresh';
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureSafeDescription,
  getPaperFigureStatus,
  getPaperFigureStoredImagePath,
  isPaperFigureDeleted,
  isPaperFigureUsable,
} from '../figure-generation/paper-figure-record';

type FigurePlanRecord = {
  id: string;
  sessionId: string;
  figureNo: number;
  title: string;
  description: string | null;
  nodes: unknown;
  updatedAt: Date;
};

export interface FigureInferenceMeta {
  summary?: string;
  visibleElements?: string[];
  visibleText?: string[];
  keyVariables?: string[];
  comparedGroups?: string[];
  numericHighlights?: string[];
  observedPatterns?: string[];
  resultDetails?: string[];
  methodologyDetails?: string[];
  discussionCues?: string[];
  chartSignals?: string[];
  claimsSupported?: string[];
  claimsToAvoid?: string[];
  inferredAt?: string;
}

export interface FigurePromptEntry {
  id: string;
  figureNo: number;
  title: string;
  caption?: string;
  description?: string;
  notes?: string;
  category?: string;
  figureType?: string;
  status?: string;
  imagePath?: string;
  relevantSection?: string;
  figureRole?: string;
  whyThisFigure?: string;
  dataNeeded?: string;
  sectionFitJustification?: string;
  structuredHint?: string;
  inferredImageMeta?: FigureInferenceMeta | null;
  updatedAt?: string;
  versionStamp?: string;
}

export interface FigurePromptContext {
  useFigures: boolean;
  selectedFigureIds: string[];
  effectiveFigureIds: string[];
  figures: FigurePromptEntry[];
  waitedForMetadata: boolean;
}

export interface Pass1FigureGroundingSnapshot {
  enabled: boolean;
  selectedFigureIds: string[];
  effectiveFigureIds: string[];
  figureRefs: string[];
  figureSignature: string;
  newestFigureUpdatedAt?: string;
  waitedForMetadata?: boolean;
}

function normalizeSectionKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeSelectedFigureIds(rawIds?: string[] | null): string[] {
  if (!Array.isArray(rawIds)) return [];
  return Array.from(new Set(
    rawIds.map((id) => String(id || '').trim()).filter(Boolean)
  ));
}

function cleanPromptFigureText(value: unknown, maxLength: number = 240): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function summarizeFigureStructuredHint(meta: Record<string, unknown>): string {
  const chartSpec = asRecord(meta.chartSpec);
  if (Object.keys(chartSpec).length > 0) {
    const xAxisLabel = cleanPromptFigureText(chartSpec.xAxisLabel, 60);
    const yAxisLabel = cleanPromptFigureText(chartSpec.yAxisLabel, 60);
    const series = Array.isArray(chartSpec.series)
      ? (chartSpec.series as Array<Record<string, unknown>>)
          .map((entry) => cleanPromptFigureText(entry.label, 40))
          .filter(Boolean)
      : [];
    return [xAxisLabel ? `x=${xAxisLabel}` : '', yAxisLabel ? `y=${yAxisLabel}` : '', series.length > 0 ? `series=${series.join(', ')}` : '']
      .filter(Boolean)
      .join(' | ');
  }

  const diagramSpec = asRecord(meta.diagramSpec);
  if (Object.keys(diagramSpec).length > 0) {
    const layout = cleanPromptFigureText(diagramSpec.layout, 20);
    const nodes = Array.isArray(diagramSpec.nodes) ? diagramSpec.nodes.length : 0;
    const edges = Array.isArray(diagramSpec.edges) ? diagramSpec.edges.length : 0;
    const groups = Array.isArray(diagramSpec.groups) ? diagramSpec.groups.length : 0;
    return [
      layout ? `layout=${layout}` : '',
      nodes > 0 ? `nodes=${nodes}` : '',
      edges > 0 ? `edges=${edges}` : '',
      groups > 0 ? `groups=${groups}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }

  const illustrationSpec = asRecord(meta.illustrationSpecV2);
  if (Object.keys(illustrationSpec).length > 0) {
    const layout = cleanPromptFigureText(illustrationSpec.layout, 20);
    const panelCount = Number(illustrationSpec.panelCount);
    const figureGenre = cleanPromptFigureText(illustrationSpec.figureGenre || meta.figureGenre, 40);
    return [
      layout ? `layout=${layout}` : '',
      Number.isFinite(panelCount) && panelCount > 0 ? `panels=${panelCount}` : '',
      figureGenre ? `genre=${figureGenre}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }

  return '';
}

function parseFigureInferenceMeta(value: unknown): FigureInferenceMeta | null {
  const meta = asRecord(value);
  if (Object.keys(meta).length === 0) return null;

  const summary = cleanPromptFigureText(meta.summary, 400);
  const visibleElements = Array.isArray(meta.visibleElements)
    ? meta.visibleElements.map((item) => cleanPromptFigureText(item, 80)).filter(Boolean)
    : [];
  const visibleText = Array.isArray(meta.visibleText)
    ? meta.visibleText.map((item) => cleanPromptFigureText(item, 80)).filter(Boolean)
    : [];
  const keyVariables = Array.isArray(meta.keyVariables)
    ? meta.keyVariables.map((item) => cleanPromptFigureText(item, 120)).filter(Boolean)
    : [];
  const comparedGroups = Array.isArray(meta.comparedGroups)
    ? meta.comparedGroups.map((item) => cleanPromptFigureText(item, 120)).filter(Boolean)
    : [];
  const numericHighlights = Array.isArray(meta.numericHighlights)
    ? meta.numericHighlights.map((item) => cleanPromptFigureText(item, 140)).filter(Boolean)
    : [];
  const observedPatterns = Array.isArray(meta.observedPatterns)
    ? meta.observedPatterns.map((item) => cleanPromptFigureText(item, 160)).filter(Boolean)
    : [];
  const resultDetails = Array.isArray(meta.resultDetails)
    ? meta.resultDetails.map((item) => cleanPromptFigureText(item, 180)).filter(Boolean)
    : [];
  const methodologyDetails = Array.isArray(meta.methodologyDetails)
    ? meta.methodologyDetails.map((item) => cleanPromptFigureText(item, 180)).filter(Boolean)
    : [];
  const discussionCues = Array.isArray(meta.discussionCues)
    ? meta.discussionCues.map((item) => cleanPromptFigureText(item, 180)).filter(Boolean)
    : [];
  const chartSignals = Array.isArray(meta.chartSignals)
    ? meta.chartSignals.map((item) => cleanPromptFigureText(item, 120)).filter(Boolean)
    : [];
  const claimsSupported = Array.isArray(meta.claimsSupported)
    ? meta.claimsSupported.map((item) => cleanPromptFigureText(item, 140)).filter(Boolean)
    : [];
  const claimsToAvoid = Array.isArray(meta.claimsToAvoid)
    ? meta.claimsToAvoid.map((item) => cleanPromptFigureText(item, 140)).filter(Boolean)
    : [];
  const inferredAt = cleanPromptFigureText(meta.inferredAt, 40);

  if (
    !summary
    && visibleElements.length === 0
    && visibleText.length === 0
    && keyVariables.length === 0
    && numericHighlights.length === 0
    && observedPatterns.length === 0
    && resultDetails.length === 0
    && methodologyDetails.length === 0
    && discussionCues.length === 0
    && chartSignals.length === 0
    && claimsSupported.length === 0
    && claimsToAvoid.length === 0
  ) {
    return null;
  }

  return {
    ...(summary ? { summary } : {}),
    ...(visibleElements.length > 0 ? { visibleElements } : {}),
    ...(visibleText.length > 0 ? { visibleText } : {}),
    ...(keyVariables.length > 0 ? { keyVariables } : {}),
    ...(comparedGroups.length > 0 ? { comparedGroups } : {}),
    ...(numericHighlights.length > 0 ? { numericHighlights } : {}),
    ...(observedPatterns.length > 0 ? { observedPatterns } : {}),
    ...(resultDetails.length > 0 ? { resultDetails } : {}),
    ...(methodologyDetails.length > 0 ? { methodologyDetails } : {}),
    ...(discussionCues.length > 0 ? { discussionCues } : {}),
    ...(chartSignals.length > 0 ? { chartSignals } : {}),
    ...(claimsSupported.length > 0 ? { claimsSupported } : {}),
    ...(claimsToAvoid.length > 0 ? { claimsToAvoid } : {}),
    ...(inferredAt ? { inferredAt } : {}),
  };
}

function buildFallbackFigureSelection(
  figures: FigurePromptEntry[],
  sectionKey: string
): FigurePromptEntry[] {
  const normalizedSectionKey = normalizeSectionKey(sectionKey);
  const exactMatches = figures.filter((figure) => normalizeSectionKey(figure.relevantSection || '') === normalizedSectionKey);
  if (exactMatches.length > 0) return exactMatches;

  if (normalizedSectionKey === 'methodology') {
    const candidates = figures.filter((figure) =>
      figure.figureRole === 'EXPLAIN_METHOD'
      || figure.category === 'DIAGRAM'
      || figure.category === 'ILLUSTRATED_FIGURE'
    );
    if (candidates.length > 0) return candidates;
  }

  if (normalizedSectionKey === 'results') {
    const candidates = figures.filter((figure) =>
      figure.figureRole === 'SHOW_RESULTS'
      || figure.category === 'DATA_CHART'
      || figure.category === 'STATISTICAL_PLOT'
    );
    if (candidates.length > 0) return candidates;
  }

  if (normalizedSectionKey === 'discussion') {
    const candidates = figures.filter((figure) => figure.figureRole === 'INTERPRET');
    if (candidates.length > 0) return candidates;
  }

  return [];
}

function mapFigurePlanToPromptEntry(plan: FigurePlanRecord): FigurePromptEntry | null {
  const meta = asPaperFigureMeta(plan.nodes);
  const rawImagePath = getPaperFigureStoredImagePath(meta);
  if (isPaperFigureDeleted(meta) || !isPaperFigureUsable(meta, rawImagePath)) {
    return null;
  }

  const suggestionMeta = asRecord(meta.suggestionMeta);
  const imageVersion = cleanPromptFigureText(meta.checksum, 80)
    || cleanPromptFigureText(meta.generatedAt, 40)
    || rawImagePath;

  return {
    id: plan.id,
    figureNo: Number(plan.figureNo),
    title: cleanPromptFigureText(plan.title, 140) || `Figure ${plan.figureNo}`,
    caption: cleanPromptFigureText(getPaperFigureCaption(meta, plan.description || ''), 220),
    description: cleanPromptFigureText(getPaperFigureSafeDescription(meta, plan.description || ''), 220),
    notes: cleanPromptFigureText(meta.notes, 220),
    category: cleanPromptFigureText(meta.category, 40),
    figureType: cleanPromptFigureText(meta.figureType, 40),
    status: cleanPromptFigureText(getPaperFigureStatus(meta, rawImagePath), 40),
    imagePath: resolvePaperFigureImageUrl(plan.sessionId, plan.id, rawImagePath, imageVersion) || undefined,
    relevantSection: cleanPromptFigureText(suggestionMeta.relevantSection, 40),
    figureRole: cleanPromptFigureText(suggestionMeta.figureRole, 40),
    whyThisFigure: cleanPromptFigureText(suggestionMeta.whyThisFigure, 220),
    dataNeeded: cleanPromptFigureText(suggestionMeta.dataNeeded, 220),
    sectionFitJustification: cleanPromptFigureText(suggestionMeta.sectionFitJustification, 180),
    structuredHint: summarizeFigureStructuredHint(suggestionMeta),
    inferredImageMeta: parseFigureInferenceMeta(meta.inferredImageMeta),
    updatedAt: plan.updatedAt instanceof Date ? plan.updatedAt.toISOString() : undefined,
    versionStamp: cleanPromptFigureText(meta.checksum, 80)
      || (plan.updatedAt instanceof Date ? plan.updatedAt.toISOString() : '')
      || cleanPromptFigureText(meta.generatedAt, 40)
      || rawImagePath
  };
}

function shouldAwaitFigureMetadata(entry: FigurePromptEntry): boolean {
  if (!entry.imagePath || entry.inferredImageMeta) return false;
  const category = String(entry.category || '').trim().toUpperCase();
  const figureType = String(entry.figureType || '').trim().toLowerCase();
  return (
    category === 'DIAGRAM'
    || category === 'ILLUSTRATED_FIGURE'
    || figureType === 'plantuml'
    || figureType.includes('sketch')
    || figureType === 'flowchart'
    || figureType === 'architecture'
  );
}

export function computePass1FigureGroundingSignature(
  entries: Array<{ id: string; versionStamp?: string | null }>
): string {
  const normalized = entries
    .map((entry) => `${String(entry.id || '').trim()}:${String(entry.versionStamp || '').trim()}`)
    .filter((entry) => entry !== ':')
    .sort();
  if (normalized.length === 0) return '';
  return crypto.createHash('sha1').update(normalized.join('|')).digest('hex').slice(0, 16);
}

function getNewestFigureUpdatedAt(figures: FigurePromptEntry[]): string | undefined {
  const timestamps = figures
    .map((figure) => Date.parse(String(figure.updatedAt || '')))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}

async function queryFigurePlans(
  sessionId: string,
  selectedFigureIds: string[]
): Promise<FigurePlanRecord[]> {
  return prisma.figurePlan.findMany({
    where: {
      sessionId,
      ...(selectedFigureIds.length > 0 ? { id: { in: selectedFigureIds } } : {})
    },
    orderBy: { figureNo: 'asc' },
    select: {
      id: true,
      sessionId: true,
      figureNo: true,
      title: true,
      description: true,
      nodes: true,
      updatedAt: true,
    }
  });
}

export async function loadFigurePromptContext(params: {
  sessionId: string;
  sectionKey: string;
  useFigures?: boolean;
  selectedFigureIds?: string[];
  requestHeaders?: Record<string, string>;
  waitForPendingMetadata?: boolean;
}): Promise<FigurePromptContext> {
  if (params.useFigures !== true) {
    return { useFigures: false, selectedFigureIds: [], effectiveFigureIds: [], figures: [], waitedForMetadata: false };
  }

  const selectedFigureIds = normalizeSelectedFigureIds(params.selectedFigureIds);
  let plans = await queryFigurePlans(params.sessionId, selectedFigureIds);
  let figures = plans
    .map((plan) => mapFigurePlanToPromptEntry(plan))
    .filter((entry): entry is FigurePromptEntry => entry !== null);

  let effectiveFigures = selectedFigureIds.length > 0
    ? figures
    : buildFallbackFigureSelection(figures, params.sectionKey);
  let waitedForMetadata = false;

  if (params.waitForPendingMetadata && params.requestHeaders && effectiveFigures.some(shouldAwaitFigureMetadata)) {
    const pendingIds = new Set(
      effectiveFigures
        .filter(shouldAwaitFigureMetadata)
        .map((figure) => figure.id)
    );

    if (pendingIds.size > 0) {
      waitedForMetadata = true;
      await Promise.all(
        plans
          .filter((plan) => pendingIds.has(plan.id))
          .map((plan) => refreshStoredPaperFigureMetadata({
            requestHeaders: params.requestHeaders!,
            sessionId: params.sessionId,
            figureId: plan.id,
            fallbackTitle: plan.title,
            fallbackPrompt: plan.description || undefined,
            fallbackCategory: String(asPaperFigureMeta(plan.nodes).category || ''),
            fallbackFigureType: String(asPaperFigureMeta(plan.nodes).figureType || ''),
          }))
      );

      plans = await queryFigurePlans(params.sessionId, selectedFigureIds);
      figures = plans
        .map((plan) => mapFigurePlanToPromptEntry(plan))
        .filter((entry): entry is FigurePromptEntry => entry !== null);
      effectiveFigures = selectedFigureIds.length > 0
        ? figures
        : buildFallbackFigureSelection(figures, params.sectionKey);
    }
  }

  return {
    useFigures: effectiveFigures.length > 0,
    selectedFigureIds,
    effectiveFigureIds: effectiveFigures.map((figure) => figure.id),
    figures: effectiveFigures,
    waitedForMetadata,
  };
}

export function formatSelectedFigureContext(
  figureContext: Pick<FigurePromptContext, 'useFigures' | 'figures'>,
  sectionKey: string
): string {
  if (!figureContext.useFigures || figureContext.figures.length === 0) {
    return '';
  }

  const normalizedSectionKey = normalizeSectionKey(sectionKey);
  const header = [
    'FIGURE GROUNDING (USER-SELECTED OR SECTION-MATCHED):',
    '- Treat only the figure metadata below as authoritative; do not invent unseen visual details.',
    '- Reference figures in prose only as [Figure N].',
    normalizedSectionKey === 'methodology'
      ? '- In Methodology, use figures only to explain setup, flow, architecture, or procedure; do not claim outcome improvements from them.'
      : normalizedSectionKey === 'results'
        ? '- In Results, report only observations that are supported by the selected figures or their stored metadata.'
        : normalizedSectionKey === 'discussion'
          ? '- In Discussion, interpret only patterns already grounded in the selected figures or reported results.'
          : '- Use figures only when they directly strengthen this section.'
  ];

  const blocks = figureContext.figures.map((figure) => {
    const lines = [
      `Figure ${figure.figureNo}: ${figure.title}`,
      figure.relevantSection ? `  Suggested section: ${figure.relevantSection}` : '',
      figure.figureRole ? `  Role: ${figure.figureRole}` : '',
      figure.category || figure.figureType
        ? `  Type: ${[figure.category, figure.figureType].filter(Boolean).join(' / ')}`
        : '',
      figure.caption ? `  Caption: ${figure.caption}` : '',
      figure.description ? `  Description: ${figure.description}` : '',
      figure.notes ? `  Notes: ${figure.notes}` : '',
      figure.whyThisFigure ? `  Why this figure: ${figure.whyThisFigure}` : '',
      figure.dataNeeded ? `  Data represented: ${figure.dataNeeded}` : '',
      figure.sectionFitJustification ? `  Section fit: ${figure.sectionFitJustification}` : '',
      figure.structuredHint ? `  Structured hint: ${figure.structuredHint}` : '',
      figure.inferredImageMeta?.summary ? `  Visible summary: ${figure.inferredImageMeta.summary}` : '',
      figure.inferredImageMeta?.visibleElements?.length
        ? `  Visible elements: ${figure.inferredImageMeta.visibleElements.join('; ')}`
        : '',
      figure.inferredImageMeta?.visibleText?.length
        ? `  Visible text: ${figure.inferredImageMeta.visibleText.join('; ')}`
        : '',
      figure.inferredImageMeta?.keyVariables?.length
        ? `  Key variables: ${figure.inferredImageMeta.keyVariables.join('; ')}`
        : '',
      figure.inferredImageMeta?.comparedGroups?.length
        ? `  Compared groups: ${figure.inferredImageMeta.comparedGroups.join('; ')}`
        : '',
      figure.inferredImageMeta?.numericHighlights?.length
        ? `  Numeric highlights: ${figure.inferredImageMeta.numericHighlights.join('; ')}`
        : '',
      figure.inferredImageMeta?.observedPatterns?.length
        ? `  Observed patterns: ${figure.inferredImageMeta.observedPatterns.join('; ')}` 
        : '',
      figure.inferredImageMeta?.resultDetails?.length
        ? `  Results-ready details: ${figure.inferredImageMeta.resultDetails.join('; ')}`
        : '',
      figure.inferredImageMeta?.methodologyDetails?.length
        ? `  Methods-visible details: ${figure.inferredImageMeta.methodologyDetails.join('; ')}`
        : '',
      figure.inferredImageMeta?.discussionCues?.length
        ? `  Discussion cues: ${figure.inferredImageMeta.discussionCues.join('; ')}`
        : '',
      figure.inferredImageMeta?.chartSignals?.length
        ? `  Visible signals: ${figure.inferredImageMeta.chartSignals.join('; ')}`
        : '',
      figure.inferredImageMeta?.claimsSupported?.length
        ? `  Supported claims: ${figure.inferredImageMeta.claimsSupported.join('; ')}`
        : '',
      figure.inferredImageMeta?.claimsToAvoid?.length
        ? `  Avoid claiming: ${figure.inferredImageMeta.claimsToAvoid.join('; ')}`
        : ''
    ].filter(Boolean);

    return lines.join('\n');
  });

  return `${header.join('\n')}\n\n${blocks.join('\n\n')}`;
}

export function buildPass1FigureGroundingSnapshot(
  figureContext: FigurePromptContext | null | undefined
): Pass1FigureGroundingSnapshot | null {
  if (!figureContext?.useFigures || figureContext.figures.length === 0) {
    return null;
  }

  const signature = computePass1FigureGroundingSignature(
    figureContext.figures.map((figure) => ({
      id: figure.id,
      versionStamp: figure.versionStamp
    }))
  );

  return {
    enabled: true,
    selectedFigureIds: normalizeSelectedFigureIds(figureContext.selectedFigureIds),
    effectiveFigureIds: normalizeSelectedFigureIds(figureContext.effectiveFigureIds),
    figureRefs: figureContext.figures.map((figure) => `[Figure ${figure.figureNo}]`),
    figureSignature: signature,
    newestFigureUpdatedAt: getNewestFigureUpdatedAt(figureContext.figures),
    waitedForMetadata: figureContext.waitedForMetadata || undefined,
  };
}
