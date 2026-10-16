/**
 * Before/after proof that a catalogue-import step left existing calls alone.
 *
 *   # before a step (migration, import apply, release, rollback)
 *   node ./node_modules/tsx/dist/cli.cjs scripts/catalog-safety-check.ts capture --out before.json
 *   # after it
 *   node ./node_modules/tsx/dist/cli.cjs scripts/catalog-safety-check.ts compare --before before.json
 *
 * `compare` exits 1 if any pre-existing call disappeared, changed without its
 * updatedAt moving (a raw write — never expected from the import), or now
 * carries a catalogue-import value. Content changes WITH a moved updatedAt are
 * listed as application edits made by people during the window. Read-only.
 */
import fs from 'node:fs'

import prisma from '../src/lib/prisma'
import { captureSafetySnapshot, compareSafetySnapshots, type SafetySnapshot } from '../src/lib/fundingCatalogImport/safety'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const command = process.argv[2]
  if (command === 'capture') {
    const out = arg('out')
    if (!out) throw new Error('--out <file> is required')
    const snapshot = await captureSafetySnapshot(prisma as any)
    fs.writeFileSync(out, JSON.stringify(snapshot))
    console.log(`Captured ${Object.keys(snapshot.rows).length} existing calls over ${snapshot.columns.length} columns from ${snapshot.database} → ${out}`)
    console.log(`Rows attached to existing calls: ${JSON.stringify(snapshot.dependentCounts)}`)
    return
  }
  if (command === 'compare') {
    const beforeFile = arg('before')
    if (!beforeFile) throw new Error('--before <file> is required')
    const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')) as SafetySnapshot
    const after = await captureSafetySnapshot(prisma as any)
    if (before.database !== after.database) throw new Error(`Snapshot is from ${before.database}, current database is ${after.database}.`)
    const result = compareSafetySnapshots(before, after)
    console.log(`Compared ${Object.keys(before.rows).length} existing calls over ${result.columnsCompared} columns.`)
    console.log(`  missing rows:            ${result.missingRows.length}`)
    console.log(`  silent changes (no updatedAt move): ${result.silentChanges.length}`)
    console.log(`  application edits (updatedAt moved): ${result.appEdits.length}`)
    console.log(`  invariant violations (existing calls carrying import values): ${result.invariantViolations}`)
    if (result.dependentDiffs.length > 0) {
      console.log('  attached-row count changes (review: people may be working):')
      result.dependentDiffs.forEach((d) => console.log(`    ${d.table}: ${d.before} → ${d.after}`))
    } else {
      console.log('  attached-row counts: unchanged')
    }
    if (result.missingRows.length > 0) console.log(`  MISSING: ${result.missingRows.slice(0, 20).join(', ')}`)
    if (result.silentChanges.length > 0) console.log(`  SILENT: ${result.silentChanges.slice(0, 20).join(', ')}`)
    console.log(result.ok ? 'PASS: existing calls are intact.' : 'FAIL: investigate before continuing.')
    if (!result.ok) process.exitCode = 1
    return
  }
  throw new Error('Usage: catalog-safety-check.ts capture --out <file> | compare --before <file>')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
