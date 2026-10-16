import { afterEach, describe, expect, it } from 'vitest'

import { buildFundingCallTextSearchCondition } from '@/lib/services/recommendationSearchService'

describe('finder text-match condition', () => {
  afterEach(() => {
    delete process.env.FINDER_FTS_UNION
  })

  it('matches call documents and taxonomy text as a UNION of ids', () => {
    const sql = buildFundingCallTextSearchCondition('cystic fibrosis').sql
    expect(sql).toContain('funding_calls.id IN (')
    expect(sql).toContain('UNION')
    // Must be the expression of funding_call_research_area_taxonomies_text_idx.
    expect(sql.replace(/\s+/g, ' ')).toContain(
      `to_tsvector( 'english', coalesce(taxonomy_text."taxonomy_level1_code", '') || ' ' || coalesce(taxonomy_text."taxonomy_level1_name", '') || ' ' || coalesce(taxonomy_text."taxonomy_level2_code", '') || ' ' || coalesce(taxonomy_text."taxonomy_level2_name", '') )`
    )
  })

  it('falls back to the OR-EXISTS form with FINDER_FTS_UNION=0', () => {
    process.env.FINDER_FTS_UNION = '0'
    const sql = buildFundingCallTextSearchCondition('cystic fibrosis').sql
    expect(sql).not.toContain('UNION')
    expect(sql).toContain('OR EXISTS')
  })
})
