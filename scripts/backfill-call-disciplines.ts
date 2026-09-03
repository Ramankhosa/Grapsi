import 'dotenv/config'

import prisma from '@/lib/prisma'
import { classifyFundingCall, loadActiveAreas } from '@/lib/funding/disciplineClassifier'

/**
 * Classifies the existing funding-call catalog into research areas.
 *
 * New calls are classified on the way in (intake) and again at publish, so this
 * exists for the backlog that predates the feature — and for re-running after
 * the discipline catalog is replaced.
 *
 * Flags:
 *   --force        re-classify calls that already have automatic mappings
 *                  (manual mappings still survive — see mergeAutoMappings)
 *   --no-llm       alias pass only; never spend an LLM call. Use this first to
 *                  see how much of the catalog resolves for free.
 *   --limit=N      stop after N calls
 *
 * Records a JobRun under `funding.classify-calls` so the run is visible at
 * /super-admin/jobs like the other operational sweeps.
 */

function flagValue(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

async function main() {
  const force = process.argv.includes('--force')
  const allowLlm = !process.argv.includes('--no-llm')
  const limit = Number(flagValue('limit') || '0') || undefined

  const areas = await loadActiveAreas()
  if (areas.length === 0) {
    throw new Error(
      'No active research-area taxonomy. Run `npm run seed:research-areas` first.'
    )
  }

  const jobRun = await prisma.jobRun.create({
    data: {
      job_key: 'funding.classify-calls',
      trigger: 'script',
      status: 'running',
      triggered_by: process.env.USER || process.env.USERNAME || null,
    },
    select: { id: true, started_at: true },
  })

  const counts = {
    total: 0,
    alias: 0,
    llm: 0,
    skippedManual: 0,
    skippedClassified: 0,
    unclassified: 0,
  }
  const unclassifiedTitles: string[] = []

  try {
    const calls = await prisma.fundingCall.findMany({
      select: { id: true, title: true, scheme_title: true },
      orderBy: { createdAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    })

    for (const call of calls) {
      counts.total += 1
      const result = await classifyFundingCall(call.id, { force, areas, allowLlm })
      const label = call.scheme_title || call.title || call.id

      if (result.method === 'alias') {
        counts.alias += 1
        console.log(`  [alias] ${label} → ${result.labels.join('; ')}`)
      } else if (result.method === 'llm') {
        counts.llm += 1
        console.log(`  [llm]   ${label} → ${result.labels.join('; ')}`)
      } else if (result.reason === 'manual_mapping_exists') {
        counts.skippedManual += 1
      } else if (result.reason === 'already_classified') {
        counts.skippedClassified += 1
      } else {
        counts.unclassified += 1
        unclassifiedTitles.push(label)
      }
    }

    const finishedAt = new Date()
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: 'succeeded',
        finished_at: finishedAt,
        duration_ms: finishedAt.getTime() - jobRun.started_at.getTime(),
        counts: counts as unknown as object,
      },
    })

    console.log('\n[classify-calls]', JSON.stringify(counts))
    if (unclassifiedTitles.length > 0) {
      console.log('[classify-calls] Unclassified (visible to every school until mapped):')
      for (const title of unclassifiedTitles) console.log(`  - ${title}`)
    }
  } catch (error) {
    const finishedAt = new Date()
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: 'failed',
        finished_at: finishedAt,
        duration_ms: finishedAt.getTime() - jobRun.started_at.getTime(),
        counts: counts as unknown as object,
        error_message: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

main()
  .catch((error) => {
    console.error('[classify-calls] Failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
