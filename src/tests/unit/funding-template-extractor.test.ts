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
          templateIntent: 'methodology',
          templateIntentAlternates: ['workplan'],
          templateIntentConfidence: 0.92,
          subsections: [
            {
              heading: 'Objectives of Proposed CoE',
              workflowMode: 'app_draft',
              templateIntent: 'objectives',
              questions: [
                {
                  label: 'Summary of the Proposal',
                  type: 'section',
                  workflowMode: 'app_draft',
                  templateIntent: 'summary',
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
    expect(normalized.sections.find((item) => item.label === 'Technical Proposal')?.templateIntent).toBe('methodology')
    expect(normalized.sections.find((item) => item.label === 'Technical Proposal')?.templateIntentAlternates).toEqual(['workplan'])
    expect(normalized.sections.find((item) => item.label === 'Objectives of Proposed CoE')?.templateIntent).toBe('objectives')
    expect(normalized.sections.find((item) => item.label === 'Summary of the Proposal')?.templateIntent).toBe('summary')
  })

  it('normalizes budget table columns, categories, and non-UUID source anchors', () => {
    const normalized = normalizeGrantTemplate(coerceTemplateShape({
      budgetTable: {
        required: true,
        yearWise: true,
        columns: [
          { label: 'Budget Head', sourceAnchors: [{ asset_id: 'cm_template_asset_1' }] },
          { label: 'Year 1 Amount' },
          { label: 'Justification' },
        ],
        categories: [
          {
            label: 'Equipment',
            cap: 'Up to 30%',
            notes: 'Only project-specific equipment.',
            sourceAnchors: [{ asset_id: 'cm_template_asset_1', quote: 'Equipment' }],
          },
        ],
        sourceAnchors: [{ asset_id: 'cm_template_asset_1' }],
      },
    }))

    expect(normalized.budget?.columns?.map((column) => column.key)).toEqual([
      'budget_head',
      'year_1_amount',
      'justification',
    ])
    expect(normalized.budget?.columns?.[0].kind).toBe('category')
    expect(normalized.budget?.categories).toMatchObject([
      { key: 'equipment', label: 'Equipment', cap: 'Up to 30%' },
    ])
    expect(normalized.budget?.sourceAnchors[0].asset_id).toBe('cm_template_asset_1')
    expect(normalized.budget?.categories[0].sourceAnchors[0].asset_id).toBe('cm_template_asset_1')
  })
})
