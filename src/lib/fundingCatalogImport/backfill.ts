/**
 * Existing-call backfill: gives curated (pre-import) calls the facts imported
 * calls carry, so one set of features works across the whole catalogue.
 *
 * Writes NEW columns only, and only where they are still empty:
 *  - applicant eligibility from eligible_countries (names the old normaliser
 *    dropped are recovered from the call's intake extraction);
 *  - final_deadline_at / entry_closes_at and deadline rows;
 *  - currency_code with USD estimates at the latest stored rate;
 *  - funder_id (an existing funder by exact name, or by acronym in the same
 *    country; otherwise a new funder);
 *  - description_source / enrichment_level / field_provenance.
 * Never written: deadline_timezone and source_closed_at (they would change
 * open/closed rules for curated calls), host eligibility (legacy
 * host_countries often means a destination, not a restriction), and any
 * pre-existing column. ts_document widens on its own: its trigger indexes
 * the extra fields once description_source is set.
 *
 * Raw SQL keeps updatedAt. Every column written and every row inserted is
 * logged in funding_import_changes under a BACKFILL run, and undo restores
 * exactly those, skipping any value someone has since changed.
 *
 * A country list with a name nothing resolves is stored as UNSPECIFIED
 * (NEEDS_CHECK for everyone) rather than as a shorter list: a shorter list
 * would wrongly rule out applicants from the unresolved country.
 */
import { Prisma, type PrismaClient } from '@/lib/prisma-generated'
import { buildDimension, type EligibilityDimension } from '@/lib/funding/eligibility'
import { countryCodesFor } from '@/lib/geo/countries'

import { acronymOf, normalizeFunderName } from './adapters/scientify'

export const BACKFILL_SOURCE_KEY = 'existing-call-backfill'
export const BACKFILL_VERSION = 'backfill-2026-10-16'

/** Columns the backfill may write, with their SQL types. */
const COLUMN_TYPES: Record<string, string> = {
  applicant_scope: 'text',
  applicant_country_codes: 'text[]',
  applicant_excluded_codes: 'text[]',
  applicant_region_codes: 'text[]',
  final_deadline_at: 'date',
  entry_closes_at: 'date',
  currency_code: 'varchar(3)',
  amount_min_usd_est: 'double precision',
  amount_max_usd_est: 'double precision',
  fx_rate_used: 'double precision',
  fx_as_of: 'date',
  funder_id: 'text',
  description_source: 'text',
  enrichment_level: 'text',
  field_provenance: 'jsonb',
}
const ARRAY_COLUMNS = new Set(['applicant_country_codes', 'applicant_excluded_codes', 'applicant_region_codes'])

export interface LegacyCallRow {
  id: string
  updated_at: string
  title: string | null
  agency: string | null
  source: string | null
  funder_country: string | null
  geography_scope: string | null
  eligible_countries: string[] | null
  recovered_countries: string[] | null
  currency: string | null
  amount_min: number | null
  amount_max: number | null
  is_rolling: boolean | null
  close_day: string | null
  open_day: string | null
  has_deadline_rows: boolean
  applicant_scope: string | null
  final_deadline_at: string | null
  entry_closes_at: string | null
  currency_code: string | null
  amount_min_usd_est: number | null
  amount_max_usd_est: number | null
  funder_id: string | null
  description_source: string | null
  enrichment_level: string | null
  field_provenance: unknown
}

export interface FunderIndexEntry {
  id: string
  normalizedName: string
  acronym: string | null
  countryCode: string | null
}

export interface CallBackfillPlan {
  callId: string
  title: string
  /** Column -> value; only columns that are empty now. */
  sets: Record<string, unknown>
  deadlines: Array<{ kind: 'OPEN' | 'FULL_APPLICATION'; dueDate: string }>
  funder: { linkTo: string; how: 'name' | 'acronym' } | { create: { name: string; normalizedName: string; acronym: string | null; countryCode: string | null } } | null
  notes: string[]
}

export function isPlaceholderCall(row: Pick<LegacyCallRow, 'source' | 'agency' | 'title'>): boolean {
  return (
    row.source === 'default-grant-format' ||
    (row.agency || '').trim() === 'Default Grant Format' ||
    (row.title || '').startsWith('Default Grant Format - ')
  )
}

