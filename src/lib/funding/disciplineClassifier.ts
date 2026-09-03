/**
 * Classifying funding calls into the shared research-area catalog.
 *
 * `FundingCall.disciplines` is free-text LLM output — "Quantum Technology",
 * "Food Systems", "Ethics". Useful to read, useless to join on: no two calls
 * agree on wording, and nothing relates it to a tenant's org structure. This
 * maps each call onto `ResearchAreaTaxonomyArea` rows instead, which IS
 * joinable, and is the half of "calls relevant to my school" that lives on the
 * call side.
 *
 * Two passes, cheapest first:
 *   1. Alias sweep over the catalog — free, instant, and explains itself.
 *   2. One LLM call, only when the sweep finds nothing.
 *
 * The LLM runs under the existing FUNDING_CALL_INGEST task code rather than a
 * new WorkflowStage, so this needs no `seed:llm-models` run to work in an
 * existing deployment.
 */

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { matchAreas, type MatchableArea } from './disciplineMatcher'
import {
  FUNDING_CALL_INGEST_TASK_CODE,
  FUNDING_CALL_INGEST_TEXT_STAGE_CODE,
  runFundingGatewayText,
} from './llmRouting'
import { fundingCallResearchAreaTaxonomyService } from '@/lib/services/fundingCallResearchAreaTaxonomyService'

/** Reuses the intake text stage so no new WorkflowStage needs seeding. */
export const CLASSIFY_STAGE_CODE = FUNDING_CALL_INGEST_TEXT_STAGE_CODE

export const SOURCE_ALIAS = 'auto:alias'
export const SOURCE_LLM = 'auto:llm'

export interface ClassifyResult {
  fundingCallId: string
  /** 'alias' | 'llm' | 'manual' (already classified by hand) | 'none' */
  method: 'alias' | 'llm' | 'manual' | 'none'
  areaIds: string[]
  /** Human-readable catalog labels, for logs and the backfill report. */
  labels: string[]
  reason?: string
}

interface CallRow {
  id: string
  title: string | null
  scheme_title: string | null
  summary: string | null
  description: string | null
  disciplines: string[]
  tenantId: string | null
}

/** The active catalog, shaped for the matcher. Small (~50 rows) and cached per call site. */
export async function loadActiveAreas(): Promise<MatchableArea[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      level1_code: string
      level1_name: string
      level2_code: string
      level2_name: string
      aliases: string[]
    }>
  >(Prisma.sql`
    SELECT area.id, area.level1_code, area.level1_name, area.level2_code, area.level2_name, area.aliases
    FROM research_area_taxonomy_areas area
    INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
    WHERE area.is_active = true
      AND upload.status = 'ACTIVE'
    ORDER BY area.sort_order ASC NULLS LAST, area.level1_name ASC, area.level2_name ASC
  `)

  return rows.map((row) => ({
    id: row.id,
    level1Code: row.level1_code,
    level1Name: row.level1_name,
    level2Code: row.level2_code,
    level2Name: row.level2_name,
    aliases: row.aliases || [],
  }))
}

function areaLabel(area: MatchableArea): string {
  return area.level2Name ? `${area.level1Name} → ${area.level2Name}` : area.level1Name
}

/**
 * Ask the model to place the call in the catalog.
 *
 * Codes are echoed back and validated against the catalog, so a hallucinated
 * area cannot reach the database. Returns [] on any failure — a classification
 * we could not make is not an error worth propagating to a publish.
 */
async function classifyWithLlm(
  call: CallRow,
  areas: MatchableArea[]
): Promise<Array<{ areaId: string; confidence: number }>> {
  const catalog = areas
    .map((area) => `${area.level2Code || area.level1Code}\t${areaLabel(area)}`)
    .join('\n')

  const callText = [
    `Title: ${call.scheme_title || call.title || '(untitled)'}`,
    call.disciplines.length ? `Stated topics: ${call.disciplines.join(', ')}` : null,
    call.summary || call.description
      ? `Description: ${(call.summary || call.description || '').slice(0, 4000)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = [
    'Classify this research funding call into the discipline catalog below.',
    '',
    'CATALOG (code, then label):',
    catalog,
    '',
    'CALL:',
    callText,
    '',
    'Return JSON: {"areas":[{"code":"<catalog code>","confidence":<0..1>}]}',
    'Rules:',
    '- Return between 1 and 3 areas, best first.',
    '- Use ONLY codes that appear verbatim in the catalog above.',
    '- Judge what the call FUNDS, not who administers it. Ignore the funder name,',
    '  countries, deadlines and application mechanics.',
    '- A broad call open to all disciplines should return the one or two areas it',
    '  most emphasises, or an empty list if it truly names none.',
  ].join('\n')

  let raw: string
  try {
    const result = await runFundingGatewayText({
      taskCode: FUNDING_CALL_INGEST_TASK_CODE,
      stageCode: CLASSIFY_STAGE_CODE,
      prompt,
      temperature: 0,
      maxTokensOut: 400,
      responseMimeType: 'application/json',
      context: { tenantId: call.tenantId },
      metadata: { action: 'classify_disciplines', fundingCallId: call.id },
    }).then((response) => response?.rawText || '')
    raw = result
  } catch (error) {
    console.warn(
      `[CLASSIFY] LLM classification failed for call ${call.id}:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  }

  if (!raw) return []

  let parsed: unknown
  try {
    // Models occasionally wrap JSON in a fenced block despite the mime type.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.warn(`[CLASSIFY] Unparseable LLM response for call ${call.id}`)
    return []
  }

  const items = (parsed as { areas?: Array<{ code?: unknown; confidence?: unknown }> })?.areas
  if (!Array.isArray(items)) return []

  const byCode = new Map<string, MatchableArea>()
  for (const area of areas) {
    byCode.set((area.level2Code || area.level1Code).toLowerCase(), area)
  }

  const accepted: Array<{ areaId: string; confidence: number }> = []
  const seen = new Set<string>()
  for (const item of items.slice(0, 3)) {
    const code = String(item?.code || '').trim().toLowerCase()
    const area = byCode.get(code)
    // Silently drop codes the catalog does not contain. A model that invents an
    // area must not be able to write one.
    if (!area || seen.has(area.id)) continue
    seen.add(area.id)
    const confidence = Number(item?.confidence)
    accepted.push({
      areaId: area.id,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    })
  }

  return accepted
}

