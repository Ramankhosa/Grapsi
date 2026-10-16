import { describe, expect, it } from 'vitest'

import { enrichmentGate, findDocumentLinks, guidelineItemCount, titleOverlap } from '@/lib/fundingCatalogImport/enrich'

const PAGE = 'https://www.example-foundation.org/grants/career-development-award'

describe('enrichment document links', () => {
  it('keeps call documents on the same site and drops site furniture', () => {
    const html = `
      <main>
        <a href="/docs/2027-career-development-award-guidelines.pdf">Application guidelines</a>
        <a href="https://files.example-foundation.org/forms/budget-template.docx">Budget form</a>
        <a href="/docs/annual-report-2025.pdf">Annual report</a>
        <a href="https://other-site.org/guidelines.pdf">Partner guidelines</a>
        <a href="/docs/random.pdf">Download</a>
      </main>
      <footer><a href="/legal/california-transparency-supply-chains-act.pdf">Supply chains</a></footer>`
    expect(findDocumentLinks(html, PAGE, 'Career Development Award (Marfan syndrome | worldwide)')).toEqual([
      'https://www.example-foundation.org/docs/2027-career-development-award-guidelines.pdf',
      'https://files.example-foundation.org/forms/budget-template.docx',
    ])
  })
})

describe('enrichment gate', () => {
  it('measures how much of the title the page mentions, ignoring the bracketed facets', () => {
    expect(titleOverlap('Career Development Award (Marfan syndrome | worldwide)', 'Our Career Development scheme...')).toBe(1)
    expect(titleOverlap('Pioneer SCA3 Translational Research Awards (ataxia)', 'Welcome to our foundation home page')).toBe(0)
  })

  it('counts rules in a guideline pack', () => {
    expect(guidelineItemCount({ eligibility: ['PhD required', 'Based in the EU'], documents: [{ name: 'CV' }, { name: 'Budget' }], notes: 'x' })).toBe(4)
    expect(guidelineItemCount(null)).toBe(0)
  })

  it('passes only a page about this call, on its own site, with enough rules', () => {
    const base = { title: 'Career Development Award', pageText: 'Career Development Award. '.repeat(80), pageHost: 'www.example.org', officialHost: 'example.org', documents: 1, guidelineItems: 8 }
    expect(enrichmentGate(base)).toEqual([])
    expect(enrichmentGate({ ...base, pageHost: 'login.othersite.com' })).toContain('page redirected to another site')
    expect(enrichmentGate({ ...base, pageText: 'Welcome. '.repeat(400) }).join(' ')).toMatch(/title overlap/)
    expect(enrichmentGate({ ...base, pageText: 'Career Development Award', documents: 0 }).join(' ')).toMatch(/too short/)
    expect(enrichmentGate({ ...base, guidelineItems: 2 }).join(' ')).toMatch(/too few guideline rules/)
  })
})
