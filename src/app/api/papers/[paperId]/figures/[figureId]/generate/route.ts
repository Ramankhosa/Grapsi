import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { getDraftingSessionForUser } from '@/lib/grants/shadowSessionAccess';
import { 
  generateChartFromConfig,
  generateFromMermaidCode,
  generateFromPlantUMLCode,
  FigureGenerationResult
} from '@/lib/figure-generation';
import {
  generateChartConfig,
  generateDiagramCode,
  repairDiagramCode
} from '@/lib/figure-generation/llm-figure-service';
import {
  generateStatisticalPlotSpec,
  hasResolvedExplicitChartData,
  resolveChartGenerationInput,
  toFigureDataPayload,
} from '@/lib/figure-generation/llm-plot-service';
import { chooseDiagramRenderer } from '@/lib/figure-generation/diagram-renderer-policy';
import type { DiagramStructuredSpec, FigureData } from '@/lib/figure-generation/types';
import {
  normalizeFigurePreferences,
  resolveThemeFromPreferences,
  resolveSketchStyleFromPreferences
} from '@/lib/figure-generation/preferences';
import {
  asPaperFigureMeta,
  getPaperFigureCaption,
  getPaperFigureCaptionSeed,
  getPaperFigureGenerationPrompt,
  getPaperFigureImageVersion,
} from '@/lib/figure-generation/paper-figure-record';
import { scheduleStoredPaperFigureMetadataRefresh } from '@/lib/figure-generation/paper-figure-metadata-refresh';
import { generatePaperSketch } from '@/lib/figure-generation/paper-sketch-service';
import { resolvePaperFigureImageUrl } from '@/lib/figure-generation/paper-figure-image';
import { llmGateway } from '@/lib/metering/gateway';
import type { TaskCode } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const generateSchema = z.object({
  figureType: z.string(),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATED_FIGURE', 'ILLUSTRATION', 'SKETCH', 'CUSTOM']),
  title: z.string(),
  caption: z.string().optional().nullable(),
  // User's natural language description for LLM generation
  description: z.string().optional().nullable(),
  modificationRequest: z.string().optional().nullable(),
  data: z.object({
    labels: z.array(z.string()).optional(),
    datasets: z.array(z.object({
      label: z.string(),
      data: z.array(z.number()),
      errors: z.array(z.number()).optional()
    })).optional(),
    values: z.array(z.number()).optional(),
    xValues: z.array(z.number()).optional(),
    yValues: z.array(z.number()).optional(),
    groups: z.record(z.string(), z.array(z.number())).optional(),
    method1: z.array(z.number()).optional(),
    method2: z.array(z.number()).optional(),
    curves: z.array(z.object({
      label: z.string().optional(),
      fpr: z.array(z.number()),
      tpr: z.array(z.number()),
      auc: z.number().optional()
    })).optional(),
    studies: z.array(z.object({
      label: z.string(),
      effect: z.number(),
      ci_low: z.number().optional(),
      ci_high: z.number().optional(),
      weight: z.number().optional(),
      type: z.enum(['study', 'summary']).optional()
    })).optional(),
    matrix: z.array(z.array(z.number())).optional(),
    matrixLabels: z.array(z.string()).optional()
  }).optional().nullable(), // Allow null for diagrams that don't need data
  code: z.string().optional().nullable(),
  theme: z.string().optional().nullable(),
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
  suggestionMeta: z.object({
    relevantSection: z.string().optional(),
    figureRole: z.enum(['ORIENT', 'POSITION', 'EXPLAIN_METHOD', 'SHOW_RESULTS', 'INTERPRET']).optional(),
    sectionFitJustification: z.string().optional(),
    expectedByReviewers: z.boolean().optional(),
    importance: z.enum(['required', 'recommended', 'optional']).optional(),
    dataNeeded: z.string().optional(),
    whyThisFigure: z.string().optional(),
    rendererPreference: z.enum(['plantuml', 'mermaid', 'auto']).optional(),
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
    }).optional(),
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
    }).optional(),
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
      renderDirectives: z.object({
        aspectRatio: z.string().optional(),
        fillCanvasPercentMin: z.number().optional(),
        whitespaceMaxPercent: z.number().optional(),
        textPolicy: z.any().optional(),
        stylePolicy: z.any().optional(),
        compositionPolicy: z.any().optional()
      }).optional(),
      actors: z.array(z.string()).optional(),
      props: z.array(z.string()).optional(),
      forbiddenElements: z.array(z.string()).optional()
    }).optional(),
    renderSpec: z.object({
      kind: z.enum(['chart', 'diagram', 'illustration']),
      chartSpec: z.any().optional(),
      diagramSpec: z.any().optional(),
      illustrationSpecV2: z.any().optional()
    }).optional(),
    figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
    renderDirectives: z.object({
      aspectRatio: z.string().optional(),
      fillCanvasPercentMin: z.number().optional(),
      whitespaceMaxPercent: z.number().optional(),
      textPolicy: z.any().optional(),
      stylePolicy: z.any().optional(),
      compositionPolicy: z.any().optional()
    }).optional(),
    paperProfile: z.object({
      paperGenre: z.string(),
      studyType: z.enum(['experimental', 'survey', 'qualitative', 'mixed-methods', 'simulation', 'theoretical', 'unknown']),
      dataAvailability: z.enum(['provided', 'partial', 'none'])
    }).optional(),
    // Sketch/illustration-specific fields
    sketchStyle: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional(),
    sketchPrompt: z.string().optional(),
    sketchMode: z.enum(['SUGGEST', 'GUIDED']).optional()
  }).optional(),
  // Whether to use LLM for code generation
  useLLM: z.boolean().optional().default(true)
});

// Use absolute path for reliable file operations
const FIGURE_UPLOAD_DIR = path.join(process.cwd(), 'public/uploads/figures');
const FIGURE_METADATA_STAGE_CODE = 'PAPER_FIGURE_METADATA_INFER';

async function getSessionForUser(
  sessionId: string,
  user: { id: string; roles?: string[]; tenantId?: string | null }
) {
  return getDraftingSessionForUser(sessionId, user, 'editContent', {
    include: {
      researchTopic: true,
      paperBlueprint: true,
      paperSections: {
        orderBy: { updatedAt: 'desc' }
      }
    }
  });
}

