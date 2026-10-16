/**
 * Step 0 of the catalogue-import runbook: a READ-ONLY inventory of the funding
 * calls already in a database, so the import can be planned against what is
 * really there. Runs before or after the catalogue-import migrations (new
 * columns are used only if present). Only SELECT statements are issued.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/inventory-existing-calls.ts --out inventory
 *
 * Writes <out>.json and <out>.md. The report holds aggregate counts, country
 * and currency spellings, agency names and call ids/titles — no user data.
 */
import fs from 'node:fs'

import prisma from '../src/lib/prisma'
import { resolveCountryList } from '../src/lib/geo/countries'
import { acronymOf, normalizeFunderName } from '../src/lib/fundingCatalogImport/adapters/scientify'
import { descriptionHash, findExistingDuplicatePairs, urlKeys, type DedupCall } from '../src/lib/fundingCatalogImport/duplicates'
import { isoDate } from '../src/lib/fundingCatalogImport/normalize/text'
import { referencingColumns } from '../src/lib/fundingCatalogImport/safety'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const SEED_AGENCY_HINTS = ['global health innovation trust', 'south asia climate fund', 'learning futures foundation', 'default grant format']

type Row = Record<string, any>

async function q<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params)
}

async function main() {
  const out = arg('out') || `inventory-${new Date().toISOString().slice(0, 10)}`
  const [db] = await q<{ name: string; tz: string; version: string }>(`SELECT current_database() AS name, current_setting('TimeZone') AS tz, version() AS version`)
  const [vector] = await q<{ v: string | null }>(`SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS v`)
  const cols = new Set((await q<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'funding_calls'`)).map((r) => r.c))
  const migrated = cols.has('import_run_id')
  const migrations = await q<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 15`
  )
  const failedMigrations = (await q(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name)

  const calls = await q(`
    SELECT id, "tenantId" AS tenant_id, visibility::text AS visibility, status::text AS status, catalog_status::text AS catalog_status,
           is_active, source, metadata->>'kind' AS kind, scheme_title, title, agency_name, "agencyName" AS agency_name_legacy,
           source_url, "sourceUrl" AS source_url_legacy, official_urls, close_date, "deadlineAt" AS deadline_at, open_date, is_rolling,
           eligible_countries, host_countries, eligible_regions, geography_scope, funder_country, currency, amount_min, amount_max,
           citizenship_requirements, residency_requirements, description, "createdAt" AS created_at,
           metadata->>'embedding_version' AS embedding_version, metadata->>'embedding_status' AS embedding_status,
           metadata->>'alerts_dispatched_at' AS alerts_dispatched_at
           ${migrated ? ', import_run_id' : ''}
    FROM funding_calls
    ${migrated ? 'WHERE import_run_id IS NULL' : ''}`)

  const originOf = (c: Row) => {
    if (c.source === 'default-grant-format' || c.kind === 'default_grant_format') return 'default_grant_format_placeholder'
    if (c.visibility === 'TENANT_PRIVATE') return c.source === 'user-funding-intake' ? 'tenant_private_user_upload' : 'tenant_private'
    if (c.visibility === 'GLOBAL_PUBLISHED' && !c.tenant_id) return 'platform_catalogue'
    return `other:${c.visibility}`
  }
  const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] || 0) + n }

  const byOrigin: Record<string, number> = {}
  const byOriginStatus: Record<string, number> = {}
  const statusDisagreement: Record<string, number> = {}
  const embeddingVersions: Record<string, number> = {}
  const currencies: Record<string, number> = {}
  const unresolvedCountries: Record<string, number> = {}
  let emptyCountryLists = 0
  let globalScopeNoList = 0
  let notAlertStamped = 0
  const seedLike: Array<{ id: string; agency: string }> = []
  for (const c of calls) {
    const origin = originOf(c)
    bump(byOrigin, origin)
    bump(byOriginStatus, `${origin} · catalog=${c.catalog_status ?? 'null'} · status=${c.status} · active=${c.is_active ?? 'null'}`)
    const published = c.catalog_status === 'PUBLISHED' || c.status === 'PUBLISHED'
    if ((c.catalog_status === 'PUBLISHED') !== (c.status === 'PUBLISHED')) bump(statusDisagreement, `${origin}: catalog=${c.catalog_status} status=${c.status}`)
    if (origin === 'default_grant_format_placeholder') continue
    if (published) bump(embeddingVersions, c.embedding_version || `(none: ${c.embedding_status || 'unknown'})`)
    if (published && !c.alerts_dispatched_at) notAlertStamped++
    bump(currencies, c.currency == null ? '(null)' : JSON.stringify(c.currency))
    const names = [...(c.eligible_countries || []), ...(c.host_countries || []), ...(c.funder_country ? [c.funder_country] : [])]
    for (const value of resolveCountryList(names).unknown) bump(unresolvedCountries, value)
    if ((c.eligible_countries || []).length === 0 && (c.host_countries || []).length === 0) {
      emptyCountryLists++
      if (/global|international/i.test(c.geography_scope || '')) globalScopeNoList++
    }
    const agency = String(c.agency_name || c.agency_name_legacy || '').toLowerCase()
    if (SEED_AGENCY_HINTS.some((hint) => agency.includes(hint))) seedLike.push({ id: c.id, agency })
  }

  const platform = calls.filter((c) => originOf(c) === 'platform_catalogue')
  const agencies: Record<string, number> = {}
  platform.forEach((c) => bump(agencies, c.agency_name || c.agency_name_legacy || '(none)'))

  // Rows attached to existing calls (user work and side data), per table.
  const attached: Record<string, number> = {}
  const callsWithWork = new Set<string>()
  for (const { table, column } of await referencingColumns(prisma as any)) {
    const rows = await q<{ id: string; n: number }>(
      `SELECT t."${column}"::text AS id, count(*)::int AS n FROM "${table}" t WHERE t."${column}" IS NOT NULL ${migrated ? `AND t."${column}" IN (SELECT id FROM funding_calls WHERE import_run_id IS NULL)` : ''} GROUP BY 1`
    )
    attached[`${table}.${column}`] = rows.reduce((n, r) => n + r.n, 0)
    if (!/^funding_call_(document|guideline|template)|research_area|funding_import|funding_intake/.test(table)) rows.forEach((r) => callsWithWork.add(r.id))
  }
  const withDocuments = (await q<{ n: number }>(`SELECT count(DISTINCT funding_call_id)::int AS n FROM funding_call_documents`))[0]?.n ?? 0
  const withGuidelines = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM funding_calls WHERE active_guideline_id IS NOT NULL OR active_template_id IS NOT NULL`))[0]?.n ?? 0

  // Duplicates among existing platform calls (report only).
  const dedup: DedupCall[] = platform.map((c) => {
    const agency = c.agency_name || c.agency_name_legacy || ''
    const acronym = acronymOf(agency)
    const close = isoDate(c.close_date || c.deadline_at)
    return {
      id: c.id,
      kind: 'existing',
      title: c.scheme_title || c.title || '',
      funderKeys: [normalizeFunderName(agency), acronym ? `acr:${acronym.toLowerCase()}` : ''].filter(Boolean),
      urlKeys: urlKeys([c.source_url, c.source_url_legacy, ...(c.official_urls || [])]),
      finalDeadline: close,
      year: close ? Number(close.slice(0, 4)) : new Date(c.created_at).getUTCFullYear(),
      descriptionHash: descriptionHash(c.description),
      seriesKey: null,
    }
  })
  const titleOf = new Map(platform.map((c) => [c.id, c.scheme_title || c.title]))
  const existingPairs = findExistingDuplicatePairs(dedup).map((p) => ({
    tier: p.tier,
    a: `${titleOf.get(p.subjectId)} [${p.subjectId}]`,
    b: `${titleOf.get(p.candidateId)} [${p.candidateId}]`,
    titleSimilarity: p.signals.titleSimilarity,
    sameUrl: p.signals.sameUrl,
    round: p.signals.round,
  }))

  const tenants = await q<{ id: string; name: string; status: string; users: number; country_code?: string | null }>(`
    SELECT t.id, t.name, t.status::text AS status, (SELECT count(*)::int FROM users u WHERE u."tenantId" = t.id) AS users
           ${(await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'country_code'`)).length ? ', t.country_code' : ''}
    FROM tenants t ORDER BY users DESC LIMIT 500`)

  const report = {
    takenAt: new Date().toISOString(),
    database: db.name,
    databaseTimezone: db.tz,
    postgres: db.version,
    pgvector: vector?.v ?? null,
    catalogImportMigrationsApplied: migrated,
    recentMigrations: migrations.map((m) => `${m.migration_name}${m.finished_at ? '' : ' (NOT FINISHED)'}`),
    failedMigrations,
    existingCalls: calls.length,
    byOrigin,
    byOriginStatus,
    statusColumnDisagreement: statusDisagreement,
    publishedEmbeddingVersions: embeddingVersions,
    publishedWithoutAlertStamp: notAlertStamped,
    currencies,
    unresolvedCountrySpellings: unresolvedCountries,
    callsWithEmptyCountryLists: emptyCountryLists,
    callsSayingGlobalWithNoList: globalScopeNoList,
    callsWithDocuments: withDocuments,
    callsWithGuidelineOrTemplate: withGuidelines,
    callsWithUserWorkAttached: callsWithWork.size,
    attachedRowsByTable: attached,
    distinctPlatformAgencies: Object.keys(agencies).length,
    topPlatformAgencies: Object.entries(agencies).sort((a, b) => b[1] - a[1]).slice(0, 40),
    possibleSeedOrDemoCalls: seedLike,
    existingDuplicatePairs: existingPairs,
    tenants: tenants.map((t) => ({ ...t, suggestedCountryCode: t.country_code || 'IN' })),
  }
  fs.writeFileSync(`${out}.json`, JSON.stringify(report, null, 2))
  const lines = [
    `# Funding-call inventory — ${report.database} (${report.takenAt})`,
    '',
    `Postgres ${report.postgres.split(' ').slice(0, 2).join(' ')} · pgvector ${report.pgvector ?? 'not installed'} · DB timezone ${report.databaseTimezone} · catalogue-import migrations applied: ${migrated ? 'yes' : 'no'}`,
    failedMigrations.length > 0 ? `**Unfinished migrations: ${failedMigrations.join(', ')} — resolve before any migrate deploy.**` : 'No unfinished migrations.',
    '',
    `## Existing calls: ${report.existingCalls}`,
    ...Object.entries(byOrigin).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '### By status',
    ...Object.entries(byOriginStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '### status vs catalog_status disagreement',
    Object.keys(statusDisagreement).length === 0 ? 'None.' : Object.entries(statusDisagreement).map(([k, v]) => `- ${k}: ${v}`).join('\n'),
    '',
    `## Embeddings on published calls (imports must use the same)`,
    ...Object.entries(embeddingVersions).map(([k, v]) => `- ${k}: ${v}`),
    `Published calls with no alert stamp (the hourly sweep would alert these): ${notAlertStamped}`,
    '',
    '## Data shape',
    `- Calls with empty country lists: ${emptyCountryLists} (saying Global/International with no list: ${globalScopeNoList})`,
    `- Calls with documents: ${withDocuments}; with an active guideline or template: ${withGuidelines}`,
    `- Calls with user work attached (assignments, proposals, sessions, matches, DSR rows…): ${callsWithWork.size}`,
    `- Currency spellings: ${Object.entries(currencies).map(([k, v]) => `${k}×${v}`).join(', ')}`,
    `- Country spellings the ISO normaliser cannot resolve: ${Object.keys(unresolvedCountries).length === 0 ? 'none' : Object.entries(unresolvedCountries).map(([k, v]) => `"${k}"×${v}`).join(', ')}`,
    `- Distinct platform agencies: ${report.distinctPlatformAgencies}`,
    '',
    '## Possible seeded/demo calls',
    seedLike.length === 0 ? 'None found.' : seedLike.map((s) => `- ${s.agency} [${s.id}]`).join('\n'),
    '',
    `## Possible duplicates among existing platform calls (${existingPairs.length}, report only)`,
    ...existingPairs.slice(0, 50).map((p) => `- ${p.tier}: ${p.a} ↔ ${p.b} (title ${p.titleSimilarity}, url ${p.sameUrl ? 'same' : 'different'}, round ${p.round})`),
    '',
    `## Tenants (${tenants.length}) — confirm country codes before enabling any tenant-country rules`,
    ...tenants.slice(0, 60).map((t) => `- ${t.name} (${t.status}, ${t.users} users) → ${t.country_code || 'IN (suggested)'}`),
    '',
    '## Rows attached to existing calls',
    ...Object.entries(attached).filter(([, v]) => v > 0).map(([k, v]) => `- ${k}: ${v}`),
  ]
  fs.writeFileSync(`${out}.md`, lines.join('\n'))
  console.log(`Inventory written to ${out}.md and ${out}.json (read-only; nothing was changed).`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
