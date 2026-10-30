import { prisma } from '@/lib/prisma'

/**
 * The master switch for the Source Watch pipeline, with three positions:
 *
 * - RUNNING: everything runs.
 * - CRAWL_PAUSED: no website is crawled for new pages (no source checks,
 *   revisits or site discovery are claimed or planned), while screening,
 *   extraction and the rest of the queue finish what is already waiting.
 * - STOPPED: workers claim no task at all, the planner queues nothing, no paid
 *   AI call is made and no provider batch is submitted.
 *
 * A task already running finishes the page in hand. Queued work is kept and
 * resumes when the switch moves back. Kept in monitor_sync_cursors so it needs
 * no migration, and read on every claim (no cache) so it takes effect at once.
 */

export type PipelineMode = 'RUNNING' | 'CRAWL_PAUSED' | 'STOPPED'

export interface PipelineSwitch {
  mode: PipelineMode
  /** STOPPED: nothing runs. */
  paused: boolean
  /** CRAWL_PAUSED or STOPPED: no new pages are fetched. */
  crawlPaused: boolean
  reason: string | null
  by: string | null
  at: string | null
}

/** The task kinds that crawl websites for pages; everything else works on pages already found. */
export const CRAWL_KINDS = ['CHECK_SOURCE', 'REVISIT', 'DISCOVER_SITE'] as const

const NAME = 'pipeline-switch'
const MODES: PipelineMode[] = ['RUNNING', 'CRAWL_PAUSED', 'STOPPED']

function view(mode: PipelineMode, rest: { reason?: string | null; by?: string | null; at?: string | null } = {}): PipelineSwitch {
  return { mode, paused: mode === 'STOPPED', crawlPaused: mode !== 'RUNNING', reason: rest.reason ?? null, by: rest.by ?? null, at: rest.at ?? null }
}

export async function pipelineSwitch(): Promise<PipelineSwitch> {
  const row = await prisma.monitorSyncCursor.findUnique({ where: { name: NAME } })
  const value = row?.cursor as { mode?: string; paused?: boolean; reason?: string | null; by?: string | null; at?: string | null } | undefined
  if (!value) return view('RUNNING')
  // Rows written before the crawl-only position carry just `paused`.
  const mode = MODES.includes(value.mode as PipelineMode) ? value.mode as PipelineMode : value.paused === true ? 'STOPPED' : 'RUNNING'
  return view(mode, value)
}

export async function pipelinePaused(): Promise<boolean> {
  return (await pipelineSwitch()).paused
}

export async function crawlPaused(): Promise<boolean> {
  return (await pipelineSwitch()).crawlPaused
}

export async function setPipelineSwitch(mode: PipelineMode, actor: { by: string; reason?: string | null }): Promise<PipelineSwitch> {
  const value = view(mode, { reason: mode === 'RUNNING' ? null : actor.reason?.trim() || null, by: actor.by, at: new Date().toISOString() })
  await prisma.monitorSyncCursor.upsert({ where: { name: NAME }, create: { name: NAME, cursor: { ...value } }, update: { cursor: { ...value } } })
  return value
}
