import { describe, expect, it } from 'vitest'

import {
  buildFundingIntakeJobStatusCounts,
  deriveFundingIntakeBatchStatus,
} from '@/lib/fundingIntake/batchStatus'

describe('funding intake batch status', () => {
  it('keeps active batches processing', () => {
    expect(deriveFundingIntakeBatchStatus(['draft_created', 'extracting'])).toBe('processing')
    expect(deriveFundingIntakeBatchStatus(['queued', 'needs_review'])).toBe('processing')
  })

  it('marks all saved jobs as completed', () => {
    expect(deriveFundingIntakeBatchStatus(['draft_created', 'draft_created'])).toBe('completed')
  })

  it('marks review-gated batches as needs_review when there are no failures', () => {
    expect(deriveFundingIntakeBatchStatus(['draft_created', 'needs_review'])).toBe('needs_review')
  })

  it('prioritizes failure outcomes after active work is done', () => {
    expect(deriveFundingIntakeBatchStatus(['failed', 'failed'])).toBe('failed')
    expect(deriveFundingIntakeBatchStatus(['canceled', 'canceled'])).toBe('canceled')
    expect(deriveFundingIntakeBatchStatus(['failed', 'draft_created'])).toBe('partially_failed')
    expect(deriveFundingIntakeBatchStatus(['failed', 'needs_review'])).toBe('partially_failed')
  })

  it('builds stable job status counts', () => {
    expect(buildFundingIntakeJobStatusCounts(['queued', 'draft_created', 'draft_created', 'needs_review'])).toMatchObject({
      queued: 1,
      fetching: 0,
      extracting: 0,
      needs_review: 1,
      draft_created: 2,
      failed: 0,
      canceled: 0,
    })
  })
})
