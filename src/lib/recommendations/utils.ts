import crypto from 'crypto';
const isoCountries = require('i18n-iso-countries');
const isoCountriesEnglish = require('i18n-iso-countries/langs/en.json');
import {
  APPLICATION_LANGUAGE_OPTIONS,
  ELIGIBLE_REGION_OPTIONS,
  FUNDING_KIND_OPTIONS,
  SPONSOR_TYPE_OPTIONS,
} from '../fundingIntake/constants';
import {
  CAREER_STAGE_ALIASES,
  FUNDING_KIND_ALIASES,
  GEOGRAPHY_SCOPE_ALIASES,
  INSTITUTION_TYPE_ALIASES,
  RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS,
  RECOMMENDATION_CAREER_STAGE_OPTIONS,
  RECOMMENDATION_FUNDING_KIND_OPTIONS,
  RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS,
  RECOMMENDATION_INSTITUTION_TYPE_OPTIONS,
  RECOMMENDATION_REGION_OPTIONS,
  RECOMMENDATION_SPONSOR_TYPE_OPTIONS,
  REGION_ALIASES,
  RESEARCH_AREA_EXPANSIONS,
  RESEARCH_AREA_MAX_LENGTH,
  SPONSOR_TYPE_ALIASES,
} from './constants';
import type {
  NormalizedRecommendationSearchRequest,
  PaperMetadataQuery,
  RecommendationSearchFilters,
  RecommendationSearchRequest,
  ResearchAreaQuery,
} from './types';

const countryDisplayNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' as Intl.DisplayNamesOptions['type'] })
    : null;

const countryNameLookup = new Map<string, string>();
const countryCodeLookup = new Map<string, string>();

function registerCountryAlias(alias: string, canonical: string) {
  countryNameLookup.set(normalizeKey(alias), canonical);
}

function registerCountryCode(code: string, canonical: string) {
  countryCodeLookup.set(normalizeKey(code), canonical);
}

[
  ['usa', 'United States'],
  ['u.s.a.', 'United States'],
  ['us', 'United States'],
  ['u.s.', 'United States'],
  ['uk', 'United Kingdom'],
  ['u.k.', 'United Kingdom'],
  ['uae', 'United Arab Emirates'],
  ['south korea', 'South Korea'],
  ['republic of korea', 'South Korea'],
  ['north korea', 'North Korea'],
  ['russia', 'Russia'],
  ['viet nam', 'Vietnam'],
  ['czech republic', 'Czechia'],
].forEach(([alias, canonical]) => registerCountryAlias(alias, canonical));

isoCountries.registerLocale(isoCountriesEnglish);

