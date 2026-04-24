import { describe, expect, it } from 'vitest'

import {
  buildDraftValuesFromExtraction,
  normalizeDraftInput,
  normalizeExtractionPayload,
  validateFundingExtractionPayload,
} from '@/lib/fundingIntake/utils'

describe('funding intake normalization', () => {
  it('builds description deterministically from evidence-backed segments', () => {
    const payload = normalizeExtractionPayload(
      {
        fields: {
          agency_name: {
            value: 'Nordic Health Fund',
            status: 'supported',
            confidence: 0.95,
            evidence: [{ sourceType: 'segment', segmentId: 'seg_001', quote: 'Nordic Health Fund' }],
          },
          scheme_title: {
            value: 'Infection Prevention Grant',
            status: 'supported',
            confidence: 0.94,
            evidence: [{ sourceType: 'segment', segmentId: 'seg_001', quote: 'Infection Prevention Grant' }],
          },
          description: {
            value: 'hallucinated summary should be ignored',
            status: 'supported',
            confidence: 0.9,
            evidence: [
              {
                sourceType: 'segment',
                segmentId: 'seg_002',
                quote: 'Supports infection prevention pilots in hospitals.',
              },
              {
                sourceType: 'segment',
                segmentId: 'seg_003',
                quote: 'Projects must produce a final implementation report.',
              },
            ],
          },
        },
      },
      {
        segments: [
          { id: 'seg_001', heading: 'Call Title', text: 'Nordic Health Fund Infection Prevention Grant' },
          { id: 'seg_002', heading: 'Overview', text: 'Supports infection prevention pilots in hospitals.' },
          { id: 'seg_003', heading: 'Outputs', text: 'Projects must produce a final implementation report.' },
        ],
      }
    )

    expect(payload.fields.description.value).toBe(
      'Supports infection prevention pilots in hospitals.\n\nProjects must produce a final implementation report.'
    )
    expect(payload.summarySegments).toEqual(['seg_002', 'seg_003'])
  })

  it('keeps unsupported fields empty and does not infer disciplines', () => {
    const payload = normalizeExtractionPayload({
      fields: {
        agency_name: { value: 'PAR Foundation', status: 'supported', confidence: 1, evidence: [] },
        scheme_title: { value: 'Beyond Antibiotics 2026 Grant Call', status: 'supported', confidence: 1, evidence: [] },
        description: { value: null, status: 'unsupported', confidence: 0, evidence: [] },
        disciplines: { value: null, status: 'unsupported', confidence: 0, evidence: [] },
      },
    })

    const draft = buildDraftValuesFromExtraction(payload)

    expect(draft.disciplines).toEqual([])
  })

  it('derives official urls deterministically from source preparation metadata', () => {
    const payload = normalizeExtractionPayload({
      fields: {
        agency_name: { value: 'Agency', status: 'supported', confidence: 1, evidence: [] },
        scheme_title: { value: 'Call', status: 'supported', confidence: 1, evidence: [] },
        description: { value: null, status: 'unsupported', confidence: 0, evidence: [] },
      },
    })

    const draft = buildDraftValuesFromExtraction(payload, {
      sourceUrl: 'https://example.org/call',
      fetchedUrl: 'https://example.org/final-call',
    })

    expect(draft.official_urls).toEqual([
      'https://example.org/call',
      'https://example.org/final-call',
    ])
  })

  it('does not backfill disciplines during manual normalization', () => {
    const draft = normalizeDraftInput({
      agency_name: 'Clinical AI Foundation',
      scheme_title: 'Medical Imaging Acceleration Call',
      description: 'Funds artificial intelligence methods for medical imaging workflows.',
      disciplines: [],
    } as any)

    expect(draft.disciplines).toEqual([])
  })

  it('flags supported values that are missing evidence and allows ambiguous null fields', () => {
    const payload = normalizeExtractionPayload(
      {
        fields: {
          agency_name: {
            value: 'Agency',
            status: 'supported',
            confidence: 0.8,
            evidence: [],
          },
          scheme_title: {
            value: null,
            status: 'ambiguous',
            confidence: 0.7,
            evidence: [
              { sourceType: 'segment', segmentId: 'seg_001', quote: 'Call A' },
              { sourceType: 'segment', segmentId: 'seg_002', quote: 'Call B' },
            ],
          },
          description: {
            value: null,
            status: 'unsupported',
            confidence: 0,
            evidence: [],
          },
        },
      },
      {
        segments: [
          { id: 'seg_001', heading: null, text: 'Call A' },
          { id: 'seg_002', heading: null, text: 'Call B' },
        ],
      }
    )

    const issues = validateFundingExtractionPayload(payload, [
      { id: 'seg_001', heading: null, text: 'Call A' },
      { id: 'seg_002', heading: null, text: 'Call B' },
    ])

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'evidence_required',
          fieldKey: 'agency_name',
        }),
      ])
    )
    expect(issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'supported_field_missing_value',
          fieldKey: 'scheme_title',
        }),
      ])
    )
  })
})
