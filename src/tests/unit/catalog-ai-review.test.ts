import { describe, expect, it, vi } from 'vitest'
import { canApproveDistinct, inputHash, validateRecommendation } from '@/lib/fundingCatalogImport/aiReviewPolicy'
import { aiFilterSchema, approveDistinct, runAiReviewStep, selectAiReviewItems } from '@/lib/fundingCatalogImport/aiReview'

const snapshot = { reason: 'POSSIBLE_DUPLICATE', subject: { title: 'Round 2026', description: 'New round for 2026' }, candidate: { title: 'Round 2025', description: 'Previous round for 2025' } }
const result = { decision: 'SEPARATE_OPPORTUNITIES', confidence: 0.98, conflicts: ['DIFFERENT_ROUND'], explanation: 'The records explicitly identify different annual rounds.', evidence: [{ side: 'subject', field: 'title', quote: '2026' }, { side: 'candidate', field: 'title', quote: '2025' }], suggestedFacts: [] }
describe('AI import review evidence and approval', () => {
  it('permits explicit distinct-round recommendations with quoted evidence on both sides', () => {
    expect(canApproveDistinct(validateRecommendation(result, snapshot), snapshot)).toBeTruthy()
  })
  it.each(['DEADLINE_CONFLICT', 'FUNDER_CONFLICT', 'AMOUNT_CONFLICT', 'ELIGIBILITY_CONFLICT', 'SOURCE_CONFLICT', 'INSUFFICIENT_EVIDENCE'])('keeps %s out of bulk approval', conflict => {
    expect(canApproveDistinct(validateRecommendation({ ...result, conflicts: [conflict] }, snapshot), snapshot)).toBeFalsy()
  })
  it('rejects fabricated evidence and unsupported fact suggestions', () => {
    expect(() => validateRecommendation({ ...result, evidence: [{ side: 'subject', field: 'description', quote: 'Invented deadline' }] }, snapshot)).toThrow(/unsupported evidence/)
    expect(() => validateRecommendation({ ...result, suggestedFacts: [{ field: 'agency', value: 'Made up', evidence: 'Not present' }] }, snapshot)).toThrow(/Unsupported suggested fact/)
    expect(() => validateRecommendation({ ...result, suggestedFacts: [{ field: 'source', value: 'https://invented.example', evidence: 'New round for 2026' }] }, snapshot)).toThrow(/Unsupported suggested fact/)
  })
  it('allows absent readiness information without invented evidence', () => {
    expect(validateRecommendation({ ...result, decision: 'NEEDS_INFORMATION', conflicts: ['MISSING_INFORMATION'], evidence: [], suggestedFacts: [] }, { ...snapshot, reason: 'READINESS_FAILED' }).decision).toBe('NEEDS_INFORMATION')
  })
  it('bounds long quotes only after confirming the entire original quote exists', () => {
    const text = 'Exact source sentence. '.repeat(40)
    const s = { ...snapshot, subject: { description: text } }
    const r = { ...result, evidence: [{ side: 'subject', field: 'description', quote: text }, result.evidence[1]] }
    expect(validateRecommendation(r, s).evidence[0].quote).toEqual(text.slice(0, 500))
    expect(() => validateRecommendation({ ...r, evidence: [{ ...r.evidence[0], quote: text + ' invented' }] }, s)).toThrow()
  })
  it('does not bulk approve same-opportunity, missing facts, low confidence, or one-sided results', () => {
    for (const change of [{ decision: 'SAME_OPPORTUNITY' }, { decision: 'NEEDS_INFORMATION' }, { confidence: 0.94 }, { evidence: [result.evidence[0]] }]) {
      expect(canApproveDistinct(validateRecommendation({ ...result, ...change }, snapshot), snapshot)).toBeFalsy()
    }
  })
  it('detects changes to input and resolution', () => {
    expect(inputHash(snapshot)).not.toEqual(inputHash({ ...snapshot, resolution: 'ignored' }))
    expect(inputHash(snapshot)).not.toEqual(inputHash({ ...snapshot, subject: { ...snapshot.subject, title: 'Round 2027' } }))
  })
  it('does not bulk approve a comparison with truncated source text', () => {
    const truncated = { ...snapshot, subject: { ...snapshot.subject, descriptionTruncated: true } }
    expect(canApproveDistinct(validateRecommendation(result, truncated), truncated)).toBeFalsy()
  })
  it('validates filters rather than accepting arbitrary query operators', () => {
    expect(aiFilterSchema.safeParse({ lifecycle: 'INVALID' }).success).toBe(false)
    expect(aiFilterSchema.safeParse({ minScore: 2 }).success).toBe(false)
  })
})
describe('AI batch safety', () => {
  it('does not claim work from paused/cancelled/completed batches', async () => {
    for (const status of ['PAUSED', 'CANCELLED', 'COMPLETE']) {
      const tx = { $queryRaw: vi.fn(), catalogAiReviewBatch: { findUnique: vi.fn().mockResolvedValue({ status }) }, catalogAiReviewItem: { findFirst: vi.fn() } }
      await runAiReviewStep({ $transaction: (fn: any) => fn(tx) } as any, 'batch')
      expect(tx.catalogAiReviewItem.findFirst).not.toHaveBeenCalled()
    }
  })
  it('does not claim a second item while a live lease exists', async () => {
    const tx = { $queryRaw: vi.fn(), catalogAiReviewBatch: { findUnique: vi.fn().mockResolvedValue({ status: 'RUNNING' }) }, catalogAiReviewItem: { count: vi.fn().mockResolvedValue(1), findFirst: vi.fn() } }
    await runAiReviewStep({ $transaction: (fn: any) => fn(tx) } as any, 'batch')
    expect(tx.catalogAiReviewItem.findFirst).not.toHaveBeenCalled()
  })
  it('refuses stale approvals without modifying calls or conflict resolutions', async () => {
    const tx = { $queryRaw: vi.fn(), catalogAiReviewItem: { findFirst: vi.fn().mockResolvedValue({ input_hash: 'old', candidate_id: 'candidate' }) }, fundingImportCandidate: {
      findUnique: vi.fn().mockResolvedValue({ id: 'candidate', reason: 'POSSIBLE_DUPLICATE', subject_call_id: 'call', subject_call: { id: 'call' } }), update: vi.fn(),
    } }
    const outcomes = await approveDistinct({ $transaction: (fn: any) => fn(tx) } as any, 'batch', ['item'], 'admin')
    expect(outcomes[0].applied).toBe(false)
    expect(outcomes[0].reason).toMatch(/changed/)
    expect(tx.fundingImportCandidate.update).not.toHaveBeenCalled()
  })
  it('scopes all matching selections to pending, blocking, staged imported catalogue calls', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await selectAiReviewItems({ fundingImportCandidate: { findMany } } as any, {})
    const and = findMany.mock.calls[0][0].where.AND
    expect(and).toContainEqual({ blocks_release: true, subject_call: { import_run_id: { not: null }, catalog_status: 'STAGED', visibility: 'GLOBAL_CATALOG' } })
    expect(and[0]).toEqual({ AND: [{ resolution: { in: ['pending', 'deferred'] } }] })
  })
})
