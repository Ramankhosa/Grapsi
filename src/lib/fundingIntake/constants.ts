export const FUNDING_INTAKE_PROMPT_VERSION = 'funding-intake-v4';
export const FUNDING_INTAKE_EXTRACTOR_VERSION = '1.3.0';
export const MAX_FETCH_BYTES = 10 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const ACTIVE_IDEMPOTENT_STATUSES = ['queued', 'fetching', 'extracting', 'needs_review', 'draft_created'] as const;
export const DRAFT_MINIMUM_FIELDS = ['agency_name', 'scheme_title', 'description'] as const;

export const GEOGRAPHY_SCOPE_OPTIONS = ['National', 'Regional', 'International', 'Global'] as const;
export const FUNDING_KIND_OPTIONS = [
  'Research Grant',
  'Fellowship',
  'Travel Grant',
  'Infrastructure',
  'Equipment Grant',
  'Seed Grant',
  'Training Grant',
  'Mobility Grant',
  'Conference Grant',
  'Scholarship',
] as const;
export const ELIGIBLE_REGION_OPTIONS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'European Union',
  'ASEAN',
  'South Asia',
  'Sub-Saharan Africa',
] as const;
export const APPLICATION_LANGUAGE_OPTIONS = [
  'English',
  'French',
  'German',
  'Spanish',
  'Portuguese',
  'Arabic',
  'Chinese',
  'Japanese',
] as const;
export const SPONSOR_TYPE_OPTIONS = [
  'Government',
  'Foundation',
  'Corporate',
  'Multilateral',
  'University',
  'NGO',
  'Philanthropic',
] as const;

export type FundingFieldKey =
  | 'agency_name'
  | 'scheme_title'
  | 'description'
  | 'open_date'
  | 'close_date'
  | 'is_rolling'
  | 'geography_scope'
  | 'eligible_countries'
  | 'eligible_regions'
  | 'host_countries'
  | 'funder_country'
  | 'funding_kinds'
  | 'institution_types'
  | 'career_stages'
  | 'citizenship_requirements'
  | 'residency_requirements'
  | 'application_languages'
  | 'disciplines'
  | 'amount_min'
  | 'amount_max'
  | 'currency'
  | 'project_duration_min_months'
  | 'project_duration_max_months'
  | 'project_duration_text'
  | 'eligibility_text'
  | 'expected_deliverables_text'
  | 'official_urls'
  | 'contact_info'
  | 'sponsor_type';

export const LLM_EXTRACTABLE_FUNDING_FIELD_KEYS = [
  'agency_name',
  'scheme_title',
  'description',
  'close_date',
  'is_rolling',
  'geography_scope',
  'eligible_countries',
  'eligible_regions',
  'host_countries',
  'funding_kinds',
  'institution_types',
  'career_stages',
  'citizenship_requirements',
  'residency_requirements',
  'application_languages',
  'disciplines',
  'amount_min',
  'amount_max',
  'currency',
  'project_duration_text',
  'eligibility_text',
  'expected_deliverables_text',
] as const satisfies readonly FundingFieldKey[];

export interface FundingFieldDefinition {
  key: FundingFieldKey;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'boolean' | 'array' | 'number';
  requiredForDraft?: boolean;
  description?: string;
  placeholder?: string;
  suggestions?: readonly string[];
}

