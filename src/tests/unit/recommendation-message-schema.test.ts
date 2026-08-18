import { describe, expect, it } from 'vitest'

import {
  CHAT_RESULT_LIMIT_MAX,
  FILTER_LIST_MAX_ITEMS,
  FILTER_VALUE_MAX_LENGTH,
  PAPER_ABSTRACT_MAX_LENGTH,
  PAPER_KEYWORDS_MAX,
  RESEARCH_AREA_MAX_LENGTH,
} from '@/lib/recommendations/constants'
import {
  conversationMessageFilterSchema,
  conversationMessageRequestSchema,
  conversationQueryPatchSchema,
} from '@/lib/recommendations/messageSchema'

describe('funding chat request schemas', () => {
  it('bounds manualQueryPatch text so a single request cannot plant an oversized topic', () => {
    expect(
      conversationMessageRequestSchema.safeParse({ manualQueryPatch: { researchArea: 'a'.repeat(RESEARCH_AREA_MAX_LENGTH) } }).success
    ).toBe(true)
    expect(
      conversationMessageRequestSchema.safeParse({ manualQueryPatch: { researchArea: 'a'.repeat(RESEARCH_AREA_MAX_LENGTH + 1) } })
        .success
    ).toBe(false)
    expect(conversationQueryPatchSchema.safeParse({ abstract: 'b'.repeat(PAPER_ABSTRACT_MAX_LENGTH + 1) }).success).toBe(false)
    expect(
      conversationQueryPatchSchema.safeParse({ keywords: Array.from({ length: PAPER_KEYWORDS_MAX + 1 }, () => 'k') }).success
    ).toBe(false)
  })

  it('strips unknown keys from a query patch instead of persisting them', () => {
    const parsed = conversationQueryPatchSchema.parse({ researchArea: 'ai', injected: 'x' } as unknown)
    expect(parsed).toEqual({ researchArea: 'ai' })
  })

  it('bounds filter lists, list values, dates and result limits', () => {
    expect(
      conversationMessageFilterSchema.safeParse({ eligibleCountries: Array.from({ length: FILTER_LIST_MAX_ITEMS + 1 }, () => 'India') })
        .success
    ).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ fundingKinds: ['x'.repeat(FILTER_VALUE_MAX_LENGTH + 1)] }).success).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ limit: CHAT_RESULT_LIMIT_MAX + 1 }).success).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ deadlineFrom: '2026-01-01' }).success).toBe(true)
    expect(conversationMessageFilterSchema.safeParse({ deadlineFrom: 'x'.repeat(40) }).success).toBe(false)
  })

  it('rejects non-finite amounts', () => {
    expect(conversationMessageFilterSchema.safeParse({ amountMin: Infinity }).success).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ amountMax: -Infinity }).success).toBe(false)
    expect(conversationMessageFilterSchema.safeParse({ amountMin: 1000, amountMax: null }).success).toBe(true)
  })
})
