/**
 * Grant Diagram Studio — LLM spec generation.
 *
 * One AI step: grant section context → validated JSON spec. Rendering is
 * deterministic and happens elsewhere. Invalid JSON gets exactly one
 * structured retry with the validation errors quoted back.
 */

import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'
import { ZodError } from 'zod'
import {
  DiagramSpec,
  DiagramStudioKind,
  parseDiagramSpec,
} from './spec-types'
import type { DiagramGenerationContext } from './context'

const STAGE_CODE = 'PAPER_DIAGRAM_GENERATOR'

const KIND_INSTRUCTIONS: Record<Exclude<DiagramStudioKind, 'sketch' | 'freeform'>, string> = {
  gantt: `Produce a project workplan Gantt spec.
JSON shape:
{
  "title": string,
  "totalMonths": number,            // full project duration in months
  "groups": [                        // work packages or phases, in order
    { "id": "WP1", "name": string, "tasks": [
      { "id": "T1_1", "label": string, "startMonth": number, "endMonth": number, "critical": boolean? }
    ]}
  ],
  "milestones": [ { "id": "M1", "label": string, "month": number } ]
}
Rules:
- Months are 1-based relative project months (M1 = project start). Never calendar dates.
- Derive work packages, tasks, durations, and milestones ONLY from the provided section content. Do not invent activities that are not stated or clearly implied.
- 2-8 groups, 2-6 tasks per group, task labels under 10 words.
- Mark a task "critical": true only if the text identifies it as critical-path or blocking.
- If the text states a total duration, use it for totalMonths; otherwise use the duration hint or the latest task end month.`,
  flowchart: `Produce a flowchart spec.
JSON shape:
{
  "title": string,
  "direction": "TD" | "LR",
  "nodes": [ { "id": "A", "label": string, "role": "start"|"input"|"process"|"decision"|"output"|"milestone"|"end", "group": string? } ],
  "edges": [ { "from": "A", "to": "B", "label": string?, "style": "solid"|"dashed" } ]
}
Rules:
- Node ids: short alphanumeric (A, B, step1). 4-14 nodes, labels under 8 words.
- Model the process described in the section ONLY. No invented steps.
- Use "decision" role for genuine branch points, with labeled outgoing edges (e.g. "yes"/"no").
- Use "group" to cluster nodes into named phases when the section describes phases.
- Prefer "TD" unless the flow is a pipeline of sequential stages (then "LR").`,
  logic_model: `Produce a logic model spec (impact pathway).
JSON shape:
{
  "title": string,
  "columns": [
    { "key": "inputs"|"activities"|"outputs"|"outcomes"|"impact", "label": string, "items": [ { "id": "i1", "text": string } ] }
  ]
}
Rules:
- Use 3-5 columns in causal order; include "outcomes" and "impact" whenever the section supports them.
- 2-6 items per column, each under 18 words, grounded ONLY in the section content.`,
  chart: `Produce a chart spec.
JSON shape:
{
  "title": string,
  "chartType": "bar"|"stackedBar"|"horizontalBar"|"line"|"pie"|"doughnut",
  "labels": [string],
  "datasets": [ { "label": string, "data": [number] } ],
  "xLabel": string?, "yLabel": string?, "valuePrefix": string?, "valueSuffix": string?
}
Rules:
- STRICT DATA GATE: use ONLY numbers explicitly present in the section content. If the section does not contain enough real numbers for a meaningful chart, respond with exactly {"error": "NO_DATA"} instead of a spec.
- Every dataset's data array must have the same length as labels.
- Pick the simplest chart type that fits the data.`,
  plot: `Produce a statistical plot brief. A downstream AI will write matplotlib code from it.
JSON shape:
{
  "title": string,
  "plotType": "boxplot"|"violin"|"heatmap"|"confusion_matrix"|"roc_curve"|"error_bar"|"regression"|"bland_altman"|"forest_plot",
  "description": string,   // what to plot, axes, groups, comparisons — precise and grounded
  "dataText": string       // ALL relevant numbers copied verbatim from the section content, labeled
}
Rules:
- STRICT DATA GATE: dataText must contain ONLY numbers explicitly present in the section content. If the section lacks enough real numeric data for the plot, respond with exactly {"error": "NO_DATA"}.
- Pick the plotType that best matches the data's statistical structure.
- description must reference only variables and groups named in the section.`,
}

export interface DiagramSpecResult {
  spec: DiagramSpec
  tokensUsed: number
  model: string
  promptUsed: string
}

export class DiagramNoDataError extends Error {
  constructor() {
    super('The section does not contain enough concrete data for this diagram type.')
    this.name = 'DiagramNoDataError'
  }
}

function extractJsonBlock(raw: string): string {
  let cleaned = raw.trim()
  const fenced = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenced) cleaned = fenced[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1)
  return cleaned
}

