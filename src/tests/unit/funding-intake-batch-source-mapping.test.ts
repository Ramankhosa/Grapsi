import { describe, expect, it } from 'vitest'

import { resolveBatchSourceAssignments } from '@/lib/fundingIntake/batchSourceMapping'

describe('funding intake batch source mapping', () => {
  it('defaults guideline and template source to details source', () => {
    expect(resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_1' }],
      detailsSourceKey: 'source_1',
    })).toEqual({
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_1',
      templateSourceKey: 'source_1',
    })
  })

  it('rejects jobs without a details source', () => {
    expect(() => resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_1' }],
    })).toThrow(/detailsSourceKey/)
  })

  it('rejects invalid and missing source keys', () => {
    expect(() => resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_1' }],
      detailsSourceKey: 'source_2',
    })).toThrow(/does not exist/)

    expect(() => resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_4' }],
      detailsSourceKey: 'source_4',
    })).toThrow(/Invalid source key/)
  })

  it('allows up to three explicit sources', () => {
    expect(resolveBatchSourceAssignments({
      sources: [
        { sourceKey: 'source_1' },
        { sourceKey: 'source_2' },
        { sourceKey: 'source_3' },
      ],
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_2',
      templateSourceKey: 'source_3',
    })).toEqual({
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_2',
      templateSourceKey: 'source_3',
    })
  })
})
