import { describe, expect, it } from 'vitest'

import {
  applyPatentFilters,
  buildFindSimilarQuery,
  buildSearchCacheKey,
  buildShortlistCsv,
  classificationGroupOf,
  derivePatentFacets,
  EMPTY_PATENT_FILTERS,
  formatClassification,
  formatPatentCitation,
  formatShortlistMarkdown,
  normalizePublicationNumberKey,
  readPatentFiltersFromParams,
  sortPatents,
  splitForHighlight,
  toPatentEvidence,
  toPatentSearchItem,
  tokenizeHighlightTerms,
  writePatentFiltersToParams,
} from '@/lib/patentIntelligence/searchCore'
import type { PatentSearchItem, PatentShortlistItemDto } from '@/lib/patentIntelligence/types'
import type { IndianPatentRecord } from '@/lib/patentnest/types'

const RAW: IndianPatentRecord = {
  publicationNumber: 'IN 2028/2005 A',
  applicationNumber: '2028/DEL/2005',
  kind: 'a',
  country: 'INDIA',
  title: '  Graphene oxide   membrane for arsenic removal ',
  abstract: 'A graphene-oxide membrane that removes arsenic from groundwater using C++ style layering (a).',
  applicants: [{ name: 'Indian Institute of Technology, Delhi', address: 'Hauz Khas, New Delhi', sequence: 1 }, { name: ' ', address: null }],
  inventors: ['A. Sharma', 'B. Rao', 'a. sharma'],
  classifications: ['B01D 71/02', 'C02F 1/44', 'B01D71/02'],
  filingDate: '2005-08-10',
  publicationDate: '2007-02-16',
  numberOfPages: 12,
  numberOfClaims: 9,
  extractionConfidence: 0.93,
  source: { name: 'IP India Patent Journal', document: 'journal-2007-07.pdf', page: 41 },
  relevance: { score: 0.82, semanticScore: 0.86, textScore: 0.41, matchedFields: ['title', 'abstract'] },
}

function item(overrides: Partial<IndianPatentRecord> = {}): PatentSearchItem {
  const result = toPatentSearchItem({ ...RAW, ...overrides })
  if (!result) throw new Error('fixture did not normalize')
  return result
}

function dto(record: PatentSearchItem, overrides: Partial<PatentShortlistItemDto> = {}): PatentShortlistItemDto {
  return {
    id: `s-${record.publicationNumberKey}`,
    publicationNumber: record.publicationNumber,
    publicationNumberKey: record.publicationNumberKey,
    title: record.title,
    note: null,
    ideaRunId: null,
    record,
    createdAt: '2026-08-22T10:00:00.000Z',
    updatedAt: '2026-08-22T10:00:00.000Z',
    ...overrides,
  }
}

describe('toPatentSearchItem', () => {
  it('normalizes a raw PatentNest record', () => {
    const result = item()
    expect(result.publicationNumberKey).toBe('IN20282005A')
    expect(result.id).toBe('IN20282005A')
    expect(result.title).toBe('Graphene oxide membrane for arsenic removal')
    expect(result.kind).toBe('A')
    expect(result.country).toBe('INDIA')
    // "INDIA" is not ISO-2, so the jurisdiction comes from the number prefix.
    expect(result.jurisdiction).toBe('IN')
    expect(result.applicants).toEqual([{ name: 'Indian Institute of Technology, Delhi', address: 'Hauz Khas, New Delhi' }])
    expect(result.inventors).toEqual(['A. Sharma', 'B. Rao'])
    expect(result.classifications).toEqual(['B01D 71/02', 'C02F 1/44', 'B01D71/02'])
    expect(result.classificationGroups).toEqual(['B01D', 'C02F'])
    expect(result.filingYear).toBe(2005)
    expect(result.publicationYear).toBe(2007)
    expect(result.relevance).toEqual({ score: 0.82, semanticScore: 0.86, textScore: 0.41, matchedFields: ['title', 'abstract'] })
    expect(result.source).toEqual({ name: 'IP India Patent Journal', document: 'journal-2007-07.pdf', page: 41 })
  })

  it('returns null without a publication number and tolerates missing fields', () => {
    expect(toPatentSearchItem({ title: 'x' })).toBeNull()
    expect(toPatentSearchItem(null)).toBeNull()
    const sparse = toPatentSearchItem({ publicationNumber: 'US 9,123,456 B2' })
    expect(sparse).toMatchObject({
      publicationNumberKey: 'US9123456B2', jurisdiction: 'US', title: 'Untitled patent', abstract: null,
      applicants: [], inventors: [], classifications: [], classificationGroups: [], filingYear: null, relevance: null, source: null,
    })
  })

  it('prefers an ISO-2 country over the number prefix', () => {
    expect(item({ country: 'in' }).jurisdiction).toBe('IN')
    expect(item({ country: 'EP', publicationNumber: 'WO 2019/123' }).jurisdiction).toBe('EP')
  })
})

