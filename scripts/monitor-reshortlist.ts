/**
 * Apply the 29 Oct 2026 shortlist rules to pages already waiting for the laptop.
 * Pages that fail them are taken out of the queue and closed as not funding
 * (the same record a new page gets); strong keyword matches move to the front.
 *
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-reshortlist.ts          # dry run
 *   node node_modules/tsx/dist/cli.cjs scripts/monitor-reshortlist.ts --apply
 */
import dotenv from 'dotenv'
dotenv.config()

async function main() {
  const apply = process.argv.includes('--apply')
  const { prisma } = await import('../src/lib/prisma')
  const { RELEVANCE_VERSION, scoreShortlist } = await import('../src/lib/monitor/relevance')
  const { queueLocalAnalysis } = await import('../src/lib/monitor/localAnalysis')
  const split = (value: string) => value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  try {
    const jobs = await prisma.monitorLocalAnalysisJob.findMany({
      where: { state: 'QUEUED' },
      select: { id: true, resource_id: true, resource: { select: { title: true, canonical_url: true, site: { select: { host: true, language_profile: true } },
        observations: { include: { source: true }, orderBy: { last_seen_at: 'desc' }, take: 5 } } } },
    })
    const drop: Array<{ job: string; resource: string; reason: string; host: string }> = []
    const promote: string[] = []
    for (const job of jobs) {
      const r = job.resource
      const observation = r.observations[0]
      const config = { include: split(observation?.source.keywords ?? ''), exclude: split(observation?.source.exclude_keywords ?? ''), languages: r.site.language_profile }
      const onlyInSitemaps = r.observations.length > 0 && r.observations.every(o => o.source.kind === 'SITEMAP')
      const score = scoreShortlist(r.title ?? observation?.anchor_text ?? '', observation?.context_text ?? '', r.canonical_url ?? '', config, onlyInSitemaps)
      if (score.outcome === 'STRONG_NEGATIVE') drop.push({ job: job.id, resource: job.resource_id, reason: score.reasons.join(', '), host: r.site.host })
      else if (score.outcome === 'STRONG_POSITIVE') promote.push(job.resource_id)
    }
    const byReason = new Map<string, number>(); const byHost = new Map<string, number>()
    for (const d of drop) { byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1); byHost.set(d.host, (byHost.get(d.host) ?? 0) + 1) }
    console.log(JSON.stringify({ queued: jobs.length, leaveQueue: drop.length, keep: jobs.length - drop.length, moveToFront: promote.length,
      byReason: Object.fromEntries(byReason), byHost: Object.fromEntries([...byHost].sort((a, b) => b[1] - a[1]).slice(0, 15)) }, null, 1))
    if (!apply) { console.log('Dry run: nothing changed. Re-run with --apply.'); return }
    for (let i = 0; i < drop.length; i += 500) {
      const batch = drop.slice(i, i + 500)
      await prisma.$transaction(async tx => {
        for (const d of batch) {
          // Only a job still waiting; the laptop may have taken it meanwhile.
          const stopped = await tx.monitorLocalAnalysisJob.updateMany({ where: { id: d.job, state: 'QUEUED' }, data: { state: 'SUPERSEDED', last_error: `Shortlist tightened: ${d.reason}`.slice(0, 300), updated_at: new Date() } })
          if (!stopped.count) continue
          await tx.monitorOpportunity.updateMany({
            where: { primary_resource_id: d.resource, processing_state: 'SCORED', review_state: { in: ['NONE', 'PENDING'] }, triage_reason: { startsWith: 'Waiting for laptop' } },
            data: { processing_state: 'DONE', triage_verdict: 'NOT_FUNDING', relevance_outcome: 'STRONG_NEGATIVE', triage_reason: d.reason, decision_versions: { policy: RELEVANCE_VERSION, shortlist: '2026-10-29' } },
          })
        }
      }, { timeout: 120_000 })
    }
    let moved = 0
    for (const id of promote) if (await queueLocalAnalysis(id, prisma, 20)) moved++
    console.log(`Applied: ${drop.length} pages left the laptop queue; ${moved} strong matches moved to the front.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