Object.entries<string>(isoCountries.getNames('en', { select: 'official' })).forEach(([countryCode, countryName]) => {
  if (!countryName) {
    return;
  }
  registerCountryAlias(countryName, countryName);
  registerCountryCode(countryCode, countryName);

  const alpha3 = isoCountries.alpha2ToAlpha3(countryCode);
  if (alpha3) {
    registerCountryCode(alpha3, countryName);
  }
});

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeKey(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampArray(values: unknown[], maxItems: number): string[] {
  return values
    .map((value) => normalizeWhitespace(String(value || '')))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function parseListInput(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

export function normalizeCountryInput(
  value: string,
  options: { allowIsoCodes?: boolean } = {}
): string | null {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return null;
  }
  const canonical = countryNameLookup.get(normalized);
  if (canonical) {
    return canonical;
  }

  if (options.allowIsoCodes !== false) {
    const codeMatch = countryCodeLookup.get(normalized);
    if (codeMatch) {
      return codeMatch;
    }
  }

  if (options.allowIsoCodes !== false && countryDisplayNames && /^[a-z]{2}$/i.test(normalized)) {
    try {
      const fromCode = countryDisplayNames.of(normalized.toUpperCase());
      if (fromCode && normalizeKey(fromCode) !== normalized) {
        return fromCode;
      }
    } catch {}
  }

  if (options.allowIsoCodes !== false && /^[a-z]{3}$/i.test(normalized)) {
    try {
      const alpha2 = isoCountries.alpha3ToAlpha2(normalized.toUpperCase());
      if (alpha2) {
        const fromAlpha3 = isoCountries.getName(alpha2, 'en', { select: 'official' });
        if (fromAlpha3) {
          return fromAlpha3;
        }
      }
    } catch {}
  }

  const titled = titleCase(value);
  if (countryNameLookup.has(normalizeKey(titled))) {
    return countryNameLookup.get(normalizeKey(titled)) || null;
  }

  return null;
}

export function normalizeCountryList(values: string[]): string[] | null {
  const normalized = values
    .map((value) => normalizeCountryInput(value))
    .filter((value): value is string => Boolean(value));

  if (normalized.length !== values.filter((value) => normalizeWhitespace(value)).length) {
    return null;
  }

  return Array.from(new Set(normalized));
}

export function buildCountryMatchKeys(values: string[]): string[] {
  const keys = new Set<string>();

  values.forEach((value) => {
    const canonical = normalizeCountryInput(value);
    if (!canonical) {
      return;
    }

    keys.add(normalizeKey(canonical));

    countryNameLookup.forEach((mappedCanonical, aliasKey) => {
      if (mappedCanonical === canonical) {
        keys.add(aliasKey);
      }
    });
  });

  return Array.from(keys);
}

function normalizeFromAliasMap(
  values: string[],
  aliasMap: Record<string, string>,
  allowedValues: readonly string[]
): string[] | null {
  const allowed = new Set(allowedValues);
  const normalized = values
    .map((value) => {
      const key = normalizeKey(value);
      if (!key) {
        return null;
      }
      if (aliasMap[key]) {
        return aliasMap[key];
      }
      const titled = titleCase(value);
      if (allowed.has(titled)) {
        return titled;
      }
      const exact = allowedValues.find((option) => normalizeKey(option) === key);
      return exact || null;
    })
    .filter((value): value is string => Boolean(value));

  if (normalized.length !== values.filter((value) => normalizeWhitespace(value)).length) {
    return null;
  }

  return Array.from(new Set(normalized));
}

function stripResearchQueryBoilerplate(input: string) {
  return [
    /^funding opportunities related to\s*-\s*/i,
    /^opportunities related to\s*-\s*/i,
    /^(is there any|are there any)\s+funding\s+(?:opportunities\s+)?(?:in|for|around)\s+/i,
    /^(find|show|search for|looking for|i need|need)\s+(?:funding|funding opportunities|opportunities)\s+(?:in|for|around)?\s*/i,
    /^(find|show|search for|looking for)\s+/i,
  ]
    .reduce((value, pattern) => value.replace(pattern, ''), input)
    .replace(/^\bthe\b\s+/i, '')
    .replace(/\s+\barea\b$/i, '')
    .trim();
}

export function normalizeRegionList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, REGION_ALIASES, RECOMMENDATION_REGION_OPTIONS);
}

export function normalizeGeographyScopeList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, GEOGRAPHY_SCOPE_ALIASES, RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS);
}

export function normalizeFundingKindList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, FUNDING_KIND_ALIASES, RECOMMENDATION_FUNDING_KIND_OPTIONS);
}

export function normalizeInstitutionTypeList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, INSTITUTION_TYPE_ALIASES, RECOMMENDATION_INSTITUTION_TYPE_OPTIONS);
}

export function normalizeCareerStageList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, CAREER_STAGE_ALIASES, RECOMMENDATION_CAREER_STAGE_OPTIONS);
}

export function normalizeSponsorTypeList(values: string[]): string[] | null {
  return normalizeFromAliasMap(values, SPONSOR_TYPE_ALIASES, RECOMMENDATION_SPONSOR_TYPE_OPTIONS);
}

export function normalizeApplicationLanguageList(values: string[]): string[] | null {
  return normalizeFromAliasMap(
    values,
    Object.fromEntries(RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS.map((value) => [normalizeKey(value), value])),
    RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS
  );
}

function tokenizeText(input: string, maxTokens = 30): string[] {
  const preservedShortTokens = new Set(['ai', 'ml', 'nlp', 'cv', 'llm', 'ar', 'vr', 'xr', 'ui', 'ux']);
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'into', 'onto', 'from', 'that', 'this', 'these', 'those',
    'are', 'is', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'about', 'over',
    'under', 'between', 'through', 'during', 'across', 'using', 'used', 'within', 'their', 'there', 'where',
    'funding', 'opportunity', 'opportunities', 'find', 'show', 'search', 'looking', 'need', 'related', 'area',
  ]);

  const tokens = normalizeKey(input)
    .split(/\s+/)
    .filter((token) => (token.length > 2 || preservedShortTokens.has(token)) && !stopWords.has(token));

  return Array.from(new Set(tokens)).slice(0, maxTokens);
}