function buildContextBlock(context: DiagramGenerationContext): string {
  const parts: string[] = []
  if (context.callTitle) parts.push(`FUNDING CALL: ${context.callTitle}`)
  if (context.durationMonthsHint) {
    parts.push(`PROJECT DURATION HINT: ${context.durationMonthsHint} months`)
  }
  for (const section of context.sections) {
    parts.push(`--- SECTION: ${section.label} (${section.sectionKey}) ---`)
    if (section.purpose) parts.push(`Purpose: ${section.purpose}`)
    if (section.mustCover.length > 0) parts.push(`Must cover: ${section.mustCover.join('; ')}`)
    parts.push(section.content || '(section not yet drafted)')
  }
  return parts.join('\n')
}

async function callSpecLLM(
  prompt: string,
  requestHeaders: Record<string, string>,
  purpose: string
): Promise<{ response: string; tokensUsed: number; model: string }> {
  const result = await llmGateway.executeLLMOperation(
    { headers: requestHeaders },
    {
      taskCode: 'LLM2_DRAFT' as TaskCode,
      stageCode: STAGE_CODE,
      prompt,
      parameters: { temperature: 0.2 },
      idempotencyKey: `grant-diagram-${purpose}-${Date.now()}`,
      metadata: {
        module: 'grant-diagram-studio',
        stageCode: STAGE_CODE,
        purpose,
        skipFeaturePolicy: true,
      },
    }
  )
  if (!result.success || !result.response) {
    throw new Error(result.error?.message || 'LLM call failed')
  }
  return {
    response: result.response.output,
    tokensUsed: result.response.outputTokens || 0,
    model: result.response.modelClass || 'unknown',
  }
}

function parseSpecResponse(kind: DiagramStudioKind, raw: string): DiagramSpec {
  const json = extractJsonBlock(raw)
  const parsed = JSON.parse(json)
  if (parsed && typeof parsed === 'object' && (parsed as { error?: string }).error === 'NO_DATA') {
    throw new DiagramNoDataError()
  }
  return parseDiagramSpec(kind, parsed)
}

function describeParseFailure(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .slice(0, 8)
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}

export async function generateDiagramSpec(params: {
  kind: Exclude<DiagramStudioKind, 'sketch' | 'freeform'>
  context: DiagramGenerationContext
  guidance?: string
  requestHeaders: Record<string, string>
}): Promise<DiagramSpecResult> {
  const { kind, context, guidance, requestHeaders } = params

  const prompt = [
    'You are a grant-proposal visualization planner. You convert grant proposal section content into a structured diagram specification.',
    '',
    KIND_INSTRUCTIONS[kind],
    '',
    guidance ? `USER GUIDANCE: ${guidance}\n` : '',
    'GRANT CONTEXT:',
    buildContextBlock(context),
    '',
    'Respond with ONLY the JSON object. No prose, no markdown fences.',
  ].join('\n')

  let lastError: unknown
  let attemptPrompt = prompt
  for (let attempt = 0; attempt < 2; attempt++) {
    const { response, tokensUsed, model } = await callSpecLLM(
      attemptPrompt,
      requestHeaders,
      `generate_${kind}${attempt > 0 ? '_retry' : ''}`
    )
    try {
      const spec = parseSpecResponse(kind, response)
      return { spec, tokensUsed, model, promptUsed: prompt }
    } catch (error) {
      if (error instanceof DiagramNoDataError) throw error
      lastError = error
      attemptPrompt = [
        prompt,
        '',
        'Your previous response was invalid:',
        describeParseFailure(error),
        'Previous response (fix it):',
        response.slice(0, 4000),
        '',
        'Return ONLY the corrected JSON object.',
      ].join('\n')
    }
  }
  throw new Error(`Diagram spec generation failed: ${describeParseFailure(lastError)}`)
}

export async function refineDiagramSpec(params: {
  kind: Exclude<DiagramStudioKind, 'sketch' | 'freeform'>
  currentSpec: DiagramSpec
  instruction: string
  context: DiagramGenerationContext
  requestHeaders: Record<string, string>
}): Promise<DiagramSpecResult> {
  const { kind, currentSpec, instruction, context, requestHeaders } = params

  const prompt = [
    'You are refining an existing grant diagram specification.',
    '',
    KIND_INSTRUCTIONS[kind],
    '',
    'CURRENT SPEC:',
    JSON.stringify(currentSpec, null, 2),
    '',
    `USER INSTRUCTION: ${instruction}`,
    '',
    'GRANT CONTEXT (for grounding — do not add content that contradicts it):',
    buildContextBlock(context),
    '',
    'Apply the instruction with the minimal necessary change; keep everything else identical.',
    'Respond with ONLY the full updated JSON object. No prose, no markdown fences.',
  ].join('\n')

  let lastError: unknown
  let attemptPrompt = prompt
  for (let attempt = 0; attempt < 2; attempt++) {
    const { response, tokensUsed, model } = await callSpecLLM(
      attemptPrompt,
      requestHeaders,
      `refine_${kind}${attempt > 0 ? '_retry' : ''}`
    )
    try {
      const spec = parseSpecResponse(kind, response)
      return { spec, tokensUsed, model, promptUsed: prompt }
    } catch (error) {
      if (error instanceof DiagramNoDataError) throw error
      lastError = error
      attemptPrompt = [
        prompt,
        '',
        'Your previous response was invalid:',
        describeParseFailure(error),
        '',
        'Return ONLY the corrected JSON object.',
      ].join('\n')
    }
  }
  throw new Error(`Diagram spec refinement failed: ${describeParseFailure(lastError)}`)
}

