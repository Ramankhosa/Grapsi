import { createHash } from 'node:crypto'

/**
 * When a watch point is next due.
 *
 * Calendar days, counted in India Standard Time (the platform's operating
 * zone), so a daily source stays daily instead of drifting later with every
 * run. Each source gets a deterministic offset inside the day so a large
 * watch list spreads across hours instead of hitting every funder at 00:00.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** Due times spread over the first six hours of the IST day. */
export const JITTER_WINDOW_MS = 6 * 60 * 60 * 1000

/** The UTC instant of 00:00 IST on the IST calendar day containing `date`. */
export function startOfIstDay(date: Date): Date {
  const shifted = date.getTime() + IST_OFFSET_MS
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS)
}

/** Stable per-key offset in [0, windowMs). */
export function jitterMs(key: string, windowMs = JITTER_WINDOW_MS): number {
  const digest = createHash('sha256').update(key).digest()
  return digest.readUInt32BE(0) % Math.max(1, windowMs)
}

/** Daily is the floor; weekly the slowest cadence a listing gets. */
export function cadenceDays(frequencyMinutes: number): number {
  return Math.min(7, Math.max(1, Math.round(Math.max(1440, frequencyMinutes) / 1440)))
}

/**
 * A listing that keeps showing nothing new is checked less often: twice the
 * chosen interval after 4 quiet checks, three times after 10, never beyond a
 * week. HIGH-priority watch points keep their interval, any change resets the
 * streak, and MONITOR_ADAPTIVE_CADENCE=false turns this off.
 */
export const ADAPTIVE_CADENCE = { doubleAfter: 4, tripleAfter: 10, maxDays: 7 }

export function adaptiveCadenceDays(baseDays: number, quietStreak: number, priority: string, enabled = process.env.MONITOR_ADAPTIVE_CADENCE !== 'false'): number {
  if (!enabled || priority === 'HIGH') return baseDays
  const stretch = quietStreak >= ADAPTIVE_CADENCE.tripleAfter ? 3 : quietStreak >= ADAPTIVE_CADENCE.doubleAfter ? 2 : 1
  return Math.max(baseDays, Math.min(ADAPTIVE_CADENCE.maxDays, baseDays * stretch))
}

export function nextCheckAt(now: Date, everyDays: number, key: string): Date {
  return new Date(startOfIstDay(now).getTime() + Math.max(1, everyDays) * DAY_MS + jitterMs(key))
}

/**
 * First checks of a bulk import or approval: up to `freeUpTo` sites start at
 * once, larger batches are spread `minutesPerSite` apart, never longer than
 * `maxMinutes` in all. Returns null when the site may start now.
 */
export const BULK_SPREAD = { freeUpTo: 10, minutesPerSite: 3, maxMinutes: 24 * 60 }

export function bulkSpreadMinutes(count: number): number {
  return count <= BULK_SPREAD.freeUpTo ? 0 : Math.min(BULK_SPREAD.maxMinutes, count * BULK_SPREAD.minutesPerSite)
}

export function staggeredStart(now: Date, index: number, count: number): Date | null {
  const spread = bulkSpreadMinutes(count)
  if (!spread || index === 0) return null
  return new Date(now.getTime() + Math.floor((index * spread * 60_000) / count))
}
