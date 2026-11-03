import type { RecommendationSearchFilters } from './types';

export type DirectoryFilters = Required<RecommendationSearchFilters>;

/** Every filter at rest: open and rolling calls, nothing else narrowed. */
export const BASE_DIRECTORY_FILTERS: DirectoryFilters = {
  geographyScope: [],
  eligibleCountries: [],
  eligibleRegions: [],
  hostCountries: [],
  funderCountries: [],
  fundingKinds: [],
  institutionTypes: [],
  careerStages: [],
  citizenshipRequirements: [],
  residencyRequirements: [],
  applicationLanguages: [],
  sponsorTypes: [],
  taxonomyAreaIds: [],
  importedAreaIds: [],
  lifecycleStatuses: ['OPEN', 'ROLLING'],
  funderIds: [],
  sdgGoals: [],
  programmeFrameworks: [],
  qualifications: [],
  projectDurations: [],
  targetGroups: [],
  indirectCostPolicies: [],
  mobility: [],
  applicationRoutes: [],
  noMembershipNeeded: false,
  deadlineFrom: '',
  deadlineTo: '',
  rollingOnly: false,
  amountMin: null,
  amountMax: null,
  amountCurrency: '',
  includeUnknownAmount: false,
  includeExpired: false,
  limit: 10,
  sort: 'best_match',
};

/** The directory listing's defaults: a page of 12. */
export const DIRECTORY_DEFAULT_FILTERS: DirectoryFilters = {
  ...BASE_DIRECTORY_FILTERS,
  limit: 12,
  sort: 'best_match',
};

/** The filters that differ from the defaults, for the address bar (null when none). */
export function encodeDirectoryFilters(filters: DirectoryFilters): string | null {
  const changed = Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) => key !== 'limit' && JSON.stringify(value) !== JSON.stringify(DIRECTORY_DEFAULT_FILTERS[key as keyof DirectoryFilters])
    )
  );
  return Object.keys(changed).length > 0 ? JSON.stringify(changed) : null;
}

/** Filters from a shared link: unknown keys and wrongly typed values are ignored. */
export function decodeDirectoryFilters(raw: unknown): DirectoryFilters {
  if (typeof raw !== 'string') return DIRECTORY_DEFAULT_FILTERS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return DIRECTORY_DEFAULT_FILTERS;
    const out: Record<string, unknown> = { ...DIRECTORY_DEFAULT_FILTERS };
    for (const [key, fallback] of Object.entries(DIRECTORY_DEFAULT_FILTERS)) {
      if (!(key in parsed) || key === 'limit') continue;
      const value = parsed[key];
      const ok = Array.isArray(fallback)
        ? Array.isArray(value) && value.every((item) => typeof item === 'string')
        : fallback === null
          ? value === null || (typeof value === 'number' && Number.isFinite(value))
          : typeof value === typeof fallback;
      if (ok) out[key] = value;
    }
    if (parsed.includeExpired === true && !('lifecycleStatuses' in parsed)) out.lifecycleStatuses = [];
    return out as DirectoryFilters;
  } catch {
    return DIRECTORY_DEFAULT_FILTERS;
  }
}
