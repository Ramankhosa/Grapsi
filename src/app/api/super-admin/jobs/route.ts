/**
 * Super Admin Jobs API
 *
 * Read-only view over job_runs: recent run history and last success per job,
 * so a dead scheduler shows up as a stale "last success" instead of silence.
 * Run-now actions POST the job endpoints directly (they accept interactive
 * funding-operator auth), so this route only reads.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import prisma from '@/lib/prisma'

async function verifySuperAdmin(request: NextRequest) {
  const authResult = await authenticateUser(request)
  if (!authResult.user) {
    return { error: 'Unauthorized', status: 401 as const }
  }

  const isSuperAdmin = authResult.user.roles?.some(
    (role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER'
  )

  if (!isSuperAdmin) {
    return { error: 'Super admin access required', status: 403 as const }
  }

  return { user: authResult.user }
}

/** The job registry: every jobKey withJobRun is called with. */
const JOB_KEYS = [
  'reminders-sweep',
  'alerts-dispatch',
  'alerts-digest-daily',
  'alerts-digest-weekly',
  'reports-weekly',
  'event-user-expiry',
  'proposal-reviews-sweep',
  'proposals-sweep',
] as const

const RUNS_PER_JOB = 10

export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const jobs = await Promise.all(
      JOB_KEYS.map(async (jobKey) => {
        const [runs, lastSuccess] = await Promise.all([
          prisma.jobRun.findMany({
            where: { job_key: jobKey },
            orderBy: { started_at: 'desc' },
            take: RUNS_PER_JOB,
          }),
          // Separate query, not derived from the window above: a rarely
          // succeeding job's last success can be older than its last N runs.
          prisma.jobRun.findFirst({
            where: { job_key: jobKey, status: 'succeeded' },
            orderBy: { started_at: 'desc' },
            select: { started_at: true },
          }),
        ])

        return {
          jobKey,
          lastSuccessAt: lastSuccess?.started_at ?? null,
          runs: runs.map((run) => ({
            id: run.id,
            trigger: run.trigger,
            status: run.status,
            startedAt: run.started_at,
            finishedAt: run.finished_at,
            durationMs: run.duration_ms,
            httpStatus: run.http_status,
            counts: run.counts,
            errorMessage: run.error_message,
            triggeredBy: run.triggered_by,
          })),
        }
      })
    )

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[SUPER-ADMIN-JOBS] Failed to load job runs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load job runs' },
      { status: 500 }
    )
  }
}
