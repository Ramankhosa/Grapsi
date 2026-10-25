import { LLM_EXTRACTABLE_FUNDING_FIELD_KEYS } from '@/lib/fundingIntake/constants'
import type { FundingExtractionPayload } from '@/lib/fundingIntake/types'
import { lifecycleAt } from './evidence'

export const EXTRACTION_VERSION = 'source-watch-extract-2'
export const DATE_FIELDS = new Set(['open_date', 'close_date'])
export const NUMBER_FIELDS = new Set(['amount_min', 'amount_max', 'project_duration_min_months', 'project_duration_max_months'])
export const ARRAY_FIELDS = new Set(['eligible_countries', 'eligible_regions', 'host_countries', 'funding_kinds', 'institution_types', 'career_stages', 'citizenship_requirements', 'residency_requirements', 'application_languages', 'disciplines', 'official_urls'])
export const REQUIRED_FIELDS = ['agency_name', 'scheme_title', 'description']
const citation = { type: 'object', additionalProperties: false, properties: { segment: { type: 'string' }, quote: { type: 'string' }, coverage: { type: 'string', enum: ['COMPLETE', 'PARTIAL'] } }, required: ['segment', 'quote', 'coverage'] }
export const EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { fields: { type: 'object', additionalProperties: false, properties: Object.fromEntries(
    [...LLM_EXTRACTABLE_FUNDING_FIELD_KEYS, 'reference', 'round', 'application_invitation'].map(key => {
      const type = ARRAY_FIELDS.has(key) ? 'array' : NUMBER_FIELDS.has(key) ? 'number' : ['is_rolling', 'application_invitation'].includes(key) ? 'boolean' : 'string'
      return [key, { type: 'object', additionalProperties: false, properties: {
        value: { type: [type, 'null'], ...(type === 'array' ? { items: { type: 'string' } } : {}) },
        citations: { type: 'array', items: citation },
      }, required: ['value', 'citations'] }]
    })
  ) } }, required: ['fields'],
}
export interface ExtractionQuality { state: 'INSUFFICIENT' | 'PARTIAL' | 'READY'; supportedFields: number; reasons: string[]; invitationVerified: boolean }
export function extractionQuality(payload: FundingExtractionPayload, coverage: Record<string, string>, invitationVerified: boolean, identityConflicts: string[] = []): ExtractionQuality {
  const supportedFields = Object.values(payload.fields).filter(f => f.status === 'supported').length
  const reasons = REQUIRED_FIELDS.filter(k => coverage[k] !== 'COMPLETE').map(k => `Complete evidence needed for ${k}`)
  if (!invitationVerified) reasons.push('An explicit application invitation needs source evidence')
  const lifecycle = lifecycleAt(payload.fields.close_date.value as string | null, payload.fields.open_date.value as string | null, payload.fields.is_rolling.value === true ? 'ROLLING' : null)
  if (!['OPEN', 'ROLLING', 'REOPENED'].includes(lifecycle)) reasons.push(`Application window is ${lifecycle.toLowerCase()}`)
  reasons.push(...identityConflicts)
  return { state: supportedFields === 0 ? 'INSUFFICIENT' : reasons.length ? 'PARTIAL' : 'READY', supportedFields, reasons, invitationVerified }
}