function isoCountry(name: string | null | undefined): string | null {
  if (!name) return null
  const codes = countryCodesFor(name, { allowCodes: true })
  return codes.length === 1 ? codes[0] : null
}

/** The applicant dimension a legacy call's country list implies, or null to leave it unevaluated. */
export function applicantDimensionFor(row: Pick<LegacyCallRow, 'geography_scope' | 'eligible_countries' | 'recovered_countries'>): {
  dimension: EligibilityDimension | null
  unresolved: string[]
  recovered: string[]
} {
  const stored = row.eligible_countries || []
  const recovered = (row.recovered_countries || []).filter((name) => !stored.includes(name))
  const names = [...stored, ...recovered]
  if ((row.geography_scope || '').trim().toLowerCase() === 'global') {
    return { dimension: { scope: 'ANY', countryCodes: [], excludedCodes: [], regionCodes: [] }, unresolved: [], recovered }
  }
  if (names.length === 0) return { dimension: null, unresolved: [], recovered }
  const built = buildDimension({ groupTags: [], countryValues: names, regionCodeForTag: () => null })
  if (built.unknownValues.length > 0) {
    return {
      dimension: { scope: 'UNSPECIFIED', countryCodes: [], excludedCodes: [], regionCodes: [] },
      unresolved: built.unknownValues,
      recovered,
    }
  }
  return { dimension: built.dimension, unresolved: [], recovered }
}

/** Pure: what the backfill would write for one legacy call. */
export function planCallBackfill(
  row: LegacyCallRow,
  context: {
    rates: Map<string, { usdPerUnit: number; asOf: string }>
    funders: FunderIndexEntry[]
    runId: string
  }
): CallBackfillPlan {
  const sets: Record<string, unknown> = {}
  const notes: string[] = []

  if (!row.applicant_scope) {
    const applicant = applicantDimensionFor(row)
    if (applicant.recovered.length > 0) notes.push(`recovered ${applicant.recovered.length} country name(s) from intake: ${applicant.recovered.join(', ')}`)
    if (applicant.unresolved.length > 0) notes.push(`unresolved country name(s) ${applicant.unresolved.join(', ')}: stored as UNSPECIFIED`)
    if (applicant.dimension) {
      sets.applicant_scope = applicant.dimension.scope
      sets.applicant_country_codes = applicant.dimension.countryCodes
      sets.applicant_excluded_codes = applicant.dimension.excludedCodes
      sets.applicant_region_codes = applicant.dimension.regionCodes
    }
  }

  const deadlines: CallBackfillPlan['deadlines'] = []
  if (!row.is_rolling && row.close_day) {
    if (!row.final_deadline_at) sets.final_deadline_at = row.close_day
    // No letter-of-intent stage on a curated call: entry closes at the deadline.
    if (!row.entry_closes_at) sets.entry_closes_at = row.close_day
    if (!row.has_deadline_rows) {
      if (row.open_day && row.open_day < row.close_day) deadlines.push({ kind: 'OPEN', dueDate: row.open_day })
      deadlines.push({ kind: 'FULL_APPLICATION', dueDate: row.close_day })
    }
  }

  const currency = (row.currency || '').trim().toUpperCase()
  if (!row.currency_code && /^[A-Z]{3}$/.test(currency)) {
    sets.currency_code = currency
    const rate = context.rates.get(currency)
    const hasAmount = row.amount_min !== null || row.amount_max !== null
    if (rate && hasAmount && row.amount_min_usd_est === null && row.amount_max_usd_est === null) {
      sets.amount_min_usd_est = row.amount_min === null ? null : Math.round(Number(row.amount_min) * rate.usdPerUnit)
      sets.amount_max_usd_est = row.amount_max === null ? null : Math.round(Number(row.amount_max) * rate.usdPerUnit)
      sets.fx_rate_used = rate.usdPerUnit
      sets.fx_as_of = rate.asOf
    } else if (hasAmount && !rate) {
      notes.push(`no stored rate for ${currency}: no USD estimate`)
    }
  } else if (!row.currency_code && currency) {
    notes.push(`currency "${row.currency}" is not an ISO code: left unset`)
  }

  let funder: CallBackfillPlan['funder'] = null
  const agency = (row.agency || '').trim()
  if (!row.funder_id && agency) {
    const normalizedName = normalizeFunderName(agency)
    const countryCode = isoCountry(row.funder_country)
    const acronym = acronymOf(agency) || (/^[A-Z][A-Z0-9&.\-]{1,14}$/.test(agency) ? agency : null)
    const byName = context.funders.find((f) => f.normalizedName === normalizedName)
    // An acronym alone collides across countries (DST, NSF, NRF): only trust
    // it when both sides name the same country.
    const byAcronym = !byName && acronym && countryCode
      ? context.funders.find((f) => f.acronym === acronym && f.countryCode === countryCode)
      : undefined
    if (byName) funder = { linkTo: byName.id, how: 'name' }
    else if (byAcronym) funder = { linkTo: byAcronym.id, how: 'acronym' }
    else if (normalizedName) funder = { create: { name: agency, normalizedName, acronym: acronymOf(agency), countryCode } }
  }

  if (!row.description_source) sets.description_source = 'intake'
  // Curated calls carry their own guidelines; LITE/ENRICHED describe the catalogue.
  if (!row.enrichment_level) sets.enrichment_level = 'CURATED'
  if (!row.field_provenance) {
    sets.field_provenance = { default: { source: 'intake', verified_at: row.updated_at, run_id: context.runId } }
  }

  return { callId: row.id, title: row.title || row.id, sets, deadlines, funder, notes }
}

