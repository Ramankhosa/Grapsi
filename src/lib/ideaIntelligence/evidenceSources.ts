import { literatureSearchService, type SearchResult } from '@/lib/services/literature-search-service'
import { serpApiProvider, type SerpApiSearchResult } from '@/lib/serpapi-provider'
import { isPatentNestConfigured, searchIndianPatents } from '@/lib/patentnest/client'
import { sanitizeExternalUrl } from '@/lib/urlSafety'

export type PublicationEvidence = {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  doi: string | null
  url: string | null
  citationCount: number | null
  source: string
}

export type PatentEvidence = {
  id: string
  title: string
  abstract: string | null
  publicationNumber: string | null
  assignee: string | null
  inventor: string | null
  priorityDate: string | null
  filingDate: string | null
  publicationDate: string | null
  url: string | null
  source: 'google_patents' | 'patentnest'
}

export type WebEvidence = {
  id: string
  title: string
  snippet: string | null
  url: string | null
  source: string
  date: string | null
}

export type EvidenceDiagnostics = {
  publicationSources: string[]
  patentnestConfigured: boolean
  patentnestStatus: 'not_configured' | 'ok' | 'error'
  patentnestError?: string
  serpapiError?: string
}

export type MultiSourceEvidence = {
  publications: PublicationEvidence[]
  patents: PatentEvidence[]
  webResults: WebEvidence[]
  diagnostics: EvidenceDiagnostics
}

