import { describe, expect, it } from 'vitest'

import {
  buildGrantProposalDocxSections,
  GRANT_EXPORT_EMPTY_PLACEHOLDER,
} from '@/lib/grants/export'

describe('grant proposal DOCX section assembly', () => {
  it('includes all grant section ownership modes in section order with placeholders', () => {
    const result = buildGrantProposalDocxSections([
      {
        sectionKey: 'team_letters',
        label: 'Team Letters',
        sectionType: 'checklist',
        sectionOrder: 30,
        content: null,
        structuredResponses: [
          {
            fieldKey: 'structuredData',
            responseJson: {
              items: [{ label: 'Institutional commitment letter', completed: false, notes: '' }],
            },
          },
        ],
      },
      {
        sectionKey: 'technical_plan',
        label: 'Technical Plan',
        sectionType: 'narrative',
        sectionOrder: 10,
        content: 'AI generated technical plan.',
        structuredResponses: [],
      },
      {
        sectionKey: 'budget_justification',
        label: 'Budget Justification',
        sectionType: 'short_answer',
        sectionOrder: 20,
        content: 'Manual budget justification.',
        structuredResponses: [],
      },
    ])

    expect(result.sections.map((section) => section.key)).toEqual([
      'technical_plan',
      'budget_justification',
      'team_letters',
    ])
    expect(result.sections.map((section) => section.content)).toEqual([
      'AI generated technical plan.',
      'Manual budget justification.',
      GRANT_EXPORT_EMPTY_PLACEHOLDER,
    ])
    expect(result.emptySectionCount).toBe(1)
  })

  it('renders structured responses as readable bullets and tables instead of raw JSON', () => {
    const result = buildGrantProposalDocxSections([
      {
        sectionKey: 'attachments',
        label: 'Attachments',
        sectionType: 'checklist',
        sectionOrder: 1,
        content: null,
        structuredResponses: [
          {
            fieldKey: 'structuredData',
            responseJson: {
              items: [
                { label: 'CV', completed: true, notes: 'Uploaded by PI' },
                { label: 'Support letter', completed: false, notes: 'Pending co-PI signature' },
              ],
            },
          },
        ],
      },
      {
        sectionKey: 'budget',
        label: 'Budget',
        sectionType: 'budget_rows',
        sectionOrder: 2,
        content: null,
        structuredResponses: [
          {
            fieldKey: 'structuredData',
            responseJson: {
              columns: [
                { key: 'category', label: 'Category' },
                { key: 'amount', label: 'Amount' },
                { key: 'justification', label: 'Justification' },
              ],
              rows: [
                { category: 'Equipment', amount: '1000', justification: 'Prototype hardware' },
              ],
            },
          },
        ],
      },
    ])

    expect(result.sections[0].blocks?.[0]).toMatchObject({
      type: 'bullets',
      items: ['[x] CV - Uploaded by PI', '[ ] Support letter - Pending co-PI signature'],
    })
    expect(result.sections[1].blocks?.[0]).toMatchObject({
      type: 'table',
      headers: ['Category', 'Amount', 'Justification'],
      rows: [['Equipment', '1000', 'Prototype hardware']],
    })
    expect(result.sections.map((section) => section.content).join('\n')).not.toContain('{')
    expect(result.emptySectionCount).toBe(0)
  })

  it('renders budget template notes before the structured budget table', () => {
    const result = buildGrantProposalDocxSections([
      {
        sectionKey: 'budget',
        label: 'Budget',
        sectionType: 'budget_rows',
        sectionOrder: 1,
        content: null,
        structuredResponses: [
          {
            fieldKey: 'structuredData',
            responseJson: {
              notes: 'Use the funder-provided budget categories.',
              columns: [
                { key: 'category', label: 'Category' },
                { key: 'amount', label: 'Amount' },
              ],
              rows: [{ category: 'Equipment', amount: '1000' }],
            },
          },
        ],
      },
    ])

    expect(result.sections[0].blocks?.[0]).toMatchObject({
      type: 'paragraph',
      text: 'Use the funder-provided budget categories.',
    })
    expect(result.sections[0].blocks?.[1]).toMatchObject({
      type: 'table',
      headers: ['Category', 'Amount'],
      rows: [['Equipment', '1000']],
    })
  })

  it('treats category-only budget rows as unprepared for export', () => {
    const result = buildGrantProposalDocxSections([
      {
        sectionKey: 'budget',
        label: 'Budget',
        sectionType: 'budget_rows',
        sectionOrder: 1,
        content: null,
        structuredResponses: [
          {
            fieldKey: 'structuredData',
            responseJson: {
              notes: 'Use the funder-provided budget categories.',
              columns: [
                { key: 'category', label: 'Category', kind: 'category' },
                { key: 'amount', label: 'Amount', kind: 'amount' },
                { key: 'justification', label: 'Justification', kind: 'justification' },
              ],
              rows: [{ category: 'Equipment', amount: null, justification: '' }],
            },
          },
        ],
      },
    ])

    expect(result.sections[0].content).toBe(GRANT_EXPORT_EMPTY_PLACEHOLDER)
    expect(result.sections[0].blocks).toEqual([
      { type: 'paragraph', text: GRANT_EXPORT_EMPTY_PLACEHOLDER },
    ])
    expect(result.emptySectionCount).toBe(1)
  })
})
