export type RecommendationInputMode = 'paper_metadata' | 'research_area';
export type RecommendationSort = 'best_match' | 'deadline_soonest';
export type RecommendationDegradedMode = 'full_text_only' | null;
export type RecommendationNoResultsReason = 'no_match' | 'filters_too_strict' | 'query_too_weak' | null;

export interface RecommendationAccessScope {
  tenantId: string | null;
  isSuperAdmin: boolean;
}

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
  taxonomyAreaIds?: string[];
  deadlineFrom?: string;
  deadlineTo?: string;
  rollingOnly?: boolean;
  amountMin?: number | null;
  amountMax?: number | null;
  includeExpired?: boolean;
  limit?: number;
  sort?: RecommendationSort;
}

export interface RecommendationStrictFilterRecovery {
  retryFilters: Required<RecommendationSearchFilters>;
  relaxedFilterKeys: Array<keyof RecommendationSearchFilters>;
}

export interface RecommendationSearchDiagnostics {
  strictFilterRecovery?: RecommendationStrictFilterRecovery | null;
  profile?: RecommendationProfileRunDiagnostics | null;
  chat?: {
    parsePath?: string | null;
    intent?: string | null;
    confidence?: number | null;
  } | null;
}

export interface RecommendationPreferenceFlags {
  useEligibilityProfile: boolean;
  usePublicationContext: boolean;
}

export interface RecommendationProfileSavedAreaSnapshot {
  id: string;
  label: string;
  researchArea: string;
  keywords: string[];
  disciplines: string[];
  taxonomyAreaId: string | null;
  taxonomyPath: string | null;
}

export interface RecommendationPublicationSnapshot {
  id: string;
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  tags: string[];
  abstractSnippet: string | null;
}

export interface RecommendationProfileSnapshot {
  countryOfResidence: string | null;
  citizenshipCountries: string[];
  institutionType: string | null;
  careerStage: string | null;
  applicationLanguages: string[];
  researchAreas: string[];
  keywords: string[];
  savedResearchAreas: RecommendationProfileSavedAreaSnapshot[];
  publications: RecommendationPublicationSnapshot[];
  sourceLabel: string | null;
  preferences?: RecommendationPreferenceFlags;
}

export interface RecommendationProfileMatch {
  score: number;
  reasons: string[];
  fieldsUsed: string[];
}

export interface RecommendationProfileRunDiagnostics {
  enabled: boolean;
  snapshot: RecommendationProfileSnapshot | null;
  preferences?: RecommendationPreferenceFlags;
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
  access?: RecommendationAccessScope;
  llmContext?: { tenantId?: string | null; userId?: string | null; planId?: string | null };
  profileContext?: RecommendationProfileSnapshot | null;
  useProfileContext?: boolean;
  useEligibilityProfile?: boolean;
  usePublicationContext?: boolean;
}

export interface RecommendationDirectoryRequest {
  query?: string;
  page?: number;
  filters?: RecommendationSearchFilters;
  access?: RecommendationAccessScope;
  profileContext?: RecommendationProfileSnapshot | null;
  useProfileContext?: boolean;
  useEligibilityProfile?: boolean;
  usePublicationContext?: boolean;
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
  profileMatch: RecommendationProfileMatch | null;
  eligibilitySummary: string;
  evidence?: RecommendationDocumentEvidence | null;
}

export interface RecommendationDocumentEvidenceChunk {
  chunkId: string;
  sectionTitle: string | null;
  sectionType: string;
  pageStart: number;
  pageEnd: number;
  similarity: number;
  documentVersion: number;
  text: string;
}

export interface RecommendationDocumentEvidence {
  availability: 'document_available' | 'no_document';
  chunks: RecommendationDocumentEvidenceChunk[];
  qualityWarnings: string[];
  docSemanticFit: number | null;
}

export interface RecommendationSearchResponse {
  normalizedQuery: NormalizedRecommendationSearchRequest['normalizedQuery'];
  appliedFilters: Required<RecommendationSearchFilters>;
  degradedMode: RecommendationDegradedMode;
  lowConfidence: boolean;
  noResultsReason: RecommendationNoResultsReason;
  relaxationSuggestions: string[];
  strictFilterRecovery?: RecommendationStrictFilterRecovery | null;
  searchDiagnostics?: RecommendationSearchDiagnostics | null;
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
  | 'taxonomyArea'
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
  label?: string;
  level1Code?: string;
  level1Name?: string;
  level2Code?: string;
  level2Name?: string;
  count: number;
}

export interface DirectoryFacetRequest {
  query?: string;
  filters?: RecommendationSearchFilters;
  access?: RecommendationAccessScope;
}

export interface DirectoryFacetResponse {
  totalPublished: number;
  facets: Record<DirectoryFacetDimension, DirectoryFacetItem[]>;
}
