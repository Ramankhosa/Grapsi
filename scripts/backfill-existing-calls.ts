/**
 * Existing-call backfill (see src/lib/fundingCatalogImport/backfill.ts).
 *
 *   # plan only (default): per-call report, writes nothing
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-existing-calls.ts [--out report.json]
 *   # write
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-existing-calls.ts --apply --confirm-target <db name> [--operator-email you@x]
 *   # reverse a run
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-existing-calls.ts --undo <runId> --confirm-target <db name>
 *
 * Run inside the parity window: catalog-safety-check capture, finder-parity
 * capture, this script, then both compares. On production only after the
 * match-census work is live: any write changes a call's xmin, which the
 * census treats as a change and re-scores.
 */
import fs from 'node:fs'

import prisma from '../src/lib/prisma'
import {
  applyBackfill,
  loadBackfillContext,
  loadLegacyCalls,
  planCallBackfill,
  undoBackfill,
} from '../src/lib/fundingCatalogImport/backfill'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const confirmTarget = arg('confirm-target')
  const undo = arg('undo')
  if (undo) {
    const result = await undoBackfill({ db: prisma, runId: undo, confirmTarget })
    console.log(`Undone ${undo}: restored ${result.restored} column values, skipped ${result.skippedChanged} changed since, deleted ${result.deadlineRowsDeleted} deadline rows and ${result.fundersDeleted} funders.`)
    return
  }

  if (flag('apply')) {
    const result = await applyBackfill({ db: prisma, confirmTarget, operatorEmail: arg('operator-email'), log: console.log })
    console.log(`Backfill run ${result.runId}: ${result.calls} calls, ${result.columnsWritten} column values, ${result.deadlineRows} deadline rows, funders ${result.fundersLinked} linked + ${result.fundersCreated} created.`)
    return
  }

  const rows = await loadLegacyCalls(prisma)
  const context = await loadBackfillContext(prisma)
  const plans = rows.map((row) => planCallBackfill(row, { ...context, runId: '(dry-run)' }))
  const count = (predicate: (plan: (typeof plans)[number]) => boolean) => plans.filter(predicate).length
  console.log(`${plans.length} existing calls (placeholders excluded).`)
  console.log(`  applicant eligibility: ${count((p) => 'applicant_scope' in p.sets)} (${count((p) => p.sets.applicant_scope === 'UNSPECIFIED')} UNSPECIFIED, ${count((p) => p.sets.applicant_scope === 'ANY')} ANY)`)
  console.log(`  deadlines: ${count((p) => 'final_deadline_at' in p.sets)} final dates, ${plans.reduce((n, p) => n + p.deadlines.length, 0)} deadline rows`)
  console.log(`  currency: ${count((p) => 'currency_code' in p.sets)} codes, ${count((p) => 'amount_max_usd_est' in p.sets)} USD estimates`)
  console.log(`  funders: ${count((p) => Boolean(p.funder && 'linkTo' in p.funder))} linked to existing, ${count((p) => Boolean(p.funder && 'create' in p.funder))} new`)
  for (const plan of plans) {
    if (plan.notes.length > 0) console.log(`  ${plan.title.slice(0, 60)}: ${plan.notes.join('; ')}`)
  }
  const out = arg('out')
  if (out) {
    fs.writeFileSync(out, JSON.stringify(plans, null, 2))
    console.log(`Plan written to ${out}`)
  }
  console.log('Dry run: nothing written. Re-run with --apply --confirm-target <db>.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
