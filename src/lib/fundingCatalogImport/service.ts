import { syncCatalogueAreaIndex } from '@/lib/catalogueProtection/areas'
/**
 * The external catalogue importer: dry run (report only) and apply.
 *
 * Production-safety rules this file is built around:
 *   - Existing calls are never written. The importer INSERTs new calls and
 *     their side rows; on a re-run it may update only calls an import created,
 *     field by field, keeping any value a person changed.
 *   - Imported calls are written STAGED (catalog_status), inactive and
 *     GLOBAL_CATALOG (visibility), with notifications SUPPRESSED, so they are
 *     invisible everywhere until released and can never fan out alerts or
 *     funding-department notices.
 *   - Suspected duplicates are review items, never merges.
 *   - Inputs come from a frozen, checksummed snapshot; APPLY refuses a target
 *     database it was not explicitly told about, and refuses to run while
 *     another run for the same source is in progress.
 *   - Every row inserted and every field changed is logged per run, so a run
 *     can be reversed exactly (see rollback.ts).
 */
import crypto from 'node:crypto'
import path from 'node:path'

import type { PrismaClient } from '@/lib/prisma-generated'
import { dimensionColumns } from '@/lib/funding/eligibility'

import { mapScientifyFunder, mapScientifyGrant, normalizeFunderName, acronymOf } from './adapters/scientify'
import {
  IMPORTER_VERSION,
  NOTIFICATION_POLICY_SUPPRESSED,
  REVIEW_STATUS,
  WRITE_BATCH_SIZE,
  importSourceLabel,
} from './constants'
import { crosswalkVersions, loadScientifyCrosswalks } from './crosswalks'
import {
  descriptionHash,
  findDuplicatePairs,
  findExistingDuplicatePairs,
  tierBlocksRelease,
  urlKeys,
  type DedupCall,
  type DuplicatePair,
} from './duplicates'
import { usdEstimates } from './normalize/money'
import { dateOnly, isoDate, matchKey } from './normalize/text'
import { buildSeriesKey } from './normalize/titles'
import { fieldOwner } from './provenance'
import { readJsonLines, verifySnapshot, type SnapshotManifest } from './snapshot'
import type { NormalizedExternalCall, NormalizedExternalFunder } from './types'

export interface RunImportOptions {
  db: PrismaClient
  sourceKey: 'scientify'
  snapshotDir: string
  mode: 'DRY_RUN' | 'APPLY'
  limit?: number
  operatorEmail?: string | null
  /** APPLY only: must equal current_database(). */
  confirmTarget?: string | null
  /** Only a complete crawl may mark unseen records NOT_SEEN_IN_SNAPSHOT. */
  isFullSnapshot?: boolean
  /** Override "today" (YYYY-MM-DD) for lifecycle; defaults to the UTC date. */
  today?: string
  /** Proceed even if another run for this source is marked RUNNING. */
  forceUnlock?: boolean
  log?: (message: string) => void
}

interface ReviewItem {
  dedupeKey: string
  reason: string
  tier: string
  subjectExternalId: string | null
  subjectCallId: string | null
  candidateExternalId: string | null
  candidateCallId: string | null
  score: number | null
  signals: Record<string, unknown>
  blocksRelease: boolean
}

export interface ImportReport {
  mode: 'DRY_RUN' | 'APPLY'
  sourceKey: string
  database: string
  snapshot: SnapshotManifest
  importerVersion: string
  crosswalkVersions: Record<string, string>
  today: string
  counts: Record<string, number>
  lifecycle: Record<string, number>
  eligibilityScopes: Record<string, Record<string, number>>
  currencies: Record<string, number>
  fundingKinds: Record<string, number>
  unmappedLabels: Array<{ vocabulary: string; label: string; records: number }>
  unknownCountryValues: Array<{ value: string; records: number }>
  duplicates: {
    importedVsExisting: Record<string, number>
    importedVsImported: Record<string, number>
    existingVsExisting: Record<string, number>
    samples: Array<{ tier: string; subject: string; candidate: string; signals: DuplicatePair['signals'] }>
  }
  reviewQueue: { blocking: number; informational: number; byReason: Record<string, number>; releasableCalls: number }
  existingCatalogue: { globalCalls: number; considered: number }
  notes: string[]
}

const READINESS_FIELDS = ['agency', 'title', 'description', 'funding_kinds', 'disciplines', 'close_date_or_rolling'] as const

export function readinessGaps(call: NormalizedExternalCall): string[] {
  const gaps: string[] = []
  if (call.funderNames.length === 0) gaps.push('agency')
  if (!call.title) gaps.push('title')
  if (!call.description) gaps.push('description')
  if (call.fundingKinds.length === 0) gaps.push('funding_kinds')
  if (call.disciplines.length === 0) gaps.push('disciplines')
  if (!call.lifecycle.finalDeadline && !call.lifecycle.isRolling) gaps.push('close_date_or_rolling')
  return gaps
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] || 0) + by
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Date) return v.toISOString()
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc: Record<string, unknown>, k) => {
        acc[k] = (v as Record<string, unknown>)[k]
        return acc
      }, {})
    }
    return v
  })
}

/**
 * The maintained values written to funding_calls for one imported record.
 * Keys are Prisma field names. Used for creation and as the three-way-merge
 * base (`imported_values`) on later runs.
 */
