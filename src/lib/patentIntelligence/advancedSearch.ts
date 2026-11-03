import type { PatentNestSearchFilters, PatentNestSearchMode, PatentNestSearchSort } from '@/lib/patentnest/types'

export const PATENT_TEXT_FILTERS = [
  ['title', 'Title contains'], ['abstract', 'Abstract contains'],
  ['publicationNumber', 'Publication number'], ['applicationNumber', 'Application number'],
  ['applicants', 'Applicants'], ['inventors', 'Inventors'], ['classifications', 'IPC / CPC prefixes'],
] as const
export const PATENT_DATE_FILTERS = [
  ['filingDateFrom', 'Filed from'], ['filingDateTo', 'Filed through'],
  ['publicationDateFrom', 'Published from'], ['publicationDateTo', 'Published through'],
  ['grantDateFrom', 'Granted from'], ['grantDateTo', 'Granted through'],
] as const
const ARRAY_FILTERS = new Set(['applicants', 'inventors', 'classifications'])
export type PatentAdvancedSearch = {
  mode: PatentNestSearchMode
  jurisdictions: string[]
  filters: PatentNestSearchFilters
  sort: PatentNestSearchSort
}

export function readAdvancedPatentSearch(get: (key: string) => string | null): PatentAdvancedSearch {
  const filters: Record<string, string | string[]> = {}
  for (const [key] of [...PATENT_TEXT_FILTERS, ...PATENT_DATE_FILTERS]) {
    const value = get(`f.${key}`)?.trim()
    if (value) filters[key] = ARRAY_FILTERS.has(key) ? value.split('|').map(term => term.trim()).filter(Boolean) : value
  }
  const mode = get('mode') === 'structured' ? 'structured' : 'hybrid'
  const requestedSort = get('order')
  const sort = mode === 'hybrid' ? 'relevance' :
    requestedSort === 'filingDateDesc' || requestedSort === 'grantDateDesc' || requestedSort === 'titleAsc' ? requestedSort : 'publicationDateDesc'
  return { mode, filters, sort, jurisdictions: (get('offices') || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean) }
}

export function writeAdvancedPatentSearch(params: URLSearchParams, value: PatentAdvancedSearch) {
  params.set('mode', value.mode)
  params.delete('offset')
  params.set('order', value.mode === 'structured' ? value.sort === 'relevance' ? 'publicationDateDesc' : value.sort : 'relevance')
  if (value.jurisdictions.length) params.set('offices', value.jurisdictions.join(','))
  else params.delete('offices')
  for (const [key] of [...PATENT_TEXT_FILTERS, ...PATENT_DATE_FILTERS]) {
    const raw = value.filters[key]
    const text = Array.isArray(raw) ? raw.join('|') : raw
    if (text) params.set(`f.${key}`, text)
    else params.delete(`f.${key}`)
  }
}

export function readPatentOffset(value: string | null | undefined): number {
  const offset = Number(value || 0)
  return Number.isInteger(offset) && offset >= 0 && offset <= 10000 ? offset : 0
}