/**
 * Build concise paper context string for LLM grounding.
 * This ensures generated figures are relevant to the paper, not generic.
 */
function buildPaperContext(session: any): string {
  const parts: string[] = [];

  const topic = session?.researchTopic;
  if (topic?.title) parts.push(`Paper title: "${topic.title}"`);
  if (topic?.abstractDraft) {
    const abstract = topic.abstractDraft.length > 500
      ? topic.abstractDraft.slice(0, 500) + '...'
      : topic.abstractDraft;
    parts.push(`Abstract: ${abstract}`);
  }

  const blueprint = session?.paperBlueprint;
  if (blueprint?.thesisStatement) parts.push(`Thesis: ${blueprint.thesisStatement}`);
  if (blueprint?.centralObjective) parts.push(`Objective: ${blueprint.centralObjective}`);

  if (Array.isArray(session?.paperSections)) {
    const sectionSnippets = session.paperSections
      .filter((s: any) => s?.sectionKey && s?.content)
      .slice(0, 4) // Limit to avoid token bloat
      .map((s: any) => {
        const content = s.content.length > 300 ? s.content.slice(0, 300) + '...' : s.content;
        return `[${s.sectionKey}] ${content}`;
      });
    if (sectionSnippets.length > 0) {
      parts.push(`Key sections:\n${sectionSnippets.join('\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

function buildStructuredChartData(
  data: Record<string, any> | null | undefined,
  fallbackLabel: string
): FigureData | null {
  if (!data) return null;

  if (Array.isArray(data.labels) && Array.isArray(data.datasets) && data.datasets.length > 0) {
    return {
      labels: data.labels,
      datasets: data.datasets.map((dataset: any) => ({
        label: typeof dataset?.label === 'string' && dataset.label.trim() ? dataset.label.trim() : fallbackLabel,
        data: Array.isArray(dataset?.data) ? dataset.data.map((value: unknown) => Number(value)).filter(Number.isFinite) : [],
        errors: Array.isArray(dataset?.errors) ? dataset.errors.map((value: unknown) => Number(value)).filter(Number.isFinite) : undefined
      })).filter((dataset: any) => dataset.data.length > 0)
    };
  }

  if (Array.isArray(data.labels) && Array.isArray(data.values) && data.labels.length === data.values.length && data.values.length > 0) {
    return {
      labels: data.labels,
      datasets: [{
        label: fallbackLabel,
        data: data.values.map((value: unknown) => Number(value)).filter(Number.isFinite)
      }]
    };
  }

  return null;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .replace(/[%]$/g, '')
    .replace(/,/g, '');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitRawDataRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const delimited = ['\t', '|', ';', ',']
    .map((delimiter) => {
      const cells = trimmed
        .split(delimiter)
        .map((cell) => cell.trim())
        .filter(Boolean);
      return cells.length >= 2 ? cells : [];
    })
    .find((cells) => cells.length >= 2);

  return delimited || [];
}

function buildStructuredChartDataFromText(
  requestText: string | null | undefined,
  fallbackLabel: string
): FigureData | null {
  if (!requestText) return null;

  const lines = requestText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const tabularRows = lines
    .map(splitRawDataRow)
    .filter((cells) => cells.length >= 2 && cells.some((cell) => parseNumericValue(cell) !== null));

  if (tabularRows.length >= 2) {
    const columnCount = Math.max(...tabularRows.map((row) => row.length));
    const rows = tabularRows
      .filter((row) => row.length === columnCount)
      .map((row) => row.slice(0, columnCount));

    if (rows.length >= 2) {
      const hasHeader = rows[0].some((cell) => parseNumericValue(cell) === null)
        && rows.slice(1).some((row) => row.slice(1).some((cell) => parseNumericValue(cell) !== null));
      const header = hasHeader ? rows[0] : undefined;
      const dataRows = hasHeader ? rows.slice(1) : rows;

      if (dataRows.length >= 2) {
        if (columnCount === 2) {
          const parsedValues = dataRows.map((row) => parseNumericValue(row[1]));
          if (parsedValues.every((value) => value !== null)) {
            return {
              labels: dataRows.map((row) => row[0]),
              datasets: [{
                label: header?.[1] || fallbackLabel,
                data: parsedValues as number[]
              }]
            };
          }
        }

        if (columnCount >= 3) {
          const labels = dataRows.map((row) => row[0]);
          const datasets = Array.from({ length: columnCount - 1 }, (_, index) => {
            const column = index + 1;
            const parsedValues = dataRows.map((row) => parseNumericValue(row[column]));
            if (!parsedValues.every((value) => value !== null)) return null;
            return {
              label: header?.[column] || `${fallbackLabel} ${index + 1}`,
              data: parsedValues as number[]
            };
          }).filter((dataset): dataset is { label: string; data: number[] } => !!dataset);

          if (labels.length > 0 && datasets.length > 0) {
            return { labels, datasets };
          }
        }
      }
    }
  }

  const pairRows = lines
    .map((line) => line.match(/^(.+?)\s*[:=]\s*(-?\d+(?:,\d{3})*(?:\.\d+)?%?)$/))
    .filter((match): match is RegExpMatchArray => !!match);

  if (pairRows.length >= 2) {
    const labels = pairRows.map((match) => match[1].trim());
    const values = pairRows
      .map((match) => parseNumericValue(match[2]))
      .filter((value): value is number => value !== null);

    if (labels.length === values.length && values.length > 0) {
      return {
        labels,
        datasets: [{
          label: fallbackLabel,
          data: values
        }]
      };
    }
  }

  return null;
}

function resolveChartData(
  data: Record<string, any> | null | undefined,
  requestText: string | null | undefined,
  fallbackLabel: string
): { chartData: FigureData | null; source: 'payload' | 'request_text' | 'none' } {
  const fromPayload = buildStructuredChartData(data, fallbackLabel);
  if (fromPayload) {
    return { chartData: fromPayload, source: 'payload' };
  }

  const fromRequestText = buildStructuredChartDataFromText(requestText, fallbackLabel);
  if (fromRequestText) {
    return { chartData: fromRequestText, source: 'request_text' };
  }

  return { chartData: null, source: 'none' };
}

function mapThemeToPythonJournal(theme: string | null | undefined): 'nature' | 'ieee' | 'elsevier' | 'default' {
  if (theme === 'ieee') return 'ieee';
  if (theme === 'nature') return 'nature';
  if (theme === 'modern') return 'elsevier';
  return 'default';
}

function withStageLimitGuidance(errorMessage: string | undefined, stageCode: string): string {
  const message = (errorMessage || 'LLM generation failed').trim();
  const normalized = message.toLowerCase();
  const isStageLimit = normalized.includes('input exceeds stage limit')
    || normalized.includes('configured limit')
    || normalized.includes('maxtokensin');

  if (!isStageLimit) return message;

  return [
    message,
    `Stage config issue: ${stageCode} has maxTokensIn lower than this request.`,
    'Fix by running one of:',
    '- npx tsx scripts/fix-figure-stage-limits.ts (quick patch for figure-related stage limits)',
    '- npx tsx scripts/seed-publication-ideation-stages.ts (full paper-stage reseed with generous limits)',
    'Then restart the app/PM2 process to reload configuration.'
  ].join('\n');
}

function wasRecentFailure(timestamp: unknown, withinHours: number = 24): boolean {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= withinHours * 60 * 60 * 1000;
}

function codeLooksMermaid(code?: string | null): boolean {
  if (!code) return false;
  return /(flowchart|graph\s+(TD|TB|BT|RL|LR)|sequenceDiagram|erDiagram|gantt|stateDiagram)/i.test(code);
}

function sanitizeAscii(input: string, keepNewlines: boolean = false): string {
  const normalized = (input || '').normalize('NFKD');
  return keepNewlines
    ? normalized.replace(/[^\x20-\x7E\n]/g, '')
    : normalized.replace(/[^\x20-\x7E]/g, '');
}

function sanitizeLabel(input: string): string {
  const cleaned = sanitizeAscii(input || '')
    .replace(/["'`[\]{}()<>:,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6);
  return (words.join(' ').slice(0, 28).trim() || 'Node');
}

function sanitizeAlias(input: string, index: number): string {
  const base = sanitizeAscii(input || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = base.split(' ').filter(Boolean);
  let alias = parts.map((part, idx) =>
    idx === 0 ? part.toLowerCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`
  ).join('');
  if (!alias) alias = `node${index + 1}`;
  if (!/^[a-zA-Z]/.test(alias)) alias = `n${alias}`;
  return alias.slice(0, 24);
}

function normalizeDiagramSpec(spec?: DiagramStructuredSpec | null): DiagramStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : [])
    .slice(0, 15)
    .map((node, idx) => ({
      idHint: sanitizeAlias(node?.idHint || node?.label || `node${idx + 1}`, idx),
      label: sanitizeLabel(node?.label || node?.idHint || `Node ${idx + 1}`),
      group: node?.group ? sanitizeLabel(node.group) : undefined
    }));
  const nodeSet = new Set(nodes.map(n => n.idHint));
  const edges = (Array.isArray(spec.edges) ? spec.edges : [])
    .slice(0, 18)
    .map((edge, idx) => ({
      fromHint: sanitizeAlias(edge?.fromHint || `node${idx + 1}`, idx),
      toHint: sanitizeAlias(edge?.toHint || `node${idx + 2}`, idx + 1),
      label: edge?.label ? sanitizeLabel(edge.label) : undefined,
      type: (edge?.type === 'dashed' || edge?.type === 'async' ? edge.type : 'solid') as 'solid' | 'dashed' | 'async'
    }))
    .filter(edge => nodeSet.has(edge.fromHint) && nodeSet.has(edge.toHint));
  const groups = (Array.isArray(spec.groups) ? spec.groups : [])
    .slice(0, 8)
    .map(group => ({
      name: sanitizeLabel(group?.name || 'Group'),
      nodeIds: Array.isArray(group?.nodeIds)
        ? group.nodeIds.map((id, idx) => sanitizeAlias(id, idx)).filter(id => nodeSet.has(id))
        : undefined,
      description: group?.description ? sanitizeLabel(group.description) : undefined
    }))
    .filter(group => (group.nodeIds?.length || 0) > 0);

  if (nodes.length === 0) return undefined;

  return {
    layout: spec.layout === 'LR' ? 'LR' : 'TD',
    nodes,
    edges,
    groups,
    splitSuggestion: spec.splitSuggestion ? sanitizeAscii(spec.splitSuggestion).slice(0, 140) : undefined
  };
}

interface FigureInferenceMeta {
  summary: string;
  visibleElements: string[];
  visibleText: string[];
  keyVariables: string[];
  comparedGroups: string[];
  numericHighlights: string[];
  observedPatterns: string[];
  resultDetails: string[];
  methodologyDetails: string[];
  discussionCues: string[];
  chartSignals: string[];
  claimsSupported: string[];
  claimsToAvoid: string[];
  inferredAt: string;
  model?: string;
}

function extractJsonObjectFromOutput(raw: string): Record<string, unknown> | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanInferenceText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function cleanInferenceList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => cleanInferenceText(entry, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    )
  );
}

function parseFigureInferenceMeta(
  raw: unknown,
  inferredAt: string,
  model?: string
): FigureInferenceMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const summary = cleanInferenceText(record.summary, 400);
  const visibleElements = cleanInferenceList(record.visibleElements, 8, 100);
  const visibleText = cleanInferenceList(record.visibleText, 10, 120);
  const keyVariables = cleanInferenceList(record.keyVariables, 8, 120);
  const comparedGroups = cleanInferenceList(record.comparedGroups, 8, 120);
  const numericHighlights = cleanInferenceList(record.numericHighlights, 8, 140);
  const observedPatterns = cleanInferenceList(record.observedPatterns, 8, 160);
  const resultDetails = cleanInferenceList(record.resultDetails, 8, 180);
  const methodologyDetails = cleanInferenceList(record.methodologyDetails, 8, 180);
  const discussionCues = cleanInferenceList(record.discussionCues, 8, 180);
  const chartSignals = cleanInferenceList(record.chartSignals, 8, 160);
  const claimsSupported = cleanInferenceList(record.claimsSupported, 8, 180);
  const claimsToAvoid = cleanInferenceList(record.claimsToAvoid, 8, 180);

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
  ) {
    return null;
  }

  return {
    summary,
    visibleElements,
    visibleText,
    keyVariables,
    comparedGroups,
    numericHighlights,
    observedPatterns,
    resultDetails,
    methodologyDetails,
    discussionCues,
    chartSignals,
    claimsSupported,
    claimsToAvoid,
    inferredAt,
    ...(model ? { model } : {})
  };
}

async function inferFigureImageMetadata(params: {
  requestHeaders: Record<string, string>;
  imageBase64: string;
  mimeType: string;
  title: string;
  caption?: string | null;
  category: string;
  figureType: string;
  suggestionMeta?: Record<string, unknown> | null;
}): Promise<FigureInferenceMeta | null> {
  const suggestionMeta = params.suggestionMeta && typeof params.suggestionMeta === 'object'
    ? params.suggestionMeta
    : null;
  const prompt = `You are extracting drafting-grade, evidence-safe metadata from a research-paper figure image.

Return ONLY valid JSON with this exact shape:
{
  "summary": "1-2 sentence visible summary",
  "visibleElements": ["up to 8 concrete visible elements"],
  "visibleText": ["up to 10 short labels or text strings that are visibly present"],
  "keyVariables": ["up to 8 variables, metrics, axes, components, or entities visible in the figure"],
  "comparedGroups": ["up to 8 methods, classes, conditions, cohorts, panels, or groups being compared"],
  "numericHighlights": ["up to 8 exact values, ranges, counts, percentages, or ranks visibly readable in the figure"],
  "observedPatterns": ["up to 8 directly visible patterns, comparisons, gradients, peaks, lows, or ordering statements"],
  "resultDetails": ["up to 8 drafting-ready observations that a Results section can safely report"],
  "methodologyDetails": ["up to 8 setup, workflow, architecture, or procedural details visible in the figure"],
  "discussionCues": ["up to 8 restrained interpretation cues, limitations, anomalies, or implications suggested by the visible figure"],
  "chartSignals": ["up to 8 directly visible trends or signals"],
  "claimsSupported": ["up to 8 conservative claims directly supported by the figure"],
  "claimsToAvoid": ["up to 8 claims that would overreach the visible evidence"]
}

Rules:
- Describe only what is visible in the image or explicit from visible labels, legends, axes, numbers, panels, and annotations.
- Use the metadata below only to disambiguate purpose; do not invent unseen details.
- Keep every list item short, concrete, and drafting-usable.
- If text or numbers are unreadable, return empty arrays rather than guessing.
- "numericHighlights" must contain only visibly readable values or ranges.
- "resultDetails" must be observation-only prose that a Results section can say safely.
- "methodologyDetails" must focus on structure, components, steps, or setup visible in the figure.
- "discussionCues" can mention anomalies, trade-offs, limitations, or interpretation directions only if visually grounded.
- "claimsSupported" must stay strictly proportional to visible evidence.
- "claimsToAvoid" should explicitly flag causal, statistical-significance, generalization, or performance claims not proven by the figure alone.

Figure metadata:
- Title: ${cleanInferenceText(params.title, 160)}
- Caption: ${cleanInferenceText(params.caption, 220) || 'None'}
- Category: ${cleanInferenceText(params.category, 40)}
- Figure type: ${cleanInferenceText(params.figureType, 40)}
- Suggestion meta: ${cleanInferenceText(suggestionMeta ? JSON.stringify(suggestionMeta) : 'None', 600)}`;

  try {
    const result = await llmGateway.executeLLMOperation(
      { headers: params.requestHeaders },
      {
        taskCode: 'LLM3_DIAGRAM' as TaskCode,
        stageCode: FIGURE_METADATA_STAGE_CODE,
        content: {
          parts: [
            { type: 'text', text: prompt },
            {
              type: 'image',
              image: {
                mimeType: params.mimeType,
                data: params.imageBase64,
                description: cleanInferenceText(params.title, 120) || 'Research figure'
              }
            }
          ]
        },
        parameters: {
          temperature: 0,
          reasoning_effort: 'low'
        },
        metadata: {
          module: 'paper-figures',
          stageCode: FIGURE_METADATA_STAGE_CODE,
          category: params.category,
          figureType: params.figureType
        }
      }
    );

    if (!result.success || !result.response?.output) {
      return null;
    }

    const inferredAt = new Date().toISOString();
    const parsed = extractJsonObjectFromOutput(result.response.output);
    return parseFigureInferenceMeta(parsed, inferredAt, result.response.modelClass || undefined);
  } catch (error) {
    console.warn('[PaperFigures] Figure metadata inference failed:', error);
    return null;
  }
}

async function inferFigureMetadataFromStoredImage(params: {
  requestHeaders: Record<string, string>;
  imagePath: string;
  title: string;
  caption?: string | null;
  category: string;
  figureType: string;
  suggestionMeta?: Record<string, unknown> | null;
}): Promise<FigureInferenceMeta | null> {
  try {
    const relativePath = params.imagePath.startsWith('/')
      ? params.imagePath.slice(1)
      : params.imagePath;
    const absolutePath = path.join(process.cwd(), 'public', relativePath);
    const buffer = await fs.readFile(absolutePath);
    const lowerPath = params.imagePath.toLowerCase();
    const mimeType = lowerPath.endsWith('.svg')
      ? 'image/svg+xml'
      : lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png';

    return inferFigureImageMetadata({
      requestHeaders: params.requestHeaders,
      imageBase64: buffer.toString('base64'),
      mimeType,
      title: params.title,
      caption: params.caption,
      category: params.category,
      figureType: params.figureType,
      suggestionMeta: params.suggestionMeta
    });
  } catch (error) {
    console.warn('[PaperFigures] Stored-image metadata inference failed:', error);
    return null;
  }
}

export async function POST(
  request: NextRequest, 
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId, figureId } = await context.params;
    
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Get the figure plan
    const figurePlan = await prisma.figurePlan.findFirst({
      where: { id: figureId, sessionId }
    });
    
    if (!figurePlan) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = generateSchema.parse(body);
    const normalizedPreferences = normalizeFigurePreferences(data.preferences);
    const resolvedTheme = (data.theme as any) || resolveThemeFromPreferences(normalizedPreferences);

    // Get request headers for LLM calls
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    let result: FigureGenerationResult;
    let llmMetadata: { tokensUsed?: number; model?: string } = {};
    const meta = asPaperFigureMeta(figurePlan.nodes);
    const persistedPrompt = getPaperFigureGenerationPrompt(meta, figurePlan.description || '');
    const persistedCaption = getPaperFigureCaption(meta, figurePlan.description || '');
    let rendererDecisionMeta: { renderer: 'plantuml' | 'mermaid'; reason: string } | null = null;
    let finalDiagramRenderer: 'plantuml' | 'mermaid' | null = null;
    let mermaidRenderFailed = false;
    let plantUMLRenderFailed = false;
    let mermaidRenderError: string | null = null;
    let plantUMLRenderError: string | null = null;
    let inferredImageMeta: FigureInferenceMeta | null = null;
    let resolvedChartInput: ReturnType<typeof resolveChartGenerationInput> | null = null;

    // Build paper context for LLM grounding
    const paperContext = buildPaperContext(session);

    // Generate based on category
    switch (data.category) {
      case 'DATA_CHART':
        {
          const chartEnrichment = data.suggestionMeta || (meta.suggestionMeta as any) || {};
          const chartPayload = asObjectRecord(data.data) || asObjectRecord(meta.chartData);
          const chartInput = resolveChartGenerationInput(
            data.figureType,
            chartPayload as Record<string, any> | null | undefined,
            data.description || chartEnrichment?.dataNeeded || chartEnrichment?.whyThisFigure || null,
            data.title
          );
          resolvedChartInput = chartInput;

          if (!hasResolvedExplicitChartData(chartInput)) {
            result = {
              success: false,
              error: chartInput.source === 'raw_request'
                ? 'Numeric text was detected, but it could not be parsed into exact chart values. Paste explicit CSV/TSV, label,value rows, or x,y rows so the chart uses complete and correct data.'
                : 'Publication-grade chart generation requires explicit numeric data. Provide a structured payload or paste raw CSV/TSV, label,value rows, or x,y rows; placeholder charts are disabled.',
              errorCode: 'INVALID_DATA'
            };
            break;
          }

          if (data.useLLM === false) {
            result = {
              success: false,
              error: 'Publication-grade chart generation requires AI-assisted chart configuration. Generic direct-render fallback is disabled.',
              errorCode: 'INVALID_DATA'
            };
            break;
          }

          console.log('[PaperFigures] Using LLM to generate publication-grade chart config...');

          let groundedDescription = sanitizeAscii(
            data.description
              || chartEnrichment.whyThisFigure
              || `Generate a publication-grade ${data.figureType} chart for the supplied research data focused on "${data.title}".`,
            true
          );

          if (paperContext) {
            groundedDescription = `PAPER CONTEXT (use this to make the chart relevant to the research):\n${sanitizeAscii(paperContext, true)}\n\nFIGURE REQUEST:\n${groundedDescription}`;
          }
          if (chartInput.source === 'request_text') {
            groundedDescription += '\n\nRAW DATA NOTE: Numeric series were parsed from the figure request text. Preserve those values exactly.';
          } else if (chartInput.source === 'raw_request') {
            groundedDescription += '\n\nRAW DATA NOTE: The request includes messy raw numeric content. Normalize it conservatively and use only values explicitly present in the request.';
          }
          if (chartEnrichment.relevantSection) {
            groundedDescription += `\n\nTARGET SECTION: This chart belongs in the "${sanitizeAscii(String(chartEnrichment.relevantSection))}" section of the paper.`;
          }
          if (chartEnrichment.whyThisFigure) {
            groundedDescription += `\nPURPOSE: ${sanitizeAscii(String(chartEnrichment.whyThisFigure))}`;
          }
          if (chartEnrichment.dataNeeded) {
            groundedDescription += `\nDATA TO VISUALIZE: ${sanitizeAscii(String(chartEnrichment.dataNeeded))}`;
          }
          if (data.modificationRequest) {
            groundedDescription += `\n\nUSER MODIFICATION REQUEST (apply these changes):\n${sanitizeAscii(data.modificationRequest, true)}`;
          }

          const llmResult = await generateChartConfig(
            {
              description: groundedDescription,
              chartType: data.figureType as any,
              title: data.title,
              sectionType: chartEnrichment.relevantSection,
              figureRole: chartEnrichment.figureRole as any,
              paperGenre: chartEnrichment.paperProfile?.paperGenre,
              studyType: chartEnrichment.paperProfile?.studyType,
              chartSpec: chartEnrichment.chartSpec,
              data: {
                labels: chartInput.labels,
                datasets: chartInput.datasets,
                pointDatasets: chartInput.pointDatasets,
                values: chartInput.datasets?.length === 1 ? chartInput.datasets[0].data : undefined,
                datasetLabel: chartInput.datasets?.length === 1 ? chartInput.datasets[0].label : undefined
              },
              rawDataText: chartInput.rawDataText,
              style: resolvedTheme as any
            },
            requestHeaders
          );

          if (llmResult.success && llmResult.config) {
            llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
            inferredImageMeta = llmResult.inferredMeta || null;
            result = await generateChartFromConfig(llmResult.config as any, {
              theme: { preset: resolvedTheme as any },
              format: 'png'
            });

            if (result.success) {
              result.generatedCode = JSON.stringify(llmResult.config, null, 2);
            }
          } else {
            result = {
              success: false,
              error: withStageLimitGuidance(llmResult.error || 'Failed to generate publication-grade chart configuration', 'PAPER_CHART_GENERATOR'),
              errorCode: 'API_ERROR'
            };
          }
        }
        break;

      case 'DIAGRAM':
        {
          const inheritedSuggestionMeta = (meta.suggestionMeta as any) || {};
          const diagramSpec = normalizeDiagramSpec(data.suggestionMeta?.diagramSpec || inheritedSuggestionMeta.diagramSpec);
          const suggestionRendererPreference =
            data.suggestionMeta?.rendererPreference ||
            inheritedSuggestionMeta.rendererPreference ||
            'auto';
          const recentMermaidFailure =
            wasRecentFailure(meta.lastMermaidRenderFailedAt) ||
            (typeof meta.lastError === 'string' && /\bmermaid\b/i.test(meta.lastError));
          const recentPlantUMLFailure =
            wasRecentFailure(meta.lastPlantUMLRenderFailedAt) ||
            (typeof meta.lastError === 'string' && /\bplantuml\b/i.test(meta.lastError));
          const rendererDecision = chooseDiagramRenderer({
            diagramType: data.figureType,
            title: data.title,
            description: `${data.description || ''}\n${data.modificationRequest || ''}`,
            rendererPreference: suggestionRendererPreference as any,
            hasRecentMermaidFailure: recentMermaidFailure,
            hasRecentPlantUMLFailure: recentPlantUMLFailure,
            specLooksMermaidLike: codeLooksMermaid(data.code) || /\bsubgraph\b/i.test(data.description || '')
          });
          rendererDecisionMeta = { renderer: rendererDecision.renderer, reason: rendererDecision.reason };

          const renderMermaidWithTracking = async (rawCode: string): Promise<FigureGenerationResult> => {
            const mermaidResult = await generateFromMermaidCode(rawCode, {
              theme: { preset: resolvedTheme as any },
              format: 'svg'
            });
            if (mermaidResult.success) {
              finalDiagramRenderer = 'mermaid';
              return mermaidResult;
            }
            mermaidRenderFailed = true;
            mermaidRenderError = mermaidResult.error || 'Mermaid render failed';
            return mermaidResult;
          };

          // Local helper: render and recover for PlantUML with error-informed repair.
          const renderPlantUMLWithRecovery = async (initialCode: string): Promise<FigureGenerationResult> => {
            let currentCode = initialCode;
            let lastRenderResult: FigureGenerationResult = {
              success: false,
              error: 'PlantUML render failed',
              errorCode: 'RENDERING_FAILED'
            };

            for (let attempt = 0; attempt < 2; attempt++) {
              const renderResult = await generateFromPlantUMLCode(currentCode, { format: 'svg', useProxy: false });
              if (renderResult.success) {
                renderResult.generatedCode = currentCode;
                finalDiagramRenderer = 'plantuml';
                return renderResult;
              }
              lastRenderResult = renderResult;
              plantUMLRenderFailed = true;
              plantUMLRenderError = renderResult.error || 'PlantUML render failed';

              const repair = await repairDiagramCode(
                {
                  brokenCode: currentCode,
                  errorMessage: renderResult.error || 'Unknown Kroki render failure',
                  diagramType: data.figureType as any,
                  title: data.title,
                  description: data.description || '',
                  diagramSpec
                },
                requestHeaders
              );

              if (!repair.success || !repair.code) {
                break;
              }
              currentCode = repair.code;
            }
            return lastRenderResult;
          };

          if (data.useLLM && data.description && !data.code) {
            console.log(`[PaperFigures] Using LLM to generate diagram code (${rendererDecision.renderer} preferred)...`);

            let groundedDescription = sanitizeAscii(data.description, true);
            if (paperContext) {
              groundedDescription = `PAPER CONTEXT (create a diagram that reflects this research):\n${sanitizeAscii(paperContext, true)}\n\nFIGURE REQUEST:\n${groundedDescription}`;
            }
            // Enrich with suggestion metadata so the LLM understands purpose and context
            const enrichmentMeta = data.suggestionMeta || inheritedSuggestionMeta;
            if (enrichmentMeta.relevantSection) {
              groundedDescription += `\n\nTARGET SECTION: This figure belongs in the "${sanitizeAscii(String(enrichmentMeta.relevantSection))}" section of the paper.`;
            }
            if (enrichmentMeta.whyThisFigure) {
              groundedDescription += `\nPURPOSE: ${sanitizeAscii(String(enrichmentMeta.whyThisFigure))}`;
            }
            if (enrichmentMeta.dataNeeded) {
              groundedDescription += `\nDATA/CONTENT TO VISUALIZE: ${sanitizeAscii(String(enrichmentMeta.dataNeeded))}`;
            }
            if (data.modificationRequest) {
              groundedDescription += `\n\nUSER MODIFICATION REQUEST (apply these changes):\n${sanitizeAscii(data.modificationRequest, true)}`;
            }

            const llmResult = await generateDiagramCode(
              {
                description: groundedDescription,
                diagramType: data.figureType as any,
                title: data.title,
                sectionType: enrichmentMeta.relevantSection,
                figureRole: enrichmentMeta.figureRole as any,
                paperGenre: enrichmentMeta.paperProfile?.paperGenre,
                diagramSpec,
                rendererPreference: rendererDecision.renderer,
                hasRecentMermaidFailure: recentMermaidFailure,
                hasRecentPlantUMLFailure: recentPlantUMLFailure,
                specLooksMermaidLike: /\bsubgraph\b/i.test(groundedDescription)
              },
              requestHeaders,
              rendererDecision.renderer !== 'mermaid',
              rendererDecision.renderer
            );

            if (llmResult.success && llmResult.code) {
              llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
              const isPlantUML = llmResult.code.includes('@startuml') || llmResult.diagramType === 'plantuml';

              if (isPlantUML) {
                result = await renderPlantUMLWithRecovery(llmResult.code);
              } else {
                result = await renderMermaidWithTracking(llmResult.code);
              }

              if (result.success) {
                result.generatedCode = result.generatedCode || llmResult.code;
              }
            } else {
              result = {
                success: false,
                error: withStageLimitGuidance(llmResult.error || 'Failed to generate publication-grade diagram code', 'PAPER_DIAGRAM_GENERATOR'),
                errorCode: 'API_ERROR'
              };
            }
          } else if (data.code) {
            if (data.code.includes('@startuml') || data.figureType === 'plantuml') {
              result = await renderPlantUMLWithRecovery(data.code);
            } else if (codeLooksMermaid(data.code)) {
              result = await renderMermaidWithTracking(data.code);
            } else if (rendererDecision.renderer === 'mermaid') {
              result = await renderMermaidWithTracking(data.code);
            } else {
              result = await renderPlantUMLWithRecovery(data.code);
            }
          } else {
            result = {
              success: false,
              error: 'Publication-grade diagram generation requires either an AI prompt or explicit diagram code. Generic fallback diagrams are disabled.',
              errorCode: 'INVALID_DATA'
            };
          }
        }
        break;

      case 'STATISTICAL_PLOT':
        {
          const statEnrichment = data.suggestionMeta || (meta.suggestionMeta as any) || {};
          const {
            isPythonChartServerHealthy,
            generatePythonChart,
            isPublicationGradePythonPlotType,
            PUBLICATION_GRADE_PYTHON_PLOT_TYPES
          } = await import('@/lib/figure-generation/python-chart-service');

          if (!isPublicationGradePythonPlotType(data.figureType)) {
            result = {
              success: false,
              error: `No publication-grade statistical renderer is configured for "${data.figureType}". Supported plot types: ${PUBLICATION_GRADE_PYTHON_PLOT_TYPES.join(', ')}.`,
              errorCode: 'UNSUPPORTED_TYPE'
            };
            break;
          }

          if (data.useLLM === false) {
            result = {
              success: false,
              error: 'Publication-grade statistical plots require AI-assisted code generation. Generic direct-render fallback is disabled.',
              errorCode: 'INVALID_DATA'
            };
            break;
          }

          const healthy = await isPythonChartServerHealthy();
          if (!healthy) {
            result = {
              success: false,
              error: 'Python chart server is unavailable. Start or restore the matplotlib service to generate publication-grade statistical plots.',
              errorCode: 'API_ERROR'
            };
            break;
          }

          let groundedDescription = sanitizeAscii(
            data.description
              || statEnrichment.whyThisFigure
              || `Generate a publication-grade ${data.figureType} statistical plot focused on "${data.title}".`,
            true
          );

          if (paperContext) {
            groundedDescription = `PAPER CONTEXT (use this to make the plot relevant to the research):\n${sanitizeAscii(paperContext, true)}\n\nFIGURE REQUEST:\n${groundedDescription}`;
          }
          if (statEnrichment.relevantSection) {
            groundedDescription += `\n\nTARGET SECTION: This plot belongs in the "${sanitizeAscii(String(statEnrichment.relevantSection))}" section of the paper.`;
          }
          if (statEnrichment.whyThisFigure) {
            groundedDescription += `\nPURPOSE: ${sanitizeAscii(String(statEnrichment.whyThisFigure))}`;
          }
          if (statEnrichment.dataNeeded) {
            groundedDescription += `\nDATA TO VISUALIZE: ${sanitizeAscii(String(statEnrichment.dataNeeded))}`;
          }
          if (data.modificationRequest) {
            groundedDescription += `\n\nUSER MODIFICATION REQUEST (apply these changes):\n${sanitizeAscii(data.modificationRequest, true)}`;
          }

          const llmPlot = await generateStatisticalPlotSpec({
            plotType: data.figureType,
            title: data.title,
            description: groundedDescription,
            sectionType: statEnrichment.relevantSection,
            figureRole: statEnrichment.figureRole as any,
            paperGenre: statEnrichment.paperProfile?.paperGenre,
            studyType: statEnrichment.paperProfile?.studyType,
            chartSpec: statEnrichment.chartSpec,
            structuredData: data.data as Record<string, any> | null | undefined,
            rawDataText: data.description || statEnrichment?.dataNeeded || statEnrichment?.whyThisFigure || null,
            journal: mapThemeToPythonJournal(resolvedTheme),
          }, requestHeaders);

          if (!llmPlot.success || !llmPlot.spec) {
            result = {
              success: false,
              error: withStageLimitGuidance(llmPlot.error || `Failed to generate code for "${data.figureType}" statistical plot.`, 'PAPER_CHART_GENERATOR'),
              errorCode: 'API_ERROR'
            };
            break;
          }

          llmMetadata = { tokensUsed: llmPlot.tokensUsed, model: llmPlot.model };
          inferredImageMeta = llmPlot.inferredMeta || null;
          result = await generatePythonChart(llmPlot.spec);
          if (result.success) {
            result.generatedCode = llmPlot.spec.code;
          }
        }
        break;

      case 'SKETCH':
      case 'ILLUSTRATED_FIGURE':
      case 'ILLUSTRATION':
        {
          // Route to the Gemini-based sketch service
          // Merge request-level and stored suggestion meta for maximum context
          const sketchMeta = data.suggestionMeta || (meta.suggestionMeta as any) || {};
          const sketchStyle = sketchMeta.sketchStyle
            || resolveSketchStyleFromPreferences(normalizedPreferences);
          const sketchPrompt = sketchMeta.sketchPrompt
            || data.description
            || data.title;
          const illustrationSpecV2 = sketchMeta.illustrationSpecV2
            || sketchMeta.renderSpec?.illustrationSpecV2
            || undefined;
          const figureGenre = sketchMeta.figureGenre
            || illustrationSpecV2?.figureGenre
            || undefined;
          const renderDirectives = sketchMeta.renderDirectives
            || illustrationSpecV2?.renderDirectives
            || undefined;
          const sketchMode = data.figureType?.startsWith('sketch-guided') || sketchMeta.sketchMode === 'GUIDED'
            ? 'GUIDED' as const
            : 'SUGGEST' as const;

          console.log(`[PaperFigures] Routing ${data.category} to sketch service (mode=${sketchMode}, style=${sketchStyle})...`);

          const sketchResult = await generatePaperSketch({
            paperId: sessionId,
            sessionId,
            figureId,
            mode: sketchMode,
            title: data.title,
            userPrompt: sketchPrompt,
            illustrationSpecV2,
            figureGenre,
            renderDirectives,
            style: sketchStyle
          }, user.id, undefined);

          if (sketchResult.success && sketchResult.imagePath) {
            const latestPlan = await prisma.figurePlan.findUnique({
              where: { id: figureId }
            });
            const latestNodes = asPaperFigureMeta(latestPlan?.nodes);
            scheduleStoredPaperFigureMetadataRefresh({
              requestHeaders,
              sessionId,
              figureId,
              fallbackTitle: data.title,
              fallbackPrompt: sketchPrompt,
              fallbackCategory: data.category,
              fallbackFigureType: data.figureType,
              overrideSuggestionMeta: sketchMeta
            }, 'PaperFigureGenerate');

            return NextResponse.json({
              success: true,
              imagePath: resolvePaperFigureImageUrl(
                sessionId,
                figureId,
                sketchResult.imagePath,
                getPaperFigureImageVersion(latestNodes, sketchResult.imagePath)
              ),
              format: 'png',
              fileSize: 0, // Sketch service doesn't return file size; client doesn't use it
              metadataQueued: true
            });
          }

          result = {
            success: false,
            error: sketchResult.error || 'Sketch generation failed',
            errorCode: 'API_ERROR'
          };
        }
        break;

      case 'CUSTOM':
      default:
        result = {
          success: false,
          error: `${data.category} figures require manual upload`,
          errorCode: 'UNSUPPORTED_TYPE'
        };
    }

    // If generation failed, return error
    if (!result.success || !result.imageBase64) {
      return NextResponse.json(
        { error: result.error || 'Figure generation failed' },
        { status: 400 }
      );
    }

    // Save the generated image
    await fs.mkdir(FIGURE_UPLOAD_DIR, { recursive: true });
    
    const format = result.format || 'png';
    const timestamp = Date.now();
    const filename = `figure_${figureId}_${timestamp}.${format}`;
    const filePath = path.join(FIGURE_UPLOAD_DIR, filename);
    
    const buffer = Buffer.from(result.imageBase64, 'base64');
    await fs.writeFile(filePath, buffer);
    
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const imagePath = `/uploads/figures/${filename}`;
    const nowIso = new Date().toISOString();
    const effectiveSuggestionMeta = asObjectRecord(data.suggestionMeta) || asObjectRecord(meta.suggestionMeta);
    const captionHint = (data.caption || '').trim()
      || persistedCaption
      || getPaperFigureCaptionSeed({
        suggestionMeta: effectiveSuggestionMeta
      });
    const nextGenerationPrompt = persistedPrompt
      || (!data.modificationRequest ? (data.description || '').trim() : '');
    const nextCaption = captionHint
      || inferredImageMeta?.summary
      || getPaperFigureCaptionSeed({
        suggestionMeta: effectiveSuggestionMeta,
        inferredImageMeta: inferredImageMeta ?? null
      });
    const persistedChartData = data.category === 'DATA_CHART'
      ? toFigureDataPayload(resolvedChartInput || { source: 'none' })
      : null;

    // Update the figure plan with the generated image
    // NOTE: imagePath is stored in nodes JSON since the schema doesn't have a dedicated field
    const revisionHistory = Array.isArray(meta.revisionHistory) ? meta.revisionHistory : [];
    const shouldAppendRevision = !!data.modificationRequest || meta.status === 'GENERATED';
    const nextRevisionHistory = shouldAppendRevision
      ? [
          ...revisionHistory,
          {
            at: nowIso,
            request: data.modificationRequest || null,
            description: data.description || null,
            model: llmMetadata.model || null,
            tokensUsed: llmMetadata.tokensUsed || null
          }
        ].slice(-20)
      : revisionHistory;

    await prisma.figurePlan.update({
      where: { id: figureId },
      data: {
        ...(nextCaption ? { description: nextCaption } : {}),
        nodes: {
          ...meta,
          caption: nextCaption || meta.caption || '',
          generationPrompt: nextGenerationPrompt || meta.generationPrompt || undefined,
          status: 'GENERATED',
          imagePath, // Store in nodes JSON
          source: result.provider || 'quickchart',
          generatedAt: nowIso,
          checksum,
          generatedCode: result.generatedCode,
          fileSize: buffer.length,
          inferredImageMeta: inferredImageMeta ?? null,
          appliedPreferences: normalizedPreferences,
          suggestionMeta: effectiveSuggestionMeta,
          chartData: persistedChartData || meta.chartData || undefined,
          lastModificationRequest: data.modificationRequest || null,
          rendererDecision: rendererDecisionMeta?.renderer || meta.rendererDecision || null,
          rendererDecisionReason: rendererDecisionMeta?.reason || meta.rendererDecisionReason || null,
          lastDiagramRenderer: finalDiagramRenderer || meta.lastDiagramRenderer || null,
          lastMermaidRenderFailedAt: mermaidRenderFailed
            ? nowIso
            : (finalDiagramRenderer === 'mermaid' ? null : (meta.lastMermaidRenderFailedAt || null)),
          lastMermaidRenderError: mermaidRenderFailed
            ? (mermaidRenderError || null)
            : (finalDiagramRenderer === 'mermaid' ? null : (meta.lastMermaidRenderError || null)),
          lastPlantUMLRenderFailedAt: plantUMLRenderFailed
            ? nowIso
            : (finalDiagramRenderer === 'plantuml' ? null : (meta.lastPlantUMLRenderFailedAt || null)),
          lastPlantUMLRenderError: plantUMLRenderFailed
            ? (plantUMLRenderError || null)
            : (finalDiagramRenderer === 'plantuml' ? null : (meta.lastPlantUMLRenderError || null)),
          revisionHistory: nextRevisionHistory
        } as any
      }
    });

    if (data.category === 'DIAGRAM') {
      scheduleStoredPaperFigureMetadataRefresh({
        requestHeaders,
        sessionId,
        figureId,
        fallbackTitle: data.title,
        fallbackPrompt: nextGenerationPrompt || undefined,
        fallbackCategory: data.category,
        fallbackFigureType: data.figureType,
        overrideSuggestionMeta: effectiveSuggestionMeta
      }, 'PaperFigureGenerate');
    }

    console.log(`[PaperFigures] Generated figure: ${filename} (${buffer.length} bytes)`);

    return NextResponse.json({
      success: true,
      imagePath: resolvePaperFigureImageUrl(sessionId, figureId, imagePath, checksum),
      generatedCode: result.generatedCode,
      format,
      fileSize: buffer.length,
      ...(data.category === 'DIAGRAM' ? { metadataQueued: true } : {})
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Generate error:', error);
    return NextResponse.json(
      { error: 'Failed to generate figure' },
      { status: 500 }
    );
  }
}

