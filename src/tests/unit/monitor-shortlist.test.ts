import { describe, expect, it } from 'vitest'

import { scoreShortlist, shortlistSkip } from '@/lib/monitor/relevance'

// Addresses taken from what production queued for the laptop on 29 Oct 2026.
const NOW = new Date('2026-10-29T00:00:00Z')
const shortlistReason = (title: string, url: string) => scoreShortlist(title, '', url, {}, false, NOW).reasons.join(' ')
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

  it('outside event, news and winner folders, never drops a page with a funding word, a source keyword, or a document', () => {
    expect(outcome('New call for proposals opens', 'https://www.ukri.org/news/new-call-opens/')).toBe('STRONG_POSITIVE')
    expect(outcome('Info session', 'https://www.nsf.gov/funding/info-session', false, 'Learn how to apply for the fellowship')).toBe('STRONG_POSITIVE')
    expect(outcome('Open day', 'https://example.org/events/open-day', false, '', ['open day'])).toBe('STRONG_POSITIVE')
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

  it('keeps a page whose title or slug has a funding word inside a people or archive folder', () => {
    expect(outcome('Programme lead', 'https://example.org/people/fellowship-programme-lead')).not.toBe('STRONG_NEGATIVE')
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

  // The 30 Oct 2026 link check: paid extraction ran on these, and none was an open call.
  it('drops event, news and winner pages even when they talk about funding', () => {
    expect(outcome('Faculty Early Career Development Program (CAREER)', 'https://www.nsf.gov/events/deb-virtual-office-hour-career-solicitation-0', false, 'funding opportunity, apply, deadline')).toBe('STRONG_NEGATIVE')
    expect(outcome('Funding Opportunities in GeoHealth', 'https://www.nsf.gov/events/geohealth-funding-opportunities-office-hour')).toBe('STRONG_NEGATIVE')
    expect(outcome('2025 10 09', 'https://www.nsf.gov/events/nsf-supplemental-funding-opportunities-expanding-k-12/2025-10-09')).toBe('STRONG_NEGATIVE')
    expect(outcome('AHRC welcomes significant DCMS funding for creative industries', 'https://www.ukri.org/news/ahrc-welcomes-significant-dcms-funding-for-creative-industries/')).toBe('STRONG_NEGATIVE')
    expect(outcome('Ernest Rutherford Fellowship', 'https://www.ukri.org/news/stfc-announces-latest-ernest-rutherford-fellows/')).toBe('STRONG_NEGATIVE')
    expect(outcome('Over 7 million awarded to help AI boost growth', 'https://www.ukri.org/news/over-7-million-awarded/')).toBe('STRONG_NEGATIVE')
    expect(outcome('Postdoc Fellowship for Research Abroad', 'https://novonordiskfonden.dk/nyheder/stipendier-sender-forskertalenter-til-foerende-institutioner/')).toBe('STRONG_NEGATIVE')
    expect(outcome('2019 International Research Seed Funding', 'https://verticalurbanism.org/competition-winner/2019-international-research-seed-funding/')).toBe('STRONG_NEGATIVE')
    expect(shortlistReason('Ernest Rutherford Fellowship', 'https://www.ukri.org/news/stfc-announces-latest-ernest-rutherford-fellows/')).toMatch(/does not say a call is open/)
  })

  it('still reads a news post that says the call is open, and documents in any folder', () => {
    expect(outcome('Take-off phase 2, autumn round 2026', 'https://www.nwo.nl/en/news/take-off-phase-2-autumn-round-2026-open-for-proposals')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Pre-announcement: BiodivFuture call opens on 9 September', 'https://www.nwo.nl/en/news/pre-announcement-biodivfuture-call-opens-on-9-september')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Final round of the Perspectief programme', 'https://www.nwo.nl/en/news/final-round-of-the-perspectief-programme-open-for-research-proposals')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Changes to the 2026 call Take-off phase 1', 'https://www.nwo.nl/en/news/changes-to-the-2026-call-take-off-phase-1')).not.toBe('STRONG_NEGATIVE')
    // DFG publishes the call itself in a calls folder under /news/.
    expect(outcome('Priority Programme "Net-Zero Concrete" (SPP 2436)', 'https://www.dfg.de/en/news/news-topics/announcements-proposals/2026/ifr-26-74')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Call open: Triple planetary crisis in the polar regions', 'https://www.nwo.nl/en/news/call-open-triple-planetary-crisis-in-the-polar-regions')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Nu kan du ansøge om støtte', 'https://novonordiskfonden.dk/nyheder/nu-kan-du-ansoege/')).toBe('UNCERTAIN')
    expect(outcome('Fellowship guidelines', 'https://example.org/news/2026/guidelines.pdf')).not.toBe('STRONG_NEGATIVE')
    // Real calls on the same sites, outside those folders.
    expect(outcome('Rubicon 2026-3', 'https://www.nwo.nl/en/calls/rubicon-2026-3')).not.toBe('STRONG_NEGATIVE')
    expect(outcome('Leslie Earl Robertson & SawTeen See Fellowship', 'http://verticalurbanism.org/competition/leslie-earl-robertson-sawteen-see-fellowship/')).not.toBe('STRONG_NEGATIVE')
  })
})
