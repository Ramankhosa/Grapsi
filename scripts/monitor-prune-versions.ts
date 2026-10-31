/**
 * Delete stored page copies that only repeat a newer copy's text (see
 * src/lib/monitor/prune.ts for what is always kept).
 *
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-prune-versions.ts          # dry run
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-prune-versions.ts --apply
 */
import dotenv from 'dotenv'
dotenv.config()

async function main() {
  const apply = process.argv.includes('--apply')
  const { prisma } = await import('../src/lib/prisma')
  const { DUPLICATE_VERSIONS_SQL, deleteDuplicateVersions } = await import('../src/lib/monitor/prune')
  const mb = (n: unknown) => `${Math.round(Number(n ?? 0) / 1e6)} MB`
  try {
    const total = (await prisma.$queryRawUnsafe<Array<{ n: number; b: bigint }>>(`SELECT count(*)::int n, coalesce(sum(byte_length),0)::bigint b FROM monitor_resource_versions`))[0]
    const prune = (await prisma.$queryRawUnsafe<Array<{ n: number; b: bigint; jobs: number }>>(`SELECT count(*)::int n, coalesce(sum(v.byte_length),0)::bigint b,
      (SELECT count(*)::int FROM monitor_local_analysis_jobs j WHERE j.version_id IN (${DUPLICATE_VERSIONS_SQL})) jobs
      FROM monitor_resource_versions v WHERE v.id IN (${DUPLICATE_VERSIONS_SQL})`))[0]
    const bySite = await prisma.$queryRawUnsafe<Array<{ host: string; n: number; b: bigint; used: bigint }>>(`SELECT s.host, count(*)::int n, sum(v.byte_length)::bigint b,
      (SELECT sum(x.byte_length) FROM monitor_resource_versions x JOIN monitor_resources y ON y.id = x.resource_id WHERE y.site_id = s.id)::bigint used
      FROM monitor_resource_versions v JOIN monitor_resources r ON r.id = v.resource_id JOIN monitor_sites s ON s.id = r.site_id
      WHERE v.id IN (${DUPLICATE_VERSIONS_SQL}) GROUP BY s.id, s.host ORDER BY b DESC LIMIT 15`)
    console.log(`Stored: ${total.n} copies, ${mb(total.b)}. Duplicates to delete: ${prune.n} copies, ${mb(prune.b)} (with ${prune.jobs} never-run laptop jobs).`)
    for (const s of bySite) console.log(`  ${s.host.padEnd(30)} ${String(s.n).padStart(5)} copies  ${mb(s.b).padStart(7)} of ${mb(s.used)} used`)
    if (!apply) { console.log('Dry run: nothing deleted. Re-run with --apply.'); return }
    const done = await deleteDuplicateVersions(prisma, (copies, bytes) => console.log(`  deleted ${copies} copies, ${mb(bytes)} so far`))
    console.log(`Applied: deleted ${done.copies} duplicate copies, freed ${mb(done.bytes)}.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