export const FUNDING_FIELD_DEFINITIONS: readonly FundingFieldDefinition[] = [
  { key: 'agency_name', label: 'Agency Name', type: 'text', requiredForDraft: true },
  { key: 'scheme_title', label: 'Scheme Title', type: 'text', requiredForDraft: true },
  {
    key: 'description',
    label: 'Description',
    type: 'textarea',
    requiredForDraft: true,
    description: 'Canonical call summary or description used across catalog, search, and drafting.',
  },
  { key: 'open_date', label: 'Open Date', type: 'date' },
  { key: 'close_date', label: 'Close Date', type: 'date' },
  { key: 'is_rolling', label: 'Rolling Opportunity', type: 'boolean' },
  {
    key: 'geography_scope',
    label: 'Geography Scope',
    type: 'text',
    description: 'Overall reach of the call for filtering and matching.',
    suggestions: [...GEOGRAPHY_SCOPE_OPTIONS],
    placeholder: 'National, Regional, International, or Global',
  },
  {
    key: 'eligible_countries',
    label: 'Eligible Applicant Countries',
    type: 'array',
    description: 'Countries from which applicants are allowed to apply.',
    placeholder: 'India, United States, Germany',
  },
  {
    key: 'eligible_regions',
    label: 'Eligible Regions',
    type: 'array',
    description: 'Regional eligibility blocks when the call targets regions rather than named countries.',
    suggestions: [...ELIGIBLE_REGION_OPTIONS],
    placeholder: 'European Union, ASEAN, South Asia',
  },
  {
    key: 'host_countries',
    label: 'Host Countries / Project Location',
    type: 'array',
    description: 'Where the project, fellowship, or activity may be hosted.',
    placeholder: 'United Kingdom, Germany, Singapore',
  },
  {
    key: 'funder_country',
    label: 'Funder Country',
    type: 'text',
    description: 'Country of the sponsoring agency or primary funder.',
    placeholder: 'United States',
  },
  {
    key: 'funding_kinds',
    label: 'Funding Types',
    type: 'array',
    description: 'Use consistent tags such as Fellowship, Research Grant, or Travel Grant.',
    suggestions: [...FUNDING_KIND_OPTIONS],
    placeholder: 'Research Grant, Fellowship, Travel Grant',
  },
  {
    key: 'institution_types',
    label: 'Institution Types',
    type: 'array',
    description: 'Eligible organisation or host categories.',
    placeholder: 'University, Research Institute, NGO',
  },
  {
    key: 'career_stages',
    label: 'Career Stages',
    type: 'array',
    description: 'Explicit target applicant stages if stated.',
    placeholder: 'PhD, Postdoctoral, Early Career Faculty',
  },
  {
    key: 'citizenship_requirements',
    label: 'Citizenship Requirements',
    type: 'array',
    description: 'Nationality-based restrictions or preferences.',
    placeholder: 'Citizens of EU member states only',
  },
  {
    key: 'residency_requirements',
    label: 'Residency Requirements',
    type: 'array',
    description: 'Residence-based restrictions or preferences.',
    placeholder: 'Must reside in Canada at time of application',
  },
  {
    key: 'application_languages',
    label: 'Application Languages',
    type: 'array',
    description: 'Languages accepted for the application package.',
    suggestions: [...APPLICATION_LANGUAGE_OPTIONS],
    placeholder: 'English, French',
  },
  {
    key: 'disciplines',
    label: 'Disciplines',
    type: 'array',
    description: 'Research areas or disciplines explicitly supported by the call.',
    placeholder: 'AI, Public Health, Materials Science',
  },
  { key: 'amount_min', label: 'Minimum Amount', type: 'number' },
  { key: 'amount_max', label: 'Maximum Amount', type: 'number' },
  { key: 'currency', label: 'Currency', type: 'text' },
  { key: 'project_duration_min_months', label: 'Minimum Project Duration (Months)', type: 'number' },
  { key: 'project_duration_max_months', label: 'Maximum Project Duration (Months)', type: 'number' },
  {
    key: 'project_duration_text',
    label: 'Project Duration Notes',
    type: 'textarea',
    description: 'Verbatim duration guidance such as fixed ranges, duration caps, or special notes.',
  },
  { key: 'eligibility_text', label: 'Eligibility Text', type: 'textarea' },
  {
    key: 'expected_deliverables_text',
    label: 'Expected Deliverables',
    type: 'textarea',
    description: 'Deliverables, outputs, milestones, or reporting expectations explicitly stated in the call.',
  },
  { key: 'official_urls', label: 'Official URLs', type: 'array' },
  { key: 'contact_info', label: 'Contact Info', type: 'textarea' },
  {
    key: 'sponsor_type',
    label: 'Sponsor Type',
    type: 'text',
    suggestions: [...SPONSOR_TYPE_OPTIONS],
    placeholder: 'Government, Foundation, Corporate',
  },
];

export const ARRAY_FIELD_KEYS = new Set<FundingFieldKey>([
  'eligible_countries',
  'eligible_regions',
  'host_countries',
  'funding_kinds',
  'institution_types',
  'career_stages',
  'citizenship_requirements',
  'residency_requirements',
  'application_languages',
  'disciplines',
  'official_urls',
]);

export const NUMERIC_FIELD_KEYS = new Set<FundingFieldKey>([
  'amount_min',
  'amount_max',
  'project_duration_min_months',
  'project_duration_max_months',
]);

export const DATE_FIELD_KEYS = new Set<FundingFieldKey>([
  'open_date',
  'close_date',
]);

export const BOOLEAN_FIELD_KEYS = new Set<FundingFieldKey>([
  'is_rolling',
]);
