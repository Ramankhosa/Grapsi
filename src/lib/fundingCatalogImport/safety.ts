/**
 * Proof that an import step left existing data alone.
 *
 * `captureSafetySnapshot` fingerprints every pre-existing funding_calls row
 * over the columns that existed BEFORE the catalogue-import migrations, and
 * counts the rows that hang off existing calls (assignments, proposals, grant
 * sessions, alerts, matches, mappings…). Run it before a step, save the JSON,
 * run it again after, and `compareSafetySnapshots` reports any difference.
 *
 * On a live database people keep working, so a changed row is classified:
 * `updatedAt` moved → an application edit (expected activity); unchanged
 * `updatedAt` but different content → raw-SQL write (suspicious, investigate).
 *
 * It also enforces the invariant that makes every new reader predicate a no-op
 * for existing calls: no pre-existing call may carry any catalogue-import
 * value (STAGED, GLOBAL_CATALOG, import_run_id, notification policy…).
 */
import type { PrismaClient } from '@/lib/prisma-generated'

/** Columns added by the catalogue-import migrations; excluded from fingerprints. */
export const CATALOG_IMPORT_COLUMNS = new Set([
  'funder_id', 'funder_country_code', 'import_run_id', 'review_status', 'notification_policy', 'notification_policy_reason',
  'enrichment_level', 'description_source', 'field_provenance', 'next_deadline_at', 'final_deadline_at', 'entry_closes_at',
  'deadline_timezone', 'source_closed_at', 'opportunity_status', 'lifecycle_needs_check', 'status_computed_at',
  'applicant_scope', 'applicant_country_codes', 'applicant_excluded_codes', 'applicant_region_codes',
  'residence_scope', 'residence_country_codes', 'residence_excluded_codes', 'residence_region_codes',
  'citizenship_scope', 'citizenship_country_codes', 'citizenship_excluded_codes', 'citizenship_region_codes',
  'host_scope', 'host_country_codes', 'host_excluded_codes', 'host_region_codes', 'eligibility_scope_hint', 'regions_version',
  'currency_code', 'amount_text', 'amount_time_basis', 'amount_recipient_basis', 'indirect_cost_policy', 'indirect_cost_note',
  'amount_min_usd_est', 'amount_max_usd_est', 'fx_rate_used', 'fx_as_of', 'requires_nomination', 'nomination_note',
  'required_qualifications', 'target_groups', 'membership_requirements', 'work_rights_required', 'additional_benefits',
  'sdg_goals', 'challenge_tags', 'programme_framework', 'source_disciplines', 'content_language', 'title_native', 'series_key',
])

/** Tables the import itself owns; rows in them are not "existing data". */
export const IMPORT_OWNED_TABLES = new Set(['funding_call_deadlines', 'funding_import_candidates', 'external_source_records'])

/**
 * Every (table, column) with a foreign key to funding_calls, read from the
 * catalogue so a table added later is covered without editing this file.
 */
export async function referencingColumns(db: PrismaClient): Promise<Array<{ table: string; column: string }>> {
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(`
    SELECT c.conrelid::regclass::text AS table_name, a.attname::text AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'funding_calls'::regclass AND c.contype = 'f'
    ORDER BY 1, 2`)
  return rows
    .map((r) => ({ table: r.table_name.replace(/^"|"$/g, ''), column: r.column_name }))
    .filter((r) => !IMPORT_OWNED_TABLES.has(r.table))
}

export interface SafetySnapshot {
  takenAt: string
  database: string
  columns: string[]
  rows: Record<string, { fingerprint: string; updatedAt: string }>
  dependentCounts: Record<string, number | null>
  invariantViolations: number
}

async function columnExists(db: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column
  )
  return rows[0]?.n > 0
}

