import { describe, expect, it } from 'vitest'

import {
  MAX_SELECTED_TEMPLATE_PDF_PAGES,
  formatPageRangeInput,
  getDefaultTemplatePdfPages,
  normalizeSelectedPages,
  parsePageRangeInput,
} from '@/lib/pdf/pageSelection'

describe('PDF page selection utilities', () => {
  it('parses ranges, dedupes pages, and sorts the result', () => {
    expect(parsePageRangeInput('3, 1-2, 2, 7', { totalPages: 10 })).toEqual({
      pages: [1, 2, 3, 7],
      error: null,
    })
  })

  it('rejects malformed and reversed ranges', () => {
    expect(parsePageRangeInput('1, abc', { totalPages: 10 }).error).toContain('Use page numbers')
    expect(parsePageRangeInput('5-3', { totalPages: 10 }).error).toContain('reversed')
  })

  it('rejects pages outside the document and over the selection cap', () => {
    expect(parsePageRangeInput('1, 11', { totalPages: 10 }).error).toContain('outside')
    expect(
      parsePageRangeInput(`1-${MAX_SELECTED_TEMPLATE_PDF_PAGES + 1}`, {
        totalPages: 100,
      }).error
    ).toContain('pages or fewer')
  })

  it('normalizes selected page arrays from multipart JSON payloads', () => {
    expect(normalizeSelectedPages([4, '2', 4, 1], { totalPages: 5 })).toEqual({
      pages: [1, 2, 4],
      error: null,
    })
    expect(normalizeSelectedPages(['x'], { totalPages: 5 }).error).toContain('positive whole numbers')
    expect(normalizeSelectedPages({ page: 1 }).error).toContain('array')
  })

  it('formats selected pages back into compact ranges', () => {
    expect(formatPageRangeInput([1, 2, 3, 7, 10, 11, 12])).toBe('1-3, 7, 10-12')
  })

  it('defaults PDFs to all pages up to the extraction cap', () => {
    expect(getDefaultTemplatePdfPages(3)).toEqual([1, 2, 3])
    expect(getDefaultTemplatePdfPages(16)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1))
    expect(getDefaultTemplatePdfPages(50)).toEqual(
      Array.from({ length: MAX_SELECTED_TEMPLATE_PDF_PAGES }, (_, index) => index + 1)
    )
  })
})
