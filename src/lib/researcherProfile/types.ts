import type { RecommendationSearchFilters } from '../recommendations/types';

export type ResearcherNotificationFrequency = 'instant' | 'daily' | 'weekly';

export interface ResearcherNotificationPreferencesRecord {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  emailAddress: string;
  whatsappNumber: string;
  whatsappVerified: boolean;
  notificationFrequency: ResearcherNotificationFrequency;
  digestEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  alertKeywords: string[];
}

export interface ResearcherProfileRecord {
  displayName: string;
  birthYear: number | null;
  countryOfResidence: string;
  citizenshipCountries: string[];
  institutionName: string;
  institutionType: string;
  department: string;
  careerStage: string;
  yearsOfExperience: number | null;
  applicationLanguages: string[];
  researchSummary: string;
  researchAreas: string[];
  keywords: string[];
  linkedinUrl: string;
  googleScholarUrl: string;
  scopusUrl: string;
  orcidUrl: string;
}

export interface ResearchAreaTaxonomyUploadSummary {
  id: string;
  sourceName: string;
  originalFilename: string | null;
  rowCount: number;
  activeRowCount: number;
  status: string;
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
}

export interface ResearchAreaTaxonomyAreaRecord {
  id: string;
  uploadId: string;
  level1Code: string;
  level1Name: string;
  level2Code: string;
  level2Name: string;
  description: string;
  aliases: string[];
  sortOrder: number | null;
  isActive: boolean;
}

export interface ResearchAreaTaxonomyGroup {
  level1Code: string;
  level1Name: string;
  areas: ResearchAreaTaxonomyAreaRecord[];
}

export interface ResearchAreaTaxonomyPayload {
  upload: ResearchAreaTaxonomyUploadSummary | null;
  areas: ResearchAreaTaxonomyAreaRecord[];
  groups: ResearchAreaTaxonomyGroup[];
  hasActiveTaxonomy: boolean;
}

export interface FundingCallResearchAreaTaxonomyRecord {
  id: string;
  fundingCallId: string;
  taxonomyAreaId: string;
  level1Code: string;
  level1Name: string;
  level2Code: string;
  level2Name: string;
  source: string;
  confidence: number | null;
  createdAt: string;
}

export interface ResearcherSavedResearchAreaTaxonomy {
  areaId: string | null;
  level1Code: string;
  level1Name: string;
  level2Code: string;
  level2Name: string;
}

export interface ResearcherSavedResearchAreaRecord {
  id: string;
  taxonomy: ResearcherSavedResearchAreaTaxonomy | null;
  label: string;
  researchArea: string;
  keywords: string[];
  disciplines: string[];
  isDefault: boolean;
  useForAlerts: boolean;
  normalizedText: string;
  embeddingVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearcherProfilePayload {
  profile: ResearcherProfileRecord;
  notificationPreferences: ResearcherNotificationPreferencesRecord;
}

export interface ResearcherFinderPublication {
  id: string;
  title: string;
  abstract: string;
  year: number | null;
  venue: string | null;
}

export interface ResearcherFinderContext {
  profile: ResearcherProfilePayload['profile'];
  notificationPreferences: ResearcherProfilePayload['notificationPreferences'];
  researchAreas: ResearcherSavedResearchAreaRecord[];
  publications?: ResearcherFinderPublication[];
  profileDefaultContext: {
    query: { researchArea: string };
    filters: RecommendationSearchFilters;
    sourceLabel: string | null;
    taxonomy: ResearcherSavedResearchAreaTaxonomy | null;
  } | null;
}
