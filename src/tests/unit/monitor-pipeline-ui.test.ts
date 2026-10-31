import { describe, expect, it } from 'vitest'
import { classifyOpportunity } from '@/lib/monitor/outcomes'
import { TRIAGE_VERSION, unchangedNegative } from '@/lib/monitor/candidates'
import { RELEVANCE_VERSION } from '@/lib/monitor/relevance'
import { adaptiveCadenceDays } from '@/lib/monitor/schedule'
import { adaptiveRevisitDays } from '@/lib/monitor/revisit'

import { suggestedSettings, suggestWatchPages, websiteWarnings } from '@/lib/monitor/catalogImport'
import { buildSiteTree, type TreeInput } from '@/lib/monitor/siteTree'
import { skipRuleFor, skipRuleKey } from '@/lib/monitor/skipRules'

const rule = (url: string, match: 'PAGE' | 'FOLDER', expires_at: Date | null = null) => ({
  id: `${match}:${url}`,
  dedup_key: skipRuleKey(url, match)!.dedupKey,
  match,
  expires_at,
})

describe("don't-visit rules", () => {
  it('a page rule covers that page only, ignoring tracking params and www', () => {
    const rules = [rule('https://www.ukri.org/news/archive', 'PAGE')]
    expect(skipRuleFor(rules, 'https://ukri.org/news/archive?utm_source=x')).not.toBeNull()
    expect(skipRuleFor(rules, 'https://www.ukri.org/news/archive/2024')).toBeNull()
    expect(skipRuleFor(rules, 'https://www.ukri.org/news')).toBeNull()
  })

  it('a folder rule covers everything beneath the path, not siblings sharing a prefix', () => {
    const rules = [rule('https://grants.nih.gov/news/', 'FOLDER')]
    expect(skipRuleFor(rules, 'https://grants.nih.gov/news')).not.toBeNull()
    expect(skipRuleFor(rules, 'https://grants.nih.gov/news/2026/item.html')).not.toBeNull()
    expect(skipRuleFor(rules, 'https://grants.nih.gov/newsletter')).toBeNull()
    expect(skipRuleFor(rules, 'https://grants.nih.gov/grants/guide/')).toBeNull()
  })

  it('a folder rule drops the query string when stored', () => {
    expect(skipRuleKey('https://x.org/calls/?page=2', 'FOLDER')!.url).toBe('https://x.org/calls/')
  })

  it('an expired rule no longer applies', () => {
    const rules = [rule('https://x.org/a', 'PAGE', new Date('2026-01-01'))]
    expect(skipRuleFor(rules, 'https://x.org/a', new Date('2026-02-01'))).toBeNull()
    expect(skipRuleFor(rules, 'https://x.org/a', new Date('2025-12-01'))).not.toBeNull()
  })
})

describe('catalog import suggestions', () => {
  it('suggests the folder most call pages share, then the homepage', () => {
    const urls = [
      'https://grants.nih.gov/grants/guide/pa-files/PA-23-291.html',
      'https://grants.nih.gov/grants/guide/rfa-files/RFA-1.html',
      'https://grants.nih.gov/grants/guide/notice-files/NOT-2.html',
      'https://grants.nih.gov/funding/other.html',
    ]
    const suggestions = suggestWatchPages('grants.nih.gov', urls)
    expect(suggestions[0].url).toBe('https://grants.nih.gov/grants/guide/')
    expect(suggestions.at(-1)!.url).toBe('https://grants.nih.gov/')
    expect(new Set(suggestions.map((s) => s.url)).size).toBe(suggestions.length)
  })

  it('flags file stores, shared portals and a funder in the wrong country', () => {
    const funders = ['DE', 'IN', 'DE', 'DE', 'DE'].map((country, i) => ({ id: String(i), name: `F${i}`, country, type: null, calls: 1 }))
    const codes = websiteWarnings({ host: 'cdn.example.de', calls: 10, documents: 9, funders, sampleUrls: [] }).map((w) => w.code)
    expect(codes).toEqual(expect.arrayContaining(['FILE_HOST', 'SHARED_PORTAL', 'FUNDER_MISMATCH']))
    expect(websiteWarnings({ host: 'www.vr.se', calls: 50, documents: 0, funders: funders.slice(0, 1).map((f) => ({ ...f, country: 'SE' })), sampleUrls: [] })).toEqual([])
  })

  it('suggests cadence and priority from call volume', () => {
    expect(suggestedSettings({ calls: 249, liveCalls: 173, sampleUrls: [], host: 'a.org' })).toMatchObject({ frequencyMinutes: 1440, priority: 'HIGH' })
    expect(suggestedSettings({ calls: 4, liveCalls: 0, sampleUrls: ['https://cdn.a.org/x.pdf'], host: 'a.org' })).toMatchObject({ frequencyMinutes: 10080, priority: 'LOW', documentHosts: ['cdn.a.org'] })
  })
})

