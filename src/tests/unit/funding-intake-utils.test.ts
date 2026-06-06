import { describe, expect, it } from 'vitest'

import {
  assertSafePublicHttpsUrl,
  buildDraftValuesFromExtraction,
  normalizeDraftInput,
  normalizeExtractionPayload,
  validateFundingExtractionPayload,
} from '@/lib/fundingIntake/utils'
import { prepareFundingJsonIntake } from '@/lib/fundingIntake/jsonIngestion'
import { parseCoreExtractorPayload } from '@/lib/fundingIntake/coreExtractionPayload'

describe('funding intake normalization', () => {
  it('allows http and https URL intake schemes while rejecting non-web protocols', async () => {
    await expect(assertSafePublicHttpsUrl('http://localhost:3010/call')).resolves.toMatchObject({
      protocol: 'http:',
      hostname: 'localhost',
    })
    await expect(assertSafePublicHttpsUrl('https://localhost:3010/call')).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'localhost',
    })
    await expect(assertSafePublicHttpsUrl('ftp://example.org/call')).rejects.toThrow(
      'Only http and https URLs are allowed'
    )
  })

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

  it('prepares uploaded JSON into call, template, and guideline artifacts', () => {
    const prepared = prepareFundingJsonIntake({
      schema_version: 'funding_intake_json_v1',
      call: {
        fields: {
          agency_name: 'Global Research Fund',
          scheme_title: 'AI for Health Call',
          description: 'Funds applied AI health research pilots.',
          close_date: '2026-09-30',
        },
      },
      template: {
        grant_template_json: {
          questions: [
            {
              key: 'project_summary',
              label: 'Project Summary',
              type: 'field',
              workflowMode: 'app_draft',
              required: true,
              templateIntent: 'summary',
              sourceAnchors: [{ asset_id: 'not-a-uuid', quote: 'ignored' }],
            },
          ],
          sections: [],
          budget: null,
          attachments: [],
          evaluationCriteria: [],
          submissionRules: { notes: null, items: [], sourceAnchors: [] },
          sourceAnchors: [],
          mergeConflicts: [],
        },
      },
      guidelines: {
        guideline_pack_json: {
          priorities: [
            {
              key: 'alignment',
              text: 'Show alignment with AI for health priorities.',
              importance: 'high',
              confidence: 0.9,
              sourceAnchors: [],
            },
          ],
        },
      },
    })

    expect(prepared.draftValues.agency_name).toBe('Global Research Fund')
    expect(prepared.draftValues.description).toBe('Funds applied AI health research pilots.')
    expect(prepared.template?.questions[0]?.key).toBe('project_summary')
    expect(prepared.template?.questions[0]?.sourceAnchors).toEqual([])
    expect(prepared.guidelinePack?.priorities[0]?.text).toContain('AI for health')
    expect(prepared.metadata.has_template).toBe(true)
    expect(prepared.metadata.has_guidelines).toBe(true)
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

  it('coerces recoverable LLM field-shape drift before strict parsing', () => {
    const parsed = parseCoreExtractorPayload(JSON.stringify({
      fields: {
        agency_name: {
          value: ['Lung Cancer Research Foundation'],
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_001', quote: ['Lung Cancer Research Foundation'] }],
        },
        scheme_title: {
          value: 'LCRF OUCH-I RFP',
          status: 'supported',
          confidence: 0.9,
          evidence: [{ sourceType: 'segment', segmentId: 'seg_001', quote: 'LCRF OUCH-I RFP' }],
        },
        description: {
          value: ['Funds research on lung cancer.', 'Supports investigator-initiated proposals.'],
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_002', quote: ['Funds research on lung cancer.'] }],
        },
        amount_min: null,
      },
      warnings: [],
    }))

    expect(parsed.fields.agency_name.value).toBe('Lung Cancer Research Foundation')
    expect(parsed.fields.description.value).toBe(
      'Funds research on lung cancer.\nSupports investigator-initiated proposals.'
    )
    expect(parsed.fields.amount_min).toMatchObject({
      value: null,
      status: 'unsupported',
      confidence: 0,
      evidence: [],
    })
  })

  it('parses expanded core extraction fields used by funding search and embeddings', () => {
    const parsed = parseCoreExtractorPayload(JSON.stringify({
      fields: {
        open_date: {
          value: '2026-06-01',
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_001', quote: 'opens on 2026-06-01' }],
        },
        funder_country: {
          value: 'India',
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_001', quote: 'Government of India' }],
        },
        disciplines: {
          value: ['Climate adaptation', 'Sustainable agriculture', 'Rural livelihoods'],
          status: 'supported',
          confidence: 0.92,
          evidence: [{ segmentId: 'seg_002', quote: 'climate adaptation for sustainable agriculture and rural livelihoods' }],
        },
        project_duration_min_months: {
          value: 12,
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_003', quote: '12 to 24 months' }],
        },
        project_duration_max_months: {
          value: 24,
          status: 'supported',
          confidence: 0.9,
          evidence: [{ segmentId: 'seg_003', quote: '12 to 24 months' }],
        },
        official_urls: {
          value: ['https://example.org/call'],
          status: 'supported',
          confidence: 0.88,
          evidence: [{ segmentId: 'seg_004', quote: 'https://example.org/call' }],
        },
        contact_info: {
          value: 'grants@example.org',
          status: 'supported',
          confidence: 0.88,
          evidence: [{ segmentId: 'seg_004', quote: 'grants@example.org' }],
        },
        sponsor_type: {
          value: 'Government',
          status: 'supported',
          confidence: 0.8,
          evidence: [{ segmentId: 'seg_001', quote: 'Government of India' }],
        },
      },
      warnings: [],
    }))

    expect(parsed.fields.open_date.value).toBe('2026-06-01')
    expect(parsed.fields.funder_country.value).toBe('India')
    expect(parsed.fields.disciplines.value).toEqual([
      'Climate adaptation',
      'Sustainable agriculture',
      'Rural livelihoods',
    ])
    expect(parsed.fields.project_duration_min_months.value).toBe(12)
    expect(parsed.fields.project_duration_max_months.value).toBe(24)
    expect(parsed.fields.official_urls.value).toEqual(['https://example.org/call'])
    expect(parsed.fields.contact_info.value).toBe('grants@example.org')
    expect(parsed.fields.sponsor_type.value).toBe('Government')
  })
})
