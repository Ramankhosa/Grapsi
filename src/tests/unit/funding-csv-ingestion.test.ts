import { describe, expect, it } from 'vitest'

import { parseCsvRows, parseFundingCsvUpload } from '@/lib/fundingIntake/csvIngestion'
import { buildFundingCsvTemplate } from '@/lib/fundingIntake/csvPrompt'
import { prepareFundingJsonIntake } from '@/lib/fundingIntake/jsonIngestion'

describe('funding CSV ingestion', () => {
  it('parses quoted cells, embedded commas, and newlines', () => {
    const rows = parseCsvRows('field,value\ndescription,"A, B\nsecond line"\nagency_name,NSF\n')
    expect(rows).toEqual([
      ['field', 'value'],
      ['description', 'A, B\nsecond line'],
      ['agency_name', 'NSF'],
    ])
  })

  it('maps call fields (with aliases + list splitting) and guideline rows into the intake object', () => {
    const csv = [
      'field,value',
      'agency_name,National Science Foundation',
      'scheme_title,AI for Health',
      'description,Funds applied AI research for public health.',
      'deadline,2026-09-30',
      'amount_max,"500000"',
      'is_rolling,false',
      'disciplines,AI|Public Health|Materials Science',
      'priority,Advance equitable health outcomes',
      'must_address,Include a data management plan',
      'format_rule,Maximum 10 pages',
    ].join('\n')

    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('National Science Foundation')
    // "deadline" alias resolves to close_date
    expect(obj.call.fields.close_date).toBe('2026-09-30')
    expect(obj.call.fields.amount_max).toBe(500000)
    expect(obj.call.fields.is_rolling).toBe(false)
    expect(obj.call.fields.disciplines).toEqual(['AI', 'Public Health', 'Materials Science'])
    expect(obj.guidelines.guideline_pack_json.priorities).toHaveLength(1)
    expect(obj.guidelines.guideline_pack_json.mustAddress[0].text).toBe('Include a data management plan')
    expect(obj.guidelines.guideline_pack_json.formatRules[0].text).toBe('Maximum 10 pages')
    // Template is intentionally absent from CSV.
    expect(obj.template).toBeUndefined()
  })

  it('feeds cleanly into the existing JSON intake preparation', () => {
    const csv = [
      'field,value',
      'agency_name,NSF',
      'scheme_title,AI for Health',
      'description,Funds applied AI research for public health outcomes and equity.',
      'disciplines,AI|Public Health',
      'priority,Advance equitable health outcomes',
    ].join('\n')

    const prepared = prepareFundingJsonIntake(parseFundingCsvUpload(csv))
    expect(prepared.draftValues.agency_name).toBe('NSF')
    expect(prepared.draftValues.scheme_title).toBe('AI for Health')
    expect(prepared.draftValues.disciplines).toEqual(['AI', 'Public Health'])
    expect(prepared.guidelinePack).not.toBeNull()
    expect(prepared.template).toBeNull()
  })

  it('rejects an empty CSV and a CSV without any core call field', () => {
    expect(() => parseFundingCsvUpload('   ')).toThrow(/empty/i)
    expect(() => parseFundingCsvUpload('field,value\npriority,Some priority\n')).toThrow(
      /agency_name, scheme_title, or description/i
    )
  })

  it('produces a downloadable template that round-trips through the parser', () => {
    const template = buildFundingCsvTemplate()
    expect(template.startsWith('field,value')).toBe(true)
    // The blank template has only "# ..." hints, so it has no usable core field.
    expect(() => parseFundingCsvUpload(template)).toThrow()
  })
})

describe('funding CSV ingestion — tolerance to common LLM mistakes', () => {
  it('strips markdown code fences and prose preamble/trailer', () => {
    const csv = [
      'Here is the CSV you asked for:',
      '```csv',
      'field,value',
      'agency_name,NSF',
      'scheme_title,AI for Health',
      'description,Applied AI for public health.',
      '```',
      'Let me know if you need anything else!',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('NSF')
    expect(obj.call.fields.scheme_title).toBe('AI for Health')
  })

  it('accepts unquoted values that contain commas', () => {
    const csv = [
      'field,value',
      'agency_name,NSF',
      'scheme_title,AI for Health',
      'eligibility_text,Open to universities, NGOs, and hospitals in India',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.eligibility_text).toBe('Open to universities, NGOs, and hospitals in India')
  })

  it('falls back to colon/tab/equals delimiters and strips bullet markers', () => {
    const csv = [
      'field,value',
      'agency_name: NSF',
      '- scheme_title = AI for Health',
      'description\tApplied AI for public health outcomes.',
      '1. priority: Advance equitable health outcomes',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('NSF')
    expect(obj.call.fields.scheme_title).toBe('AI for Health')
    expect(obj.call.fields.description).toBe('Applied AI for public health outcomes.')
    expect(obj.guidelines.guideline_pack_json.priorities[0].text).toBe('Advance equitable health outcomes')
  })

  it('normalizes title-cased / spaced field names and stray wrapping quotes', () => {
    const csv = [
      'field,value',
      'Agency Name,"NSF"',
      'Scheme Title,AI for Health',
      "Description,'Applied AI for public health.'",
      'Must Address,Include a data management plan',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('NSF')
    expect(obj.call.fields.description).toBe('Applied AI for public health.')
    expect(obj.guidelines.guideline_pack_json.mustAddress[0].text).toBe('Include a data management plan')
  })

  it('coerces currency-formatted and suffixed amounts without eating duration units', () => {
    const csv = [
      'field,value',
      'agency_name,NSF',
      'description,Applied AI for public health.',
      'amount_min,"$50,000"',
      'amount_max,1.2M',
      'project_duration_max_months,24 months',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.amount_min).toBe(50000)
    expect(obj.call.fields.amount_max).toBe(1200000)
    expect(obj.call.fields.project_duration_max_months).toBe(24)
  })

  it('ignores unknown/extra rows instead of failing the whole import', () => {
    const csv = [
      'field,value',
      'agency_name,NSF',
      'description,Applied AI for public health.',
      'random_note,this should be ignored',
      'confidence,0.9',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('NSF')
    expect(obj.call.fields).not.toHaveProperty('random_note')
  })

  it('works even when the header row is missing', () => {
    const csv = [
      'agency_name,NSF',
      'scheme_title,AI for Health',
      'description,Applied AI for public health.',
    ].join('\n')
    const obj = parseFundingCsvUpload(csv) as any
    expect(obj.call.fields.agency_name).toBe('NSF')
  })
})
