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
    expect(outcome('Over 7 million awarded to help AI boost growth', 'https://www.ukri.org/news/over-7-million-awarded/')).toBe('UNCERTAIN')
    expect(outcome('Nu kan du ansøge om støtte', 'https://novonordiskfonden.dk/nyheder/nu-kan-du-ansoege/')).toBe('UNCERTAIN')
    expect(outcome('Guidelines', 'https://example.org/media/2023-01-10/guidelines.pdf')).toBe('UNCERTAIN')
  })

  // From the laptop's own GENERAL verdicts (29 Oct 2026).
  it('drops building news, staff notices, people profiles and events the laptop judged general', () => {
    expect(outcome('54-Story Addition Proposed Above Toronto Model', 'https://verticalurbanism.org/news-article/54-story-addition-proposed-above-toronto-model/')).toBe('STRONG_NEGATIVE')
    expect(outcome('Purchase requisition-cum-Fund Booking Form', 'https://niepa.ac.in/download/staff_corner/2023/Sept/booking-form.pdf')).toBe('UNCERTAIN') // documents are always read
    expect(outcome('Office Order 01.09.2023', 'https://niepa.ac.in/download/staff_corner/2023/Sept/office-order')).toBe('STRONG_NEGATIVE')
    expect(outcome('isaac work', 'https://verticalurbanism.org/people-profile/isaac-work/')).toBe('STRONG_NEGATIVE')
    expect(outcome('wsp steel re use tool', 'https://verticalurbanism.org/resources/award-recipients/wsp-steel-re-use-tool/')).toBe('STRONG_NEGATIVE')
    // Title rules work on any address.
    expect(outcome('Houston condo hotel nears completion', 'https://example.org/stories/houston-condo')).toBe('STRONG_NEGATIVE')
    expect(outcome('CVU California kick off event', 'https://example.org/happenings/cvu-california')).toBe('STRONG_NEGATIVE')
  })

  it('keeps a page whose title or slug has a funding word, even inside a noise folder', () => {
    expect(outcome('Info session', 'https://www.nsf.gov/events/cybersecurity-innovation-cici-program')).toBe('UNCERTAIN')
    // A noise folder whose name contains "award" does not save a profile beneath it.
    expect(outcome('john m prausnitz', 'https://www.nsf.gov/honorary-awards/national-medal-science/recipients/john-m-prausnitz')).toBe('STRONG_NEGATIVE')
    // DFG publishes real calls under /aktuelles/ with no funding word in the address.
    expect(outcome('ifw 25 101', 'https://www.dfg.de/de/aktuelles/neuigkeiten-themen/info-wissenschaft/2025/ifw-25-101')).toBe('UNCERTAIN')
    // Circulars and notifications are how Indian agencies announce calls: never a title rule.
    expect(outcome('Circular regarding 14/04/2025', 'https://example.gov.in/notices/circular-14-04')).toBe('UNCERTAIN')
  })

  it('leaves an ordinary page with no funding word uncertain, as before', () => {
    expect(outcome('About the foundation', 'https://example.org/about')).toBe('UNCERTAIN')
  })
})
