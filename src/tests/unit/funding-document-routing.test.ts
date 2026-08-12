import { describe, expect, it } from 'vitest'

import { GUIDELINE_SECTION_TYPES, TEMPLATE_SECTION_TYPES } from '@/lib/fundingDocuments/constants'
import { composeRoutedSectionText, type RoutedSectionLike } from '@/lib/fundingDocuments/sectionRouting'
import { runFundingDocumentQualityChecks } from '@/lib/fundingDocuments/qualityChecks'

function section(overrides: Partial<RoutedSectionLike>): RoutedSectionLike {
  return {
    id: overrides.id || `sec-${Math.random().toString(36).slice(2)}`,
    document_id: overrides.document_id || 'doc-1',
    section_type: overrides.section_type || 'other',
    section_title: overrides.section_title ?? null,
    section_text: overrides.section_text ?? 'Body text',
    classification_method: overrides.classification_method || 'heading',
    order_index: overrides.order_index ?? 0,
  }
}

describe('composeRoutedSectionText', () => {
  it('keeps only sections whose type is relevant', () => {
    const composed = composeRoutedSectionText(
      [
        section({ id: 'a', section_type: 'eligibility', section_title: 'Who can apply', section_text: 'Faculty only.' }),
        section({ id: 'b', section_type: 'overview', section_text: 'About the scheme.' }),
        section({ id: 'c', section_type: 'budget_rules', section_text: 'Max 50 lakh.' }),
      ],
      GUIDELINE_SECTION_TYPES
    )

    expect(composed.usedSectionIds).toEqual(['a', 'c'])
    expect(composed.usedAllSections).toBe(false)
    expect(composed.text).toContain('## Who can apply')
    expect(composed.text).toContain('Faculty only.')
    expect(composed.text).not.toContain('About the scheme.')
    expect(composed.usedSectionTypes.sort()).toEqual(['budget_rules', 'eligibility'])
  })

  it('falls back to every section when nothing was confidently classified as relevant', () => {
    const composed = composeRoutedSectionText(
      [
        section({ id: 'a', section_type: 'other', section_text: 'Page one text.' }),
        section({ id: 'b', section_type: 'eligibility', classification_method: 'fallback', section_text: 'Maybe eligibility.' }),
      ],
      GUIDELINE_SECTION_TYPES
    )

    expect(composed.usedAllSections).toBe(true)
    expect(composed.usedSectionIds).toEqual(['a', 'b'])
    expect(composed.text).toContain('Page one text.')
  })

  it('labels contributions per document when several documents contribute', () => {
    const labels = new Map([
      ['doc-1', 'call.pdf (v1)'],
      ['doc-2', 'annexure.pdf (v2)'],
    ])
    const composed = composeRoutedSectionText(
      [
        section({ id: 'a', document_id: 'doc-1', section_type: 'eligibility', section_text: 'Rule A.' }),
        section({ id: 'b', document_id: 'doc-2', section_type: 'budget_rules', section_text: 'Rule B.' }),
      ],
      GUIDELINE_SECTION_TYPES,
      { documentLabels: labels }
    )

    expect(composed.text).toContain('# Source: call.pdf (v1)')
    expect(composed.text).toContain('# Source: annexure.pdf (v2)')
    expect(composed.usedDocumentIds.sort()).toEqual(['doc-1', 'doc-2'])
  })

  it('truncates at maxChars and reports it', () => {
    const composed = composeRoutedSectionText(
      [section({ id: 'a', section_type: 'eligibility', section_text: 'x'.repeat(500) })],
      GUIDELINE_SECTION_TYPES,
      { maxChars: 100 }
    )
    expect(composed.truncated).toBe(true)
    expect(composed.text.length).toBe(100)
  })

  it('skips empty sections entirely', () => {
    const composed = composeRoutedSectionText(
      [
        section({ id: 'a', section_type: 'eligibility', section_text: '   ' }),
        section({ id: 'b', section_type: 'budget_rules', section_text: 'Real content.' }),
      ],
      TEMPLATE_SECTION_TYPES
    )
    expect(composed.usedSectionIds).toEqual(['b'])
  })
})

describe('kind-aware quality checks', () => {
  const call = {
    open_date: null,
    close_date: new Date('2026-12-31'),
    is_rolling: false,
    amount_min: 100000,
    amount_max: 500000,
    is_active: true,
  } as any

  const conflictingSections = [
    {
      sectionType: 'important_dates',
      sectionTitle: 'Dates',
      sectionText: 'Applications close 15 March 2026. This call is closed.',
      startPage: 1,
      endPage: 1,
      orderIndex: 0,
      confidence: 0.9,
      classificationMethod: 'heading',
    },
  ] as any[]

  it('keeps conflicts for the main call document', () => {
    const report = runFundingDocumentQualityChecks(call, conflictingSections)
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(report.needsManualReview).toBe(true)
  })

  it('downgrades conflicts and presence warnings for template documents', () => {
    const report = runFundingDocumentQualityChecks(call, conflictingSections, {
      documentKind: 'template_document',
    })
    expect(report.conflicts).toEqual([])
    expect(report.flags.every((flag) => flag.severity === 'info')).toBe(true)
    expect(report.needsManualReview).toBe(false)
  })

  it('keeps conflicts but relaxes presence expectations for guideline documents', () => {
    const report = runFundingDocumentQualityChecks(call, conflictingSections, {
      documentKind: 'guideline_document',
    })
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(report.flags.some((flag) => flag.code.startsWith('missing_') && flag.severity === 'warning')).toBe(false)
  })
})
