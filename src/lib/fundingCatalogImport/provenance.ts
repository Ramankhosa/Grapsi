/**
 * Who owns each field of an imported call.
 *
 * Shape: { default: {source, verified_at, run_id}, fields: { <field>: {source, …} } }.
 * `default` covers every field the importer wrote; `fields` records fields
 * another writer took over — a curator's edit, or the description rewritten
 * from the official page by enrichment. The importer's three-way merge only
 * updates fields its own source owns, so those changes are never overwritten
 * and never produce conflict noise. Release 1 stored a flat
 * {source, verified_at, import_run_id}; that is read as `default`.
 */
export interface FieldOwner {
  source: string
  verified_at?: string | null
  run_id?: string | null
  by?: string | null
}

export interface FieldProvenance {
  default?: FieldOwner
  fields?: Record<string, FieldOwner>
}

export function normalizeProvenance(raw: unknown): FieldProvenance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, any>
  if (typeof record.source === 'string') {
    return { default: { source: record.source, verified_at: record.verified_at ?? null, run_id: record.import_run_id ?? record.run_id ?? null } }
  }
  return {
    default: record.default && typeof record.default.source === 'string' ? record.default : undefined,
    fields: record.fields && typeof record.fields === 'object' ? record.fields : undefined,
  }
}

export function fieldOwner(raw: unknown, field: string): string | null {
  const provenance = normalizeProvenance(raw)
  return provenance.fields?.[field]?.source ?? provenance.default?.source ?? null
}

/** Returns new provenance with `fields` taken over by `owner`. */
export function stampFields(raw: unknown, fields: string[], owner: FieldOwner): FieldProvenance {
  const provenance = normalizeProvenance(raw)
  const next: Record<string, FieldOwner> = { ...(provenance.fields || {}) }
  const stamp = { ...owner, verified_at: owner.verified_at ?? new Date().toISOString() }
  for (const field of fields) next[field] = stamp
  return { default: provenance.default, fields: next }
}

/** Draft keys (catalogue editor) → every call column that carries the same fact. */
export const DRAFT_KEY_COLUMNS: Record<string, string[]> = {
  agency_name: ['agency_name', 'agencyName'],
  scheme_title: ['scheme_title', 'title'],
  description: ['description'],
  open_date: ['open_date'],
  close_date: ['close_date', 'deadlineAt', 'expiration_date', 'final_deadline_at'],
  is_rolling: ['is_rolling'],
  geography_scope: ['geography_scope'],
  eligible_countries: ['eligible_countries'],
  eligible_regions: ['eligible_regions'],
  host_countries: ['host_countries'],
  funder_country: ['funder_country'],
  funding_kinds: ['funding_kinds'],
  institution_types: ['institution_types'],
  career_stages: ['career_stages'],
  citizenship_requirements: ['citizenship_requirements'],
  residency_requirements: ['residency_requirements'],
  application_languages: ['application_languages'],
  disciplines: ['disciplines'],
  amount_min: ['amount_min'],
  amount_max: ['amount_max'],
  currency: ['currency'],
  project_duration_min_months: ['project_duration_min_months'],
  project_duration_max_months: ['project_duration_max_months'],
  project_duration_text: ['project_duration_text'],
  official_urls: ['official_urls'],
  eligibility_text: ['eligibility_text'],
  expected_deliverables_text: ['expected_deliverables_text'],
  sponsor_type: ['sponsor_type'],
}