export function buildMaintainedValues(call: NormalizedExternalCall, ctx: { funderId: string | null; usdPerUnit: number | null; fxAsOf: string | null }) {
  const usd = usdEstimates(call.amount, ctx.usdPerUnit)
  const agency = call.funderNames[0] || null
  const life = call.lifecycle
  return {
    title: call.title,
    scheme_title: call.title,
    agencyName: agency,
    agency_name: agency,
    summary: call.summary,
    description: call.description,
    sourceUrl: call.applyUrl,
    source_url: call.applyUrl,
    sourceDomain: call.applyUrl ? new URL(call.applyUrl).hostname.replace(/^www\./, '') : null,
    official_urls: call.applyUrl ? [call.applyUrl] : [],
    open_date: dateOnly(life.openDate),
    close_date: dateOnly(life.finalDeadline),
    deadlineAt: dateOnly(life.finalDeadline),
    expiration_date: dateOnly(life.finalDeadline),
    is_rolling: life.isRolling,
    geography_scope: call.geographyScope,
    eligible_countries: call.eligibleCountryNames,
    eligible_regions: call.eligibleRegions,
    host_countries: call.hostCountryNames,
    funder_country: call.funderCountryName,
    citizenship_requirements: call.citizenshipRequirements,
    funding_kinds: call.fundingKinds,
    institution_types: call.institutionTypes,
    career_stages: call.careerStages,
    disciplines: call.disciplines,
    amount_min: call.amount.min,
    amount_max: call.amount.max,
    currency: call.amount.currency,
    project_duration_min_months: call.durationMinMonths,
    project_duration_max_months: call.durationMaxMonths,
    project_duration_text: call.durationText,
    eligibility_text: call.eligibilityText,
    sponsor_type: call.sponsorType,
    funder_id: ctx.funderId,
    funder_country_code: call.funderCountryCode,
    description_source: 'scientify',
    next_deadline_at: dateOnly(life.nextDeadline),
    final_deadline_at: dateOnly(life.finalDeadline),
    entry_closes_at: dateOnly(life.entryCloses),
    deadline_timezone: life.deadlineTimezone,
    source_closed_at: life.sourceClosed ? call.fetchedAt || new Date() : null,
    opportunity_status: life.status,
    lifecycle_needs_check: life.needsCheck,
    ...dimensionColumns('residence', call.residence),
    ...dimensionColumns('citizenship', call.citizenship),
    ...dimensionColumns('host', call.host),
    regions_version: call.regionsVersion,
    currency_code: call.amount.currency,
    amount_text: call.amount.text,
    amount_time_basis: call.amount.text ? call.amount.timeBasis : null,
    amount_recipient_basis: call.amount.text ? call.amount.recipientBasis : null,
    indirect_cost_policy: call.indirectCostPolicy,
    indirect_cost_note: call.amount.indirectCostNote,
    amount_min_usd_est: usd.min,
    amount_max_usd_est: usd.max,
    fx_rate_used: usd.min !== null || usd.max !== null ? ctx.usdPerUnit : null,
    fx_as_of: usd.min !== null || usd.max !== null ? dateOnly(ctx.fxAsOf) : null,
    requires_nomination: call.requiresNomination,
    nomination_note: call.nominationNote,
    required_qualifications: call.requiredQualifications,
    target_groups: call.targetGroups,
    membership_requirements: call.membershipRequirements,
    work_rights_required: call.workRightsRequired,
    additional_benefits: call.additionalBenefits,
    sdg_goals: call.sdgGoals,
    challenge_tags: call.challengeTags,
    programme_framework: call.programmeFramework,
    source_disciplines: call.disciplines,
    content_language: call.contentLanguage,
    title_native: call.titleNative,
  } as Record<string, unknown>
}

/**
 * Hash of everything an import would write, minus the values that depend on
 * today's date (lifecycle status, next deadline): those are display copies a
 * refresh recomputes, and including them would make every daily re-run look
 * like a change. Mapping-rule versions are included on purpose, and so is the
 * FX rate the call's USD estimate uses: a refreshed rate re-processes exactly
 * the calls in that currency. Calls with no rate hash as they always did.
 */
function changeHash(call: NormalizedExternalCall, versions: Record<string, string>, fx?: string | null): string {
  const { rawPayload: _raw, lifecycle, ...rest } = call
  const { status: _status, nextDeadline: _next, ...stableLifecycle } = lifecycle
  return crypto
    .createHash('sha256')
    .update(stableJson({ normalized: { ...rest, lifecycle: stableLifecycle }, importer: IMPORTER_VERSION, versions, ...(fx ? { fx } : {}) }))
    .digest('hex')
}

/**
 * Columns recomputed from reference data (FX rates), not from the source. A
 * change to these alone is not an edit of the call, so it keeps its updatedAt
 * (an FX refresh must not make 7k calls "recently updated").
 */
const DERIVED_FIELDS = new Set(['amount_min_usd_est', 'amount_max_usd_est', 'fx_rate_used', 'fx_as_of'])

async function resolveOperator(db: PrismaClient, email: string | null | undefined) {
  if (!email) return { id: 'system:catalog-import', email: null as string | null }
  const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true } })
  if (!user) throw new Error(`No user with email ${email}; pass an existing operator email.`)
  return { id: user.id, email: user.email }
}

type ExistingCallRow = {
  id: string
  title: string | null
  scheme_title: string | null
  agency_name: string | null
  agencyName: string | null
  source_url: string | null
  sourceUrl: string | null
  official_urls: string[] | null
  close_date: Date | null
  deadlineAt: Date | null
  description: string | null
  createdAt: Date
}

async function loadExistingCatalogue(db: PrismaClient, sourceKey: string, snapshotExternalIds: Set<string>) {
  // Platform catalogue calls only. Tenant-private calls and Default Grant
  // Format scaffolds are never compared, linked or shown in review.
  const curated = await db.$queryRawUnsafe<ExistingCallRow[]>(`
    SELECT id, title, scheme_title, agency_name, "agencyName", source_url, "sourceUrl", official_urls,
           close_date, "deadlineAt", description, "createdAt"
    FROM funding_calls
    WHERE "tenantId" IS NULL
      AND visibility::text = 'GLOBAL_PUBLISHED'
      AND import_run_id IS NULL
      AND COALESCE(source, '') <> 'default-grant-format'
      AND COALESCE(metadata->>'kind', '') <> 'default_grant_format'`)
  // Calls imported from OTHER sources, and this source's calls that are not
  // in the current snapshot, are existing calls too: a second source must be
  // checked against the first. They are compared, never written.
  const imported = await db.$queryRawUnsafe<Array<ExistingCallRow & { esr_source: string | null; esr_external: string | null }>>(`
    SELECT fc.id, fc.title, fc.scheme_title, fc.agency_name, fc."agencyName", fc.source_url, fc."sourceUrl", fc.official_urls,
           fc.close_date, fc."deadlineAt", fc.description, fc."createdAt",
           esr.source_key AS esr_source, esr.external_id AS esr_external
    FROM funding_calls fc
    LEFT JOIN external_source_records esr
      ON esr.funding_call_id = fc.id AND esr.entity_type = 'CALL' AND esr.link_role = 'PRIMARY'
    WHERE fc.import_run_id IS NOT NULL AND fc.catalog_status::text <> 'REJECTED'`)
  const otherImported = imported.filter((row) => row.esr_source !== sourceKey || !row.esr_external || !snapshotExternalIds.has(row.esr_external))
  return [...curated, ...otherImported]
}

