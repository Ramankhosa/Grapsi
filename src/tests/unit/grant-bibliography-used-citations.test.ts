import { describe, expect, it } from 'vitest'

import {
  collectUsedGrantCitationKeysForBibliography,
  countUsedGrantCitationKeysForBibliography,
} from '@/lib/grants/bibliography'

describe('grant bibliography used citation extraction', () => {
  it('collects only grant section citation markers in first-use order', () => {
    const used = collectUsedGrantCitationKeysForBibliography(
      [
        {
          sectionKey: 'summary',
          content: 'The proposal builds on [CITE:Smith2024; Lee2023] and later [CITE:smith2024].',
        },
        {
          sectionKey: 'budget',
          structuredResponses: [
            {
              responseJson: {
                rows: [
                  { item: 'Dataset access justified by [CITE:Budget2022]' },
                ],
              },
            },
          ],
        },
        {
          sectionKey: 'bibliography',
          content: 'Stale bibliography entry with [CITE:Unused2020].',
        },
      ],
      ['Smith2024', 'Lee2023', 'Budget2022', 'Unused2020']
    )

    expect(used).toEqual(['Smith2024', 'Lee2023', 'Budget2022'])
  })

  it('counts repeated grant citation occurrences without counting bibliography content', () => {
    const counts = countUsedGrantCitationKeysForBibliography(
      [
        {
          sectionKey: 'summary',
          content: '[CITE:Smith2024] repeated later as [CITE:smith2024]. [CITE:Lee2023]',
        },
        {
          sectionKey: 'bibliography',
          content: '[CITE:Smith2024] should not add another count.',
        },
      ],
      ['Smith2024', 'Lee2023']
    )

    expect(counts).toEqual({
      smith2024: 2,
      lee2023: 1,
    })
  })
})
