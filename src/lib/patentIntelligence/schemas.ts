import { z } from 'zod'

import { PATENT_QUERY_BOUNDS, PATENT_SEARCH_LIMITS } from './searchCore'

export const searchRequestSchema = z.object({
  query: z.string().trim().min(PATENT_QUERY_BOUNDS.min, 'Enter at least 2 characters.').max(PATENT_QUERY_BOUNDS.max, 'Keep the query under 2,000 characters.'),
  limit: z.number().int().min(PATENT_SEARCH_LIMITS.min).max(PATENT_SEARCH_LIMITS.max).optional().default(PATENT_SEARCH_LIMITS.default),
  jurisdictions: z.array(z.string().trim().length(2)).max(10).optional(),
})

const shortText = (max: number) => z.string().max(max)
const nullableShortText = (max: number) => z.string().max(max).nullable()

// The shortlist stores the record the user saw, so the shape is validated here
// rather than trusting arbitrary JSON from the browser.
export const patentSearchItemSchema = z.object({
  id: shortText(200),
  publicationNumber: shortText(200),
  publicationNumberKey: shortText(200),
  applicationNumber: nullableShortText(200),
  kind: nullableShortText(20),
  country: nullableShortText(80),
  jurisdiction: nullableShortText(8),
  title: shortText(1000),
  abstract: z.string().max(5000).nullable(),
  applicants: z.array(z.object({ name: shortText(300), address: nullableShortText(500) })).max(50),
  inventors: z.array(shortText(300)).max(50),
  classifications: z.array(shortText(60)).max(50),
  classificationGroups: z.array(shortText(8)).max(50),
  filingDate: nullableShortText(32),
  publicationDate: nullableShortText(32),
  filingYear: z.number().int().nullable(),
  publicationYear: z.number().int().nullable(),
  numberOfPages: z.number().nullable(),
  numberOfClaims: z.number().nullable(),
  extractionConfidence: z.number().nullable(),
  source: z.object({ name: shortText(200), document: nullableShortText(300), page: z.number().nullable() }).nullable(),
  relevance: z.object({
    score: z.number().nullable(),
    semanticScore: z.number().nullable(),
    textScore: z.number().nullable(),
    matchedFields: z.array(shortText(60)).max(20),
  }).nullable(),
})

export const shortlistCreateSchema = z.object({
  record: patentSearchItemSchema,
  note: z.string().max(2000).nullable().optional(),
  ideaRunId: z.string().max(80).nullable().optional(),
})

export const shortlistPatchSchema = z.object({
  note: z.string().max(2000).nullable(),
})

export const shortlistExportFormatSchema = z.enum(['csv', 'md'])

export type SearchRequestInput = z.infer<typeof searchRequestSchema>
export type ShortlistCreateInput = z.infer<typeof shortlistCreateSchema>