describe('helpers', () => {
  it('normalizes publication number keys and classification groups', () => {
    expect(normalizePublicationNumberKey('in-2028/2005-a')).toBe('IN20282005A')
    expect(classificationGroupOf('A61K 31/00')).toBe('A61K')
    expect(classificationGroupOf('C02F0001720000')).toBe('C02F')
    expect(classificationGroupOf('h04l')).toBe('H04L')
    expect(classificationGroupOf('x')).toBeNull()
  })

  it('renders compact IPC full symbols as readable codes and leaves others alone', () => {
    expect(formatClassification('C02F0001720000')).toBe('C02F 1/72')
    expect(formatClassification('B01J0020020000')).toBe('B01J 20/02')
    expect(formatClassification('B82Y0030000000')).toBe('B82Y 30/00')
    expect(formatClassification('H04L0001106000')).toBe('H04L 1/106')
    expect(formatClassification('A61K 31/00')).toBe('A61K 31/00')
    expect(formatClassification(' g06n 20/00 ')).toBe('g06n 20/00')
    const citation = formatPatentCitation(item({ classifications: ['C02F0001720000', 'B01J0020060000'] }))
    expect(citation).toContain('IPC/CPC: C02F 1/72; B01J 20/06')
  })

  it('builds a bounded find-similar query', () => {
    const long = item({ abstract: 'word '.repeat(1000) })
    const query = buildFindSimilarQuery(long)
    expect(query.startsWith('Graphene oxide membrane for arsenic removal. word')).toBe(true)
    expect(Array.from(query).length).toBeLessThanOrEqual(2000)
  })

  it('normalizes cache keys', () => {
    expect(buildSearchCacheKey('  Solar   CELL ', 30)).toBe('solar cell|30|')
    expect(buildSearchCacheKey('solar cell', 999, ['us', 'IN', 'in'])).toBe('solar cell|50|IN,US')
  })
})

describe('derivePatentFacets / applyPatentFilters / sortPatents', () => {
  const a = item()
  const b = item({ publicationNumber: 'US 1', country: null, applicants: [{ name: 'Acme' }], classifications: ['A61K 31/00'], publicationDate: '2010-01-01', filingDate: null, kind: 'B2' })
  const c = item({ publicationNumber: 'EP 2', country: 'EP', applicants: [{ name: 'Acme' }, { name: 'Acme' }], classifications: [], publicationDate: null, filingDate: null, kind: null })

  it('counts facets from the unfiltered page and falls back to the number prefix for jurisdiction', () => {
    const facets = derivePatentFacets([a, b, c])
    expect(facets.jurisdictions).toEqual([{ value: 'EP', count: 1 }, { value: 'IN', count: 1 }, { value: 'US', count: 1 }])
    // Duplicate applicant names inside one record count once.
    expect(facets.applicants[0]).toEqual({ value: 'Acme', count: 2 })
    expect(facets.years.map((year) => year.value)).toEqual(['2010', '2007'])
    expect(facets.classifications).toEqual([{ value: 'A61K', count: 1 }, { value: 'B01D', count: 1 }, { value: 'C02F', count: 1 }])
    expect(facets.kinds).toEqual([{ value: 'A', count: 1 }, { value: 'B2', count: 1 }])
  })

  it('caps the applicant facet at fifteen', () => {
    const many = Array.from({ length: 20 }, (_, index) => item({ publicationNumber: `IN ${index}`, applicants: [{ name: `Org ${index}` }] }))
    expect(derivePatentFacets(many).applicants).toHaveLength(15)
  })

  it('ANDs across facets and ORs within one', () => {
    expect(applyPatentFilters([a, b, c], EMPTY_PATENT_FILTERS)).toHaveLength(3)
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, applicants: ['Acme'] })).toEqual([b, c])
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, applicants: ['Acme'], jurisdictions: ['US'] })).toEqual([b])
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, jurisdictions: ['IN', 'EP'] })).toEqual([a, c])
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, years: ['2007'] })).toEqual([a])
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, classifications: ['C02F'] })).toEqual([a])
    expect(applyPatentFilters([a, b, c], { ...EMPTY_PATENT_FILTERS, kinds: ['B2'] })).toEqual([b])
  })

  it('sorts by date with undated records last and keeps relevance order untouched', () => {
    expect(sortPatents([a, b, c], 'relevance')).toEqual([a, b, c])
    expect(sortPatents([a, b, c], 'newest').map((entry) => entry.publicationNumber)).toEqual(['US 1', 'IN 2028/2005 A', 'EP 2'])
    expect(sortPatents([a, b, c], 'oldest').map((entry) => entry.publicationNumber)).toEqual(['IN 2028/2005 A', 'US 1', 'EP 2'])
  })
})

