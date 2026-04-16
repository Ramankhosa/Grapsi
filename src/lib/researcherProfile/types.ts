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

export interface ResearcherSavedResearchAreaRecord {
  id: string;
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

export interface ResearcherFinderContext {
  profile: ResearcherProfilePayload['profile'];
  notificationPreferences: ResearcherProfilePayload['notificationPreferences'];
  researchAreas: ResearcherSavedResearchAreaRecord[];
  profileDefaultContext: {
    query: { researchArea: string };
    filters: RecommendationSearchFilters;
    sourceLabel: string | null;
  } | null;
}