/**
 * Classify one call and persist the mapping.
 *
 * Idempotent and safe to re-run: manual mappings always survive
 * (`mergeAutoMappings`), and a call that already has automatic mappings is left
 * alone unless `force` is set.
 */
export async function classifyFundingCall(
  fundingCallId: string,
  options: { force?: boolean; areas?: MatchableArea[]; allowLlm?: boolean } = {}
): Promise<ClassifyResult> {
  const { force = false, allowLlm = true } = options

  const call = await prisma.fundingCall.findUnique({
    where: { id: fundingCallId },
    select: {
      id: true,
      title: true,
      scheme_title: true,
      summary: true,
      description: true,
      disciplines: true,
      tenantId: true,
    },
  })
  if (!call) {
    return { fundingCallId, method: 'none', areaIds: [], labels: [], reason: 'call_not_found' }
  }

  const existing = await prisma.$queryRaw<Array<{ source: string; count: number }>>(Prisma.sql`
    SELECT source, COUNT(*)::int AS count
    FROM funding_call_research_area_taxonomies
    WHERE funding_call_id = ${fundingCallId}
    GROUP BY source
  `)
  const hasManual = existing.some((row) => row.source === 'manual')
  const hasAuto = existing.some((row) => row.source !== 'manual')

  // An operator who mapped this by hand has said the last word on it.
  if (hasManual && !force) {
    return { fundingCallId, method: 'manual', areaIds: [], labels: [], reason: 'manual_mapping_exists' }
  }
  if (hasAuto && !force) {
    return { fundingCallId, method: 'none', areaIds: [], labels: [], reason: 'already_classified' }
  }

  const areas = options.areas ?? (await loadActiveAreas())
  if (areas.length === 0) {
    return { fundingCallId, method: 'none', areaIds: [], labels: [], reason: 'no_active_taxonomy' }
  }
  const areaById = new Map(areas.map((area) => [area.id, area]))

  const aliasMatches = matchAreas(
    {
      tags: call.disciplines,
      title: call.scheme_title || call.title,
      body: call.summary || call.description,
    },
    areas
  )

  let method: ClassifyResult['method'] = 'alias'
  let matches: Array<{ taxonomyAreaId: string; confidence: number | null }> = aliasMatches.map(
    (match) => ({ taxonomyAreaId: match.areaId, confidence: match.confidence })
  )
  let source = SOURCE_ALIAS

  if (matches.length === 0) {
    if (!allowLlm) {
      return { fundingCallId, method: 'none', areaIds: [], labels: [], reason: 'no_alias_match' }
    }
    const llmMatches = await classifyWithLlm(call, areas)
    if (llmMatches.length === 0) {
      return { fundingCallId, method: 'none', areaIds: [], labels: [], reason: 'unclassified' }
    }
    method = 'llm'
    source = SOURCE_LLM
    matches = llmMatches.map((match) => ({
      taxonomyAreaId: match.areaId,
      confidence: match.confidence,
    }))
  }

  await fundingCallResearchAreaTaxonomyService.mergeAutoMappings({
    fundingCallId,
    matches,
    source,
  })

  const areaIds = matches.map((match) => match.taxonomyAreaId)
  return {
    fundingCallId,
    method,
    areaIds,
    labels: areaIds.map((id) => {
      const area = areaById.get(id)
      return area ? areaLabel(area) : id
    }),
  }
}

/**
 * Fire-and-forget classification, for call sites that must not wait on it or
 * fail because of it — the publish path above all. Mirrors
 * `dispatchFundingAlertsQuietly`, which solves the same problem for alerts.
 */
export function classifyFundingCallQuietly(fundingCallId: string): void {
  void classifyFundingCall(fundingCallId).catch((error) => {
    console.warn(
      `[CLASSIFY] Could not classify call ${fundingCallId}:`,
      error instanceof Error ? error.message : String(error)
    )
  })
}
