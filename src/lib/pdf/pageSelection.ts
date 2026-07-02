export const DEFAULT_AUTO_SELECT_PAGE_LIMIT = 15
export const MAX_SELECTED_TEMPLATE_PDF_PAGES = 30

export type PageSelectionResult = {
  pages: number[]
  error: string | null
}

function uniqueSortedPages(pages: number[]) {
  return Array.from(new Set(pages)).sort((a, b) => a - b)
}

function validatePages(
  pages: number[],
  options: { totalPages?: number | null; maxPages?: number } = {}
): PageSelectionResult {
  const maxPages = options.maxPages ?? MAX_SELECTED_TEMPLATE_PDF_PAGES
  const totalPages = typeof options.totalPages === 'number' ? options.totalPages : null

  if (pages.length === 0) {
    return { pages: [], error: null }
  }

  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1) {
      return { pages: [], error: 'Page numbers must be positive whole numbers.' }
    }
    if (totalPages && page > totalPages) {
      return { pages: [], error: `Page ${page} is outside this ${totalPages}-page PDF.` }
    }
  }

  const normalized = uniqueSortedPages(pages)
  if (normalized.length > maxPages) {
    return { pages: [], error: `Select ${maxPages} pages or fewer.` }
  }

  return { pages: normalized, error: null }
}

export function normalizeSelectedPages(
  input: unknown,
  options: { totalPages?: number | null; maxPages?: number } = {}
): PageSelectionResult {
  if (!Array.isArray(input)) {
    return { pages: [], error: 'Selected pages must be an array of page numbers.' }
  }

  const pages = input.map((value) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
    return Number.NaN
  })

  return validatePages(pages, options)
}

export function parsePageRangeInput(
  input: string,
  options: { totalPages?: number | null; maxPages?: number } = {}
): PageSelectionResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { pages: [], error: null }
  }

  const pages: number[] = []
  const chunks = trimmed.split(',').map((chunk) => chunk.trim()).filter(Boolean)

  for (const chunk of chunks) {
    const match = chunk.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) {
      return { pages: [], error: 'Use page numbers or ranges such as 1-3, 7, 10-12.' }
    }

    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (start > end) {
      return { pages: [], error: `Page range ${chunk} is reversed.` }
    }

    for (let page = start; page <= end; page += 1) {
      pages.push(page)
      if (pages.length > (options.maxPages ?? MAX_SELECTED_TEMPLATE_PDF_PAGES) * 2) {
        break
      }
    }
  }

  return validatePages(pages, options)
}

export function formatPageRangeInput(pages: number[]) {
  const normalized = uniqueSortedPages(pages)
  if (normalized.length === 0) return ''

  const ranges: string[] = []
  let start = normalized[0]
  let previous = normalized[0]

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index]
    if (current === previous + 1) {
      previous = current
      continue
    }

    ranges.push(start === previous ? String(start) : `${start}-${previous}`)
    start = current
    previous = current
  }

  ranges.push(start === previous ? String(start) : `${start}-${previous}`)
  return ranges.join(', ')
}

export function getDefaultTemplatePdfPages(totalPages: number) {
  if (!Number.isInteger(totalPages) || totalPages < 1) return []
  return Array.from(
    { length: Math.min(totalPages, MAX_SELECTED_TEMPLATE_PDF_PAGES) },
    (_, index) => index + 1
  )
}

export function isTemplatePdfSelectionRequired(totalPages: number | null | undefined) {
  return typeof totalPages === 'number' && totalPages > DEFAULT_AUTO_SELECT_PAGE_LIMIT
}