// ============================================================================
// Freeform code mode — the LLM writes Graphviz DOT directly. Richer output
// (any layout, HTML-like labels, ranks) at the cost of structured editing.
// ============================================================================

function extractDotCode(raw: string): string {
  let cleaned = raw.trim()
  const fenced = cleaned.match(/```(?:dot|graphviz)?\s*\n?([\s\S]*?)```/)
  if (fenced) cleaned = fenced[1].trim()
  const start = cleaned.search(/\b(?:strict\s+)?digraph\b/)
  if (start > 0) cleaned = cleaned.slice(start)
  const lastBrace = cleaned.lastIndexOf('}')
  if (lastBrace >= 0) cleaned = cleaned.slice(0, lastBrace + 1)
  if (!/\bdigraph\b/.test(cleaned)) {
    throw new Error('Response did not contain a digraph definition')
  }
  return cleaned
}

function buildFreeformDotPrompt(params: {
  context: DiagramGenerationContext
  guidance?: string
  title?: string
  themeHints: string
}): string {
  return [
    'You are an expert Graphviz engineer producing a publication-quality diagram for a grant proposal.',
    '',
    'Write a complete Graphviz DOT `digraph`. You have full freedom: clusters, ranks, record/HTML-like labels, edge weights — whatever best communicates the content.',
    '',
    'HARD RULES:',
    '- Output ONLY DOT code. No prose, no markdown fences.',
    '- Ground every node and edge in the provided section content. Do not invent content.',
    '- ASCII text only in labels. No image/href attributes.',
    `- Visual style (use these exact colors): ${params.themeHints}`,
    '- Set bgcolor, fontname on graph/node/edge. Keep it clean and readable: filled shapes with rounded style where sensible, penwidth 1.4, arrowsize 0.85.',
    '- At most 24 nodes.',
    '',
    params.title ? `DIAGRAM TITLE: ${params.title}` : '',
    params.guidance ? `USER GUIDANCE: ${params.guidance}` : '',
    '',
    'GRANT CONTEXT:',
    buildContextBlock(params.context),
  ]
    .filter(Boolean)
    .join('\n')
}

export interface FreeformCodeResult {
  code: string
  tokensUsed: number
  model: string
  promptUsed: string
}

export async function generateFreeformDotCode(params: {
  context: DiagramGenerationContext
  guidance?: string
  title?: string
  themeHints: string
  requestHeaders: Record<string, string>
}): Promise<FreeformCodeResult> {
  const prompt = buildFreeformDotPrompt(params)
  const { response, tokensUsed, model } = await callSpecLLM(
    prompt,
    params.requestHeaders,
    'generate_freeform_dot'
  )
  return { code: extractDotCode(response), tokensUsed, model, promptUsed: prompt }
}

/** Error-informed repair pass for DOT code that failed to render. */
export async function repairFreeformDotCode(params: {
  code: string
  renderError: string
  requestHeaders: Record<string, string>
}): Promise<FreeformCodeResult> {
  const prompt = [
    'The following Graphviz DOT code failed to render. Fix the syntax/rendering problem with the MINIMAL change; keep the structure and content identical.',
    '',
    'RENDER ERROR:',
    params.renderError.slice(0, 800),
    '',
    'BROKEN CODE:',
    params.code.slice(0, 16000),
    '',
    'Output ONLY the corrected DOT code. No prose, no markdown fences.',
  ].join('\n')
  const { response, tokensUsed, model } = await callSpecLLM(
    prompt,
    params.requestHeaders,
    'repair_freeform_dot'
  )
  return { code: extractDotCode(response), tokensUsed, model, promptUsed: prompt }
}

/** Instruction-driven rewrite of existing freeform DOT code. */
export async function refineFreeformDotCode(params: {
  code: string
  instruction: string
  context: DiagramGenerationContext
  themeHints: string
  requestHeaders: Record<string, string>
}): Promise<FreeformCodeResult> {
  const prompt = [
    'You are refining an existing Graphviz DOT diagram for a grant proposal.',
    '',
    'CURRENT CODE:',
    params.code.slice(0, 16000),
    '',
    `USER INSTRUCTION: ${params.instruction}`,
    '',
    'GRANT CONTEXT (for grounding — do not contradict it):',
    buildContextBlock(params.context),
    '',
    `Visual style (keep these exact colors): ${params.themeHints}`,
    'Apply the instruction with the minimal necessary change; keep everything else identical.',
    'Output ONLY the full updated DOT code. No prose, no markdown fences.',
  ].join('\n')
  const { response, tokensUsed, model } = await callSpecLLM(
    prompt,
    params.requestHeaders,
    'refine_freeform_dot'
  )
  return { code: extractDotCode(response), tokensUsed, model, promptUsed: prompt }
}
