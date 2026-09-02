import { NextResponse } from 'next/server'

import prisma from '@/lib/prisma'

export { isCronRequest } from '@/lib/funding/cronAuth'

export type JobTrigger = 'schedule' | 'manual' | 'script'

interface WithJobRunOptions {
  jobKey: string
  trigger: JobTrigger
  /** Operator email for manual runs; omit for cron. */
  triggeredBy?: string | null
}

/**
 * Records one job_runs row around a cron-callable route handler, so the
 * super-admin Jobs panel can show run history and last-success per job.
 *
 * Contract: call this only AFTER auth has succeeded — otherwise the table
 * fills with failed rows from unauthenticated probes.
 *
 * Every database write here is best-effort: observability must never take
 * down the job it observes.
 */
export async function withJobRun(
  options: WithJobRunOptions,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const startedAt = new Date()
  let runId: string | null = null

  try {
    const run = await prisma.jobRun.create({
      data: {
        job_key: options.jobKey,
        trigger: options.trigger,
        status: 'running',
        started_at: startedAt,
        triggered_by: options.triggeredBy ?? null,
      },
      select: { id: true },
    })
    runId = run.id
  } catch (error) {
    console.error('[JOB-RUN] Failed to record run start:', error)
  }

  const finish = async (data: {
    status: 'succeeded' | 'failed'
    httpStatus?: number | null
    counts?: unknown
    errorMessage?: string | null
  }) => {
    if (!runId) return
    try {
      await prisma.jobRun.update({
        where: { id: runId },
        data: {
          status: data.status,
          http_status: data.httpStatus ?? null,
          // A body we could not parse leaves the column as it was: for a Json
          // field Prisma reads `undefined` as "don't touch", where `null` would
          // need Prisma.JsonNull and buys nothing over the NULL already there.
          counts: data.counts == null ? undefined : (data.counts as object),
          error_message: data.errorMessage ?? null,
          finished_at: new Date(),
          duration_ms: Date.now() - startedAt.getTime(),
        },
      })
    } catch (error) {
      console.error('[JOB-RUN] Failed to record run finish:', error)
    }
  }

  try {
    const response = await handler()
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    await finish({
      status: response.ok ? 'succeeded' : 'failed',
      httpStatus: response.status,
      counts: body,
      errorMessage: response.ok ? null : body?.message ?? body?.error ?? null,
    })
    return response
  } catch (error) {
    await finish({
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    console.error(`[JOB-RUN] ${options.jobKey} threw:`, error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Job failed' },
      { status: 500 }
    )
  }
}