function normalizeText(value: unknown, maxLength = 3000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function hostnameOf(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isResearchOrFunderDomain(url: string | null) {
  const host = hostnameOf(url)
  if (!host) return false
  if (['google.com', 'bing.com', 'youtube.com', 'facebook.com', 'x.com', 'twitter.com', 'linkedin.com'].some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return false
  }
  return (
    host.endsWith('.gov.in') ||
    host.endsWith('.gov') ||
    host.endsWith('.edu') ||
    host.endsWith('.ac.in') ||
    host.endsWith('.org') ||
    /\b(dst|dbt|serb|anrf|birac|icmr|csir|ugc|aicte|meity|startupindia|grant|fund|research|science|innovation)\b/.test(host)
  )
}

function stableId(prefix: string, value: unknown) {
  const text = normalizeText(value, 300)
  return `${prefix}:${Buffer.from(text || `${Date.now()}-${Math.random()}`).toString('base64url').slice(0, 36)}`
}

function normalizePublication(result: SearchResult): PublicationEvidence {
  const url = sanitizeExternalUrl(result.url || result.pdfUrl)
  return {
    id: result.id || stableId('publication', result.title),
    title: normalizeText(result.title, 500),
    authors: Array.isArray(result.authors) ? result.authors.map((author) => normalizeText(author, 120)).filter(Boolean).slice(0, 12) : [],
    year: typeof result.year === 'number' ? result.year : null,
    venue: normalizeText(result.venue, 240) || null,
    abstract: normalizeText(result.abstract, 2200) || null,
    doi: normalizeText(result.doi, 180) || null,
    url,
    citationCount: typeof result.citationCount === 'number' ? result.citationCount : null,
    source: normalizeText(result.source, 80) || 'literature',
  }
}

function normalizeSerpPatent(result: SerpApiSearchResult): PatentEvidence | null {
  const anyResult = result as any
  const title = normalizeText(anyResult.title, 500)
  if (!title) return null
  const url = sanitizeExternalUrl(anyResult.link || anyResult.pdf)
  return {
    id: normalizeText(anyResult.patent_id || anyResult.publication_number || anyResult.link, 240) || stableId('patent', title),
    title,
    abstract: normalizeText(anyResult.snippet, 1500) || null,
    publicationNumber: normalizeText(anyResult.publication_number, 120) || null,
    assignee: normalizeText(anyResult.assignee, 240) || null,
    inventor: normalizeText(anyResult.inventor, 240) || null,
    priorityDate: normalizeText(anyResult.priority_date, 80) || null,
    filingDate: normalizeText(anyResult.filing_date, 80) || null,
    publicationDate: normalizeText(anyResult.publication_date || anyResult.grant_date, 80) || null,
    url,
    source: 'google_patents',
  }
}

function normalizeWeb(result: SerpApiSearchResult): WebEvidence | null {
  const anyResult = result as any
  const title = normalizeText(anyResult.title, 500)
  if (!title) return null
  const url = sanitizeExternalUrl(anyResult.link)
  if (!isResearchOrFunderDomain(url)) return null
  return {
    id: url || stableId('web', title),
    title,
    snippet: normalizeText(anyResult.snippet, 1000) || null,
    url,
    source: normalizeText(anyResult.source || anyResult.displayed_link, 160) || 'web',
    date: normalizeText(anyResult.date, 80) || null,
  }
}

function normalizePatentnestItem(item: any): PatentEvidence | null {
  const title = normalizeText(item?.title || item?.inventionTitle || item?.patentTitle, 500)
  if (!title) return null
  const url = sanitizeExternalUrl(item?.url || item?.link || item?.sourceUrl)
  return {
    id: normalizeText(item?.id || item?.applicationNumber || item?.publicationNumber || item?.patentNumber, 240) || stableId('patentnest', title),
    title,
    abstract: normalizeText(item?.abstract || item?.summary || item?.snippet, 1500) || null,
    publicationNumber: normalizeText(item?.publicationNumber || item?.publication_number || item?.applicationNumber, 160) || null,
    assignee: normalizeText(item?.assignee || item?.applicant || item?.applicantName || item?.applicants?.[0]?.name, 240) || null,
    inventor: normalizeText(item?.inventor || item?.inventorName || (Array.isArray(item?.inventors) ? item.inventors.join(', ') : item?.inventors), 240) || null,
    priorityDate: normalizeText(item?.priorityDate || item?.priority_date, 80) || null,
    filingDate: normalizeText(item?.filingDate || item?.filing_date || item?.applicationDate, 80) || null,
    publicationDate: normalizeText(item?.publicationDate || item?.publication_date, 80) || null,
    url,
    source: 'patentnest',
  }
}

async function searchPatentnest(query: string, limit: number) {
  if (!isPatentNestConfigured()) {
    return { results: [], status: 'not_configured' as const }
  }

  try {
    const response = await searchIndianPatents(query, limit)
    return {
      results: response.data.results.map(normalizePatentnestItem).filter(Boolean).slice(0, limit) as PatentEvidence[],
      status: 'ok' as const,
    }
  } catch (error) {
    return {
      results: [],
      status: 'error' as const,
      error: error instanceof Error ? error.message : 'PatentNest search failed',
    }
  }
}

export async function retrieveIdeaEvidence(query: string, options: { publicationLimit?: number; patentLimit?: number; webLimit?: number } = {}): Promise<MultiSourceEvidence> {
  const publicationLimit = Math.min(Math.max(options.publicationLimit || 10, 1), 20)
  const patentLimit = Math.min(Math.max(options.patentLimit || 10, 1), 20)
  const webLimit = Math.min(Math.max(options.webLimit || 8, 1), 15)

  const [publicationResult, patentResult, patentnestResult, webResult] = await Promise.allSettled([
    literatureSearchService.search(query, {
      sources: ['semantic_scholar', 'openalex', 'crossref'],
      includeAbstract: true,
      hasAbstract: false,
      limit: publicationLimit,
    }),
    serpApiProvider.searchPatents({ q: query, num: patentLimit }),
    searchPatentnest(query, patentLimit),
    serpApiProvider.searchWeb({ q: `${query} research funding India`, num: webLimit }),
  ])

  const publications = publicationResult.status === 'fulfilled'
    ? publicationResult.value.results.map(normalizePublication).filter((item) => item.title).slice(0, publicationLimit)
    : []
  const googlePatents = patentResult.status === 'fulfilled'
    ? (patentResult.value.organic_results || []).map(normalizeSerpPatent).filter(Boolean) as PatentEvidence[]
    : []
  const patentnest = patentnestResult.status === 'fulfilled' ? patentnestResult.value : { results: [], status: 'error' as const, error: 'PatentNest request failed' }
  const webResults = webResult.status === 'fulfilled'
    ? (webResult.value.organic_results || []).map(normalizeWeb).filter(Boolean).slice(0, webLimit) as WebEvidence[]
    : []

  const seenPatents = new Set<string>()
  const patents = [...patentnest.results, ...googlePatents]
    .filter((patent) => {
      const key = `${patent.publicationNumber || patent.id || patent.title}`.toLowerCase()
      if (seenPatents.has(key)) return false
      seenPatents.add(key)
      return true
    })
    .slice(0, patentLimit)

  return {
    publications,
    patents,
    webResults,
    diagnostics: {
      publicationSources: publicationResult.status === 'fulfilled' ? publicationResult.value.sources : [],
      patentnestConfigured: isPatentNestConfigured(),
      patentnestStatus: patentnest.status,
      patentnestError: 'error' in patentnest ? patentnest.error : undefined,
      serpapiError: patentResult.status === 'fulfilled' ? patentResult.value.error : patentResult.reason?.message,
    },
  }
}
