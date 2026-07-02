import { describe, expect, it } from 'vitest'

import { __icmrTestables } from '@/lib/publicProjects/connectors/icmr'
import { __prismTestables } from '@/lib/publicProjects/connectors/prism'
import { buildPublicProjectEmbeddingInput } from '@/lib/publicProjects/service'

describe('public project corpus helpers', () => {
  it('builds the labelled retrieval embedding document with the required fallback order', () => {
    expect(
      buildPublicProjectEmbeddingInput({
        title: 'Low-cost biosensor platform',
        abstractText: 'Abstract text',
        executiveSummary: 'Executive summary text',
        objectivesText: 'Objective text',
      })
    ).toBe('Title: Low-cost biosensor platform\nAbstract: Abstract text')

    expect(
      buildPublicProjectEmbeddingInput({
        title: 'Low-cost biosensor platform',
        abstractText: '',
        executiveSummary: 'Executive summary text',
        objectivesText: 'Objective text',
      })
    ).toBe('Title: Low-cost biosensor platform\nAbstract: Executive summary text')

    expect(
      buildPublicProjectEmbeddingInput({
        title: 'Low-cost biosensor platform',
        abstractText: null,
        executiveSummary: null,
        objectivesText: 'Objective text',
      })
    ).toBe('Title: Low-cost biosensor platform\nAbstract: Objective text')
  })

  it('keeps contact details out of the embedding input contract', () => {
    const input = buildPublicProjectEmbeddingInput({
      title: 'Project with PI contact',
      abstractText: 'Scientific summary only',
      executiveSummary: null,
      objectivesText: null,
    } as any)

    expect(input).toContain('Scientific summary only')
    expect(input).not.toContain('@')
    expect(input).not.toContain('phone')
  })

  it('uses title-only embedding input for sources with NA abstracts', () => {
    expect(
      buildPublicProjectEmbeddingInput({
        sourceKey: 'BIRAC',
        title: 'BIRAC supported project title',
        abstractText: 'NA',
        executiveSummary: null,
        objectivesText: null,
      } as any)
    ).toBe('Title: BIRAC supported project title')

    expect(
      buildPublicProjectEmbeddingInput({
        sourceKey: 'ICMR',
        title: 'ICMR approved project title',
        abstractText: 'NA',
        executiveSummary: null,
        objectivesText: null,
      } as any)
    ).toBe('Title: ICMR approved project title')
  })

  it('parses ICMR approved-project PDF text blocks', () => {
    const rows = __icmrTestables.parseIcmrPdfRows(
      `
      Detail of Projects
      S.no.
      1
      Principal Investigator
      Funded by
      Date of approval
      Total budget
      Duration
      Subject area
      Effectiveness of cell phone counseling to improve breast feeding indicators
      Dr. Archana Patel
      Professor,
      Indira Gandhi Government Medical College, Central Avenue Road,
      Nagpur-440018
      Alive and Thrive Small Grants Program through
      Bill & Melinda Gates Foundation, USA
      18 Months
      Rs 44, 99,002
      Reproductive Health
      June 8, 2010
      `,
      {
        pdfId: 'Vol_II',
        label: 'January 2008-December 2012',
        url: 'https://www.icmr.gov.in/example.pdf',
      }
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].title).toContain('cell phone counseling')
    expect(rows[0].principalInvestigator).toBe('Dr. Archana Patel')
    expect(rows[0].fundedBy).toContain('Bill & Melinda Gates Foundation')
    expect(rows[0].duration).toBe('18 Months')
    expect(rows[0].totalBudget).toBe('Rs 44, 99,002')
    expect(rows[0].subjectArea).toBe('Reproductive Health')
    expect(rows[0].dateOfApproval).toBe('June 8, 2010')
    expect(__icmrTestables.parseBudgetAmount(rows[0].totalBudget)).toBe('4499002')
    expect(__icmrTestables.parseDurationMonths(rows[0].duration)).toBe(18)
  })

  it('normalizes PRISM states and stable source record keys', () => {
    expect(
      __prismTestables.toStateArray({
        data: [{ stateName: 'Punjab' }, { STATE_NAME: 'DELHI' }, 'punjab'],
      })
    ).toEqual(['PUNJAB', 'DELHI'])

    expect(__prismTestables.buildSourceRecordKey('legacy', '12345')).toBe('PRISM:legacy:12345')
  })

  it('detects PRISM legacy listings and parses listing budgets', () => {
    expect(__prismTestables.isLegacyListing({ onlineOffline: 'Offline' })).toBe(true)
    expect(__prismTestables.isLegacyListing({ onlineOffline: 'Online' })).toBe(false)
    expect(__prismTestables.parseBudget('₹ 12,34,567.50')).toBe('1234567.50')
  })
})
