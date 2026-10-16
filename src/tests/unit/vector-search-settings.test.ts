import { describe, expect, it } from 'vitest'

import { vectorSearchSettingsFor } from '@/lib/vectorSearch'

describe('vector search settings', () => {
  it('uses ef_search and iterative scan on pgvector 0.8+', () => {
    expect(vectorSearchSettingsFor('0.8.0')).toEqual([
      'SET LOCAL hnsw.ef_search = 100',
      "SET LOCAL hnsw.iterative_scan = 'relaxed_order'",
    ])
    expect(vectorSearchSettingsFor('1.2')).toHaveLength(2)
  })

  it('skips settings the installed pgvector does not define', () => {
    // SET on an undefined hnsw.* parameter is an error that would fail every search.
    expect(vectorSearchSettingsFor('0.7.4')).toEqual(['SET LOCAL hnsw.ef_search = 100'])
    expect(vectorSearchSettingsFor('0.4.4')).toEqual([])
    expect(vectorSearchSettingsFor(null)).toEqual([])
    expect(vectorSearchSettingsFor('garbage')).toEqual([])
  })
})
