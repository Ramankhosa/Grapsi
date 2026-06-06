import { beforeEach, describe, expect, it, vi } from 'vitest'

const citationStyleMocks = vi.hoisted(() => ({
  getCitationStyle: vi.fn(),
  formatInTextCitation: vi.fn(),
}))

vi.mock('@/lib/services/citation-style-service', () => ({
  citationStyleService: citationStyleMocks,
}))

import { formatGrantProposalDocxCitations } from '@/lib/grants/exportCitationFormatting'

const citations = [
  {
    id: 'citation-smith',
    title: 'Workforce resilience',
    authors: ['Jane Smith'],
    year: 2024,
    citationKey: 'Smith2024',
  },
  {
    id: 'citation-lee',
    title: 'AI labor policy',
    authors: ['Alex Lee'],
    year: 2023,
    citationKey: 'Lee2023',
  },
]

describe('grant DOCX citation formatting', () => {
  beforeEach(() => {
    citationStyleMocks.getCitationStyle.mockReset()
    citationStyleMocks.formatInTextCitation.mockReset()
    citationStyleMocks.getCitationStyle.mockImplementation(async (code: string) => ({
      code: String(code || 'APA7').toUpperCase(),
    }))
    citationStyleMocks.formatInTextCitation.mockImplementation(async (citation: any, styleCode: string, options: any) => {
      if (String(styleCode).toUpperCase() === 'IEEE') {
        return `[${options?.citationNumber || 1}]`
      }
      const lastName = String(citation.authors?.[0] || 'Anonymous').split(/\s+/).pop()
      return `(${lastName}, ${citation.year || 'n.d.'})`
    })
  })

  it('replaces raw grant citation markers in paragraphs, bullets, and tables', async () => {
    const sections = await formatGrantProposalDocxCitations({
      styleCode: 'APA7',
      citations,
      sections: [
        {
          key: 'technical_plan',
          title: 'Technical Plan',
          content: '',
          blocks: [
            { type: 'paragraph', text: 'The project is grounded in prior work [CITE:Smith2024].' },
            { type: 'bullets', items: ['Evidence base [CITE:Lee2023].'] },
            {
              type: 'table',
              headers: ['Claim', 'Source'],
              rows: [['Workforce transition', '[CITE:Smith2024]']],
            },
          ],
        },
      ],
    })

    expect(sections[0].content).not.toContain('[CITE:')
    expect(sections[0].content).toContain('(Smith, 2024)')
    expect(sections[0].content).toContain('(Lee, 2023)')
    expect(sections[0].blocks?.[2]).toMatchObject({
      type: 'table',
      rows: [['Workforce transition', '(Smith, 2024)']],
    })
  })

  it('uses grant document order for numeric citation styles', async () => {
    const sections = await formatGrantProposalDocxCitations({
      styleCode: 'IEEE',
      citations,
      sections: [
        {
          key: 'need',
          title: 'Need',
          content: 'First citation [CITE:Lee2023].',
        },
        {
          key: 'approach',
          title: 'Approach',
          content: 'Second citation [CITE:Smith2024] and repeat [CITE:Lee2023].',
        },
      ],
    })

    expect(sections[0].content).toBe('First citation [1].')
    expect(sections[1].content).toBe('Second citation [2] and repeat [1].')
    expect(citationStyleMocks.formatInTextCitation).toHaveBeenCalledWith(
      expect.objectContaining({ citationKey: 'Lee2023' }),
      'IEEE',
      expect.objectContaining({
        citationNumber: 1,
        citationNumbering: { Lee2023: 1, Smith2024: 2 },
      })
    )
    expect(citationStyleMocks.formatInTextCitation).toHaveBeenCalledWith(
      expect.objectContaining({ citationKey: 'Smith2024' }),
      'IEEE',
      expect.objectContaining({
        citationNumber: 2,
        citationNumbering: { Lee2023: 1, Smith2024: 2 },
      })
    )
  })
})
