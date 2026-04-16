import fs from 'fs/promises'
import path from 'path'
import type { TaskCode } from '@prisma/client'
import { llmGateway } from '@/lib/metering/gateway'

const FIGURE_METADATA_STAGE_CODE = 'PAPER_FIGURE_METADATA_INFER'

export interface PaperFigureInferenceMeta {
  summary: string
  visibleElements: string[]
  visibleText: string[]
  keyVariables: string[]
  comparedGroups: string[]
  numericHighlights: string[]
  observedPatterns: string[]
  resultDetails: string[]
  methodologyDetails: string[]
  discussionCues: string[]
  chartSignals: string[]
  claimsSupported: string[]
  claimsToAvoid: string[]
  inferredAt: string
  model?: string
}

function extractJsonObjectFromOutput(raw: string): Record<string, unknown> | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function cleanInferenceText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text
}

function cleanInferenceList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => cleanInferenceText(entry, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    )
  )
}

export function coercePaperFigureInferenceMeta(
  raw: unknown,
  inferredAt?: string,
  model?: string
): PaperFigureInferenceMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const summary = cleanInferenceText(record.summary, 400)
  const visibleElements = cleanInferenceList(record.visibleElements, 8, 100)
  const visibleText = cleanInferenceList(record.visibleText, 10, 120)
  const keyVariables = cleanInferenceList(record.keyVariables, 8, 120)
  const comparedGroups = cleanInferenceList(record.comparedGroups, 8, 120)
  const numericHighlights = cleanInferenceList(record.numericHighlights, 8, 140)
  const observedPatterns = cleanInferenceList(record.observedPatterns, 8, 160)
  const resultDetails = cleanInferenceList(record.resultDetails, 8, 180)
  const methodologyDetails = cleanInferenceList(record.methodologyDetails, 8, 180)
  const discussionCues = cleanInferenceList(record.discussionCues, 8, 180)
  const chartSignals = cleanInferenceList(record.chartSignals, 8, 160)
  const claimsSupported = cleanInferenceList(record.claimsSupported, 8, 180)
  const claimsToAvoid = cleanInferenceList(record.claimsToAvoid, 8, 180)
  const normalizedInferredAt = cleanInferenceText(record.inferredAt, 40) || inferredAt || ''
  const normalizedModel = cleanInferenceText(record.model, 80) || model || ''

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
    return null
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
    inferredAt: normalizedInferredAt || new Date().toISOString(),
    ...(normalizedModel ? { model: normalizedModel } : {})
  }
}

export async function inferPaperFigureImageMetadata(params: {
  requestHeaders: Record<string, string>
  imageBase64: string
  mimeType: string
  title: string
  caption?: string | null
  category: string
  figureType: string
  suggestionMeta?: Record<string, unknown> | null
}): Promise<PaperFigureInferenceMeta | null> {
  const suggestionMeta = params.suggestionMeta && typeof params.suggestionMeta === 'object'
    ? params.suggestionMeta
    : null

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
- Title: ${cleanInferenceText(params.title, 180)}
- Caption: ${cleanInferenceText(params.caption, 260) || 'None'}
- Category: ${cleanInferenceText(params.category, 40)}
- Figure type: ${cleanInferenceText(params.figureType, 40)}
- Suggestion meta: ${cleanInferenceText(suggestionMeta ? JSON.stringify(suggestionMeta) : 'None', 900)}`

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
    )

    if (!result.success || !result.response?.output) {
      return null
    }

    const inferredAt = new Date().toISOString()
    const parsed = extractJsonObjectFromOutput(result.response.output)
    return coercePaperFigureInferenceMeta(parsed, inferredAt, result.response.modelClass || undefined)
  } catch (error) {
    console.warn('[PaperFigures] Figure metadata inference failed:', error)
    return null
  }
}

export async function inferPaperFigureMetadataFromStoredImage(params: {
  requestHeaders: Record<string, string>
  imagePath: string
  title: string
  caption?: string | null
  category: string
  figureType: string
  suggestionMeta?: Record<string, unknown> | null
}): Promise<PaperFigureInferenceMeta | null> {
  try {
    const relativePath = params.imagePath.startsWith('/')
      ? params.imagePath.slice(1)
      : params.imagePath
    const absolutePath = path.join(process.cwd(), 'public', relativePath)
    const buffer = await fs.readFile(absolutePath)
    const lowerPath = params.imagePath.toLowerCase()
    const mimeType = lowerPath.endsWith('.svg')
      ? 'image/svg+xml'
      : lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : lowerPath.endsWith('.webp')
          ? 'image/webp'
          : lowerPath.endsWith('.gif')
            ? 'image/gif'
            : 'image/png'

    return inferPaperFigureImageMetadata({
      requestHeaders: params.requestHeaders,
      imageBase64: buffer.toString('base64'),
      mimeType,
      title: params.title,
      caption: params.caption,
      category: params.category,
      figureType: params.figureType,
      suggestionMeta: params.suggestionMeta
    })
  } catch (error) {
    console.warn('[PaperFigures] Stored-image metadata inference failed:', error)
    return null
  }
}
