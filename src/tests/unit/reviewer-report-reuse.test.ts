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
  landscapeNoveltyInputHash,
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
