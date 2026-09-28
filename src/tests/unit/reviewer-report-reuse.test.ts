import { afterEach, describe, expect, it, vi } from 'vitest'

// reportGeneration transitively reaches prisma, the metering gateway, both
// provider SDKs and the landscape's search services; the helpers under test
// are pure, so the heavy leaves are mocked away.
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }))
vi.mock('@/lib/metering/gateway', () => ({ llmGateway: { executeLLMOperation: vi.fn() } }))
vi.mock('@/lib/funding/llmRouting', () => ({ runFundingGatewayText: vi.fn() }))
vi.mock('@/lib/geminiService', () => ({
  generateFromGemini: vi.fn(),
  generateFromGeminiWithFiles: vi.fn(),
  isGeminiRateLimitErrorLike: vi.fn(() => false),
  getGeminiRetryAfterMs: vi.fn(() => null),
}))
vi.mock('@/lib/openaiService', () => ({
  generateFromOpenAI: vi.fn(),
  DEFAULT_OPENAI_FALLBACK_MODEL: 'gpt-5.2',
}))
vi.mock('@/lib/ideaIntelligence/evidenceSources', () => ({ retrievePatentnestPatents: vi.fn() }))
vi.mock('@/lib/ideaIntelligence/projectRecords', () => ({ loadProjectRecords: vi.fn() }))
vi.mock('@/lib/publicProjects/searchService', () => ({ publicProjectSearchService: { search: vi.fn() } }))
vi.mock('@/lib/recommendations/conversationUtils', () => ({ extractJsonObject: vi.fn() }))
vi.mock('@/lib/reviewer/usage', () => ({
  completeReviewerUsage: vi.fn(),
  releaseReviewerUsage: vi.fn(),
  reserveReviewerUsage: vi.fn(),
  resolveReviewerCallOwner: vi.fn(),
  reviewerReportOperationId: vi.fn(),
  ServiceQuotaExceededError: class ServiceQuotaExceededError extends Error {},
}))

import {
  capCallContext,
  landscapeCacheOf,
  landscapeIsReusable,
  landscapeNoveltyInputHash,
  recentReportRuns,
  reusableNoveltyOf,
  reviewerReportDailyLimit,
  shouldReuseLandscape,
} from '@/lib/reviewer/reportGeneration'

const NOW = new Date('2026-08-24T12:00:00Z')

function hashInput(overrides: Partial<Parameters<typeof landscapeNoveltyInputHash>[0]> = {}) {
  return {
    projectTitle: 'Portable biosensors',
    callDescription: 'A call about rural diagnostics.',
    digests: [
      { title: 'Abstract', text: 'Deploy 40 biosensors in rural clinics.' },
      { title: 'Methodology', text: 'On-device classification pipeline.' },
    ],
    ...overrides,
  }
}

function prevReport(overrides: Record<string, any> = {}) {
  const hash = landscapeNoveltyInputHash(hashInput())
  return {
    landscape: { status: 'ok', input_hash: hash },
    generated_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.REVIEWER_LANDSCAPE_REUSE
})

describe('landscapeNoveltyInputHash', () => {
  it('is stable across whitespace differences in the call description', () => {
    const a = landscapeNoveltyInputHash(hashInput({ callDescription: 'A call   about\n rural diagnostics. ' }))
    const b = landscapeNoveltyInputHash(hashInput())
    expect(a).toBe(b)
  })

  it('changes when a digest text changes', () => {
    const changed = landscapeNoveltyInputHash(hashInput({
      digests: [
        { title: 'Abstract', text: 'Deploy 45 biosensors in rural clinics.' },
        { title: 'Methodology', text: 'On-device classification pipeline.' },
      ],
    }))
    expect(changed).not.toBe(landscapeNoveltyInputHash(hashInput()))
  })

  it('changes when digest order or title changes', () => {
    const base = landscapeNoveltyInputHash(hashInput())
    const reordered = landscapeNoveltyInputHash(hashInput({
      digests: [
        { title: 'Methodology', text: 'On-device classification pipeline.' },
        { title: 'Abstract', text: 'Deploy 40 biosensors in rural clinics.' },
      ],
    }))
    expect(reordered).not.toBe(base)
  })

  it('changes when the project title changes', () => {
    expect(landscapeNoveltyInputHash(hashInput({ projectTitle: 'Other project' })))
      .not.toBe(landscapeNoveltyInputHash(hashInput()))
  })
})

