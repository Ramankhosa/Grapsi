import { z } from 'zod'

// PatentNest public API v1.3. Keep validation shared by the server client and
// Grapsi's authenticated search route; none of this module contains credentials.
export const PATENTNEST_FIELDS = [
  'publicationNumber', 'applicationNumber', 'kind', 'country', 'familyId', 'title', 'abstract',
  'applicants', 'inventors', 'classifications', 'filingDate', 'publicationDate', 'grantDate',
  'numberOfPages', 'numberOfClaims', 'extractionConfidence', 'source', 'relevance',
] as const

const text = z.string().trim().min(1).max(300)
const identifier = text.refine(value => /[A-Za-z0-9]/.test(value), 'Enter an identifier containing letters or numbers.')
const terms = z.array(text).min(1).max(20)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD dates.').refine(value => {
  const parsed = new Date(value)
  return !value.startsWith('0000-') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Enter a real calendar date.')

export const patentNestFieldsSchema = z.array(z.enum(PATENTNEST_FIELDS)).min(1).max(PATENTNEST_FIELDS.length)
export const patentNestFiltersSchema = z.object({
  title: text.optional(), abstract: text.optional(),
  publicationNumber: identifier.optional(), applicationNumber: identifier.optional(),
  applicants: terms.optional(), inventors: terms.optional(),
  classifications: z.array(identifier).min(1).max(20).optional(),
  filingDateFrom: date.optional(), filingDateTo: date.optional(),
  publicationDateFrom: date.optional(), publicationDateTo: date.optional(),
  grantDateFrom: date.optional(), grantDateTo: date.optional(),
}).strict()

export function createPatentNestSearchSchema(defaultLimit = 20) {
  return z.object({
    query: z.string().trim().min(2, 'Search query must contain between 2 and 2,000 characters.').max(2000, 'Search query must contain between 2 and 2,000 characters.').optional(),
    mode: z.enum(['hybrid', 'structured']).optional(),
    limit: z.number().int().min(1, 'Search limit must be an integer between 1 and 50.').max(50, 'Search limit must be an integer between 1 and 50.').default(defaultLimit),
    offset: z.number().int().min(0).max(10000).optional(),
    sort: z.enum(['relevance', 'publicationDateDesc', 'filingDateDesc', 'grantDateDesc', 'titleAsc']).optional(),
    jurisdictions: z.array(z.string().trim().regex(/^([A-Za-z]{2}|\*)$/).transform(value => value.toUpperCase())).min(1).max(20).optional(),
    filters: patentNestFiltersSchema.optional(),
    fields: patentNestFieldsSchema.optional(),
  }).strict().superRefine((value, ctx) => {
    const mode = value.mode || (value.query ? 'hybrid' : 'structured')
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    if (value.jurisdictions?.includes('*') && value.jurisdictions.length > 1) {
      issue('Choose all available offices or enter specific patent office codes.')
    }
    if (!value.query && !Object.keys(value.filters || {}).length) issue('Supply a query or at least one search filter.')
    if (mode === 'hybrid' && !value.query) issue('Search by meaning requires a query.')
    if (mode === 'hybrid' && ((value.offset || 0) !== 0 || (value.sort && value.sort !== 'relevance'))) {
      issue('Use structured search for pagination or date/title sorting.')
    }
    if (mode === 'structured' && value.sort === 'relevance') issue('Structured search requires date or title sorting.')
    for (const name of ['filingDate', 'publicationDate', 'grantDate'] as const) {
      const from = value.filters?.[`${name}From`], to = value.filters?.[`${name}To`]
      if (from && to && from > to) issue(`${name}: the start date must be on or before the end date.`)
    }
  })
}

export const patentNestSearchSchema = createPatentNestSearchSchema()
