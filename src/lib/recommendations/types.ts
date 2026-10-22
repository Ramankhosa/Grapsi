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
  importedAreaIds?: string[];
  lifecycleStatuses?: string[];
  /** Funder ids (funders table). Calls with no funder link match on agency name. */
  funderIds?: string[];
  /** UN Sustainable Development Goal numbers, as strings '1'..'17'. */
  sdgGoals?: string[];
  /** Programme prefixes: "Horizon Europe" also matches "Horizon Europe › Cluster 5 › Pillar II". */
  programmeFrameworks?: string[];
  /** Qualification the call asks for (QUALIFICATION_OPTIONS). */
  qualifications?: string[];
  /** Project length buckets (PROJECT_DURATION_OPTIONS): the call's range overlaps one. */
  projectDurations?: string[];
  /** Groups a call is aimed at (TARGET_GROUP_OPTIONS). */
  targetGroups?: string[];
  /** INCLUDED | DIRECT_ONLY | CO_FUND. */
  indirectCostPolicies?: string[];
  /** inbound | outbound. */
  mobility?: string[];
  /** How applications reach the funder (APPLICATION_ROUTE_OPTIONS). */
  applicationRoutes?: string[];
  /** Hide calls open to members of a society only. */
  noMembershipNeeded?: boolean;
  deadlineFrom?: string;
  deadlineTo?: string;
  rollingOnly?: boolean;
  amountMin?: number | null;
  amountMax?: number | null;
  /**
   * ISO 4217 code amountMin/amountMax are in. When set, calls in another
   * currency are compared through their USD estimate; '' compares raw numbers
   * whatever the currency (the original behaviour).
   */
  amountCurrency?: string;
  /** With an amount filter: keep calls whose amount is unknown or cannot be compared. */
  includeUnknownAmount?: boolean;
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

/**
 * One topic branch of a multi-area search. Selected areas are searched independently
 * (own embedding, own lexical query, own relevance gate) and merged with attribution,
 * instead of being concatenated into a single blended query.
 */
export interface RecommendationSelectedResearchArea {
  id: string;
  label: string;
  queryText: string;
  /** Level-1/level-2 taxonomy the user filed this area under, when they picked one. */
  taxonomyAreaId?: string | null;
  taxonomyAreaIds?: string[];
  taxonomyPath?: string | null;
}

/** Which selected area a result matched, and how strongly, on that area's own branch. */
export interface RecommendationAreaMatch {
  areaId: string;
  label: string;
  score: number;
}

export interface RecommendationAreaBreakdownItem {
  areaId: string;
  label: string;
  queryText: string;
  taxonomyPath?: string | null;
  totalResults: number;
  topScore: number;
}

export interface RecommendationProfileSavedAreaSnapshot {
  id: string;
  label: string;
  researchArea: string;
  keywords: string[];
  disciplines: string[];
  taxonomyAreaId: string | null;
  taxonomyAreaIds?: string[];
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
  /**
   * Saved research areas the user picked for this search. Two or more (or one plus a
   * distinct typed topic) trigger the fan-out path in `recommendationSearchService`.
   */
  selectedResearchAreas?: RecommendationSelectedResearchArea[];
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
  /** Two-level research-area tags on the call, shared with saved researcher areas. */
  taxonomyAreaIds?: string[];
  importedAreaIds?: string[];
  lifecycleStatuses?: string[];
  /** Imported external-catalogue call (GLOBAL_CATALOG). */
  isCatalog?: boolean;
  /** The funder takes a limited number of applications per institution. */
  limitedSubmissions?: boolean;
  /** False for imported calls whose official guidelines are not fetched yet. */
  authoringReady?: boolean;
  /** The call's stored eligibility dimensions (snake_case), when any is evaluated. */
  eligibilityDimensions?: Record<string, unknown> | null;
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
  /** Populated only on multi-area searches: which selected areas this call matched. */
  matchedAreas?: RecommendationAreaMatch[];
  /** Imported external-catalogue call (GLOBAL_CATALOG). */
  isCatalog?: boolean;
  /** The funder takes a limited number of applications per institution. */
  limitedSubmissions?: boolean;
  /** False for imported calls whose official guidelines are not fetched yet. */
  authoringReady?: boolean;
  /**
   * The call's stated country eligibility against the user's profile, when the
   * search used the profile and the call states any; otherwise null.
   */
  eligibilityVerdict?: RecommendationEligibilityVerdict | null;
}

export type RecommendationEligibilityVerdict = 'ELIGIBLE' | 'NEEDS_CHECK' | 'INELIGIBLE';

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
  /** Per-area coverage of a multi-area search; null for ordinary single-topic searches. */
  areaBreakdown?: RecommendationAreaBreakdownItem[] | null;
}

export interface RecommendationRawResultItem extends RecommendationSearchResultItem {
  taxonomyAreaIds?: string[];
  importedAreaIds?: string[];
  lifecycleStatuses?: string[];
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

/**
 * Directory facets. Countries are not a facet: "open to applicants from" is an
 * eligibility reading (worldwide calls count), not a list of countries a call
 * names, so the directory offers a country picker instead of counts.
 */
export type DirectoryFacetDimension =
  | 'taxonomyArea'
  | 'fundingKind'
  | 'careerStage'
  | 'institutionType'
  | 'sponsorType'
  | 'funder'
  | 'sdgGoal'
  | 'programmeFramework'
  | 'region'
  | 'geographyScope'
  | 'qualification'
  | 'projectDuration'
  | 'targetGroup'
  | 'indirectCosts'
  | 'mobility'
  | 'applicationRoute';

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
  /** Calls matching every filter and the search text: the result count. */
  totalPublished: number;
  /** For yes/no filters: how many calls each would hide under the other filters. */
  toggles?: { membershipRequired: number };
  facets: Record<DirectoryFacetDimension, DirectoryFacetItem[]>;
}