describe('shouldReuseLandscape', () => {
  const hash = landscapeNoveltyInputHash(hashInput())

  it('reuses a fresh matching landscape', () => {
    expect(shouldReuseLandscape(prevReport(), hash, NOW)).toBe(true)
  })

  it('rejects a hash mismatch', () => {
    expect(shouldReuseLandscape(prevReport(), 'different-hash', NOW)).toBe(false)
  })

  it('rejects an errored landscape', () => {
    const report = prevReport({ landscape: { status: 'error', input_hash: hash } })
    expect(shouldReuseLandscape(report, hash, NOW)).toBe(false)
  })

  it('rejects a report older than the max age', () => {
    const report = prevReport({
      generated_at: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(shouldReuseLandscape(report, hash, NOW)).toBe(false)
  })

  it('rejects a report with no parseable timestamp', () => {
    expect(shouldReuseLandscape(prevReport({ generated_at: undefined }), hash, NOW)).toBe(false)
  })

  it('rejects when there is no previous landscape', () => {
    expect(shouldReuseLandscape(null, hash, NOW)).toBe(false)
    expect(shouldReuseLandscape({}, hash, NOW)).toBe(false)
  })

  it('is disabled by the kill switch', () => {
    process.env.REVIEWER_LANDSCAPE_REUSE = 'false'
    expect(shouldReuseLandscape(prevReport(), hash, NOW)).toBe(false)
  })
})

describe('landscapeCacheOf', () => {
  it('reads a landscape parked by a run whose panel report failed', () => {
    const parked = {
      landscape_cache: { landscape: { status: 'ok' }, built_at: '2026-08-24T11:00:00Z' },
    }
    expect(landscapeCacheOf(parked)).toEqual({
      landscape: { status: 'ok' },
      novelty: null,
      built_at: '2026-08-24T11:00:00Z',
    })
  })

  it('is null when nothing was parked', () => {
    expect(landscapeCacheOf(null)).toBeNull()
    expect(landscapeCacheOf({})).toBeNull()
    expect(landscapeCacheOf({ landscape_cache: {} })).toBeNull()
  })
})

describe('landscapeIsReusable', () => {
  const hash = landscapeNoveltyInputHash(hashInput())

  it('accepts a parked landscape built moments ago, so the retry does not rebuild it', () => {
    const parked = { status: 'ok', input_hash: hash }
    expect(landscapeIsReusable(parked, new Date(NOW.getTime() - 30_000).toISOString(), hash, NOW)).toBe(true)
  })

  it('rejects a parked landscape whose inputs have since changed', () => {
    const parked = { status: 'ok', input_hash: 'stale-hash' }
    expect(landscapeIsReusable(parked, NOW.toISOString(), hash, NOW)).toBe(false)
  })

  it('rejects a parked landscape that is past the max age', () => {
    const parked = { status: 'ok', input_hash: hash }
    const old = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
    expect(landscapeIsReusable(parked, old, hash, NOW)).toBe(false)
  })
})

describe('landscapeIsReusable — every source must have answered', () => {
  // Only a fully errored build used to be refused, so a run whose patent
  // search failed was reused for a week and patents never came back.
  const hash = landscapeNoveltyInputHash(hashInput())
  const builtAt = new Date(NOW.getTime() - 60_000).toISOString()
  const clean = (overrides: Record<string, any> = {}) => ({
    status: 'ok',
    input_hash: hash,
    sources: {
      projects: { searched: true, count: 5, degradedMode: null },
      patents: { searched: true, status: 'ok', count: 4 },
    },
    ...overrides,
  })

  it('reuses a landscape where both searches answered', () => {
    expect(landscapeIsReusable(clean(), builtAt, hash, NOW)).toBe(true)
  })

  it('rebuilds a partial landscape, so a failed patent search is retried', () => {
    const partial = clean({
      status: 'partial',
      sources: {
        projects: { searched: true, count: 5, degradedMode: null },
        patents: { searched: false, status: 'error', count: 0, error: 'PatentNest authentication failed.' },
      },
    })
    expect(landscapeIsReusable(partial, builtAt, hash, NOW)).toBe(false)
  })

  it('rebuilds when the patent search errored even if the status reads ok', () => {
    const patentsFailed = clean({ sources: { projects: { searched: true, count: 5, degradedMode: null }, patents: { searched: false, status: 'error', count: 0 } } })
    expect(landscapeIsReusable(patentsFailed, builtAt, hash, NOW)).toBe(false)
  })

  it('rebuilds when the project search errored', () => {
    const projectsFailed = clean({ sources: { projects: { searched: false, count: 0, degradedMode: null, error: 'timeout' }, patents: { searched: true, status: 'ok', count: 4 } } })
    expect(landscapeIsReusable(projectsFailed, builtAt, hash, NOW)).toBe(false)
  })

  it('rebuilds a not-configured patent search once patent search is configured', () => {
    const notConfigured = clean({ sources: { projects: { searched: true, count: 5, degradedMode: null }, patents: { searched: false, status: 'not_configured', count: 0 } } })
    expect(landscapeIsReusable(notConfigured, builtAt, hash, NOW, { patentSearchConfigured: true })).toBe(false)
    expect(landscapeIsReusable(notConfigured, builtAt, hash, NOW, { patentSearchConfigured: false })).toBe(true)
  })

  it('rebuilds a landscape that recorded a degraded step', () => {
    const degraded = clean({ notes: ['Matching the results against the proposal timed out.'] })
    expect(landscapeIsReusable(degraded, builtAt, hash, NOW)).toBe(false)
  })
})

describe('reusableNoveltyOf', () => {
  it('keeps a real verdict and drops the unassessed fallback', () => {
    expect(reusableNoveltyOf({ verdict: 'incremental' })).toEqual({ verdict: 'incremental' })
    expect(reusableNoveltyOf({ verdict: 'unassessed' })).toBeNull()
    expect(reusableNoveltyOf(null)).toBeNull()
  })

  it('is read back from a parked cache alongside the landscape', () => {
    const parked = { landscape_cache: { landscape: { status: 'ok' }, novelty: { verdict: 'differentiated' }, built_at: '2026-08-24T11:00:00Z' } }
    expect(landscapeCacheOf(parked)?.novelty).toEqual({ verdict: 'differentiated' })
  })
})

describe('report run ceiling', () => {
  afterEach(() => {
    delete process.env.REVIEWER_REPORT_DAILY_LIMIT
  })

  it('counts only runs inside the last 24 hours', () => {
    const state = {
      report_runs: [
        new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        new Date(NOW.getTime() - 60 * 1000).toISOString(),
        'not-a-date',
      ],
      report_lock: { token: 'x', until: NOW.toISOString() },
    }
    expect(recentReportRuns(state, NOW)).toHaveLength(2)
    expect(recentReportRuns(null, NOW)).toEqual([])
    expect(recentReportRuns({ report_runs: 'garbage' }, NOW)).toEqual([])
  })

  it('defaults to 15 and honours a positive override', () => {
    expect(reviewerReportDailyLimit()).toBe(15)
    process.env.REVIEWER_REPORT_DAILY_LIMIT = '4'
    expect(reviewerReportDailyLimit()).toBe(4)
    process.env.REVIEWER_REPORT_DAILY_LIMIT = '0'
    expect(reviewerReportDailyLimit()).toBe(15)
  })
})

describe('capCallContext', () => {
  it('leaves a normal call context alone and truncates an oversized one', () => {
    expect(capCallContext('short context')).toBe('short context')
    const capped = capCallContext('x'.repeat(30_000))
    expect(capped.length).toBeLessThan(25_000)
    expect(capped).toContain('[Call context truncated for the panel report]')
  })
})
