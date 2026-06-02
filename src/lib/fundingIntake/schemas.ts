import { z } from 'zod';

export const fundingExtractionFieldStatusSchema = z.enum([
  'supported',
  'unsupported',
  'ambiguous',
]);

export const fundingEvidenceAnchorSchema = z.object({
  sourceType: z.literal('segment'),
  segmentId: z.string().trim().min(1),
  quote: z.string().trim().min(1),
  heading: z.string().trim().nullable(),
});

const baseFieldSchema = {
  status: fundingExtractionFieldStatusSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(fundingEvidenceAnchorSchema),
};

const stringFieldSchema = z.object({
  ...baseFieldSchema,
  value: z.string().trim().nullable(),
});

const stringArrayFieldSchema = z.object({
  ...baseFieldSchema,
  value: z.array(z.string().trim()).nullable(),
});

const numberFieldSchema = z.object({
  ...baseFieldSchema,
  value: z.number().nullable(),
});

const booleanFieldSchema = z.object({
  ...baseFieldSchema,
  value: z.boolean().nullable(),
});

export const fundingIntakeStructuredOutputSchema = z.object({
  fields: z.object({
    agency_name: stringFieldSchema,
    scheme_title: stringFieldSchema,
    description: stringFieldSchema,
    open_date: stringFieldSchema,
    close_date: stringFieldSchema,
    is_rolling: booleanFieldSchema,
    geography_scope: stringFieldSchema,
    eligible_countries: stringArrayFieldSchema,
    eligible_regions: stringArrayFieldSchema,
    host_countries: stringArrayFieldSchema,
    funder_country: stringFieldSchema,
    funding_kinds: stringArrayFieldSchema,
    institution_types: stringArrayFieldSchema,
    career_stages: stringArrayFieldSchema,
    citizenship_requirements: stringArrayFieldSchema,
    residency_requirements: stringArrayFieldSchema,
    application_languages: stringArrayFieldSchema,
    disciplines: stringArrayFieldSchema,
    amount_min: numberFieldSchema,
    amount_max: numberFieldSchema,
    currency: stringFieldSchema,
    project_duration_min_months: numberFieldSchema,
    project_duration_max_months: numberFieldSchema,
    project_duration_text: stringFieldSchema,
    eligibility_text: stringFieldSchema,
    expected_deliverables_text: stringFieldSchema,
    official_urls: stringArrayFieldSchema,
    contact_info: stringFieldSchema,
    sponsor_type: stringFieldSchema,
  }),
  warnings: z.array(z.string()),
});

export type FundingIntakeStructuredOutput = z.infer<typeof fundingIntakeStructuredOutputSchema>;
