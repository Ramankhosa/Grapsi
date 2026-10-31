import { describe, expect, it } from 'vitest'
import { scoreRelevance, tokens, jaccard } from '@/lib/monitor/relevance'
import { lifecycleAt, renderEvidence, verifyCitation, evidenceFingerprint, type EvidenceSegment } from '@/lib/monitor/evidence'
import { validateBatch } from '@/lib/monitor/candidates'
import { isCrawlTrap } from '@/lib/monitor/discovery'

describe('relevance is cheap and conservative', () => {
  it('retains combining marks and detects Hindi and English funding', () => {
    expect(tokens('अनुसंधान छात्रवृत्ति')).toEqual(['अनुसंधान', 'छात्रवृत्ति'])
    expect(scoreRelevance('छात्रवृत्ति आवेदन', '', '').outcome).toBe('STRONG_POSITIVE')
    expect(scoreRelevance('Research grant deadline', '', '').outcome).toBe('STRONG_POSITIVE')
  })
  it('does not discard opaque links or research news on a missing keyword', () => {
    expect(scoreRelevance('Notice 42', '', '/files/42.pdf').outcome).toBe('UNCERTAIN')
    expect(scoreRelevance('Research news', 'new application round', '').outcome).toBe('UNCERTAIN')
    expect(scoreRelevance('Privacy policy', '', '').outcome).toBe('STRONG_NEGATIVE')
    expect(scoreRelevance('Grant', '', '', { exclude: ['grant'] }).outcome).toBe('STRONG_NEGATIVE')
  })
  it('never turns similarity into identity', () => {
    expect(jaccard('grant round 2026', 'grant round 2027')).toBe(0.5)
  })
})
const segment: EvidenceSegment = { id: 'v1:1', resourceId: 'r1', versionId: 'v1', url: 'https://funder.example/call', role: 'CALL_NOTICE', page: 1, text: 'Applications close on 30 November 2026.', complete: true }
describe('trusted evidence', () => {
  it('validates triage members individually and never trusts duplicate or invented ids', () => {
    const member = { id: 'a', verdict: 'NEW_OPPORTUNITY', confidence: 0.9, reason: 'Official call', type: 'grant' }
    expect([...validateBatch({ items: [{ ...member, id: 'b' }, member] }, ['a', 'b']).keys()]).toEqual(['b', 'a'])
    expect([...validateBatch({ items: [member, member, { ...member, id: 'fake' }, { ...member, id: 'b' }] }, ['a', 'b']).keys()]).toEqual(['b'])
  })
  it('detects crawl traps while preserving ordinary call URLs', () => {
    expect(isCrawlTrap('https://funder.example/calendar?month=9')).toBe(true)
    expect(isCrawlTrap('https://funder.example/a/a/a/a')).toBe(true)
    expect(isCrawlTrap('https://funder.example/calls?id=ABC123')).toBe(false)
  })
  it('rejects invented ids and quotes, and partial evidence claiming completeness', () => {
    const citation = { segment: segment.id, quote: 'close on 30 November 2026', coverage: 'COMPLETE' }
    expect(verifyCitation(citation, [segment])).toBe(true)
    expect(verifyCitation({ ...citation, segment: 'fake' }, [segment])).toBe(false)
    expect(verifyCitation({ ...citation, quote: '31 December 2026' }, [segment])).toBe(false)
    expect(verifyCitation(citation, [{ ...segment, complete: false }])).toBe(false)
  })
  it('bounds bundles and invalidates fingerprints when evidence changes', () => {
    const bundle = renderEvidence([segment], 10)
    expect(bundle.segments[0].complete).toBe(false)
    expect(bundle.segments[0].text).toHaveLength(10)
    expect(evidenceFingerprint([segment], { policy: 1 })).not.toBe(evidenceFingerprint([segment], { policy: 2 }))
  })
  it('computes date status at read time and honours IST end of day', () => {
    expect(lifecycleAt('2026-11-30', null, null, new Date('2026-11-30T18:00:00Z'))).toBe('OPEN')
    expect(lifecycleAt('2026-11-30', null, null, new Date('2026-11-30T19:00:00Z'))).toBe('EXPIRED')
    expect(lifecycleAt(null, null, 'CANCELLED')).toBe('CANCELLED')
  })
})
