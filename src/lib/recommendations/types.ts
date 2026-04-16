export type RecommendationInputMode = 'paper_metadata' | 'research_area';
export type RecommendationSort = 'best_match' | 'deadline_soonest';
export type RecommendationDegradedMode = 'full_text_only' | null;
export type RecommendationNoResultsReason = 'no_match' | 'filters_too_strict' | 'query_too_weak' | null;

export interface RecommendationSearchFilters {
  geographyScope?: string[];
  eligibleCountries?: string[];
  eligibleRegions?: string[];
  hostCountries?: string[];
  funderCountries?: string[];
  fundingKinds?: string[];
  institutionTypes?: string[];
  careerStages?: string[];
  citizenshipRequirements?: string[];
  residencyRequirements?: string[];
  applicationLanguages?: string[];
  sponsorTypes?: string[];
  deadlineFrom?: string;
  deadlineTo?: string;
  rollingOnly?: boolean;
  amountMin?: number | null;
  amountMax?: number | null;
  includeExpired?: boolean;
  limit?: number;
  sort?: RecommendationSort;
}

export interface PaperMetadataQuery {
  title?: string;
  abstract?: string;
  keywords?: string[];
}

export interface ResearchAreaQuery {
  researchArea: string;
}

export interface RecommendationSearchRequest {
  inputMode: RecommendationInputMode;
  query: PaperMetadataQuery | ResearchAreaQuery;
  filters?: RecommendationSearchFilters;
}

export interface RecommendationDirectoryRequest {
  query?: string;
  page?: number;
  filters?: RecommendationSearchFilters;
}

export interface NormalizedRecommendationSearchRequest {
  inputMode: RecommendationInputMode;
  filters: Required<RecommendationSearchFilters>;
  normalizedQuery: {
    inputMode: RecommendationInputMode;
    title: string | null;
    abstract: string | null;
    keywords: string[];
    researchArea: string | null;
    truncated: boolean;
    canonicalQueryText: string;
    semanticDocument: string;
    fullTextQuery: string;
    researchTags: string[];
    queryStrength: 'weak' | 'normal' | 'rich';
  };
}

export interface RecommendationCandidate {
  id: string;
  agencyName: string;
  schemeTitle: string;
  shortDescription: string | null;
  fullDescription: string | null;
  description: string;
  closeDate: string | null;
  isRolling: boolean;
  fundingKinds: string[];
  disciplines: string[];
  eligibleCountries: string[];
  eligibleRegions: string[];
  hostCountries: string[];
  institutionTypes: string[];
  careerStages: string[];
  sponsorType: string | null;
  officialUrls: string[];
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  eligibilityText: string | null;
  contactInfo: string | null;
  geographyScope: string | null;
  funderCountry: string | null;
  citizenshipRequirements: string[];
  residencyRequirements: string[];
  applicationLanguages: string[];
  semanticSimilarity: number;
  textRank: number;
}

export interface RecommendationSearchResultItem {
  id: string;
  agencyName: string;
  schemeTitle: string;
  shortDescription: string | null;
  closeDate: string | null;
  isRolling: boolean;
  fundingKinds: string[];
  disciplines: string[];
  eligibleCountries: string[];
  eligibleRegions: string[];
  hostCountries: string[];
  institutionTypes: string[];
  careerStages: string[];
  sponsorType: string | null;
  officialUrls: string[];
  score: number;
  matchReasons: string[];
  eligibilitySummary: string;
}

export interface RecommendationSearchResponse {
  normalizedQuery: NormalizedRecommendationSearchRequest['normalizedQuery'];
  appliedFilters: Required<RecommendationSearchFilters>;
  degradedMode: RecommendationDegradedMode;
  lowConfidence: boolean;
  noResultsReason: RecommendationNoResultsReason;
  relaxationSuggestions: string[];
  results: RecommendationSearchResultItem[];
  totalResults: number;
}

export interface RecommendationRawResultItem extends RecommendationSearchResultItem {
  fullDescription: string | null;
  description: string;
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  eligibilityText: string | null;
  contactInfo: string | null;
  geographyScope: string | null;
  funderCountry: string | null;
  citizenshipRequirements: string[];
  residencyRequirements: string[];
  applicationLanguages: string[];
  semanticSimilarity: number;
  textRank: number;
}

export interface InternalRecommendationSearchResponse extends RecommendationSearchResponse {
  rawResults: RecommendationRawResultItem[];
}

export interface RecommendationDirectoryResponse {
  query: string;
  appliedFilters: Required<RecommendationSearchFilters>;
  results: RecommendationRawResultItem[];
  totalResults: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export type DirectoryFacetDimension =
  | 'researchArea'
  | 'country'
  | 'fundingKind'
  | 'careerStage'
  | 'discipline'
  | 'sponsorType'
  | 'region'
  | 'institutionType';

export interface DirectoryFacetItem {
  value: string;
  count: number;
}

export interface DirectoryFacetRequest {
  query?: string;
  filters?: RecommendationSearchFilters;
}

export interface DirectoryFacetResponse {
  totalPublished: number;
  facets: Record<DirectoryFacetDimension, DirectoryFacetItem[]>;
}
