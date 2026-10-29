import { describe, expect, it } from 'vitest'

import { scoreShortlist, shortlistSkip } from '@/lib/monitor/relevance'

// Addresses taken from what production queued for the laptop on 29 Oct 2026.
const NOW = new Date('2026-10-29T00:00:00Z')
const outcome = (title: string, url: string, onlyInSitemaps = false, context = '', include: string[] = []) =>
  scoreShortlist(title, context, url, { include }, onlyInSitemaps, NOW).outcome

describe('shortlist rules', () => {
  it('drops event, news, people and archive pages with no funding word', () => {
    expect(outcome('john m prausnitz', 'https://www.nsf.gov/honorary-awards/national-medal-science/recipients/john-m-prausnitz')).toBe('STRONG_NEGATIVE')
    expect(outcome('leaps mps webinar 0', 'https://www.nsf.gov/events/leaps-mps-webinar-0')).toBe('STRONG_NEGATIVE')
    expect(outcome('Ny viden om diabetes', 'https://novonordiskfonden.dk/nyheder/ny-viden-om-diabetes/')).toBe('STRONG_NEGATIVE')
    expect(outcome('Projekt 123', 'https://www.fwf.ac.at/forschungsradar/10.55776/P12345')).toBe('STRONG_NEGATIVE')
  })

  it('drops dated pages from before last year, keeps last year and this year', () => {
    expect(shortlistSkip('https://www.nsf.gov/x/dms-virtual-office-hours-14/2021-05-14', false, NOW)).toBe('OLD_DATED_PAGE')
    expect(shortlistSkip('https://example.org/2024/03/annual-report', false, NOW)).toBe('OLD_DATED_PAGE')
    expect(shortlistSkip('https://example.org/x/2025-08-05', false, NOW)).toBeNull()
    expect(shortlistSkip('https://example.org/x/2026-05-14', false, NOW)).toBeNull()
  })

  it('keeps only funding-looking addresses from a sitemap', () => {
    expect(outcome('updates', 'https://www.nsf.gov/edu/updates', true)).toBe('STRONG_NEGATIVE')
    expect(outcome('grfp nsf graduate research', 'https://www.nsf.gov/funding/opportunities/grfp-nsf-graduate-research', true)).toBe('STRONG_POSITIVE')
    expect(shortlistSkip('https://www.dfg.de/de/foerderung/programme/einzelfoerderung', true, NOW)).toBeNull()
    expect(shortlistSkip('https://www.sls.se/utlysningar/forskningsanslag', true, NOW)).toBeNull()
    // The same unremarkable page found on a listing is still read.
    expect(outcome('updates', 'https://www.nsf.gov/edu/updates', false)).toBe('UNCERTAIN')
  })

  it('never drops a page with a funding word, a source keyword, or a document', () => {
    expect(outcome('New call for proposals opens', 'https://www.ukri.org/news/new-call-opens/')).toBe('STRONG_POSITIVE')
    expect(outcome('Info session', 'https://www.nsf.gov/events/info-session', false, 'Learn how to apply for the fellowship')).toBe('STRONG_POSITIVE')
    expect(outcome('Open day', 'https://example.org/events/open-day', false, '', ['open day'])).toBe('STRONG_POSITIVE')
    expect(outcome('Guidelines', 'https://example.org/media/2023-01-10/guidelines.pdf')).toBe('UNCERTAIN')
  })

  it('leaves an ordinary page with no funding word uncertain, as before', () => {
    expect(outcome('About the foundation', 'https://example.org/about')).toBe('UNCERTAIN')
  })
})
