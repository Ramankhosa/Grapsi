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
      documentKinds: { source_1: 'call_document' },
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
      documentKinds: {
        source_1: 'call_document',
        source_2: 'guideline_document',
        source_3: 'template_document',
      },
    })
  })

  it('derives slot assignments from per-source document kinds', () => {
    expect(resolveBatchSourceAssignments({
      sources: [
        { sourceKey: 'source_1', documentKind: 'call_document' },
        { sourceKey: 'source_2', documentKind: 'guideline_document' },
        { sourceKey: 'source_3', documentKind: 'call_document' },
      ],
    })).toEqual({
      detailsSourceKey: 'source_1',
      guidelinesSourceKey: 'source_2',
      templateSourceKey: 'source_1',
      documentKinds: {
        source_1: 'call_document',
        source_2: 'guideline_document',
        source_3: 'call_document',
      },
    })
  })

  it('keeps additional call documents tagged call_document even in unassigned slots', () => {
    const result = resolveBatchSourceAssignments({
      sources: [
        { sourceKey: 'source_1' },
        { sourceKey: 'source_2', documentKind: 'call_document' },
      ],
      detailsSourceKey: 'source_1',
    })
    expect(result.documentKinds).toEqual({
      source_1: 'call_document',
      source_2: 'call_document',
    })
    expect(result.guidelinesSourceKey).toBe('source_1')
  })

  it('rejects a details source tagged as a non-call document', () => {
    expect(() => resolveBatchSourceAssignments({
      sources: [
        { sourceKey: 'source_1', documentKind: 'guideline_document' },
        { sourceKey: 'source_2', documentKind: 'call_document' },
      ],
      detailsSourceKey: 'source_1',
    })).toThrow(/details source must be a call document/)
  })

  it('rejects unknown document kinds', () => {
    expect(() => resolveBatchSourceAssignments({
      sources: [{ sourceKey: 'source_1', documentKind: 'weird_document' }],
      detailsSourceKey: 'source_1',
    })).toThrow(/Invalid document kind/)
  })
})
