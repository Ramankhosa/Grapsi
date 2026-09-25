/**
 * One-off backfill of dsr_call_school_mappings.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-dsr-call-school-mappings.ts            # dry run, every tenant with a funding department
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-dsr-call-school-mappings.ts --tenant=<id>
 *   node ./node_modules/tsx/dist/cli.cjs scripts/backfill-dsr-call-school-mappings.ts --apply     # write, after the DSR head reviewed the dry run
 *
 * Only adds rows; never changes or removes an existing mapping. Routing stays
 * off until each department switches on "Route calls by school relevance".
 */
import prisma from '../src/lib/prisma'
import { planBackfill, writeMappings } from '../src/lib/fundingDept/callSchoolMapping'

async function main() {
  const apply = process.argv.includes('--apply')
  const only = process.argv.find(arg => arg.startsWith('--tenant='))?.slice('--tenant='.length)
  const tenants = only ? [only] : (await prisma.fundingDeptMember.findMany({ where: { is_active: true }, distinct: ['tenant_id'], select: { tenant_id: true } })).map(r => r.tenant_id)
  const backfillDay = new Date()
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} call-to-school mapping backfill for ${tenants.length} tenant(s), dated ${backfillDay.toISOString()}`)
  for (const tenantId of tenants) {
    const plan = await planBackfill(tenantId, backfillDay)
    const perSchool = new Map<string, number>()
    for (const row of plan.rows) perSchool.set(row.schoolId, (perSchool.get(row.schoolId) || 0) + 1)
    const names = new Map((await prisma.tenantOrgUnit.findMany({ where: { id: { in: [...perSchool.keys()] } }, select: { id: true, name: true } })).map(s => [s.id, s.name]))
    console.log(`\nTenant ${tenantId}: ${plan.rows.length} new mapping(s) across ${plan.calls} call(s) and ${plan.schools} school(s); ${plan.alreadyMapped} already mapped`)
    for (const [source, count] of Object.entries(plan.bySource)) if (count) console.log(`  ${source.padEnd(24)} ${count}`)
    for (const [school, count] of [...perSchool].sort((a, b) => b[1] - a[1])) console.log(`  school ${names.get(school) || school}: ${count}`)
    if (apply) console.log(`  written: ${(await writeMappings(plan.rows)).length}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
