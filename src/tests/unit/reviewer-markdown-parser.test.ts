import { describe, expect, it } from 'vitest'

import {
  MarkdownParserService,
  extractTextFromHTML,
  htmlToMarkdown,
} from '../../../lib/services/markdownParserService'

describe('reviewer markdown parser fallback', () => {
  it('extracts readable text from the imported reviewer rich editor HTML', () => {
    expect(
      extractTextFromHTML(
        '<p>Budget&nbsp;&amp;&nbsp;impact</p><ul><li>Milestone &lt;A&gt;</li></ul>'
      )
    ).toBe('Budget & impact\n- Milestone <A>')
  })

  it('keeps parser fallback output stable without optional donor dependencies', async () => {
    expect(htmlToMarkdown('<div>Plain&nbsp;text</div>')).toBe('Plain text')

    const parser = new MarkdownParserService()
    await expect(parser.parseMarkdown('  Funding details  ')).resolves.toEqual({
      agencyName: '',
      schemeTitle: '',
      description: 'Funding details',
      countryAvailability: [],
      eligibleApplicantCountries: [],
      applicantTypes: [],
      grantTypes: [],
      researchAreas: [],
      urls: [],
    })
  })
})