describe('site page tree', () => {
  const at = new Date('2026-10-24T00:00:00Z')
  const input: TreeInput = {
    sources: [{ id: 's1', name: 'NIH guide', url: 'https://grants.nih.gov/grants/guide/', kind: 'PAGE', status: 'ACTIVE', last_error: null, last_checked_at: at }],
    resources: [
      { id: 'listing', kind: 'PAGE', role: 'LISTING', canonical_url: 'https://grants.nih.gov/grants/guide', title: 'Guide', last_observed_at: at, last_validation_status: 'OK' },
      { id: 'call', kind: 'PAGE', role: 'CALL_PAGE', canonical_url: 'https://grants.nih.gov/grants/guide/rfa-1.html', title: 'RFA 1', last_observed_at: at, last_validation_status: 'OK' },
      { id: 'news', kind: 'PAGE', role: 'UNKNOWN', canonical_url: 'https://grants.nih.gov/grants/guide/news.html', title: 'News', last_observed_at: at, last_validation_status: 'OK' },
      { id: 'pdf', kind: 'DOCUMENT', role: 'DOCUMENT', canonical_url: 'https://grants.nih.gov/files/rfa-1.pdf', title: null, last_observed_at: at, last_validation_status: 'OK' },
    ],
    observations: [
      { source_id: 's1', resource_id: 'listing', anchor_text: null, missing_since: null },
      { source_id: 's1', resource_id: 'call', anchor_text: 'RFA 1', missing_since: null },
      { source_id: 's1', resource_id: 'news', anchor_text: 'News', missing_since: null },
    ],
    opportunities: [
      { id: 'o1', primary_resource_id: 'call', title: 'RFA 1', review_state: 'PENDING', processing_state: 'TRIAGED', triage_verdict: 'NEW_OPPORTUNITY', relevance_outcome: 'STRONG_POSITIVE', funding_call_id: null, created_at: at },
      { id: 'o2', primary_resource_id: 'news', title: 'News', review_state: 'NONE', processing_state: 'DONE', triage_verdict: 'NOT_FUNDING', relevance_outcome: 'UNCERTAIN', funding_call_id: null, created_at: at },
    ],
    evidence: [{ opportunity_id: 'o1', resource_id: 'pdf' }],
    frontier: [
      { id: 'f1', url: 'https://grants.nih.gov/', depth: 0, discovered_from: null, state: 'VISITED', visited_at: at },
      { id: 'f2', url: 'https://grants.nih.gov/about/', depth: 1, discovered_from: 'https://grants.nih.gov/', state: 'PENDING', visited_at: null },
    ],
    skipRules: [{ ...rule('https://grants.nih.gov/about/', 'FOLDER'), id: 'r1' }],
  }
  const nodes = buildSiteTree(input, at)
  const byUrl = (url: string) => nodes.find((n) => n.url === url)!

  it('puts the watched page at level 0 and what it lists at level 1', () => {
    expect(byUrl('https://grants.nih.gov/grants/guide/')).toMatchObject({ kind: 'WATCH_POINT', level: 0 })
    expect(byUrl('https://grants.nih.gov/grants/guide/rfa-1.html')).toMatchObject({ level: 1, parentId: 'source:s1' })
    // The listing resource is the watch point itself, not a child of it.
    expect(nodes.filter((n) => n.url === 'https://grants.nih.gov/grants/guide')).toHaveLength(0)
  })

  it('colours pages by what they led to', () => {
    expect(byUrl('https://grants.nih.gov/grants/guide/rfa-1.html').outcome).toBe('FUNDING_FOUND')
    expect(byUrl('https://grants.nih.gov/grants/guide/news.html').outcome).toBe('NOT_FUNDING')
  })

  it('hangs evidence documents under their call page, one level deeper', () => {
    expect(byUrl('https://grants.nih.gov/files/rfa-1.pdf')).toMatchObject({ kind: 'DOCUMENT', level: 2, parentId: 'resource:call' })
  })

  it('follows the crawler’s discovered-from links and shows don’t-visit marks', () => {
    const home = byUrl('https://grants.nih.gov/')
    const about = byUrl('https://grants.nih.gov/about/')
    expect(about.parentId).toBe(home.id)
    expect(about.level).toBe(home.level + 1)
    expect(about).toMatchObject({ outcome: 'SKIPPED', skipRuleId: 'r1' })
  })
})