function existingDedupCall(row: ExistingCallRow): DedupCall {
  const agency = row.agency_name || row.agencyName || ''
  const acronym = acronymOf(agency)
  const close = isoDate(row.close_date || row.deadlineAt)
  return {
    id: row.id,
    kind: 'existing',
    title: row.scheme_title || row.title || '',
    funderKeys: [normalizeFunderName(agency), acronym ? `acr:${acronym.toLowerCase()}` : ''].filter(Boolean),
    urlKeys: urlKeys([row.source_url, row.sourceUrl, ...(row.official_urls || [])]),
    finalDeadline: close,
    year: close ? Number(close.slice(0, 4)) : row.createdAt ? row.createdAt.getUTCFullYear() : null,
    descriptionHash: descriptionHash(row.description),
    seriesKey: null,
  }
}

function importedDedupCall(call: NormalizedExternalCall, funderById: Map<string, NormalizedExternalFunder>): DedupCall {
  const keys = new Set<string>()
  for (const id of call.funderExternalIds) {
    keys.add(`sf:${id}`)
    const funder = funderById.get(id)
    if (funder?.normalizedName) keys.add(funder.normalizedName)
    if (funder?.acronym) keys.add(`acr:${funder.acronym.toLowerCase()}`)
  }
  for (const name of call.funderNames) {
    const normalized = normalizeFunderName(name)
    if (normalized) keys.add(normalized)
  }
  return {
    id: `x:${call.externalId}`,
    kind: 'imported',
    title: call.title,
    funderKeys: Array.from(keys),
    urlKeys: urlKeys([call.applyUrl]),
    finalDeadline: call.lifecycle.finalDeadline,
    year: call.lifecycle.finalDeadline ? Number(call.lifecycle.finalDeadline.slice(0, 4)) : call.sourcePublishedAt?.getUTCFullYear() ?? null,
    descriptionHash: descriptionHash(call.description),
    seriesKey: buildSeriesKey(call.funderExternalIds[0] || null, call.title),
  }
}