describe('highlighting', () => {
  it('tokenizes meaningful terms only', () => {
    expect(tokenizeHighlightTerms('A method for the removal of Arsenic using graphene-oxide membranes, C++')).toEqual(['removal', 'arsenic', 'graphene', 'oxide', 'membranes'])
    expect(tokenizeHighlightTerms('')).toEqual([])
  })

  it('splits text case-insensitively and escapes regex metacharacters', () => {
    const chunks = splitForHighlight('Arsenic removal (ARSENIC) via C++', ['arsenic', 'c++', '(a)'])
    expect(chunks).toEqual([
      { text: 'Arsenic', hit: true },
      { text: ' removal (', hit: false },
      { text: 'ARSENIC', hit: true },
      { text: ') via ', hit: false },
      { text: 'C++', hit: true },
    ])
    expect(splitForHighlight('plain', [])).toEqual([{ text: 'plain', hit: false }])
    expect(splitForHighlight(null, ['x'])).toEqual([])
  })
})

describe('citations and exports', () => {
  it('formats plain and markdown citations, omitting missing parts', () => {
    const full = item()
    expect(formatPatentCitation(full)).toBe(
      'Graphene oxide membrane for arsenic removal. Indian Institute of Technology, Delhi. Publication No. IN 2028/2005 A (kind A), IN. Filed 2005-08-10; published 2007-02-16. IPC/CPC: B01D 71/02; C02F 1/44; B01D71/02. Source: PatentNest (journal-2007-07.pdf, p. 41).',
    )
    expect(formatPatentCitation(full, 'markdown')).toBe(
      '- **Graphene oxide membrane for arsenic removal** — Indian Institute of Technology, Delhi. Publication No. `IN 2028/2005 A (kind A)`, IN. Filed 2005-08-10; published 2007-02-16. IPC/CPC: B01D 71/02; C02F 1/44; B01D71/02. Source: PatentNest (journal-2007-07.pdf, p. 41).',
    )
    const sparse = toPatentSearchItem({ publicationNumber: 'US 1', title: 'Sparse' }) as PatentSearchItem
    expect(formatPatentCitation(sparse)).toBe('Sparse. Publication No. US 1, US. Source: PatentNest.')
  })

  it('renders a markdown block with notes', () => {
    const markdown = formatShortlistMarkdown([dto(item(), { note: '  cite in   IP section ' })], { heading: 'Prior art' })
    expect(markdown.startsWith('## Prior art\n\n- **Graphene oxide membrane')).toBe(true)
    expect(markdown).toContain('\n  - Note: cite in IP section\n')
    expect(formatShortlistMarkdown([])).toContain('_No patents shortlisted yet._')
  })

  it('builds RFC 4180 CSV with escaped cells', () => {
    const csv = buildShortlistCsv([dto(item({ title: 'Quote "me", please\nnow' }), { note: 'a,b' })])
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('publication_number,title,applicants,inventors,kind,jurisdiction,filing_date,publication_date,classifications,relevance_score,note,saved_at,source')
    expect(row.startsWith('IN 2028/2005 A,"Quote ""me"", please\nnow"'.split('\n')[0])).toBe(true)
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"Indian Institute of Technology, Delhi"')
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})

describe('URL filter state', () => {
  it('round-trips pipe-joined lists (applicant names may contain commas)', () => {
    const params = new URLSearchParams()
    writePatentFiltersToParams(params, { ...EMPTY_PATENT_FILTERS, applicants: ['Indian Institute of Technology, Delhi', 'Acme'], years: ['2007'] })
    expect(params.get('a')).toBe('Indian Institute of Technology, Delhi|Acme')
    expect(params.get('y')).toBe('2007')
    expect(params.has('j')).toBe(false)
    const read = readPatentFiltersFromParams((key) => params.get(key))
    expect(read).toEqual({ ...EMPTY_PATENT_FILTERS, applicants: ['Indian Institute of Technology, Delhi', 'Acme'], years: ['2007'] })
  })
})

describe('toPatentEvidence (phase-2 bridge)', () => {
  it('maps to the idea-intelligence evidence shape', () => {
    expect(toPatentEvidence(item())).toEqual({
      id: 'IN20282005A',
      title: 'Graphene oxide membrane for arsenic removal',
      abstract: RAW.abstract,
      publicationNumber: 'IN 2028/2005 A',
      assignee: 'Indian Institute of Technology, Delhi',
      inventor: 'A. Sharma, B. Rao',
      priorityDate: null,
      filingDate: '2005-08-10',
      publicationDate: '2007-02-16',
      url: null,
      source: 'patentnest',
    })
  })
})