export async function loadLegacyCalls(db: PrismaClient): Promise<LegacyCallRow[]> {
  const rows = await db.$queryRaw<LegacyCallRow[]>(Prisma.sql`
    SELECT
      fc.id,
      to_char(fc."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
      COALESCE(fc.scheme_title, fc.title) AS title,
      COALESCE(NULLIF(TRIM(fc.agency_name), ''), NULLIF(TRIM(fc."agencyName"), '')) AS agency,
      fc.source,
      fc.funder_country,
      fc.geography_scope,
      fc.eligible_countries,
      (
        SELECT ARRAY(SELECT jsonb_array_elements_text(e.extracted_json->'fields'->'eligible_countries'->'value'))
        FROM funding_intake_jobs j
        JOIN funding_intake_extractions e ON e.job_id = j.id
        WHERE j.linked_funding_call_id = fc.id
          AND jsonb_typeof(e.extracted_json->'fields'->'eligible_countries'->'value') = 'array'
        ORDER BY e.created_at DESC
        LIMIT 1
      ) AS recovered_countries,
      fc.currency,
      fc.amount_min::float AS amount_min,
      fc.amount_max::float AS amount_max,
      fc.is_rolling,
      -- Curated deadlines are instants stored in UTC; DSR reads them as India dates.
      (COALESCE(fc.close_date, fc."deadlineAt", fc.expiration_date) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date::text AS close_day,
      (fc.open_date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date::text AS open_day,
      EXISTS (SELECT 1 FROM funding_call_deadlines d WHERE d.funding_call_id = fc.id) AS has_deadline_rows,
      fc.applicant_scope,
      fc.final_deadline_at::text AS final_deadline_at,
      fc.entry_closes_at::text AS entry_closes_at,
      fc.currency_code,
      fc.amount_min_usd_est,
      fc.amount_max_usd_est,
      fc.funder_id,
      fc.description_source,
      fc.enrichment_level,
      fc.field_provenance
    FROM funding_calls fc
    WHERE fc.import_run_id IS NULL
    ORDER BY fc."createdAt", fc.id
  `)
  return rows.filter((row) => !isPlaceholderCall(row))
}

export async function loadBackfillContext(db: PrismaClient) {
  const rateRows = await db.currencyRate.findMany({ orderBy: { as_of: 'desc' } })
  const rates = new Map<string, { usdPerUnit: number; asOf: string }>()
  for (const row of rateRows) if (!rates.has(row.currency)) rates.set(row.currency, { usdPerUnit: row.usd_per_unit, asOf: row.as_of.toISOString().slice(0, 10) })
  const funderRows = await db.funder.findMany({ select: { id: true, normalized_name: true, acronym: true, country_code: true } })
  const funders: FunderIndexEntry[] = funderRows.map((f) => ({ id: f.id, normalizedName: f.normalized_name, acronym: f.acronym, countryCode: f.country_code }))
  return { rates, funders }
}