function expandResearchTags(tags: string[]): string[] {
  const expanded = new Set<string>();
  tags.forEach((tag) => {
    const normalized = normalizeKey(tag);
    if (!normalized) {
      return;
    }
    expanded.add(tag);
    const directExpansion = RESEARCH_AREA_EXPANSIONS[normalized];
    if (directExpansion) {
      directExpansion.forEach((item) => expanded.add(item));
    }
  });
  return Array.from(expanded);
}

function buildResearchAreaFullTextQuery(terms: string[]) {
  const uniqueTerms = Array.from(new Set(terms.map((term) => normalizeWhitespace(term)).filter(Boolean)));
  return uniqueTerms
    .map((term) => (term.includes(' ') ? `"${term}"` : term))
    .join(' OR ');
}

function formatKeywords(keywords?: string[]): string[] {
  return clampArray(keywords || [], 20).map((item) => item.slice(0, 64));
}

function detectQueryStrength(params: {
  title: string | null;
  abstract: string | null;
  keywords: string[];
  researchArea: string | null;
}): 'weak' | 'normal' | 'rich' {
  if (params.researchArea) {
    const tokenCount = tokenizeText(params.researchArea).length;
    if (tokenCount <= 2) {
      return 'weak';
    }
    return tokenCount >= 5 ? 'rich' : 'normal';
  }

  const titleLength = params.title?.length || 0;
  const abstractLength = params.abstract?.length || 0;
  const keywordCount = params.keywords.length;

  if (abstractLength >= 300 || keywordCount >= 5) {
    return 'rich';
  }

  if (abstractLength >= 120 || titleLength >= 20 || keywordCount >= 2) {
    return 'normal';
  }

  return 'weak';
}

