import { prisma } from '@/lib/prisma'

import { computeDiff, addedLines, removedLines } from './differ'
import { fetchUrl, discoverFeed, isAllowedByRobots } from './fetcher'
import { sendChangeAlert } from './notify'
import { extractText, applyIgnoreRules, hashText } from './normalize'
import { feedToText } from './rss'
import { triageChange } from './triage'

/** Snapshots kept per source: enough history to explain a find, not an archive. */
const SNAPSHOT_RETENTION = 20
/** Daily is the floor; a legacy row asking for less is clamped up to it. */
export const MIN_FREQUENCY_MINUTES = 1440

export type CheckResult =
  | { status: 'baseline' }
  | { status: 'unchanged' }
  | { status: 'changed'; changeId: string; verdict: string }
  | { status: 'error'; message: string }

/**
 * Run one check of a source: fetch, normalise, compare against the latest
 * snapshot, and on a real change record a MonitoredChange, triage it, and
 * alert. Safe to call from a cron sweep or from the "Check now" button.
 */
export async function runCheck(sourceId: string): Promise<CheckResult> {
  const source = await prisma.monitoredSource.findUnique({
    where: { id: sourceId },
    include: { ignoreRules: true },
  })
  if (!source) return { status: 'error', message: 'Source not found' }

  try {
    if (!(await isAllowedByRobots(source.url))) {
      throw new Error("Blocked by robots.txt — this site asks not to be crawled")
    }

    // AUTO resolves once, on the first check: a site with a feed is both
    // cheaper and more reliable to watch than its HTML.
    let feedUrl = source.feed_url
    let mode = source.mode
    if (mode === 'AUTO') {
      const html = await fetchUrl(source.url)
      const discovered = await discoverFeed(source.url, html)
      if (discovered) {
        feedUrl = discovered
        mode = 'FEED'
      } else {
        mode = 'HTML'
      }
      await prisma.monitoredSource.update({
        where: { id: source.id },
        data: { mode, feed_url: feedUrl },
      })
    }

    let text: string
    if (mode === 'FEED' && feedUrl) {
      text = await feedToText(await fetchUrl(feedUrl))
    } else {
      text = extractText(await fetchUrl(source.url), source.url, source.selector)
    }
    text = applyIgnoreRules(
      text,
      source.ignoreRules.map((rule) => rule.pattern)
    )
    if (text.trim().length === 0) {
      throw new Error(
        'Fetched page produced no readable text (JavaScript-only site, or the selector matches nothing)'
      )
    }
    const contentHash = hashText(text)

    const latest = await prisma.monitoredSnapshot.findFirst({
      where: { source_id: source.id },
      orderBy: { fetched_at: 'desc' },
    })

    const clearError = { fail_count: 0, last_error: null, last_checked_at: new Date() }

    if (!latest) {
      await prisma.monitoredSnapshot.create({
        data: { source_id: source.id, content_hash: contentHash, text },
      })
      await prisma.monitoredSource.update({ where: { id: source.id }, data: clearError })
      return { status: 'baseline' }
    }

    if (latest.content_hash === contentHash) {
      await prisma.monitoredSource.update({ where: { id: source.id }, data: clearError })
      return { status: 'unchanged' }
    }

    await prisma.monitoredSnapshot.create({
      data: { source_id: source.id, content_hash: contentHash, text },
    })
    await pruneSnapshots(source.id)

    const diff = computeDiff(latest.text, text)
    const triage = await triageChange({
      sourceName: source.name,
      sourceUrl: source.url,
      keywords: source.keywords,
      added: addedLines(diff),
      removed: removedLines(diff),
    })

    // A confidently-cosmetic change is recorded but never shown to a human;
    // that judgement is what keeps the queue worth opening.
    const isCosmetic = triage !== null && triage.verdict === 'COSMETIC' && triage.confidence >= 0.8

    const change = await prisma.monitoredChange.create({
      data: {
        source_id: source.id,
        diff: diff as unknown as object,
        verdict: triage?.verdict ?? 'UNKNOWN',
        confidence: triage?.confidence ?? null,
        extracted: triage
          ? ({ summary: triage.summary, opportunities: triage.opportunities } as object)
          : undefined,
        state: isCosmetic ? 'DISMISSED' : 'NEW',
        resolved_at: isCosmetic ? new Date() : null,
      },
    })

    await prisma.monitoredSource.update({
      where: { id: source.id },
      data: { ...clearError, last_changed_at: new Date() },
    })

    if (!isCosmetic) {
      await sendChangeAlert({
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        ownerUserId: source.owner_user_id,
        changeId: change.id,
        triage,
      })
    }

    return { status: 'changed', changeId: change.id, verdict: triage?.verdict ?? 'UNKNOWN' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.monitoredSource.update({
      where: { id: source.id },
      data: {
        last_checked_at: new Date(),
        fail_count: { increment: 1 },
        last_error: message.slice(0, 500),
      },
    })
    return { status: 'error', message }
  }
}

async function pruneSnapshots(sourceId: string): Promise<void> {
  const keep = await prisma.monitoredSnapshot.findMany({
    where: { source_id: sourceId },
    orderBy: { fetched_at: 'desc' },
    take: SNAPSHOT_RETENTION,
    select: { id: true },
  })
  await prisma.monitoredSnapshot.deleteMany({
    where: { source_id: sourceId, id: { notIn: keep.map((s) => s.id) } },
  })
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Calendar days between two instants. Counting whole days rather than elapsed
 * milliseconds is what keeps a daily source on a daily rhythm: a source checked
 * at 2pm yesterday is due at this morning's sweep, where an elapsed-time test
 * would call it "20 hours old" and push it to tomorrow, drifting a day later
 * with every run.
 */
export function calendarDaysSince(then: Date, now: Date): number {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / 86_400_000)
}

export function isDue(
  source: { last_checked_at: Date | null; frequency_minutes: number },
  now: Date
): boolean {
  if (!source.last_checked_at) return true
  const minutes = Math.max(MIN_FREQUENCY_MINUTES, source.frequency_minutes)
  const everyDays = Math.max(1, Math.round(minutes / 1440))
  return calendarDaysSince(source.last_checked_at, now) >= everyDays
}
