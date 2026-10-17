import type { DirectoryFacetDimension, RecommendationSearchFilters } from './types';

/**
 * The filter each directory facet edits. Inside one facet the chosen values
 * are alternatives (any of them); different facets, and every other filter,
 * must all hold.
 */
export const FACET_DIMENSION_FIELD = {
  taxonomyArea: 'taxonomyAreaIds',
  fundingKind: 'fundingKinds',
  careerStage: 'careerStages',
  institutionType: 'institutionTypes',
  sponsorType: 'sponsorTypes',
  funder: 'funderIds',
  sdgGoal: 'sdgGoals',
  programmeFramework: 'programmeFrameworks',
  region: 'eligibleRegions',
  geographyScope: 'geographyScope',
  qualification: 'qualifications',
  projectDuration: 'projectDurations',
  targetGroup: 'targetGroups',
  indirectCosts: 'indirectCostPolicies',
  mobility: 'mobility',
  applicationRoute: 'applicationRoutes',
} as const satisfies Record<DirectoryFacetDimension, keyof RecommendationSearchFilters>;

export type FacetFilterField = (typeof FACET_DIMENSION_FIELD)[DirectoryFacetDimension];
export const FACET_FILTER_FIELDS = Object.values(FACET_DIMENSION_FIELD) as FacetFilterField[];

export function facetValues(filters: RecommendationSearchFilters, dimension: DirectoryFacetDimension): string[] {
  return (filters[FACET_DIMENSION_FIELD[dimension]] as string[] | undefined) || [];
}

/** The filters with one facet value added, or removed when already chosen. */
export function toggleFacetValue<T extends RecommendationSearchFilters>(filters: T, dimension: DirectoryFacetDimension, value: string): T {
  const field = FACET_DIMENSION_FIELD[dimension];
  const current = facetValues(filters, dimension);
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return { ...filters, [field]: next };
}
