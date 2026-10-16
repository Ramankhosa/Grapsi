/**
 * External funding-catalogue import (ScientifyResearch crawl).
 *
 *   # 1. Freeze the crawler output into a checksummed snapshot (copies files)
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts freeze \
 *     --data-dir C:/Users/raman/Documents/Crawler/data --out storage/import-snapshots
 *
 *   # 2. Dry run: read-only, writes a report (JSON + Markdown) next to the snapshot
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts dry-run --snapshot <dir>
 *
 *   # 3. Apply: inserts STAGED, suppressed, GLOBAL_CATALOG calls; needs the DB name
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts apply --snapshot <dir> \
 *     --confirm-target <database name> [--operator-email you@x] [--full-snapshot] [--limit N]
 *
 *   # 4. Release clear calls to researcher discovery (silent), take them back, or roll a run back
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts release --source scientify [--limit N] [--apply]
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts unrelease --source scientify [--ids a,b] [--apply]
 *   node ./node_modules/tsx/dist/cli.cjs scripts/import-funding-catalog.ts rollback --run <runId> [--confirm-target <db>]
 *
 * Existing calls are never written. Take a pg_dump before any APPLY on a real
 * database, and run scripts/catalog-safety-check.ts before and after.
 */
import fs from 'node:fs'
import path from 'node:path'

import prisma from '../src/lib/prisma'
import { releaseImportedCalls, unreleaseImportedCalls } from '../src/lib/fundingCatalogImport/release'
import { rollbackImportRun } from '../src/lib/fundingCatalogImport/rollback'
import { runCatalogImport, type ImportReport } from '../src/lib/fundingCatalogImport/service'
import { freezeSnapshot } from '../src/lib/fundingCatalogImport/snapshot'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function markdown(report: ImportReport): string {
  const table = (rows: Record<string, number>) =>
    Object.entries(rows).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n')
  return [
    `# Catalogue import ${report.mode === 'DRY_RUN' ? 'dry run' : 'apply'} — ${report.sourceKey}`,
    '',
    `Database **${report.database}** · importer ${report.importerVersion} · today ${report.today}`,
    `Snapshot taken ${report.snapshot.takenAt}: ${report.snapshot.files.map((f) => `${f.name} (${f.lines} lines, sha256 ${f.sha256.slice(0, 12)}…)`).join(', ')}`,
    '',
    '## Counts',
    '| | |\n|---|---|',
    table(report.counts),
    '',
    '## Lifecycle',
    '| status | calls |\n|---|---|',
    table(report.lifecycle),
    '',
    '## Review queue',
    `Blocking items: **${report.reviewQueue.blocking}** · informational: ${report.reviewQueue.informational} · releasable after import: **${report.reviewQueue.releasableCalls}**`,
    '',
    '| reason | items |\n|---|---|',
    table(report.reviewQueue.byReason),
    '',
    '## Duplicates',
    `Imported vs existing catalogue (${report.existingCatalogue.globalCalls} existing global calls): ${JSON.stringify(report.duplicates.importedVsExisting)}`,
    `Imported vs imported: ${JSON.stringify(report.duplicates.importedVsImported)}`,
    `Existing vs existing (report only): ${JSON.stringify(report.duplicates.existingVsExisting)}`,
    '',
    '| tier | imported | candidate | title sim | funder | url | round |\n|---|---|---|---|---|---|---|',
    ...report.duplicates.samples.slice(0, 25).map(
      (s) => `| ${s.tier} | ${s.subject} | ${s.candidate} | ${s.signals.titleSimilarity} | ${s.signals.sameFunder ? 'yes' : ''} | ${s.signals.sameUrl ? 'yes' : ''} | ${s.signals.round} |`
    ),
    '',
    '## Eligibility scopes',
    ...Object.entries(report.eligibilityScopes).map(([dim, rows]) => `- ${dim}: ${JSON.stringify(rows)}`),
    '',
    '## Currencies',
    '| currency | calls |\n|---|---|',
    table(report.currencies),
    '',
    '## Funding kinds',
    '| kind | calls |\n|---|---|',
    table(report.fundingKinds),
    '',
    '## Unmapped source labels',
    report.unmappedLabels.length === 0 ? 'None.' : report.unmappedLabels.map((u) => `- ${u.vocabulary}: "${u.label}" (${u.records})`).join('\n'),
    '',
    '## Unknown country values',
    report.unknownCountryValues.length === 0 ? 'None.' : report.unknownCountryValues.map((u) => `- "${u.value}" (${u.records})`).join('\n'),
    '',
    ...report.notes.map((n) => `> ${n}`),
  ].join('\n')
}

