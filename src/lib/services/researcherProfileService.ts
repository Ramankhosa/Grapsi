import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import type {
  ResearcherFinderContext,
  ResearcherNotificationPreferencesRecord,
  ResearcherProfilePayload,
  ResearcherProfileRecord,
  ResearcherSavedResearchAreaRecord,
  ResearcherSavedResearchAreaTaxonomy,
} from '../researcherProfile/types';
import {
  normalizeApplicationLanguageList,
  normalizeCareerStageList,
  normalizeCountryInput,
  normalizeCountryList,
  normalizeInstitutionTypeList,
  normalizeWhitespace,
} from '../recommendations/utils';
import type {
  RecommendationPreferenceFlags,
  RecommendationProfileSnapshot,
  RecommendationPublicationSnapshot,
  RecommendationSearchFilters,
} from '../recommendations/types';
import { EmbeddingService } from './embeddingService';
import { researchAreaTaxonomyService } from './researchAreaTaxonomyService';

const embeddingService = new EmbeddingService();
export const RESEARCH_AREA_EMBEDDING_VERSION = 'research-area-v2-taxonomy';
export const FUNDING_PUBLICATION_TAG = 'my-publication';

export interface ResearchAreaEmbeddingCoverage {
  total: number;
  current: number;
  missing: number;
  stale: number;
  embeddingVersion: string;
}

export interface EmbeddingBackfillResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

type UserWithResearcherRelations = Awaited<ReturnType<typeof prisma.user.findUnique>>;

function emptyString(value: string | null | undefined) {
  return typeof value === 'string' ? value : '';
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value || '');
  return normalized || '';
}

function normalizeTextArray(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeWhitespace(String(value || '')))
        .filter(Boolean)
    )
  );
}

