import { describe, expect, it } from 'vitest'

import {
  buildDraftValuesFromExtraction,
  normalizeDraftInput,
  normalizeExtractionPayload,
} from '@/lib/fundingIntake/utils'

describe('funding intake normalization', () => {
  it('sanitizes malformed scalar objects into usable draft values', () => {
    const payload = normalizeExtractionPayload({
      fields: {
        agency_name: { value: 'Nordic Health Fund', confidence: 1 },
        scheme_title: { value: 'Infection Prevention Grant', confidence: 1 },
        description: { value: 'Supports infection prevention pilots.', confidence: 1 },
        funder_country: { value: { country: 'Sweden', code: 'SE' }, confidence: 0.9 },
        sponsor_type: { value: { label: 'Foundation' }, confidence: 0.8 },
        expected_deliverables_text: {
          value: { summary: 'Toolkit and final report', bullets: ['Toolkit', 'Report'] },
          confidence: 0.7,
        },
        funding_kinds: { value: [{ label: 'Research Grant' }, 'Seed Grant'], confidence: 0.8 },
        official_urls: {
          value: [{ href: 'https://example.org/call' }, { url: 'https://example.org/faq' }],
          confidence: 0.8,
        },
      },
    })

    const draft = buildDraftValuesFromExtraction(payload)

    expect(draft.funder_country).toBe('Sweden')
    expect(draft.sponsor_type).toBe('Foundation')
    expect(draft.expected_deliverables_text).toBe('Toolkit and final report')
    expect(draft.funding_kinds).toEqual(['Research Grant', 'Seed Grant'])
    expect(draft.official_urls).toEqual(['https://example.org/call', 'https://example.org/faq'])
  })

  it('derives research-area tags when disciplines are empty but the topic is explicit', () => {
    const payload = normalizeExtractionPayload({
      fields: {
        agency_name: { value: 'PAR Foundation', confidence: 1 },
        scheme_title: { value: 'Beyond Antibiotics 2026 Grant Call', confidence: 1 },
        description: {
          value:
            'Supports preventive strategies that reduce antimicrobial resistance and prevent infections.',
          confidence: 1,
        },
        disciplines: { value: null, confidence: 0, is_missing: true },
      },
    })

    const draft = buildDraftValuesFromExtraction(payload)

    expect(draft.disciplines).toEqual(
      expect.arrayContaining(['Antimicrobial Resistance', 'Infectious Disease'])
    )
  })

  it('applies the same fallback discipline enrichment during manual normalization', () => {
    const draft = normalizeDraftInput({
      agency_name: 'Clinical AI Foundation',
      scheme_title: 'Medical Imaging Acceleration Call',
      description: 'Funds artificial intelligence methods for medical imaging workflows.',
      disciplines: [],
    } as any)

    expect(draft.disciplines).toEqual(
      expect.arrayContaining(['Artificial Intelligence', 'Medical Imaging'])
    )
  })
})