function writeReport(report: ImportReport, dir: string, label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const json = path.join(dir, `report-${label}-${stamp}.json`)
  const md = path.join(dir, `report-${label}-${stamp}.md`)
  fs.writeFileSync(json, JSON.stringify(report, null, 2))
  fs.writeFileSync(md, markdown(report))
  return { json, md }
}

async function main() {
  const command = process.argv[2]
  const log = (m: string) => console.log(m)
  if (command === 'freeze') {
    const dataDir = arg('data-dir')
    if (!dataDir) throw new Error('--data-dir is required')
    const out = path.resolve(arg('out') || 'storage/import-snapshots')
    const { snapshotDir, manifest } = await freezeSnapshot({
      sourceKey: 'scientify',
      sourceDir: dataDir,
      files: ['grants.jsonl', 'funders.jsonl', 'raw/taxonomy_terms.json'],
      snapshotRoot: out,
    })
    console.log(`Snapshot frozen at ${snapshotDir}`)
    manifest.files.forEach((f) => console.log(`  ${f.name}: ${f.lines} lines, ${f.bytes} bytes, sha256 ${f.sha256}`))
    return
  }
  if (command === 'dry-run' || command === 'apply') {
    const snapshot = arg('snapshot')
    if (!snapshot) throw new Error('--snapshot is required')
    const { runId, report } = await runCatalogImport({
      db: prisma as any,
      sourceKey: 'scientify',
      snapshotDir: path.resolve(snapshot),
      mode: command === 'apply' ? 'APPLY' : 'DRY_RUN',
      limit: arg('limit') ? Number(arg('limit')) : undefined,
      operatorEmail: arg('operator-email') || null,
      confirmTarget: arg('confirm-target') || null,
      isFullSnapshot: flag('full-snapshot'),
      today: arg('today'),
      forceUnlock: flag('force-unlock'),
      log,
    })
    const files = writeReport(report, path.resolve(snapshot), command === 'apply' ? 'apply' : 'dry-run')
    console.log(`\nReport: ${files.md}`)
    console.log(`Records ${report.counts.records} · releasable ${report.reviewQueue.releasableCalls} · held for review ${report.counts.heldForReview}`)
    console.log(`Duplicates vs existing: ${JSON.stringify(report.duplicates.importedVsExisting)} · among imported: ${JSON.stringify(report.duplicates.importedVsImported)}`)
    if (runId) console.log(`Import run id: ${runId}`)
    return
  }
  if (command === 'release' || command === 'unrelease') {
    const sourceKey = arg('source') || 'scientify'
    const ids = arg('ids') ? String(arg('ids')).split(',').map((id) => id.trim()).filter(Boolean) : undefined
    const result =
      command === 'release'
        ? await releaseImportedCalls({ db: prisma as any, sourceKey, ids, dryRun: !flag('apply'), limit: arg('limit') ? Number(arg('limit')) : undefined, log })
        : await unreleaseImportedCalls({ db: prisma as any, sourceKey, ids, dryRun: !flag('apply'), log })
    console.log(JSON.stringify(result))
    if (!flag('apply')) console.log(`Dry run only. Re-run with --apply to ${command}.`)
    return
  }
  if (command === 'rollback') {
    const runId = arg('run')
    if (!runId) throw new Error('--run is required')
    const confirm = arg('confirm-target')
    const result = await rollbackImportRun({ db: prisma as any, runId, dryRun: !confirm, confirmTarget: confirm || null, log })
    console.log(JSON.stringify(result))
    if (!confirm) console.log('Dry run only. Re-run with --confirm-target <database name> to roll back.')
    return
  }
  throw new Error('Usage: import-funding-catalog.ts freeze|dry-run|apply|release|rollback (see header)')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
