import { describe, expect, it } from 'vitest'

import { EvidencePackService } from '@/lib/services/evidence-pack-service'

describe('grant evidence pack digest', () => {
  it('annotates digest entries with grant persuasion role guidance without changing stored schemas', () => {
    const service = new EvidencePackService()
    const digest = service.buildEvidenceDigest(
      [
        {
          dimension: 'Scale, burden, or urgency of medication non-adherence among older adults',
          grantSemantic: 'problem_need',
          grantPersuasionRole: 'proves_need',
          citations: [
            {
              citationId: 'c1',
              citationKey: 'Need2024',
              title: 'Burden of non-adherence in older adults',
              year: 2024,
              confidence: 'HIGH',
              relevanceScore: 92,
              remark: 'Non-adherence affects 2.3 million older adults annually.',
              keyFindings: 'Medication non-adherence affects 2.3 million older adults annually.',
              hasDeepAnalysis: true,
              evidenceCards: [],
            },
          ],
        },
      ],
      ['Need2024'],
      { grantBacked: true }
    )

    expect(digest.digests).toHaveLength(1)
    expect(digest.digests[0]?.grantRoleTag).toBe('prove burden')
    expect(digest.digests[0]?.grantUsageHint).toMatch(/exact burden statistic/i)
    expect(digest.mustCiteKeys).toContain('Need2024')
  })
})
