/**
 * Call score v1: score stored pages (with --apply) and report how the score lines
 * up with the laptop's and the paid model's verdicts, overall and per site.
 * Re-run monthly; a new signal word belongs in the score only if it helps on
 * several sites (see src/lib/monitor/callScore.ts).
 *
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-call-score.ts            # report only
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-call-score.ts --apply    # score unscored pages, then report
 */
import dotenv from 'dotenv'
dotenv.config()

type Verdict = 'CALL' | 'RELATED' | 'GENERAL' | 'UNSURE'

function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null
  const all = [...pos.map(s => [s, 1] as const), ...neg.map(s => [s, 0] as const)].sort((a, b) => a[0] - b[0])
  let rankSum = 0, i = 0
  while (i < all.length) {
    let j = i
    while (j < all.length && all[j][0] === all[i][0]) j++
    for (let k = i; k < j; k++) if (all[k][1]) rankSum += (i + j + 1) / 2
    i = j
  }
  return (rankSum - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { prisma } = await import('../src/lib/prisma')
  const { scoreCall, siteChrome, stripChrome, CALL_SCORE_VERSION } = await import('../src/lib/monitor/callScore')
  try {
    if (apply) {
      let done = 0
      const sites = await prisma.monitorSite.findMany({ select: { id: true, host: true } })
      for (const site of sites) {
        const chrome = await siteChrome(prisma, site.id)
        for (;;) {
          const rows = await prisma.$queryRaw<Array<{ id: string; title: string | null; version_id: string; text: string; links: unknown }>>`
            SELECT r.id, r.title, v.id AS version_id, left(v.text, 120000) AS text, v.page_statuses->0->'links' AS links
            FROM monitor_resources r JOIN monitor_resource_versions v ON v.id = r.current_version_id
            WHERE r.site_id = ${site.id} AND v.text IS NOT NULL AND r.call_scored_version_id IS DISTINCT FROM v.id
            LIMIT 200`
          if (!rows.length) break
          for (const row of rows) {
            const links = Array.isArray(row.links) ? (row.links as Array<{ url?: unknown; title?: unknown }>).filter(l => typeof l.url === 'string').map(l => ({ url: String(l.url), title: String(l.title ?? '') })) : []
            const s = scoreCall({ title: row.title ?? '', text: stripChrome(row.text, chrome), links })
            await prisma.monitorResource.update({ where: { id: row.id }, data: { call_score: s.score, call_band: s.band, call_signals: s.signals, call_scored_version_id: row.version_id, call_scored_at: new Date() } })
          }
          done += rows.length
        }
      }
      console.log(`Scored ${done} pages with ${CALL_SCORE_VERSION}.`)
    }

    const rows = await prisma.$queryRaw<Array<{ host: string; score: number; band: string; laptop: string | null; paid: string | null; review: string | null }>>`
      WITH l AS (SELECT DISTINCT ON (resource_id) resource_id, decision FROM monitor_local_analysis_results ORDER BY resource_id, created_at DESC),
           o AS (SELECT DISTINCT ON (primary_resource_id) primary_resource_id, triage_verdict, review_state FROM monitor_opportunities
                 WHERE coalesce(decision_versions->>'model', '') <> 'local-first-pass' ORDER BY primary_resource_id, updated_at DESC)
      SELECT s.host, r.call_score AS score, r.call_band AS band, l.decision AS laptop, o.triage_verdict AS paid, o.review_state AS review
      FROM monitor_resources r JOIN monitor_sites s ON s.id = r.site_id
      LEFT JOIN l ON l.resource_id = r.id LEFT JOIN o ON o.primary_resource_id = r.id
      WHERE r.call_score IS NOT NULL`
    const verdict = (r: typeof rows[number]): Verdict | null =>
      r.laptop === 'CALL' || r.paid === 'NEW_OPPORTUNITY' || r.paid === 'UPDATE_TO_EXISTING' || r.review === 'PUBLISHED' ? 'CALL'
        : r.laptop === 'RELATED' || r.laptop === 'GENERAL' || r.laptop === 'UNSURE' ? r.laptop : null
    const judged = rows.map(r => ({ ...r, v: verdict(r) })).filter((r): r is typeof r & { v: Verdict } => r.v !== null)
    console.log(`\nScored pages ${rows.length}; with a laptop or paid verdict ${judged.length}.`)
    const bands = ['LIKELY', 'POSSIBLE', 'WEAK', 'UNLIKELY']
    const verdicts: Verdict[] = ['CALL', 'RELATED', 'GENERAL', 'UNSURE']
    console.log(`\n${'band'.padEnd(10)}${verdicts.map(v => v.padStart(9)).join('')}   unjudged`)
    for (const b of bands) {
      console.log(`${b.padEnd(10)}${verdicts.map(v => String(judged.filter(r => r.band === b && r.v === v).length).padStart(9)).join('')}   ${rows.filter(r => r.band === b && !verdict(r)).length}`)
    }
    const callHosts = new Set(judged.filter(r => r.v === 'CALL').map(r => r.host))
    const scoped = judged.filter(r => callHosts.has(r.host))
    const pos = scoped.filter(r => r.v === 'CALL').map(r => r.score)
    console.log('\nCall pages ranked above the others (AUC, sites that have calls):')
    for (const v of ['GENERAL', 'RELATED', 'UNSURE'] as const) {
      const a = auc(pos, scoped.filter(r => r.v === v).map(r => r.score))
      console.log(`  above ${v}: ${a === null ? 'n/a' : a.toFixed(2)}`)
    }
    console.log('\nPer site (calls / judged pages, AUC call vs the rest):')
    for (const host of [...callHosts].sort()) {
      const site = judged.filter(r => r.host === host)
      const a = auc(site.filter(r => r.v === 'CALL').map(r => r.score), site.filter(r => r.v !== 'CALL').map(r => r.score))
      console.log(`  ${host.padEnd(32)} ${String(site.filter(r => r.v === 'CALL').length).padStart(4)} / ${String(site.length).padEnd(5)} ${a === null ? 'n/a' : a.toFixed(2)}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
