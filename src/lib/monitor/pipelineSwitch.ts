import { prisma } from '@/lib/prisma'

/**
 * The master switch: one row that stops the whole Source Watch pipeline
 * without a restart. While it is off, workers claim no task (no crawling,
 * screening or extraction), the planner queues no checks, no paid AI call is
 * made and no provider batch is submitted. A task already running finishes
 * the page in hand. Queued work is kept and resumes when it is switched on.
 *
 * Kept in monitor_sync_cursors so it needs no migration, and read on every
 * claim (no cache) so switching off takes effect at once.
 */

export interface PipelineSwitch {
  paused: boolean
  reason: string | null
  by: string | null
  at: string | null
}

const NAME = 'pipeline-switch'
const RUNNING: PipelineSwitch = { paused: false, reason: null, by: null, at: null }

export async function pipelineSwitch(): Promise<PipelineSwitch> {
  const row = await prisma.monitorSyncCursor.findUnique({ where: { name: NAME } })
  const value = row?.cursor as Partial<PipelineSwitch> | undefined
  return value ? { ...RUNNING, ...value, paused: value.paused === true } : RUNNING
}

export async function pipelinePaused(): Promise<boolean> {
  return (await pipelineSwitch()).paused
}

export async function setPipelineSwitch(paused: boolean, actor: { by: string; reason?: string | null }): Promise<PipelineSwitch> {
  const value: PipelineSwitch = { paused, reason: paused ? actor.reason?.trim() || null : null, by: actor.by, at: new Date().toISOString() }
  await prisma.monitorSyncCursor.upsert({ where: { name: NAME }, create: { name: NAME, cursor: { ...value } }, update: { cursor: { ...value } } })
  return value
}
