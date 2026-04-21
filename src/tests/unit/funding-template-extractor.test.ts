import { describe, expect, it } from 'vitest'

import { coerceTemplateShape } from '@/lib/fundingTemplates/extractor'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'

describe('funding template extractor coercion', () => {
  it('preserves nested subsection headings from multi-column layouts', () => {
    const normalized = normalizeGrantTemplate(coerceTemplateShape({
      sections: [
        {
          label: 'Technical Proposal',
          type: 'section',
          workflowMode: 'app_draft',
          subsections: [
            {
              heading: 'Objectives of Proposed CoE',
              workflowMode: 'app_draft',
              questions: [
                {
                  label: 'Summary of the Proposal',
                  type: 'section',
                  workflowMode: 'app_draft',
                },
              ],
            },
          ],
          blocks: [
            {
              heading: 'Right Column Supporting Information',
              workflowMode: 'team_manual',
              items: [
                {
                  label: 'Principal Investigator Details',
                  type: 'field',
                  workflowMode: 'team_manual',
                },
                'Category Selection',
              ],
            },
          ],
        },
      ],
    }))

    expect(normalized.sections.map((item) => item.label)).toEqual(expect.arrayContaining([
      'Technical Proposal',
      'Objectives of Proposed CoE',
      'Summary of the Proposal',
      'Right Column Supporting Information',
    ]))
    expect(normalized.questions.map((item) => item.label)).toEqual(expect.arrayContaining([
      'Principal Investigator Details',
      'Category Selection',
    ]))
  })
})