function sqlValue(column: string, value: unknown): Prisma.Sql {
  const type = Prisma.raw(COLUMN_TYPES[column])
  if (value === null || value === undefined) return Prisma.sql`NULL::${type}`
  if (column === 'field_provenance') return Prisma.sql`${JSON.stringify(value)}::jsonb`
  return Prisma.sql`${value}::${type}`
}

export interface BackfillApplyResult {
  runId: string
  calls: number
  columnsWritten: number
  deadlineRows: number
  fundersCreated: number
  fundersLinked: number
}

export async function applyBackfill(input: {
  db: PrismaClient
  confirmTarget: string | null | undefined
  operatorEmail?: string | null
  log?: (message: string) => void
}): Promise<BackfillApplyResult> {
  const { db } = input
  const log = input.log || (() => {})
  const database = (await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name
  if (input.confirmTarget !== database) {
    throw new Error(`Refusing to write: --confirm-target must equal the target database name (${database}).`)
  }
  const run = await db.fundingImportRun.create({
    data: {
      source_key: BACKFILL_SOURCE_KEY,
      mode: 'BACKFILL',
      status: 'RUNNING',
      importer_version: BACKFILL_VERSION,
      operator_email: input.operatorEmail || null,
      target_database: database,
    },
  })
  const result: BackfillApplyResult = { runId: run.id, calls: 0, columnsWritten: 0, deadlineRows: 0, fundersCreated: 0, fundersLinked: 0 }
  try {
    const rows = await loadLegacyCalls(db)
    const context = await loadBackfillContext(db)
    const createdByName = new Map<string, string>()
    for (const row of rows) {
      const plan = planCallBackfill(row, { ...context, runId: run.id })
      await db.$transaction(async (tx) => {
        const sets = { ...plan.sets }
        if (plan.funder && 'linkTo' in plan.funder) {
          sets.funder_id = plan.funder.linkTo
          result.fundersLinked += 1
        } else if (plan.funder && 'create' in plan.funder) {
          let funderId = createdByName.get(plan.funder.create.normalizedName)
          if (!funderId) {
            const created = await tx.funder.create({
              data: {
                name: plan.funder.create.name,
                normalized_name: plan.funder.create.normalizedName,
                acronym: plan.funder.create.acronym,
                country_code: plan.funder.create.countryCode,
                import_run_id: run.id,
              },
              select: { id: true },
            })
            funderId = created.id
            createdByName.set(plan.funder.create.normalizedName, funderId)
            context.funders.push({ id: funderId, normalizedName: plan.funder.create.normalizedName, acronym: plan.funder.create.acronym, countryCode: plan.funder.create.countryCode })
            await tx.fundingImportChange.create({ data: { run_id: run.id, entity_table: 'funders', entity_id: funderId, operation: 'INSERT' } })
            result.fundersCreated += 1
          }
          sets.funder_id = funderId
        }

        const columns = Object.keys(sets)
        if (columns.length > 0) {
          // Only ever fills an empty column: arrays are written while the
          // dimension's scope is still empty, everything else through COALESCE.
          const assignments = columns.map((column) =>
            ARRAY_COLUMNS.has(column)
              ? Prisma.sql`${Prisma.raw(column)} = CASE WHEN applicant_scope IS NULL THEN ${sqlValue(column, sets[column])} ELSE ${Prisma.raw(column)} END`
              : Prisma.sql`${Prisma.raw(column)} = COALESCE(${Prisma.raw(column)}, ${sqlValue(column, sets[column])})`
          )
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE funding_calls SET ${Prisma.join(assignments, ', ')}
            WHERE id = ${row.id} AND import_run_id IS NULL
          `)
          if (Number(updated) !== 1) throw new Error(`Call ${row.id} was not updated (gone, or now imported).`)
          await tx.fundingImportChange.createMany({
            data: columns.map((column) => ({
              run_id: run.id,
              entity_table: 'funding_calls',
              entity_id: row.id,
              operation: 'UPDATE',
              field: column,
              before_value: (ARRAY_COLUMNS.has(column) ? [] : null) as never,
              after_value: (sets[column] ?? null) as never,
            })),
          })
          result.columnsWritten += columns.length
        }

        for (const deadline of plan.deadlines) {
          const created = await tx.fundingCallDeadline.create({
            data: {
              funding_call_id: row.id,
              kind: deadline.kind,
              due_date: new Date(`${deadline.dueDate}T00:00:00.000Z`),
              due_timezone: null,
              due_timezone_basis: 'UNKNOWN',
              source: 'legacy_backfill',
              import_run_id: run.id,
            },
            select: { id: true },
          })
          await tx.fundingImportChange.create({ data: { run_id: run.id, entity_table: 'funding_call_deadlines', entity_id: created.id, operation: 'INSERT' } })
          result.deadlineRows += 1
        }
      })
      result.calls += 1
      for (const note of plan.notes) log(`  ${plan.title.slice(0, 60)}: ${note}`)
    }
    await db.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', finished_at: new Date(), counts: result as never },
    })
    return result
  } catch (error) {
    await db.fundingImportRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finished_at: new Date(), error: error instanceof Error ? error.message : String(error), counts: result as never },
    })
    throw error
  }
}

export interface BackfillUndoResult {
  restored: number
  skippedChanged: number
  deadlineRowsDeleted: number
  fundersDeleted: number
}

function sameJson(a: unknown, b: unknown) {
  const normalize = (value: unknown) => {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10)
    return value
  }
  return JSON.stringify(normalize(a) ?? null) === JSON.stringify(normalize(b) ?? null)
}

/**
 * Restores every column a BACKFILL run wrote and removes the rows it
 * inserted. A column someone has changed since is left alone and counted.
 */
export async function undoBackfill(input: { db: PrismaClient; runId: string; confirmTarget: string | null | undefined }): Promise<BackfillUndoResult> {
  const { db, runId } = input
  const database = (await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name
  if (input.confirmTarget !== database) {
    throw new Error(`Refusing to undo: --confirm-target must equal the target database name (${database}).`)
  }
  const run = await db.fundingImportRun.findUnique({ where: { id: runId } })
  if (!run || run.mode !== 'BACKFILL') throw new Error(`No BACKFILL run ${runId}.`)
  const result: BackfillUndoResult = { restored: 0, skippedChanged: 0, deadlineRowsDeleted: 0, fundersDeleted: 0 }
  const updates = await db.fundingImportChange.findMany({
    where: { run_id: runId, entity_table: 'funding_calls', operation: 'UPDATE' },
    orderBy: { created_at: 'desc' },
  })
  const byCall = new Map<string, typeof updates>()
  for (const change of updates) byCall.set(change.entity_id, [...(byCall.get(change.entity_id) || []), change])

  for (const [callId, changes] of byCall) {
    const columns = changes.map((change) => change.field!).filter((field) => COLUMN_TYPES[field])
    const current = (
      await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT ${Prisma.join(columns.map((column) => Prisma.sql`${Prisma.raw(column)}${column.endsWith('_at') || column === 'fx_as_of' ? Prisma.sql`::text` : Prisma.empty} AS ${Prisma.raw(`"${column}"`)}`), ', ')}
        FROM funding_calls WHERE id = ${callId} AND import_run_id IS NULL
      `)
    )[0]
    if (!current) continue
    const restore = changes.filter((change) => {
      const unchanged = sameJson(current[change.field!], change.after_value)
      if (!unchanged) result.skippedChanged += 1
      return unchanged
    })
    if (restore.length === 0) continue
    await db.$executeRaw(Prisma.sql`
      UPDATE funding_calls
      SET ${Prisma.join(restore.map((change) => Prisma.sql`${Prisma.raw(change.field!)} = ${ARRAY_COLUMNS.has(change.field!) ? Prisma.sql`ARRAY[]::text[]` : sqlValue(change.field!, null)}`), ', ')}
      WHERE id = ${callId} AND import_run_id IS NULL
    `)
    result.restored += restore.length
  }
  result.deadlineRowsDeleted = Number(await db.$executeRaw`DELETE FROM funding_call_deadlines WHERE import_run_id = ${runId}`)
  result.fundersDeleted = Number(
    await db.$executeRaw`DELETE FROM funders f WHERE f.import_run_id = ${runId} AND NOT EXISTS (SELECT 1 FROM funding_calls c WHERE c.funder_id = f.id)`
  )
  await db.fundingImportRun.update({ where: { id: runId }, data: { status: 'ROLLED_BACK', finished_at: new Date() } })
  return result
}