function buildPaperMetadataQuery(query: PaperMetadataQuery) {
  const title = normalizeWhitespace((query.title || '').slice(0, 300)) || null;
  const abstractSource = normalizeWhitespace(query.abstract || '');
  const truncated = abstractSource.length > 10_000;
  const abstract = abstractSource ? abstractSource.slice(0, 10_000) : null;
  const keywords = formatKeywords(query.keywords);

  const researchTags = expandResearchTags([
    ...keywords,
    ...(title ? tokenizeText(title, 8) : []),
  ]);

  const semanticDocument = [
    title ? `Title: ${title}` : '',
    abstract ? `Abstract: ${abstract}` : '',
    keywords.length > 0 ? `Keywords: ${keywords.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const fullTextQuery = [title || '', keywords.join(' '), abstract ? abstract.slice(0, 500) : '']
    .join(' ')
    .trim();

  return {
    inputMode: 'paper_metadata' as const,
    title,
    abstract,
    keywords,
    researchArea: null,
    truncated,
    canonicalQueryText: [title || '', abstract || '', keywords.join(', ')].filter(Boolean).join(' | '),
    semanticDocument,
    fullTextQuery,
    researchTags,
  };
}

function buildResearchAreaModeQuery(query: ResearchAreaQuery) {
  // Hard cap regardless of source (client, LLM, persisted state): the topic is
  // embedded, expanded and replayed into later prompts, so it must stay bounded.
  const rawResearchArea = normalizeWhitespace((query.researchArea || '').slice(0, RESEARCH_AREA_MAX_LENGTH));
  const researchArea = stripResearchQueryBoilerplate(rawResearchArea) || rawResearchArea;
  const extractedTags = tokenizeText(researchArea, 12);
  const expandedTags = expandResearchTags([researchArea, ...extractedTags]);
  const fullTextQuery = buildResearchAreaFullTextQuery([researchArea, ...expandedTags]);

  return {
    inputMode: 'research_area' as const,
    title: null,
    abstract: null,
    keywords: [],
    researchArea,
    truncated: false,
    canonicalQueryText: researchArea,
    semanticDocument: [
      researchArea ? `Research area: ${researchArea}` : '',
      extractedTags.length > 0 ? `Keywords: ${extractedTags.join(', ')}` : '',
      expandedTags.length > 0 ? `Related terms: ${expandedTags.join(', ')}` : '',
    ].filter(Boolean).join('\n'),
    fullTextQuery,
    researchTags: expandedTags,
  };
}

function normalizeDateString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = normalizeWhitespace(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export function normalizeRecommendationSearchRequest(
  request: RecommendationSearchRequest
): NormalizedRecommendationSearchRequest {
  const inputMode = request.inputMode;
  const normalizedQuery =
    inputMode === 'paper_metadata'
      ? buildPaperMetadataQuery(request.query as PaperMetadataQuery)
      : buildResearchAreaModeQuery(request.query as ResearchAreaQuery);

  normalizedQuery.fullTextQuery =
    inputMode === 'paper_metadata'
      ? tokenizeText(normalizedQuery.fullTextQuery, 20).join(' ')
      : buildResearchAreaFullTextQuery([normalizedQuery.researchArea || '', ...normalizedQuery.researchTags].slice(0, 20));
  const queryStrength = detectQueryStrength(normalizedQuery);

  const filters = request.filters || {};
  const normalizedFilters: Required<RecommendationSearchFilters> = {
    geographyScope: normalizeGeographyScopeList(clampArray(filters.geographyScope || [], 20)) || [],
    eligibleCountries: normalizeCountryList(clampArray(filters.eligibleCountries || [], 20)) || [],
    eligibleRegions: normalizeRegionList(clampArray(filters.eligibleRegions || [], 20)) || [],
    hostCountries: normalizeCountryList(clampArray(filters.hostCountries || [], 20)) || [],
    funderCountries: normalizeCountryList(clampArray(filters.funderCountries || [], 20)) || [],
    fundingKinds: normalizeFundingKindList(clampArray(filters.fundingKinds || [], 20)) || [],
    institutionTypes: normalizeInstitutionTypeList(clampArray(filters.institutionTypes || [], 20)) || [],
    careerStages: normalizeCareerStageList(clampArray(filters.careerStages || [], 20)) || [],
    citizenshipRequirements: clampArray(filters.citizenshipRequirements || [], 20),
    residencyRequirements: clampArray(filters.residencyRequirements || [], 20),
    applicationLanguages:
      normalizeApplicationLanguageList(clampArray(filters.applicationLanguages || [], 20)) || [],
    sponsorTypes: normalizeSponsorTypeList(clampArray(filters.sponsorTypes || [], 20)) || [],
    taxonomyAreaIds: clampArray(filters.taxonomyAreaIds || [], 50),
    deadlineFrom: normalizeDateString(filters.deadlineFrom) || '',
    deadlineTo: normalizeDateString(filters.deadlineTo) || '',
    rollingOnly: Boolean(filters.rollingOnly),
    amountMin: typeof filters.amountMin === 'number' ? filters.amountMin : null,
    amountMax: typeof filters.amountMax === 'number' ? filters.amountMax : null,
    includeExpired: Boolean(filters.includeExpired),
    limit: Math.min(Math.max(filters.limit || 10, 1), 25),
    sort: filters.sort === 'deadline_soonest' ? 'deadline_soonest' : 'best_match',
  };

  return {
    inputMode,
    filters: normalizedFilters,
    normalizedQuery: {
      ...normalizedQuery,
      queryStrength,
    },
  };
}

export function validateRecommendationRequest(request: RecommendationSearchRequest): string | null {
  if (request.inputMode === 'paper_metadata') {
    const query = request.query as PaperMetadataQuery;
    const title = normalizeWhitespace(query.title || '');
    const abstract = normalizeWhitespace(query.abstract || '');
    const keywords = formatKeywords(query.keywords);

    const hasMeaningfulTitle = title.length >= 10;
    const hasMeaningfulAbstract = abstract.length >= 120;
    const hasKeywords = keywords.length > 0;

    if (!hasMeaningfulTitle && !hasMeaningfulAbstract && !hasKeywords) {
      return 'paper_metadata requires a title, abstract, or keywords with meaningful content';
    }
    return null;
  }

  const query = request.query as ResearchAreaQuery;
  const researchArea = normalizeWhitespace(query.researchArea || '');
  const researchAreaKey = normalizeKey(researchArea);
  const shortResearchTerms = new Set(['ai', 'ml', 'nlp', 'cv', 'llm', 'ar', 'vr', 'xr', 'ui', 'ux']);
  if (researchArea.length < 3 && !shortResearchTerms.has(researchAreaKey)) {
    return 'researchArea must be at least 3 characters';
  }
  return null;
}

export function validateNormalizedControlledFilters(filters: RecommendationSearchFilters): string | null {
  if (filters.fundingKinds && normalizeFundingKindList(filters.fundingKinds) === null) {
    return `Unknown fundingKinds value. Allowed values include: ${FUNDING_KIND_OPTIONS.join(', ')}`;
  }
  if (filters.institutionTypes && normalizeInstitutionTypeList(filters.institutionTypes) === null) {
    return `Unknown institutionTypes value. Allowed values include: ${RECOMMENDATION_INSTITUTION_TYPE_OPTIONS.join(', ')}`;
  }
  if (filters.careerStages && normalizeCareerStageList(filters.careerStages) === null) {
    return `Unknown careerStages value. Allowed values include: ${RECOMMENDATION_CAREER_STAGE_OPTIONS.join(', ')}`;
  }
  if (filters.sponsorTypes && normalizeSponsorTypeList(filters.sponsorTypes) === null) {
    return `Unknown sponsorTypes value. Allowed values include: ${SPONSOR_TYPE_OPTIONS.join(', ')}`;
  }
  if (filters.geographyScope && normalizeGeographyScopeList(filters.geographyScope) === null) {
    return `Unknown geographyScope value. Allowed values include: ${RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS.join(', ')}`;
  }
  if (filters.applicationLanguages && normalizeApplicationLanguageList(filters.applicationLanguages) === null) {
    return `Unknown applicationLanguages value. Allowed values include: ${APPLICATION_LANGUAGE_OPTIONS.join(', ')}`;
  }
  if (filters.eligibleRegions && normalizeRegionList(filters.eligibleRegions) === null) {
    return `Unknown eligibleRegions value. Allowed values include: ${ELIGIBLE_REGION_OPTIONS.join(', ')}`;
  }
  if (filters.eligibleCountries && normalizeCountryList(filters.eligibleCountries) === null) {
    return 'Unknown eligibleCountries value. Use recognizable country names or ISO country codes.';
  }
  if (filters.hostCountries && normalizeCountryList(filters.hostCountries) === null) {
    return 'Unknown hostCountries value. Use recognizable country names or ISO country codes.';
  }
  if (filters.funderCountries && normalizeCountryList(filters.funderCountries) === null) {
    return 'Unknown funderCountries value. Use recognizable country names or ISO country codes.';
  }
  return null;
}

export function createRequestHash(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function summarizeFilters(filters: RecommendationSearchFilters): string {
  const pieces = [
    filters.geographyScope?.length ? `geographyScope=${filters.geographyScope.length}` : '',
    filters.eligibleCountries?.length ? `eligibleCountries=${filters.eligibleCountries.length}` : '',
    filters.eligibleRegions?.length ? `eligibleRegions=${filters.eligibleRegions.length}` : '',
    filters.hostCountries?.length ? `hostCountries=${filters.hostCountries.length}` : '',
    filters.fundingKinds?.length ? `fundingKinds=${filters.fundingKinds.length}` : '',
    filters.institutionTypes?.length ? `institutionTypes=${filters.institutionTypes.length}` : '',
    filters.careerStages?.length ? `careerStages=${filters.careerStages.length}` : '',
    filters.sponsorTypes?.length ? `sponsorTypes=${filters.sponsorTypes.length}` : '',
    filters.taxonomyAreaIds?.length ? `taxonomyAreaIds=${filters.taxonomyAreaIds.length}` : '',
    filters.deadlineFrom ? 'deadlineFrom=1' : '',
    filters.deadlineTo ? 'deadlineTo=1' : '',
    filters.rollingOnly ? 'rollingOnly=1' : '',
  ].filter(Boolean);

  return pieces.join(', ') || 'none';
}

export function formatFundingAmount(amountMin: number | null, amountMax: number | null, currency: string | null): string | null {
  if (amountMin === null && amountMax === null) {
    return null;
  }
  if (amountMin !== null && amountMax !== null) {
    return `${currency || ''} ${amountMin} - ${amountMax}`.trim();
  }
  return `${currency || ''} ${amountMin ?? amountMax}`.trim();
}