describe('result labels say only what the pipeline knows', () => {
  const base = { review_state: 'PENDING', processing_state: 'TRIAGED', triage_verdict: 'NEW_OPPORTUNITY', triage_reason: null, relevance_outcome: 'STRONG_POSITIVE' }
  it('needs a positive, settled verdict for "funding found"', () => {
    expect(classifyOpportunity(base).outcome).toBe('FUNDING_FOUND')
    expect(classifyOpportunity({ ...base, processing_state: 'SCORED', triage_verdict: null }).outcome).toBe('SCREENING')
    expect(classifyOpportunity({ ...base, triage_verdict: 'UNSURE' }).outcome).toBe('UNSURE')
    expect(classifyOpportunity({ ...base, processing_state: 'SCORED', triage_reason: 'Waiting for laptop first-pass analysis; no paid screening has run.' }).outcome).toBe('WAITING_LOCAL')
  })
  it('splits unreadable pages from read-but-incomplete ones', () => {
    const needs = { ...base, processing_state: 'NEEDS_EVIDENCE', triage_verdict: 'NEEDS_EVIDENCE' }
    expect(classifyOpportunity(needs).outcome).toBe('INCOMPLETE')
    expect(classifyOpportunity({ ...needs, triage_reason: 'Detail evidence could not be read: timeout' }).outcome).toBe('UNREADABLE')
    expect(classifyOpportunity(needs, { last_validation_status: 'UNREACHABLE' }).outcome).toBe('UNREADABLE')
  })
})

describe('unchanged negative gate', () => {
  const versions = { policy: RELEVANCE_VERSION, prompt: TRIAGE_VERSION, fullHash: 'h1', title: 'Annual report', settings: 's1' }
  it('gates only an unchanged page judged not funding', () => {
    expect(unchangedNegative({ triage_verdict: 'NOT_FUNDING', review_state: 'NONE', decision_versions: versions }, { fullHash: 'h1', title: 'Annual report', settings: 's1' })).toBe(true)
    expect(unchangedNegative({ triage_verdict: 'NOT_FUNDING', review_state: 'NONE', decision_versions: versions }, { fullHash: 'h2', title: 'Annual report', settings: 's1' })).toBe(false)
    expect(unchangedNegative({ triage_verdict: 'NOT_FUNDING', review_state: 'NONE', decision_versions: versions }, { fullHash: 'h1', title: 'Annual report and grant call', settings: 's1' })).toBe(false)
    expect(unchangedNegative({ triage_verdict: 'NEW_OPPORTUNITY', review_state: 'PENDING', decision_versions: versions }, { fullHash: 'h1', title: 'Annual report', settings: 's1' })).toBe(false)
    expect(unchangedNegative({ triage_verdict: 'NEW_OPPORTUNITY', review_state: 'REJECTED', decision_versions: versions }, { fullHash: 'h1', title: 'Annual report', settings: 's1' })).toBe(true)
    expect(unchangedNegative({ triage_verdict: 'NOT_FUNDING', review_state: 'NONE', decision_versions: versions }, { fullHash: 'h1', title: 'Annual report', settings: 's2' })).toBe(false)
    expect(unchangedNegative({ triage_verdict: 'NOT_FUNDING', review_state: 'NONE', decision_versions: { ...versions, prompt: 'older' } }, { fullHash: 'h1', title: 'Annual report', settings: 's1' })).toBe(false)
  })
})

describe('adaptive scheduling', () => {
  it('stretches quiet listings within a week, never HIGH priority', () => {
    expect(adaptiveCadenceDays(1, 0, 'NORMAL', true)).toBe(1)
    expect(adaptiveCadenceDays(1, 4, 'NORMAL', true)).toBe(2)
    expect(adaptiveCadenceDays(3, 10, 'NORMAL', true)).toBe(7)
    expect(adaptiveCadenceDays(1, 20, 'HIGH', true)).toBe(1)
    expect(adaptiveCadenceDays(1, 20, 'NORMAL', false)).toBe(1)
  })
  it('spaces unchanged revisits, starts non-funding at 30 days, keeps deadline days', () => {
    expect(adaptiveRevisitDays(3, 0, false)).toBe(3)
    expect(adaptiveRevisitDays(3, 3, false)).toBe(24)
    expect(adaptiveRevisitDays(3, 0, true)).toBe(30)
    expect(adaptiveRevisitDays(3, 5, true)).toBe(90)
    expect(adaptiveRevisitDays(1, 5, true)).toBe(1)
  })
})