export async function runCatalogImport(options: RunImportOptions): Promise<{ runId: string | null; report: ImportReport }> {
  const { db } = options
  const log = options.log || (() => {})
  const today = options.today || new Date().toISOString().slice(0, 10)
  const manifest = await verifySnapshot(options.snapshotDir)
  const database = (await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name
  if (options.mode === 'APPLY' && options.confirmTarget !== database) {
    throw new Error(`Refusing to write: --confirm-target must equal the target database name (${database}).`)
  }
  const crosswalks = loadScientifyCrosswalks()
  const versions = crosswalkVersions(crosswalks)

  log(`Reading funders from snapshot ${path.basename(options.snapshotDir)}…`)
  const funderById = new Map<string, NormalizedExternalFunder>()
  for await (const record of readJsonLines(path.join(options.snapshotDir, 'funders.jsonl'))) {
    const funder = mapScientifyFunder(record as Record<string, unknown>)
    funderById.set(funder.externalId, funder)
  }
  log(`Reading grants…`)
  const calls: NormalizedExternalCall[] = []
  for await (const record of readJsonLines(path.join(options.snapshotDir, 'grants.jsonl'))) {
    const call = mapScientifyGrant(record as Record<string, unknown>, { crosswalks, funderById, today })
    // Pass 1 keeps only what duplicate checks and the report need. The raw
    // records (~117 MB of JSON, three ~210-country lists each) are re-read in
    // pass 2 batch by batch, so memory stays flat on a small server.
    call.rawPayload = {}
    calls.push(call)
    if (options.limit && calls.length >= options.limit) break
  }
  calls.sort((a, b) => Number(a.externalId) - Number(b.externalId))

  log(`Loading the existing catalogue…`)
  const existingRows = await loadExistingCatalogue(db, options.sourceKey, new Set(calls.map((call) => call.externalId)))
  const existingDedup = existingRows.map(existingDedupCall)
  const importedDedup = calls.map((call) => importedDedupCall(call, funderById))
  log(`Checking ${calls.length} records against ${existingRows.length} existing catalogue calls for duplicates…`)
  const pairs = findDuplicatePairs(importedDedup, existingDedup)
  const existingPairs = findExistingDuplicatePairs(existingDedup)

  // ---- Review items -------------------------------------------------------
  const reviewItems: ReviewItem[] = []
  const callByDedupId = new Map(calls.map((call) => [`x:${call.externalId}`, call]))
  for (const pair of pairs) {
    const subject = callByDedupId.get(pair.subjectId)!
    const candidateImported = pair.candidateKind === 'imported' ? callByDedupId.get(pair.candidateId) : undefined
    reviewItems.push({
      dedupeKey: `${options.sourceKey}:dup:${subject.externalId}:${candidateImported ? `x${candidateImported.externalId}` : pair.candidateId}`,
      reason: 'POSSIBLE_DUPLICATE',
      tier: pair.tier,
      subjectExternalId: subject.externalId,
      subjectCallId: null,
      candidateExternalId: candidateImported?.externalId || null,
      candidateCallId: candidateImported ? null : pair.candidateId,
      score: pair.score,
      signals: { ...pair.signals, candidateKind: pair.candidateKind },
      blocksRelease: tierBlocksRelease(pair.tier),
    })
  }
  for (const pair of existingPairs) {
    reviewItems.push({
      dedupeKey: `existing:dup:${pair.subjectId}:${pair.candidateId}`,
      reason: 'EXISTING_DUPLICATE',
      tier: pair.tier,
      subjectExternalId: null,
      subjectCallId: pair.subjectId,
      candidateExternalId: null,
      candidateCallId: pair.candidateId,
      score: pair.score,
      signals: { ...pair.signals, candidateKind: 'existing' },
      blocksRelease: false,
    })
  }
  for (const call of calls) {
    const gaps = readinessGaps(call)
    if (gaps.length > 0) {
      reviewItems.push({
        dedupeKey: `${options.sourceKey}:readiness:${call.externalId}`,
        reason: 'READINESS_FAILED',
        tier: 'INFO',
        subjectExternalId: call.externalId,
        subjectCallId: null,
        candidateExternalId: null,
        candidateCallId: null,
        score: null,
        signals: { missing: gaps, detailMissing: call.detailMissing },
        blocksRelease: true,
      })
    }
    if (call.unknownCountryValues.length > 0) {
      reviewItems.push({
        dedupeKey: `${options.sourceKey}:countries:${call.externalId}`,
        reason: 'UNKNOWN_COUNTRY_VALUES',
        tier: 'INFO',
        subjectExternalId: call.externalId,
        subjectCallId: null,
        candidateExternalId: null,
        candidateCallId: null,
        score: null,
        signals: { values: call.unknownCountryValues },
        blocksRelease: false,
      })
    }
    if (call.amount.unparsed) {
      reviewItems.push({
        dedupeKey: `${options.sourceKey}:amount:${call.externalId}`,
        reason: 'UNPARSED_AMOUNT',
        tier: 'INFO',
        subjectExternalId: call.externalId,
        subjectCallId: null,
        candidateExternalId: null,
        candidateCallId: null,
        score: null,
        signals: { text: call.amount.text },
        blocksRelease: false,
      })
    }
    if (call.sourceUnavailable) {
      reviewItems.push({
        dedupeKey: `${options.sourceKey}:unavailable:${call.externalId}`,
        reason: 'SOURCE_UNAVAILABLE',
        tier: 'INFO',
        subjectExternalId: call.externalId,
        subjectCallId: null,
        candidateExternalId: null,
        candidateCallId: null,
        score: null,
        signals: { error: call.sourceError },
        blocksRelease: false,
      })
    }
  }

  // ---- Report -------------------------------------------------------------
  const blockedExternalIds = new Set<string>()
  for (const item of reviewItems) {
    if (!item.blocksRelease) continue
    if (item.subjectExternalId) blockedExternalIds.add(item.subjectExternalId)
    if (item.candidateExternalId) blockedExternalIds.add(item.candidateExternalId)
  }
  const report = buildReport({ options, database, manifest, versions, today, calls, pairs, existingPairs, reviewItems, blockedExternalIds, existingRows })

  if (options.mode === 'DRY_RUN') return { runId: null, report }

  // ---- APPLY --------------------------------------------------------------
  const operator = await resolveOperator(db, options.operatorEmail)
  const running = await db.fundingImportRun.findFirst({
    where: { source_key: options.sourceKey, status: 'RUNNING', mode: 'APPLY', started_at: { gt: new Date(Date.now() - 6 * 3600_000) } },
    select: { id: true, started_at: true },
  })
  if (running && !options.forceUnlock) {
    throw new Error(`Another APPLY run for ${options.sourceKey} is in progress (${running.id}, started ${running.started_at.toISOString()}). Wait for it, or pass --force-unlock if it died.`)
  }
  const run = await db.fundingImportRun.create({
    data: {
      source_key: options.sourceKey,
      mode: 'APPLY',
      status: 'RUNNING',
      snapshot_path: options.snapshotDir,
      snapshot_manifest: manifest as any,
      is_full_snapshot: Boolean(options.isFullSnapshot),
      importer_version: IMPORTER_VERSION,
      crosswalk_versions: versions as any,
      operator_email: operator.email,
      target_database: database,
    },
  })
  log(`Import run ${run.id} started.`)
  try {
    await ensureSourceRegistry(db, options.sourceKey)
    const funderIdByExternal = await writeFunders(db, run.id, calls, funderById, log)
    const callIdByExternal = await writeCalls(db, {
      runId: run.id,
      sourceKey: options.sourceKey,
      wanted: new Set(calls.map((call) => call.externalId)),
      records: async function* () {
        for await (const record of readJsonLines(path.join(options.snapshotDir, 'grants.jsonl'))) {
          yield mapScientifyGrant(record as Record<string, unknown>, { crosswalks, funderById, today })
        }
      },
      funderIdByExternal,
      versions,
      operatorId: operator.id,
      blockedExternalIds,
      log,
    })
    await writeReviewItems(db, run.id, reviewItems, callIdByExternal, log)
    await refreshReviewStatus(db, run.id, Array.from(callIdByExternal.values()))
    await syncCatalogueAreaIndex(db)
    if (options.isFullSnapshot && !options.limit) {
      const seen = calls.map((call) => call.externalId)
      await db.externalSourceRecord.updateMany({
        where: { source_key: options.sourceKey, entity_type: 'CALL', external_id: { notIn: seen } },
        data: { availability: 'NOT_SEEN_IN_SNAPSHOT' },
      })
      // A promoted call stays in the funding department whatever the source
      // does; a curator is told when the source stops listing it.
      const unseenPromoted = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT fc.id FROM funding_calls fc
           JOIN external_source_records esr ON esr.funding_call_id = fc.id AND esr.entity_type = 'CALL' AND esr.link_role = 'PRIMARY'
          WHERE esr.source_key = $1 AND esr.availability = 'NOT_SEEN_IN_SNAPSHOT'
            AND fc.import_run_id IS NOT NULL AND fc.visibility::text = 'GLOBAL_PUBLISHED'`,
        options.sourceKey
      )
      for (const row of unseenPromoted) {
        await db.fundingImportCandidate.upsert({
          where: { dedupe_key: `promoted-not-seen:${row.id}` },
          update: { run_id: run.id },
          create: {
            run_id: run.id,
            dedupe_key: `promoted-not-seen:${row.id}`,
            reason: 'SOURCE_UNAVAILABLE',
            tier: 'INFO',
            subject_call_id: row.id,
            signals: { promoted: true, note: 'In the funding department, but the source no longer lists this call.' } as any,
            blocks_release: false,
          },
        })
      }
    }
    await db.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', finished_at: new Date(), counts: report.counts as any, report: report as any, checkpoint: calls[calls.length - 1]?.externalId || null },
    })
    log(`Import run ${run.id} completed.`)
    return { runId: run.id, report }
  } catch (error) {
    await db.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finished_at: new Date(), error: error instanceof Error ? error.message : String(error) },
    })
    throw error
  }
}

function buildReport(input: {
  options: RunImportOptions
  database: string
  manifest: SnapshotManifest
  versions: Record<string, string>
  today: string
  calls: NormalizedExternalCall[]
  pairs: DuplicatePair[]
  existingPairs: DuplicatePair[]
  reviewItems: ReviewItem[]
  blockedExternalIds: Set<string>
  existingRows: ExistingCallRow[]
}): ImportReport {
  const { calls } = input
  const counts: Record<string, number> = { records: calls.length }
  const lifecycle: Record<string, number> = {}
  const scopes: Record<string, Record<string, number>> = { residence: {}, citizenship: {}, host: {} }
  const currencies: Record<string, number> = {}
  const fundingKinds: Record<string, number> = {}
  const unmapped = new Map<string, number>()
  const unknownCountries = new Map<string, number>()
  for (const call of calls) {
    bump(lifecycle, call.lifecycle.status)
    bump(scopes.residence, call.residence.scope || 'NULL')
    bump(scopes.citizenship, call.citizenship.scope || 'NULL')
    bump(scopes.host, call.host.scope || 'NULL')
    bump(currencies, call.amount.currency || (call.amount.text ? 'non-numeric' : 'none'))
    call.fundingKinds.forEach((kind) => bump(fundingKinds, kind))
    if (call.fundingKinds.length === 0) bump(fundingKinds, '(none)')
    for (const item of call.unmappedLabels) unmapped.set(`${item.vocabulary}\u0000${item.label}`, (unmapped.get(`${item.vocabulary}\u0000${item.label}`) || 0) + 1)
    for (const value of call.unknownCountryValues) unknownCountries.set(value, (unknownCountries.get(value) || 0) + 1)
    if (call.detailMissing) bump(counts, 'detailMissing')
    if (call.sourceUnavailable) bump(counts, 'sourceUnavailable')
    if (call.amount.min !== null || call.amount.max !== null) bump(counts, 'amountParsed')
    if (call.amount.unparsed) bump(counts, 'amountUnparsed')
    if (call.lifecycle.needsCheck) bump(counts, 'lifecycleNeedsCheck')
    if (call.titleNative) bump(counts, 'bilingualTitles')
    if (call.researchAreaCodes.length > 0) bump(counts, 'withResearchAreas')
    if (call.funderNames.length === 0) bump(counts, 'withoutFunder')
  }
  const tierCounts = (pairs: DuplicatePair[], kind?: 'imported' | 'existing') => {
    const out: Record<string, number> = {}
    for (const pair of pairs) if (!kind || pair.candidateKind === kind) bump(out, pair.tier)
    return out
  }
  const byReason: Record<string, number> = {}
  let blocking = 0
  let informational = 0
  for (const item of input.reviewItems) {
    bump(byReason, `${item.reason}${item.tier === 'INFO' ? '' : `:${item.tier}`}`)
    if (item.blocksRelease) blocking++
    else informational++
  }
  for (const pair of input.pairs) if (pair.signals.listingVariant) bump(counts, 'listingVariantPairs')
  const releasable = calls.filter((call) => !input.blockedExternalIds.has(call.externalId)).length
  counts.releasableAfterImport = releasable
  counts.heldForReview = calls.length - releasable
  const callTitle = new Map(calls.map((c) => [`x:${c.externalId}`, `${c.title} [scientify ${c.externalId}]`]))
  const existingTitle = new Map(input.existingRows.map((r) => [r.id, `${r.scheme_title || r.title} [existing ${r.id}]`]))
  const samples = [...input.pairs]
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((pair) => ({
      tier: pair.tier,
      subject: callTitle.get(pair.subjectId) || pair.subjectId,
      candidate: callTitle.get(pair.candidateId) || existingTitle.get(pair.candidateId) || pair.candidateId,
      signals: pair.signals,
    }))
  return {
    mode: input.options.mode,
    sourceKey: input.options.sourceKey,
    database: input.database,
    snapshot: input.manifest,
    importerVersion: IMPORTER_VERSION,
    crosswalkVersions: input.versions,
    today: input.today,
    counts,
    lifecycle,
    eligibilityScopes: scopes,
    currencies,
    fundingKinds,
    unmappedLabels: Array.from(unmapped.entries())
      .map(([key, records]) => ({ vocabulary: key.split('\u0000')[0], label: key.split('\u0000')[1], records }))
      .sort((a, b) => b.records - a.records),
    unknownCountryValues: Array.from(unknownCountries.entries()).map(([value, records]) => ({ value, records })).sort((a, b) => b.records - a.records),
    duplicates: {
      importedVsExisting: tierCounts(input.pairs, 'existing'),
      importedVsImported: tierCounts(input.pairs, 'imported'),
      existingVsExisting: tierCounts(input.existingPairs),
      samples,
    },
    reviewQueue: { blocking, informational, byReason, releasableCalls: releasable },
    existingCatalogue: { globalCalls: input.existingRows.length, considered: input.existingRows.length },
    notes: [
      'Existing calls are compared but never written. Duplicates are review items, never merges.',
      'Imported calls are written STAGED, inactive, GLOBAL_CATALOG and notification-SUPPRESSED.',
    ],
  }
}

async function ensureSourceRegistry(db: PrismaClient, sourceKey: string) {
  await db.fundingSourceRegistry.upsert({
    where: { source_key: sourceKey },
    update: {},
    create: {
      source_key: sourceKey,
      display_name: 'ScientifyResearch',
      attribution_text: 'Opportunity summary from ScientifyResearch',
      homepage_url: 'https://www.scientifyresearch.org',
      republication_basis: 'informal-permission-unverified',
      display_policy: 'FULL_TEXT',
      notes: 'Descriptions are ScientifyResearch editorial summaries, shown with attribution until replaced by text mined from the official pages.',
    },
  })
}

async function writeFunders(
  db: PrismaClient,
  runId: string,
  calls: NormalizedExternalCall[],
  funderById: Map<string, NormalizedExternalFunder>,
  log: (m: string) => void
): Promise<Map<string, string>> {
  const referenced = new Set(calls.flatMap((call) => call.funderExternalIds))
  const votes = new Map<string, Record<string, number>>()
  for (const call of calls) {
    for (const id of call.funderExternalIds) {
      const tally = votes.get(id) || {}
      call.funderTypeVotes.forEach((vote) => bump(tally, vote))
      votes.set(id, tally)
    }
  }
  const existing = await db.externalSourceRecord.findMany({
    where: { source_key: 'scientify', entity_type: 'FUNDER' },
    select: { external_id: true, funder_id: true },
  })
  const funderIdByExternal = new Map<string, string>()
  for (const row of existing) if (row.funder_id) funderIdByExternal.set(row.external_id, row.funder_id)
  const toCreate = Array.from(referenced).filter((id) => !funderIdByExternal.has(id) && funderById.has(id))
  log(`Funders: ${funderIdByExternal.size} already imported, ${toCreate.length} new.`)
  for (let i = 0; i < toCreate.length; i += WRITE_BATCH_SIZE) {
    const batch = toCreate.slice(i, i + WRITE_BATCH_SIZE)
    await db.$transaction(async (tx) => {
      for (const externalId of batch) {
        const funder = funderById.get(externalId)!
        const tally = votes.get(externalId) || {}
        const funderType = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null
        const created = await tx.funder.create({
          data: {
            name: funder.name,
            normalized_name: funder.normalizedName,
            acronym: funder.acronym,
            country_code: funder.countryCode,
            funder_type: funderType,
            description: funder.description,
            metadata: { region_code: funder.regionCode, source_url: funder.sourceUrl } as any,
            import_run_id: runId,
          },
          select: { id: true },
        })
        await tx.externalSourceRecord.create({
          data: {
            source_key: 'scientify',
            entity_type: 'FUNDER',
            external_id: externalId,
            external_slug: funder.slug,
            source_url: funder.sourceUrl,
            funder_id: created.id,
            raw_payload: funder.rawPayload as any,
            content_hash: crypto.createHash('sha256').update(stableJson(funder.rawPayload)).digest('hex'),
            importer_version: IMPORTER_VERSION,
            source_published_at: funder.sourcePublishedAt,
            source_modified_at: funder.sourceModifiedAt,
            first_import_run_id: runId,
            last_import_run_id: runId,
          },
        })
        await tx.fundingImportChange.create({ data: { run_id: runId, entity_table: 'funders', entity_id: created.id, operation: 'INSERT' } })
        funderIdByExternal.set(externalId, created.id)
      }
    }, { timeout: 120_000 })
  }
  return funderIdByExternal
}

async function loadResearchAreas(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; level1_code: string; level1_name: string; level2_code: string; level2_name: string }>>(`
    SELECT area.id, area.level1_code, area.level1_name, area.level2_code, area.level2_name
    FROM research_area_taxonomy_areas area
    INNER JOIN research_area_taxonomy_uploads upload ON upload.id = area.upload_id
    WHERE area.is_active = true AND upload.status = 'ACTIVE'`)
  const byCode = new Map<string, (typeof rows)[number]>()
  for (const row of rows) byCode.set(row.level2_code || row.level1_code, row)
  return byCode
}

async function loadRates(db: PrismaClient) {
  const rows = await db.currencyRate.findMany({ orderBy: { as_of: 'desc' } })
  const latest = new Map<string, { usdPerUnit: number; asOf: string }>()
  for (const row of rows) if (!latest.has(row.currency)) latest.set(row.currency, { usdPerUnit: row.usd_per_unit, asOf: row.as_of.toISOString().slice(0, 10) })
  return latest
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null)
}

async function writeCalls(
  db: PrismaClient,
  input: {
    runId: string
    sourceKey: string
    /** External ids selected in pass 1 (respects --limit). */
    wanted: Set<string>
    /** Pass 2: the snapshot re-read and re-mapped, raw payload included. */
    records: () => AsyncGenerator<NormalizedExternalCall>
    funderIdByExternal: Map<string, string>
    versions: Record<string, string>
    operatorId: string
    blockedExternalIds: Set<string>
    log: (m: string) => void
  }
): Promise<Map<string, string>> {
  const { runId } = input
  const total = input.wanted.size
  const areas = await loadResearchAreas(db)
  const rates = await loadRates(db)
  const prior = await db.externalSourceRecord.findMany({
    where: { source_key: input.sourceKey, entity_type: 'CALL' },
    select: { id: true, external_id: true, funding_call_id: true, content_hash: true, imported_values: true, link_role: true },
  })
  const priorByExternal = new Map(prior.map((row) => [row.external_id, row]))
  const callIdByExternal = new Map<string, string>()
  let created = 0
  let unchanged = 0
  let updated = 0
  let conflicts = 0
  const now = new Date()

  let processed = 0
  let batch: NormalizedExternalCall[] = []
  const flush = async () => {
    if (batch.length === 0) return
    await writeCallBatch(batch)
    processed += batch.length
    await db.fundingImportRun.update({ where: { id: runId }, data: { checkpoint: batch[batch.length - 1].externalId } })
    input.log(`  ${processed}/${total} records written (new ${created}, updated ${updated}, unchanged ${unchanged}, conflicts ${conflicts})`)
    batch = []
  }
  for await (const call of input.records()) {
    if (!input.wanted.has(call.externalId)) continue
    batch.push(call)
    if (batch.length >= WRITE_BATCH_SIZE) await flush()
  }
  await flush()
  return callIdByExternal

  async function writeCallBatch(batch: NormalizedExternalCall[]) {
    await db.$transaction(async (tx) => {
      for (const call of batch) {
        const funderId = call.funderExternalIds[0] ? input.funderIdByExternal.get(call.funderExternalIds[0]) || null : null
        const rate = call.amount.currency ? rates.get(call.amount.currency) : undefined
        const hash = changeHash(call, input.versions, rate ? `${rate.asOf}:${rate.usdPerUnit}` : null)
        const values = buildMaintainedValues(call, { funderId, usdPerUnit: rate?.usdPerUnit ?? null, fxAsOf: rate?.asOf ?? null })
        const previous = priorByExternal.get(call.externalId)

        if (previous?.funding_call_id) {
          callIdByExternal.set(call.externalId, previous.funding_call_id)
          if (previous.content_hash === hash) {
            unchanged++
            await tx.externalSourceRecord.update({
              where: { id: previous.id },
              data: { last_seen_at: now, last_import_run_id: runId, availability: call.sourceUnavailable ? 'UNAVAILABLE' : 'AVAILABLE', source_checked_at: call.fetchedAt },
            })
            continue
          }
          if (previous.link_role !== 'PRIMARY') {
            // Attached to an existing call by a review: never write to that
            // call. Keep the new payload and raise a suggestion instead.
            await tx.externalSourceRecord.update({
              where: { id: previous.id },
              data: { raw_payload: call.rawPayload as any, content_hash: hash, importer_version: IMPORTER_VERSION, last_seen_at: now, last_import_run_id: runId, source_checked_at: call.fetchedAt },
            })
            continue
          }
          const current = await tx.fundingCall.findUnique({ where: { id: previous.funding_call_id } })
          if (!current) continue
          const base = (previous.imported_values as Record<string, unknown>) || {}
          const data: Record<string, unknown> = {}
          const nextBase: Record<string, unknown> = { ...base }
          const conflictFields: string[] = []
          for (const [field, next] of Object.entries(values)) {
            // A field a curator or enrichment took over is theirs: never
            // overwritten, and not a conflict either.
            const owner = fieldOwner(current.field_provenance, field)
            if (owner && owner !== input.sourceKey) continue
            const was = base[field]
            const now_ = (current as Record<string, unknown>)[field]
            if (sameValue(next, was)) continue
            if (sameValue(now_, was) || was === undefined) {
              data[field] = next
              nextBase[field] = next
              await tx.fundingImportChange.create({
                data: { run_id: runId, entity_table: 'funding_calls', entity_id: current.id, operation: 'UPDATE', field, before_value: (now_ ?? null) as any, after_value: (next ?? null) as any },
              })
            } else if (sameValue(now_, next)) {
              nextBase[field] = next
            } else {
              conflictFields.push(field)
            }
          }
          if (Object.keys(data).length > 0) {
            const derivedOnly = Object.keys(data).every((field) => DERIVED_FIELDS.has(field))
            await tx.fundingCall.update({
              where: { id: current.id },
              // An explicit updatedAt is kept as given by Prisma's @updatedAt.
              data: derivedOnly ? { ...(data as any), updatedAt: current.updatedAt } : { ...(data as any), updatedByUserId: input.operatorId },
            })
            updated++
          }
          if (conflictFields.length > 0) {
            conflicts++
            await tx.fundingImportCandidate.upsert({
              where: { dedupe_key: `${input.sourceKey}:conflict:${call.externalId}` },
              update: { run_id: runId, signals: { fields: conflictFields } as any, resolution: 'pending' },
              create: {
                run_id: runId,
                dedupe_key: `${input.sourceKey}:conflict:${call.externalId}`,
                reason: 'SOURCE_CONFLICT',
                tier: 'INFO',
                subject_call_id: current.id,
                signals: { fields: conflictFields } as any,
                blocks_release: false,
              },
            })
          }
          await tx.externalSourceRecord.update({
            where: { id: previous.id },
            data: { raw_payload: call.rawPayload as any, imported_values: nextBase as any, content_hash: hash, importer_version: IMPORTER_VERSION, last_seen_at: now, last_import_run_id: runId, availability: call.sourceUnavailable ? 'UNAVAILABLE' : 'AVAILABLE', source_checked_at: call.fetchedAt },
          })
          continue
        }

        // ---- New call ----
        const createdCall = await tx.fundingCall.create({
          data: {
            ...(values as any),
            visibility: 'GLOBAL_CATALOG',
            tenantId: null,
            status: 'READY_FOR_REVIEW',
            catalog_status: 'STAGED',
            is_active: false,
            sourceType: 'URL',
            input_type: 'json',
            source: importSourceLabel(input.sourceKey),
            sourceFingerprint: `${importSourceLabel(input.sourceKey)}:${call.externalId}`,
            import_run_id: runId,
            review_status: input.blockedExternalIds.has(call.externalId) ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.CLEAR,
            notification_policy: NOTIFICATION_POLICY_SUPPRESSED,
            notification_policy_reason: `bulk_import:${runId}`,
            enrichment_level: 'LITE',
            series_key: buildSeriesKey(call.funderExternalIds[0] || null, call.title),
            status_computed_at: now,
            field_provenance: { default: { source: input.sourceKey, verified_at: (call.fetchedAt || now).toISOString(), run_id: runId } } as any,
            createdByUserId: input.operatorId,
            updatedByUserId: input.operatorId,
            metadata: {
              catalog_import: {
                source_key: input.sourceKey,
                external_id: call.externalId,
                run_id: runId,
                attribution: { source: 'ScientifyResearch', url: call.sourceUrl },
                source_facets: call.sourceFacets,
                co_funders: call.funderNames.slice(1),
              },
              // The alert sweep skips stamped calls; the SUPPRESSED policy is
              // the real guard, this keeps older code paths quiet too.
              alerts_dispatched_at: now.toISOString(),
              alerts_suppressed: 'bulk_import',
              embedding_status: 'not_generated',
            } as any,
          },
          select: { id: true },
        })
        callIdByExternal.set(call.externalId, createdCall.id)
        created++
        if (call.lifecycle.deadlines.length > 0) {
          await tx.fundingCallDeadline.createMany({
            data: call.lifecycle.deadlines.map((d) => ({
              funding_call_id: createdCall.id,
              kind: d.kind,
              label: d.label,
              due_date: dateOnly(d.dueDate)!,
              due_timezone: d.dueTimezone,
              due_timezone_basis: d.dueTimezoneBasis,
              stage_required: d.stageRequired,
              source: input.sourceKey,
              import_run_id: runId,
            })),
            skipDuplicates: true,
          })
        }
        const areaRows = call.researchAreaCodes.map((code) => areas.get(code)).filter((a): a is NonNullable<typeof a> => Boolean(a))
        if (areaRows.length > 0) {
          await tx.fundingCallResearchAreaTaxonomy.createMany({
            data: areaRows.map((area) => ({
              funding_call_id: createdCall.id,
              taxonomy_area_id: area.id,
              taxonomy_level1_code: area.level1_code,
              taxonomy_level1_name: area.level1_name,
              taxonomy_level2_code: area.level2_code,
              taxonomy_level2_name: area.level2_name,
              source: 'auto:crosswalk',
              confidence: 0.9,
            })),
            skipDuplicates: true,
          })
        }
        const sourceRecordData = {
            source_key: input.sourceKey,
            entity_type: 'CALL',
            external_id: call.externalId,
            external_slug: call.slug,
            source_url: call.sourceUrl,
            funding_call_id: createdCall.id,
            funder_id: funderId,
            link_role: 'PRIMARY',
            raw_payload: call.rawPayload as any,
            imported_values: JSON.parse(stableJson(values)),
            content_hash: hash,
            importer_version: IMPORTER_VERSION,
            availability: call.sourceUnavailable ? 'UNAVAILABLE' : 'AVAILABLE',
            source_published_at: call.sourcePublishedAt,
            source_modified_at: call.sourceModifiedAt,
            first_import_run_id: runId,
            last_import_run_id: runId,
            source_checked_at: call.fetchedAt,
        }
        if (previous) {
          // A provenance row whose call is gone (e.g. after a rollback): reuse it.
          await tx.externalSourceRecord.update({ where: { id: previous.id }, data: sourceRecordData as any })
        } else {
          await tx.externalSourceRecord.create({ data: sourceRecordData as any })
        }
        await tx.fundingImportChange.create({ data: { run_id: runId, entity_table: 'funding_calls', entity_id: createdCall.id, operation: 'INSERT' } })
      }
    }, { timeout: 300_000, maxWait: 30_000 })
  }
}

async function writeReviewItems(db: PrismaClient, runId: string, items: ReviewItem[], callIdByExternal: Map<string, string>, log: (m: string) => void) {
  let written = 0
  for (let i = 0; i < items.length; i += WRITE_BATCH_SIZE) {
    const batch = items.slice(i, i + WRITE_BATCH_SIZE)
    await db.$transaction(async (tx) => {
      for (const item of batch) {
        const subject = item.subjectCallId || (item.subjectExternalId ? callIdByExternal.get(item.subjectExternalId) : null) || null
        const candidate = item.candidateCallId || (item.candidateExternalId ? callIdByExternal.get(item.candidateExternalId) : null) || null
        if (!subject && !candidate) continue
        const existing = await tx.fundingImportCandidate.findUnique({ where: { dedupe_key: item.dedupeKey }, select: { id: true, resolution: true } })
        if (existing) {
          // Keep a human's decision; refresh the evidence only.
          await tx.fundingImportCandidate.update({
            where: { id: existing.id },
            data: { run_id: runId, tier: item.tier, score: item.score, signals: item.signals as any, blocks_release: item.blocksRelease },
          })
        } else {
          await tx.fundingImportCandidate.create({
            data: {
              run_id: runId,
              dedupe_key: item.dedupeKey,
              reason: item.reason,
              tier: item.tier,
              subject_call_id: subject,
              candidate_call_id: candidate,
              score: item.score,
              signals: item.signals as any,
              blocks_release: item.blocksRelease,
            },
          })
        }
        written++
      }
    }, { timeout: 120_000 })
  }
  log(`Review items written: ${written}.`)
}

/** NEEDS_REVIEW while any blocking item mentioning the call is still pending. */
export async function refreshReviewStatus(db: PrismaClient, runId: string | null, callIds: string[]) {
  for (let i = 0; i < callIds.length; i += 1000) {
    const ids = callIds.slice(i, i + 1000)
    if (ids.length === 0) continue
    await db.$executeRawUnsafe(
      `UPDATE funding_calls fc SET review_status = CASE WHEN EXISTS (
          SELECT 1 FROM funding_import_candidates c
          WHERE c.blocks_release = true AND c.resolution IN ('pending', 'deferred')
            AND (c.subject_call_id = fc.id OR (c.candidate_call_id = fc.id AND c.reason = 'POSSIBLE_DUPLICATE'
                 AND EXISTS (SELECT 1 FROM funding_calls o WHERE o.id = c.candidate_call_id AND o.import_run_id IS NOT NULL)))
        ) THEN '${REVIEW_STATUS.NEEDS_REVIEW}' ELSE '${REVIEW_STATUS.CLEAR}' END
       WHERE fc.id = ANY($1::text[]) AND fc.import_run_id IS NOT NULL`,
      ids
    )
  }
  void runId
}

export const _internal = { changeHash, stableJson, READINESS_FIELDS, matchKey }
