import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  JOB_KEYS,
  JOB_REGISTRY,
  jobDefinition,
  jobHealth,
  stalenessLimitMs,
} from '@/lib/jobs/registry'

/**
 * The registry against reality.
 *
 * This is the test that exists because the lists drifted. Three scheduled jobs
 * had no card on the operations console, so nothing said the proposal sweep, the
 * review-recovery sweep and the source-monitor sweep had never run — while
 * production's scheduler was dead for months and the screen showed green.
 *
 * Reading the source is unusual in a unit test and deliberate here: the failure
 * being guarded against is precisely a hand-maintained list falling behind the
 * code, and only the code can say what the code does.
 */

const ROOT = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Every job key handed to withJobRun anywhere under src, tests excluded. */
function jobKeysInSource(): Set<string> {
  const found = new Set<string>()
  const tests = join(ROOT, 'src', 'tests')
  for (const file of walk(join(ROOT, 'src'))) {
    // Skipping the test tree matters: this very file names the pattern it looks
    // for, so without it the scanner finds its own documentation.
    if (file.startsWith(tests)) continue
    const text = readFileSync(file, 'utf8')
    if (!text.includes('withJobRun')) continue
    for (const match of text.matchAll(/jobKey:\s*'([a-z][a-z0-9.-]*)'/gi)) found.add(match[1])
  }
  return found
}

describe('job registry', () => {
  it('has no duplicate keys', () => {
    expect(new Set(JOB_KEYS).size).toBe(JOB_KEYS.length)
  })

  it('covers every job the code actually records', () => {
    const inSource = jobKeysInSource()
    expect(inSource.size).toBeGreaterThan(0)
    const missing = Array.from(inSource).filter((key) => !JOB_KEYS.includes(key))
    expect(missing, `withJobRun uses these keys with no registry entry: ${missing.join(', ')}`).toEqual([])
  })

  it('covers every endpoint the scheduler fires', () => {
    const scheduler = readFileSync(join(ROOT, 'scripts', 'funding-scheduler.js'), 'utf8')
    // The scheduler calls post('/api/...'), so the paths it fires are the string
    // literals beginning /api/ inside that file.
    const fired = new Set(
      Array.from(scheduler.matchAll(/'(\/api\/[^']+)'/g)).map((match) => match[1])
    )
    expect(fired.size).toBeGreaterThan(0)
    const endpoints = new Set(JOB_REGISTRY.map((job) => job.endpoint))
    const unregistered = Array.from(fired).filter((path) => !endpoints.has(path))
    expect(
      unregistered,
      `the scheduler fires these with no registry entry: ${unregistered.join(', ')}`
    ).toEqual([])
  })

  it('gives every job a cadence a staleness check can use', () => {
    for (const job of JOB_REGISTRY) {
      expect(job.expectedIntervalMinutes, job.jobKey).toBeGreaterThan(0)
      expect(job.endpoint.startsWith('/api/'), job.jobKey).toBe(true)
      expect(job.label.length, job.jobKey).toBeGreaterThan(0)
    }
  })

  it('finds a definition by key, and nothing by a wrong one', () => {
    expect(jobDefinition('reminders-sweep')?.label).toBe('Reminder sweep')
    expect(jobDefinition('reminders_sweep')).toBeUndefined()
  })
})

describe('job health', () => {
  const hourly = jobDefinition('reminders-sweep')!

  it('calls a job that has never succeeded "never", not "stale"', () => {
    // The two have different causes and different fixes: never means nobody has
    // ever fired it, which is the state production was actually in.
    expect(jobHealth(hourly, null)).toBe('never')
  })

  it('leaves a recently succeeded job alone', () => {
    expect(jobHealth(hourly, new Date())).toBe('ok')
  })

  it('tolerates a merely late run', () => {
    // Two hours late on an hourly job is normal: the scheduler fires on a minute
    // gate and a long run pushes the next one back.
    expect(jobHealth(hourly, new Date(Date.now() - 2 * 3600_000))).toBe('ok')
  })

  it('calls a job stale once it is well past its own cadence', () => {
    expect(jobHealth(hourly, new Date(Date.now() - stalenessLimitMs(hourly) - 60_000))).toBe('stale')
  })

  it('scales the allowance to the job, not to a fixed clock', () => {
    const weekly = jobDefinition('reports-weekly')!
    const tenMinutes = jobDefinition('proposal-reviews-sweep')!
    // A day-old weekly report is fine; a day-old ten-minute sweep is not.
    const aDayAgo = new Date(Date.now() - 24 * 3600_000)
    expect(jobHealth(weekly, aDayAgo)).toBe('ok')
    expect(jobHealth(tenMinutes, aDayAgo)).toBe('stale')
  })
})