function truncateText(value: string | null | undefined, maxLength: number) {
  const normalized = normalizeWhitespace(value || '');
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function normalizeProfileRecord(user: { name?: string | null; email?: string | null; researcher_profile?: any; researcher_notification_preference?: any }): ResearcherProfilePayload {
  const profile = user.researcher_profile;
  const notificationPreferences = user.researcher_notification_preference;

  return {
    profile: {
      displayName: emptyString(profile?.display_name) || emptyString(user.name),
      birthYear: typeof profile?.birth_year === 'number' ? profile.birth_year : null,
      countryOfResidence: emptyString(profile?.country_of_residence),
      citizenshipCountries: normalizeTextArray(profile?.citizenship_countries),
      institutionName: emptyString(profile?.institution_name),
      institutionType: emptyString(profile?.institution_type),
      department: emptyString(profile?.department),
      careerStage: emptyString(profile?.career_stage),
      yearsOfExperience: typeof profile?.years_of_experience === 'number' ? profile.years_of_experience : null,
      applicationLanguages: normalizeTextArray(profile?.application_languages),
      researchSummary: emptyString(profile?.research_summary),
      researchAreas: normalizeTextArray(profile?.research_areas),
      keywords: normalizeTextArray(profile?.keywords),
      linkedinUrl: normalizeUrl(profile?.linkedin_url),
      googleScholarUrl: normalizeUrl(profile?.google_scholar_url),
      scopusUrl: normalizeUrl(profile?.scopus_url),
      orcidUrl: normalizeUrl(profile?.orcid_url),
    },
    notificationPreferences: {
      inAppEnabled: notificationPreferences?.in_app_enabled ?? true,
      emailEnabled: notificationPreferences?.email_enabled ?? true,
      whatsappEnabled: notificationPreferences?.whatsapp_enabled ?? false,
      emailAddress: emptyString(notificationPreferences?.email_address) || emptyString(user.email),
      whatsappNumber: emptyString(notificationPreferences?.whatsapp_number),
      whatsappVerified: notificationPreferences?.whatsapp_verified ?? false,
      notificationFrequency: notificationPreferences?.notification_frequency ?? 'weekly',
      digestEnabled: notificationPreferences?.digest_enabled ?? true,
      quietHoursStart: emptyString(notificationPreferences?.quiet_hours_start),
      quietHoursEnd: emptyString(notificationPreferences?.quiet_hours_end),
      timezone: emptyString(notificationPreferences?.timezone) || 'Asia/Calcutta',
      alertKeywords: normalizeTextArray(notificationPreferences?.alert_keywords),
    },
  };
}

type SavedResearchAreaRow = {
  id: string;
  taxonomy_area_id: string | null;
  taxonomy_level1_code: string | null;
  taxonomy_level1_name: string | null;
  taxonomy_level2_code: string | null;
  taxonomy_level2_name: string | null;
  label: string;
  research_area: string;
  keywords: string[];
  disciplines: string[];
  is_default: boolean;
  use_for_alerts: boolean;
  normalized_text: string | null;
  embedding_version: string | null;
  created_at: Date;
  updated_at: Date;
};

function serializeResearchAreaTaxonomy(record: Partial<SavedResearchAreaRow>): ResearcherSavedResearchAreaTaxonomy | null {
  if (!record.taxonomy_area_id && !record.taxonomy_level1_name && !record.taxonomy_level2_name) {
    return null;
  }

  return {
    areaId: record.taxonomy_area_id || null,
    level1Code: emptyString(record.taxonomy_level1_code),
    level1Name: emptyString(record.taxonomy_level1_name),
    level2Code: emptyString(record.taxonomy_level2_code),
    level2Name: emptyString(record.taxonomy_level2_name),
  };
}

function serializeResearchArea(record: any): ResearcherSavedResearchAreaRecord {
  return {
    id: record.id,
    taxonomy: serializeResearchAreaTaxonomy(record),
    label: record.label,
    researchArea: record.research_area,
    keywords: normalizeTextArray(record.keywords),
    disciplines: normalizeTextArray(record.disciplines),
    isDefault: Boolean(record.is_default),
    useForAlerts: Boolean(record.use_for_alerts),
    normalizedText: emptyString(record.normalized_text),
    embeddingVersion: record.embedding_version || null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export function buildResearchAreaNormalizedText(input: {
  taxonomy?: ResearcherSavedResearchAreaTaxonomy | null;
  label: string;
  researchArea: string;
  keywords: string[];
  disciplines: string[];
}) {
  return [
    input.taxonomy?.level1Name
      ? `research field level 1: ${input.taxonomy.level1Name}${input.taxonomy.level1Code ? ` (${input.taxonomy.level1Code})` : ''}`
      : '',
    input.taxonomy?.level2Name
      ? `research field level 2: ${input.taxonomy.level2Name}${input.taxonomy.level2Code ? ` (${input.taxonomy.level2Code})` : ''}`
      : '',
    normalizeWhitespace(input.label),
    normalizeWhitespace(input.researchArea),
    input.keywords.length ? `keywords: ${input.keywords.join(', ')}` : '',
    input.disciplines.length ? `disciplines: ${input.disciplines.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function buildContentHash(normalizedText: string) {
  return crypto.createHash('sha256').update(normalizedText).digest('hex');
}

async function querySavedResearchAreas(userId: string): Promise<SavedResearchAreaRow[]> {
  return prisma.$queryRaw<SavedResearchAreaRow[]>(Prisma.sql`
    SELECT id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name, taxonomy_level2_code, taxonomy_level2_name,
           label, research_area, keywords, disciplines, is_default, use_for_alerts, normalized_text, embedding_version,
           created_at, updated_at
    FROM researcher_saved_research_areas
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, updated_at DESC
  `);
}

async function querySavedResearchAreaById(areaId: string): Promise<SavedResearchAreaRow | null> {
  const rows = await prisma.$queryRaw<SavedResearchAreaRow[]>(Prisma.sql`
    SELECT id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name, taxonomy_level2_code, taxonomy_level2_name,
           label, research_area, keywords, disciplines, is_default, use_for_alerts, normalized_text, embedding_version,
           created_at, updated_at
    FROM researcher_saved_research_areas
    WHERE id = ${areaId}
    LIMIT 1
  `);

  return rows[0] || null;
}

function buildProfileDefaultFilters(profile: ResearcherProfileRecord): RecommendationSearchFilters {
  const filters: RecommendationSearchFilters = {
    includeExpired: false,
    limit: 10,
    sort: 'best_match',
  };

  const countryCandidates = normalizeCountryList(
    [profile.countryOfResidence, ...profile.citizenshipCountries].filter(Boolean)
  );
  if (countryCandidates && countryCandidates.length > 0) {
    filters.eligibleCountries = countryCandidates;
  }

  const institutionTypes = normalizeInstitutionTypeList(profile.institutionType ? [profile.institutionType] : []);
  if (institutionTypes && institutionTypes.length > 0) {
    filters.institutionTypes = institutionTypes;
  }

  const careerStages = normalizeCareerStageList(profile.careerStage ? [profile.careerStage] : []);
  if (careerStages && careerStages.length > 0) {
    filters.careerStages = careerStages;
  }

  const applicationLanguages = normalizeApplicationLanguageList(profile.applicationLanguages);
  if (applicationLanguages && applicationLanguages.length > 0) {
    filters.applicationLanguages = applicationLanguages;
  }

  return filters;
}

export function buildRecommendationProfileSnapshot(
  context: ResearcherFinderContext,
  options: {
    includeResearchSignals?: boolean;
    publications?: RecommendationPublicationSnapshot[];
    preferences?: RecommendationPreferenceFlags;
  } = {}
): RecommendationProfileSnapshot {
  const profile = context.profile;
  const includeResearchSignals = options.includeResearchSignals !== false;
  const countryOfResidence = profile.countryOfResidence
    ? normalizeCountryInput(profile.countryOfResidence) || normalizeWhitespace(profile.countryOfResidence)
    : null;
  const citizenshipCountries =
    normalizeCountryList(profile.citizenshipCountries) || normalizeTextArray(profile.citizenshipCountries);
  const institutionType =
    normalizeInstitutionTypeList(profile.institutionType ? [profile.institutionType] : [])?.[0] ||
    normalizeWhitespace(profile.institutionType) ||
    null;
  const careerStage =
    normalizeCareerStageList(profile.careerStage ? [profile.careerStage] : [])?.[0] ||
    normalizeWhitespace(profile.careerStage) ||
    null;
  const applicationLanguages =
    normalizeApplicationLanguageList(profile.applicationLanguages) || normalizeTextArray(profile.applicationLanguages);

  return {
    countryOfResidence,
    citizenshipCountries,
    institutionType,
    careerStage,
    applicationLanguages,
    researchAreas: includeResearchSignals ? normalizeTextArray(profile.researchAreas) : [],
    keywords: includeResearchSignals ? normalizeTextArray(profile.keywords) : [],
    savedResearchAreas: includeResearchSignals
      ? context.researchAreas
          .filter((area) => area.useForAlerts !== false)
          .slice(0, 10)
          .map((area) => {
            const taxonomyPath = [area.taxonomy?.level1Name, area.taxonomy?.level2Name].filter(Boolean).join(' / ');
            return {
              id: area.id,
              label: normalizeWhitespace(area.label),
              researchArea: normalizeWhitespace(area.researchArea),
              keywords: normalizeTextArray(area.keywords),
              disciplines: normalizeTextArray(area.disciplines),
              taxonomyAreaId: area.taxonomy?.areaId || null,
              taxonomyPath: taxonomyPath || null,
            };
          })
      : [],
    publications: options.publications || [],
    sourceLabel: context.profileDefaultContext?.sourceLabel || null,
    preferences: options.preferences,
  };
}

export function buildEmptyRecommendationProfileSnapshot(options: {
  publications?: RecommendationPublicationSnapshot[];
  preferences?: RecommendationPreferenceFlags;
} = {}): RecommendationProfileSnapshot {
  return {
    countryOfResidence: null,
    citizenshipCountries: [],
    institutionType: null,
    careerStage: null,
    applicationLanguages: [],
    researchAreas: [],
    keywords: [],
    savedResearchAreas: [],
    publications: options.publications || [],
    sourceLabel: null,
    preferences: options.preferences,
  };
}

async function listFundingPublicationSignals(userId: string, limit = 10): Promise<RecommendationPublicationSnapshot[]> {
  const rows = await prisma.referenceLibrary.findMany({
    where: {
      userId,
      isActive: true,
      tags: { has: FUNDING_PUBLICATION_TAG },
    },
    select: {
      id: true,
      title: true,
      year: true,
      venue: true,
      doi: true,
      abstract: true,
      tags: true,
      updatedAt: true,
    },
    orderBy: [
      { year: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    title: normalizeWhitespace(row.title),
    year: row.year || null,
    venue: normalizeWhitespace(row.venue || '') || null,
    doi: normalizeWhitespace(row.doi || '') || null,
    tags: normalizeTextArray(row.tags).filter((tag) => tag.toLowerCase() !== FUNDING_PUBLICATION_TAG),
    abstractSnippet: truncateText(row.abstract, 360),
  })).filter((publication) => Boolean(publication.title));
}

export async function buildRecommendationPreferenceSnapshot(
  userId: string,
  preferences: RecommendationPreferenceFlags
): Promise<RecommendationProfileSnapshot | null> {
  if (!preferences.useEligibilityProfile && !preferences.usePublicationContext) {
    return null;
  }

  const publications = preferences.usePublicationContext
    ? await listFundingPublicationSignals(userId)
    : [];

  if (!preferences.useEligibilityProfile) {
    return buildEmptyRecommendationProfileSnapshot({ publications, preferences });
  }

  const context = await researcherProfileService.getFinderContext(userId);
  return buildRecommendationProfileSnapshot(context, {
    includeResearchSignals: false,
    publications,
    preferences,
  });
}

export class ResearcherProfileService {
  async getProfile(userId: string): Promise<ResearcherProfilePayload> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        researcher_profile: true,
        researcher_notification_preference: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return normalizeProfileRecord(user);
  }

  async updateProfile(
    userId: string,
    input: {
      profile: ResearcherProfileRecord;
      notificationPreferences: ResearcherNotificationPreferencesRecord;
    }
  ): Promise<ResearcherProfilePayload> {
    const normalizedCountries = normalizeCountryList(input.profile.citizenshipCountries) || normalizeTextArray(input.profile.citizenshipCountries);
    const residence = input.profile.countryOfResidence ? normalizeCountryInput(input.profile.countryOfResidence) || normalizeWhitespace(input.profile.countryOfResidence) : null;
    const institutionType = normalizeInstitutionTypeList(input.profile.institutionType ? [input.profile.institutionType] : [])?.[0] || normalizeWhitespace(input.profile.institutionType);
    const careerStage = normalizeCareerStageList(input.profile.careerStage ? [input.profile.careerStage] : [])?.[0] || normalizeWhitespace(input.profile.careerStage);
    const applicationLanguages = normalizeApplicationLanguageList(input.profile.applicationLanguages) || normalizeTextArray(input.profile.applicationLanguages);

    const emailAddress = normalizeWhitespace(input.notificationPreferences.emailAddress) || undefined;
    const alertKeywords = normalizeTextArray([
      ...input.notificationPreferences.alertKeywords,
      ...input.profile.keywords,
    ]);

    await prisma.$transaction([
      prisma.researcherProfile.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          display_name: normalizeWhitespace(input.profile.displayName) || null,
          birth_year: input.profile.birthYear,
          country_of_residence: residence,
          citizenship_countries: normalizedCountries,
          institution_name: normalizeWhitespace(input.profile.institutionName) || null,
          institution_type: institutionType || null,
          department: normalizeWhitespace(input.profile.department) || null,
          career_stage: careerStage || null,
          years_of_experience: input.profile.yearsOfExperience,
          application_languages: applicationLanguages,
          research_summary: normalizeWhitespace(input.profile.researchSummary) || null,
          research_areas: normalizeTextArray(input.profile.researchAreas),
          keywords: normalizeTextArray(input.profile.keywords),
          linkedin_url: normalizeUrl(input.profile.linkedinUrl) || null,
          google_scholar_url: normalizeUrl(input.profile.googleScholarUrl) || null,
          scopus_url: normalizeUrl(input.profile.scopusUrl) || null,
          orcid_url: normalizeUrl(input.profile.orcidUrl) || null,
        },
        update: {
          display_name: normalizeWhitespace(input.profile.displayName) || null,
          birth_year: input.profile.birthYear,
          country_of_residence: residence,
          citizenship_countries: normalizedCountries,
          institution_name: normalizeWhitespace(input.profile.institutionName) || null,
          institution_type: institutionType || null,
          department: normalizeWhitespace(input.profile.department) || null,
          career_stage: careerStage || null,
          years_of_experience: input.profile.yearsOfExperience,
          application_languages: applicationLanguages,
          research_summary: normalizeWhitespace(input.profile.researchSummary) || null,
          research_areas: normalizeTextArray(input.profile.researchAreas),
          keywords: normalizeTextArray(input.profile.keywords),
          linkedin_url: normalizeUrl(input.profile.linkedinUrl) || null,
          google_scholar_url: normalizeUrl(input.profile.googleScholarUrl) || null,
          scopus_url: normalizeUrl(input.profile.scopusUrl) || null,
          orcid_url: normalizeUrl(input.profile.orcidUrl) || null,
        },
      }),
      prisma.researcherNotificationPreference.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          in_app_enabled: input.notificationPreferences.inAppEnabled,
          email_enabled: input.notificationPreferences.emailEnabled,
          whatsapp_enabled: input.notificationPreferences.whatsappEnabled,
          email_address: emailAddress,
          whatsapp_number: normalizeWhitespace(input.notificationPreferences.whatsappNumber) || null,
          whatsapp_verified: input.notificationPreferences.whatsappVerified,
          notification_frequency: input.notificationPreferences.notificationFrequency,
          digest_enabled: input.notificationPreferences.digestEnabled,
          quiet_hours_start: normalizeWhitespace(input.notificationPreferences.quietHoursStart) || null,
          quiet_hours_end: normalizeWhitespace(input.notificationPreferences.quietHoursEnd) || null,
          timezone: normalizeWhitespace(input.notificationPreferences.timezone) || 'Asia/Calcutta',
          alert_keywords: alertKeywords,
        },
        update: {
          in_app_enabled: input.notificationPreferences.inAppEnabled,
          email_enabled: input.notificationPreferences.emailEnabled,
          whatsapp_enabled: input.notificationPreferences.whatsappEnabled,
          email_address: emailAddress,
          whatsapp_number: normalizeWhitespace(input.notificationPreferences.whatsappNumber) || null,
          whatsapp_verified: input.notificationPreferences.whatsappVerified,
          notification_frequency: input.notificationPreferences.notificationFrequency,
          digest_enabled: input.notificationPreferences.digestEnabled,
          quiet_hours_start: normalizeWhitespace(input.notificationPreferences.quietHoursStart) || null,
          quiet_hours_end: normalizeWhitespace(input.notificationPreferences.quietHoursEnd) || null,
          timezone: normalizeWhitespace(input.notificationPreferences.timezone) || 'Asia/Calcutta',
          alert_keywords: alertKeywords,
        },
      }),
    ]);

    return this.getProfile(userId);
  }

  async listResearchAreas(userId: string): Promise<ResearcherSavedResearchAreaRecord[]> {
    const areas = await querySavedResearchAreas(userId);

    return areas.map(serializeResearchArea);
  }

  async saveResearchArea(
    userId: string,
    input: {
      id?: string;
      taxonomyAreaId?: string | null;
      label: string;
      researchArea: string;
      keywords?: string[];
      disciplines?: string[];
      isDefault?: boolean;
      useForAlerts?: boolean;
    }
  ): Promise<ResearcherSavedResearchAreaRecord> {
    const normalizedKeywords = normalizeTextArray(input.keywords);
    const normalizedDisciplines = normalizeTextArray(input.disciplines);
    const taxonomyProvided = Object.prototype.hasOwnProperty.call(input, 'taxonomyAreaId');
    const existing = input.id
      ? await prisma.researcherSavedResearchArea.findFirst({
          where: { id: input.id, user_id: userId },
          select: { id: true, content_hash: true, embedding_version: true },
        })
      : null;
    if (input.id && !existing) {
      throw new Error('Saved research area not found');
    }
    const existingSavedArea = existing ? await querySavedResearchAreaById(existing.id) : null;
    let taxonomy: ResearcherSavedResearchAreaTaxonomy | null = null;

    if (input.taxonomyAreaId) {
      const taxonomyArea = await researchAreaTaxonomyService.getActiveAreaById(input.taxonomyAreaId);
      if (!taxonomyArea) {
        throw new Error('Selected research area classification is no longer active. Please choose another classification.');
      }
      taxonomy = {
        areaId: taxonomyArea.id,
        level1Code: taxonomyArea.level1Code,
        level1Name: taxonomyArea.level1Name,
        level2Code: taxonomyArea.level2Code,
        level2Name: taxonomyArea.level2Name,
      };
    } else if (!taxonomyProvided && existingSavedArea) {
      taxonomy = serializeResearchAreaTaxonomy(existingSavedArea);
    } else if (!input.id && await researchAreaTaxonomyService.hasActiveTaxonomy()) {
      throw new Error('Please choose a Level 1 and Level 2 research area classification before saving.');
    }

    const normalizedText = buildResearchAreaNormalizedText({
      taxonomy,
      label: input.label,
      researchArea: input.researchArea,
      keywords: normalizedKeywords,
      disciplines: normalizedDisciplines,
    });
    const contentHash = buildContentHash(normalizedText);

    const area = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.researcherSavedResearchArea.updateMany({
          where: { user_id: userId, NOT: input.id ? { id: input.id } : undefined },
          data: { is_default: false },
        });
      }

      if (existing) {
        const updated = await tx.researcherSavedResearchArea.update({
          where: { id: existing.id },
          data: {
            label: normalizeWhitespace(input.label),
            research_area: normalizeWhitespace(input.researchArea),
            keywords: normalizedKeywords,
            disciplines: normalizedDisciplines,
            is_default: Boolean(input.isDefault),
            use_for_alerts: input.useForAlerts !== false,
            normalized_text: normalizedText,
            content_hash: contentHash,
          },
        });
        await tx.$executeRaw(Prisma.sql`
          UPDATE researcher_saved_research_areas
          SET taxonomy_area_id = ${taxonomy?.areaId || null},
              taxonomy_level1_code = ${taxonomy?.level1Code || null},
              taxonomy_level1_name = ${taxonomy?.level1Name || null},
              taxonomy_level2_code = ${taxonomy?.level2Code || null},
              taxonomy_level2_name = ${taxonomy?.level2Name || null}
          WHERE id = ${existing.id}
        `);
        return updated;
      }

      const created = await tx.researcherSavedResearchArea.create({
        data: {
          user_id: userId,
          label: normalizeWhitespace(input.label),
          research_area: normalizeWhitespace(input.researchArea),
          keywords: normalizedKeywords,
          disciplines: normalizedDisciplines,
          is_default: Boolean(input.isDefault),
          use_for_alerts: input.useForAlerts !== false,
          normalized_text: normalizedText,
          content_hash: contentHash,
        },
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE researcher_saved_research_areas
        SET taxonomy_area_id = ${taxonomy?.areaId || null},
            taxonomy_level1_code = ${taxonomy?.level1Code || null},
            taxonomy_level1_name = ${taxonomy?.level1Name || null},
            taxonomy_level2_code = ${taxonomy?.level2Code || null},
            taxonomy_level2_name = ${taxonomy?.level2Name || null}
        WHERE id = ${created.id}
      `);
      return created;
    });

    const shouldRegenerateEmbedding =
      !existing ||
      existing.content_hash !== contentHash ||
      existing.embedding_version !== RESEARCH_AREA_EMBEDDING_VERSION;

    if (shouldRegenerateEmbedding) {
      const { embedding } = await embeddingService.generateEmbedding(normalizedText);

      if (embedding.length > 0) {
        await prisma.$executeRaw`
          UPDATE researcher_saved_research_areas
          SET embedding = ${Prisma.raw(`'[${embedding.join(',')}]'::vector`)},
              embedding_version = ${RESEARCH_AREA_EMBEDDING_VERSION}
          WHERE id = ${area.id}
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE researcher_saved_research_areas
          SET embedding = NULL,
              embedding_version = NULL
          WHERE id = ${area.id}
        `;
      }
    }

    const refreshed = await querySavedResearchAreaById(area.id);
    if (!refreshed) {
      throw new Error('Failed to load saved research area');
    }

    return serializeResearchArea(refreshed);
  }

  async deleteResearchArea(userId: string, areaId: string): Promise<void> {
    const deleted = await prisma.researcherSavedResearchArea.deleteMany({
      where: { id: areaId, user_id: userId },
    });

    if (deleted.count === 0) {
      throw new Error('Saved research area not found');
    }
  }

  async getFinderContext(userId: string): Promise<ResearcherFinderContext> {
    const [profile, researchAreas] = await Promise.all([
      this.getProfile(userId),
      this.listResearchAreas(userId),
    ]);

    const defaultArea =
      researchAreas.find((area) => area.isDefault) ||
      (profile.profile.researchAreas[0]
        ? {
            id: '',
            label: 'Profile Research Area',
            researchArea: profile.profile.researchAreas[0],
            keywords: profile.profile.keywords,
            disciplines: [],
            isDefault: true,
            useForAlerts: true,
            normalizedText: profile.profile.researchAreas[0],
            embeddingVersion: null,
            taxonomy: null,
            createdAt: '',
            updatedAt: '',
          }
        : null);

    const profileDefaultContext = defaultArea
      ? {
          query: { researchArea: defaultArea.normalizedText || defaultArea.researchArea },
          filters: buildProfileDefaultFilters(profile.profile),
          sourceLabel: defaultArea.label,
          taxonomy: defaultArea.taxonomy,
        }
      : null;

    return {
      profile: profile.profile,
      notificationPreferences: profile.notificationPreferences,
      researchAreas,
      profileDefaultContext,
    };
  }

  async getResearchAreaEmbeddingCoverage(): Promise<ResearchAreaEmbeddingCoverage> {
    const rows = await prisma.$queryRaw<
      Array<{
        total: bigint | number;
        current: bigint | number;
        missing: bigint | number;
        stale: bigint | number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE embedding IS NOT NULL
            AND embedding_version = ${RESEARCH_AREA_EMBEDDING_VERSION}
        ) AS current,
        COUNT(*) FILTER (WHERE embedding IS NULL) AS missing,
        COUNT(*) FILTER (
          WHERE embedding IS NULL
             OR embedding_version IS NULL
             OR embedding_version <> ${RESEARCH_AREA_EMBEDDING_VERSION}
        ) AS stale
      FROM researcher_saved_research_areas
    `);

    const row = rows[0];
    return {
      total: Number(row?.total || 0),
      current: Number(row?.current || 0),
      missing: Number(row?.missing || 0),
      stale: Number(row?.stale || 0),
      embeddingVersion: RESEARCH_AREA_EMBEDDING_VERSION,
    };
  }

  async backfillResearchAreaEmbeddings(limit = 25): Promise<EmbeddingBackfillResult> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const candidates = await prisma.$queryRaw<SavedResearchAreaRow[]>(Prisma.sql`
      SELECT id, taxonomy_area_id, taxonomy_level1_code, taxonomy_level1_name, taxonomy_level2_code, taxonomy_level2_name,
             label, research_area, keywords, disciplines, is_default, use_for_alerts, normalized_text, embedding_version,
             created_at, updated_at
      FROM researcher_saved_research_areas
      WHERE embedding_version IS NULL
         OR embedding_version <> ${RESEARCH_AREA_EMBEDDING_VERSION}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `);

    const result: EmbeddingBackfillResult = {
      processed: candidates.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const area of candidates) {
      try {
        const normalizedText = buildResearchAreaNormalizedText({
          taxonomy: serializeResearchAreaTaxonomy(area),
          label: area.label,
          researchArea: area.research_area,
          keywords: normalizeTextArray(area.keywords),
          disciplines: normalizeTextArray(area.disciplines),
        }) || normalizeWhitespace(area.normalized_text || area.research_area || area.label || '');
        if (!normalizedText) {
          throw new Error('Saved research area has no text to embed');
        }

        const { embedding, error } = await embeddingService.generateEmbedding(normalizedText);
        if (error || embedding.length === 0) {
          throw new Error(error || 'Embedding generation returned no vector');
        }

        await prisma.$executeRaw`
          UPDATE researcher_saved_research_areas
          SET embedding = ${Prisma.raw(`'[${embedding.join(',')}]'::vector`)},
              embedding_version = ${RESEARCH_AREA_EMBEDDING_VERSION},
              normalized_text = ${normalizedText},
              content_hash = ${buildContentHash(normalizedText)}
          WHERE id = ${area.id}
        `;

        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          id: area.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}

export const researcherProfileService = new ResearcherProfileService();