export async function captureSafetySnapshot(db: PrismaClient): Promise<SafetySnapshot> {
  const database = (await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name
  const columnRows = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'funding_calls' ORDER BY ordinal_position`
  )
  const columns = columnRows.map((r) => r.column_name).filter((c) => !CATALOG_IMPORT_COLUMNS.has(c))
  const hasImportRun = await columnExists(db, 'funding_calls', 'import_run_id')
  const expr = columns.map((c) => `coalesce("${c}"::text, '<null>')`).join(` || '|' || `)
  const rows = await db.$queryRawUnsafe<Array<{ id: string; fp: string; updated: string }>>(
    `SELECT id, md5(${expr}) AS fp, "updatedAt"::text AS updated FROM funding_calls ${hasImportRun ? 'WHERE import_run_id IS NULL' : ''}`
  )
  const dependentCounts: Record<string, number | null> = {}
  for (const { table, column } of await referencingColumns(db)) {
    const filter = hasImportRun
      ? `WHERE t."${column}" IN (SELECT id FROM funding_calls WHERE import_run_id IS NULL)`
      : ''
    const counted = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}" t ${filter}`)
    dependentCounts[`${table}.${column}`] = counted[0]?.n ?? 0
  }
  let invariantViolations = 0
  if (hasImportRun) {
    // 1. Import-only markers must never appear on a pre-existing call.
    const markers = await db.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM funding_calls
      WHERE import_run_id IS NULL AND (
        catalog_status::text = 'STAGED' OR visibility::text = 'GLOBAL_CATALOG'
        OR notification_policy IS NOT NULL OR review_status IS NOT NULL OR source_closed_at IS NOT NULL
      )`)
    // 2. New fact columns on a pre-existing call are allowed only where the
    //    existing-call backfill wrote them (and so can undo them).
    const uncovered = await db.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM funding_calls fc
      WHERE fc.import_run_id IS NULL AND (
        fc.applicant_scope IS NOT NULL OR fc.residence_scope IS NOT NULL OR fc.citizenship_scope IS NOT NULL
        OR fc.host_scope IS NOT NULL OR fc.entry_closes_at IS NOT NULL OR fc.final_deadline_at IS NOT NULL OR fc.funder_id IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM funding_import_changes c JOIN funding_import_runs r ON r.id = c.run_id
        WHERE r.mode = 'BACKFILL' AND r.status <> 'ROLLED_BACK' AND c.entity_table = 'funding_calls' AND c.entity_id = fc.id
      )`)
    invariantViolations = (markers[0]?.n ?? 0) + (uncovered[0]?.n ?? 0)
  }
  return {
    takenAt: new Date().toISOString(),
    database,
    columns,
    rows: Object.fromEntries(rows.map((r) => [r.id, { fingerprint: r.fp, updatedAt: r.updated }])),
    dependentCounts,
    invariantViolations,
  }
}

export interface SafetyComparison {
  ok: boolean
  missingRows: string[]
  /** Content changed and updatedAt moved: an application edit during the window. */
  appEdits: string[]
  /** Content changed but updatedAt did not: a raw write. Never expected from the import. */
  silentChanges: string[]
  dependentDiffs: Array<{ table: string; before: number | null; after: number | null }>
  invariantViolations: number
  columnsCompared: number
}

export function compareSafetySnapshots(before: SafetySnapshot, after: SafetySnapshot): SafetyComparison {
  const missingRows: string[] = []
  const appEdits: string[] = []
  const silentChanges: string[] = []
  for (const [id, prev] of Object.entries(before.rows)) {
    const next = after.rows[id]
    if (!next) {
      missingRows.push(id)
      continue
    }
    if (next.fingerprint !== prev.fingerprint) {
      if (next.updatedAt !== prev.updatedAt) appEdits.push(id)
      else silentChanges.push(id)
    }
  }
  const dependentDiffs = Object.keys(before.dependentCounts)
    .map((table) => ({ table, before: before.dependentCounts[table], after: after.dependentCounts[table] ?? null }))
    .filter((d) => d.before !== d.after)
  const sameColumns = before.columns.join(',') === after.columns.join(',')
  return {
    ok: missingRows.length === 0 && silentChanges.length === 0 && after.invariantViolations === 0 && sameColumns,
    missingRows,
    appEdits,
    silentChanges,
    dependentDiffs,
    invariantViolations: after.invariantViolations,
    columnsCompared: before.columns.length,
  }
}
