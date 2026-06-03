import {
  RECOMMENDATION_CAREER_STAGE_OPTIONS,
  RECOMMENDATION_FUNDING_KIND_OPTIONS,
  RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS,
} from './constants';
import type { RecommendationSearchFilters } from './types';
import { normalizeKey, normalizeWhitespace } from './utils';

export type PhraseFilterOperation = 'add' | 'set' | 'remove' | 'clear';
export type CountryFilterKey = 'eligibleCountries' | 'hostCountries' | 'funderCountries';

type PhraseRule<T extends string> = {
  value: T;
  patterns: RegExp[];
  labels: string[];
};

export interface ResearchPhraseSignals {
  confidence: number;
  operation: PhraseFilterOperation;
  searchLike: boolean;
  fundingKinds: string[];
  careerStages: string[];
  geographyScope: string[];
  topicSynonyms: string[];
  phraseHits: string[];
}

const FUNDING_KIND_RULES: Array<PhraseRule<(typeof RECOMMENDATION_FUNDING_KIND_OPTIONS)[number]>> = [
  {
    value: 'Research Grant',
    labels: ['research grant', 'project grant'],
    patterns: [/\bresearch grants?\b/, /\bproject grants?\b/],
  },
  {
    value: 'Travel Grant',
    labels: ['travel grant', 'travel funding', 'conference travel', 'presenting at conference'],
    patterns: [
      /\btravel grants?\b/,
      /\btravel funding\b/,
      /\btravel support\b/,
      /\bconference travel\b/,
      /\bconference attendance\b/,
      /\bpresenting at (?:a |the )?conference\b/,
    ],
  },
  {
    value: 'Conference Grant',
    labels: ['conference grant', 'conference funding', 'conference support', 'presenting at conference'],
    patterns: [
      /\bconference grants?\b/,
      /\bconference funding\b/,
      /\bconference support\b/,
      /\bconference travel\b/,
      /\btravel grants?\b.*\bconference\b/,
      /\bconference\b.*\btravel grants?\b/,
      /\bpresenting at (?:a |the )?conference\b/,
    ],
  },
  {
    value: 'Fellowship',
    labels: ['fellowship', 'postdoc fellowship', 'faculty fellowship', 'visiting fellowship'],
    patterns: [/\bfellowships?\b/, /\bpostdoc(?:toral)? fellowships?\b/, /\bfaculty fellowships?\b/, /\bvisiting fellowships?\b/],
  },
  {
    value: 'Scholarship',
    labels: ['scholarship', 'studentship', 'phd funding', 'doctoral funding'],
    patterns: [/\bscholarships?\b/, /\bstudentships?\b/, /\bphd funding\b/, /\bdoctoral funding\b/],
  },
  {
    value: 'Seed Grant',
    labels: ['seed funding', 'pilot grant', 'pump priming', 'proof of concept'],
    patterns: [/\bseed funding\b/, /\bseed grants?\b/, /\bpilot grants?\b/, /\bpump priming\b/, /\bproof of concept\b/],
  },
  {
    value: 'Equipment Grant',
    labels: ['equipment grant', 'equipment funding', 'instrumentation', 'lab equipment'],
    patterns: [/\bequipment grants?\b/, /\bequipment funding\b/, /\binstrumentation\b/, /\blab(?:oratory)? equipment\b/],
  },
  {
    value: 'Infrastructure',
    labels: ['infrastructure', 'facility upgrade', 'core facility'],
    patterns: [/\binfrastructure(?: grants?| funding)?\b/, /\bfacilit(?:y|ies) upgrade\b/, /\bcore facilit(?:y|ies)\b/],
  },
  {
    value: 'Training Grant',
    labels: ['training grant', 'capacity building', 'workshop support'],
    patterns: [/\btraining grants?\b/, /\bcapacity building\b/, /\bworkshop support\b/, /\bshort courses?\b/],
  },
  {
    value: 'Mobility Grant',
    labels: ['mobility grant', 'exchange visit', 'visiting researcher', 'research visit'],
    patterns: [/\bmobility grants?\b/, /\bexchange visits?\b/, /\bvisiting researcher\b/, /\bresearch visits?\b/, /\bresearch stay\b/],
  },
];

const CAREER_STAGE_RULES: Array<PhraseRule<(typeof RECOMMENDATION_CAREER_STAGE_OPTIONS)[number]>> = [
  {
    value: 'Early Career Researcher',
    labels: ['early career', 'ECR', 'new investigator', 'young investigator'],
    patterns: [/\bearly career\b/, /\becr\b/, /\bnew investigator\b/, /\byoung investigator\b/],
  },
  {
    value: 'Early Career Faculty',
    labels: ['early career faculty'],
    patterns: [/\bearly career faculty\b/],
  },
  {
    value: 'Postdoctoral',
    labels: ['postdoc', 'postdoctoral'],
    patterns: [/\bpostdocs?\b/, /\bpostdoctoral\b/],
  },
  {
    value: 'PhD',
    labels: ['PhD', 'doctoral'],
    patterns: [/\bphd\b/, /\bdoctoral\b/, /\bdoctorate\b/],
  },
  {
    value: 'Principal Investigator',
    labels: ['PI', 'principal investigator', 'faculty'],
    patterns: [/\bpi\b/, /\bprincipal investigator\b/, /\bfaculty\b/],
  },
  {
    value: 'Masters',
    labels: ['masters', 'master student'],
    patterns: [/\bmasters?\b/, /\bmaster students?\b/],
  },
  {
    value: 'Undergraduate',
    labels: ['undergraduate'],
    patterns: [/\bundergraduates?\b/],
  },
];

const GEOGRAPHY_SCOPE_RULES: Array<PhraseRule<(typeof RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS)[number]>> = [
  { value: 'Global', labels: ['global', 'worldwide'], patterns: [/\bglobal\b/, /\bworldwide\b/] },
  { value: 'International', labels: ['international'], patterns: [/\binternational\b/] },
  { value: 'National', labels: ['national', 'domestic'], patterns: [/\bnational\b/, /\bdomestic\b/] },
  { value: 'Regional', labels: ['regional'], patterns: [/\bregional\b/] },
];

const TOPIC_SYNONYM_RULES: Array<{ labels: string[]; patterns: RegExp[]; terms: string[] }> = [
  {
    labels: ['women researchers', 'women centric', 'female scientists', 'gender equity'],
    patterns: [/\bwomen researchers?\b/, /\bwomen cent(?:e|r)ric\b/, /\bfemale scientists?\b/, /\bgender equity\b/, /\bwomen in stem\b/],
    terms: ['women researchers', 'female scientists', 'gender equity', 'women in STEM'],
  },
  {
    labels: ['ASD', 'autism'],
    patterns: [/\basd\b/, /\bautism\b/, /\bautism spectrum disorder\b/],
    terms: ['autism', 'autism spectrum disorder', 'ASD', 'neurodevelopment', 'assistive technology'],
  },
  {
    labels: ['AI', 'artificial intelligence'],
    patterns: [/\bai\b/, /\bartificial intelligence\b/, /\bmachine learning\b/],
    terms: ['artificial intelligence', 'machine learning'],
  },
  {
    labels: ['infectious disease'],
    patterns: [/\binfectious diseases?\b/, /\binfection\b/, /\bpathogens?\b/],
    terms: ['infectious disease', 'infection', 'pathogens', 'public health', 'biomedical'],
  },
  {
    labels: ['biomedical'],
    patterns: [/\bbiomedical\b/, /\blife sciences?\b/],
    terms: ['biomedical research', 'life sciences', 'health research'],
  },
];

export const RESEARCH_TOPIC_STOP_TERMS = [
  'research',
  'funding',
  'fund',
  'funds',
  'grant',
  'grants',
  'project',
  'projects',
  'study',
  'studies',
  'system',
  'systems',
  'method',
  'methods',
  'work',
  'option',
  'options',
  'call',
  'calls',
  'opportunity',
  'opportunities',
];

const BROAD_SEARCH_PATTERNS = [
  /\bfunding for\b/,
  /\bfunding options? for\b/,
  /\bcalls? for\b/,
  /\bopportunities in\b/,
  /\bopportunities for\b/,
  /\bresearch funding\b/,
  /\bgrant funding\b/,
];

const SEARCH_LIKE_PATTERNS = [
  /\bfind\b/,
  /\bshow\b/,
  /\bsearch\b/,
  /\brecommend\b/,
  /\bgive\b/,
  /\blooking for\b/,
  /\bneed\b/,
  /\bfunding\b/,
  /\bgrants?\b/,
  /\bcalls?\b/,
  /\bopportunit(?:y|ies)\b/,
];

const CLEAR_FILTER_PATTERNS = [
  /\bclear all filters?\b/,
  /\breset filters?\b/,
  /\bremove all filters?\b/,
  /\bstart over\b/,
];

const REMOVE_FILTER_PATTERNS = [
  /\bremove\b/,
  /\bexclude\b/,
  /\bwithout\b/,
  /\bnot\b/,
];

const SET_FILTER_PATTERNS = [
  /\bonly\b/,
  /\bjust\b/,
  /\bshow only\b/,
];

export const COUNTRY_DEMONYM_ALIASES: Record<string, string> = {
  indian: 'India',
  german: 'Germany',
  british: 'United Kingdom',
  english: 'United Kingdom',
  scottish: 'United Kingdom',
  welsh: 'United Kingdom',
  american: 'United States',
  canadian: 'Canada',
  australian: 'Australia',
  chinese: 'China',
  japanese: 'Japan',
  korean: 'South Korea',
  french: 'France',
  spanish: 'Spain',
  italian: 'Italy',
  dutch: 'Netherlands',
  singaporean: 'Singapore',
  malaysian: 'Malaysia',
  thai: 'Thailand',
  vietnamese: 'Vietnam',
  indonesian: 'Indonesia',
  pakistani: 'Pakistan',
  bangladeshi: 'Bangladesh',
  sri: 'Sri Lanka',
  lankan: 'Sri Lanka',
  nepali: 'Nepal',
  brazilian: 'Brazil',
  mexican: 'Mexico',
};

function addUnique<T extends string>(target: Set<T>, value: T) {
  target.add(value);
}

function matchRules<T extends string>(normalized: string, rules: Array<PhraseRule<T>>) {
  const values = new Set<T>();
  const hits = new Set<string>();

  rules.forEach((rule) => {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      addUnique(values, rule.value);
      rule.labels.forEach((label) => hits.add(label));
    }
  });

  return { values: Array.from(values), hits: Array.from(hits) };
}

export function resolvePhraseFilterOperation(message: string): PhraseFilterOperation {
  const normalized = normalizeKey(message);
  if (!normalized) return 'add';
  if (CLEAR_FILTER_PATTERNS.some((pattern) => pattern.test(normalized))) return 'clear';
  if (REMOVE_FILTER_PATTERNS.some((pattern) => pattern.test(normalized))) return 'remove';
  if (SET_FILTER_PATTERNS.some((pattern) => pattern.test(normalized))) return 'set';
  return 'add';
}

export function isResearchSearchLike(message: string) {
  const normalized = normalizeKey(message);
  return SEARCH_LIKE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isBroadResearchSearch(message: string) {
  const normalized = normalizeKey(message);
  return BROAD_SEARCH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractResearchPhraseSignals(message: string): ResearchPhraseSignals {
  const normalized = normalizeKey(message);
  const funding = matchRules(normalized, FUNDING_KIND_RULES);
  const career = matchRules(normalized, CAREER_STAGE_RULES);
  const geography = matchRules(normalized, GEOGRAPHY_SCOPE_RULES);
  const topicSynonyms = new Set<string>();
  const topicHits = new Set<string>();

  TOPIC_SYNONYM_RULES.forEach((rule) => {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      rule.terms.forEach((term) => topicSynonyms.add(term));
      rule.labels.forEach((label) => topicHits.add(label));
    }
  });

  const phraseHits = Array.from(new Set([...funding.hits, ...career.hits, ...geography.hits, ...topicHits]));
  const searchLike = isResearchSearchLike(message);
  const confidence = phraseHits.length > 0 || searchLike ? 0.95 : 0.4;

  return {
    confidence,
    operation: resolvePhraseFilterOperation(message),
    searchLike,
    fundingKinds: funding.values,
    careerStages: career.values,
    geographyScope: geography.values,
    topicSynonyms: Array.from(topicSynonyms),
    phraseHits,
  };
}

export function compactResearchPhraseSignals(message: string) {
  const signals = extractResearchPhraseSignals(message);
  return {
    operation: signals.operation,
    searchLike: signals.searchLike,
    fundingKinds: signals.fundingKinds,
    careerStages: signals.careerStages,
    geographyScope: signals.geographyScope,
    topicSynonyms: signals.topicSynonyms.slice(0, 8),
    phraseHits: signals.phraseHits.slice(0, 12),
  };
}

export function resolveCountryRoleFromMessage(message: string): CountryFilterKey {
  const normalized = normalizeKey(message);
  if (
    /\b(funder|funders|funding from|funded by|agency|agencies|sponsor|sponsors|sponsored by|grantmaker|grantmakers)\b/.test(normalized)
  ) {
    return 'funderCountries';
  }

  if (
    /\b(host|hosted|holding|held|tenable|located|location|conference|workshop|event|takes place|take place|visit|visiting|exchange|fieldwork|placement|research stay)\b/.test(normalized)
  ) {
    return 'hostCountries';
  }

  return 'eligibleCountries';
}

export function hasExplicitCountryRoleCue(message: string) {
  const normalized = normalizeKey(message);
  return /\b(open to|eligible for|eligible to|based in|resident|citizen|citizenship|host|hosted|tenable|located|conference|workshop|visit|visiting|exchange|funding from|funded by|funder|funders|sponsor|sponsored by|agency|agencies)\b/.test(normalized);
}

export function normalizeDemonymCountry(value: string) {
  const normalized = normalizeKey(value);
  if (!normalized) return '';
  if (COUNTRY_DEMONYM_ALIASES[normalized]) {
    return COUNTRY_DEMONYM_ALIASES[normalized];
  }
  if (normalized === 'south korean') return 'South Korea';
  if (normalized === 'north korean') return 'North Korea';
  if (normalized === 'new zealander') return 'New Zealand';
  if (normalized === 'sri lankan') return 'Sri Lanka';
  return '';
}

export function buildCountryRemovalTerms(message: string, countries: string[]) {
  const normalized = normalizeKey(message);
  const terms = new Set<string>(countries);
  Object.entries(COUNTRY_DEMONYM_ALIASES).forEach(([demonym, country]) => {
    if (country && normalized.includes(demonym) && countries.includes(country)) {
      terms.add(demonym);
    }
  });
  ['south korean', 'north korean', 'new zealander', 'sri lankan'].forEach((demonym) => {
    const country = normalizeDemonymCountry(demonym);
    if (country && normalized.includes(demonym) && countries.includes(country)) {
      terms.add(demonym);
    }
  });
  return Array.from(terms);
}

export function getLexiconRemovalTerms() {
  const terms = new Set<string>(RESEARCH_TOPIC_STOP_TERMS);
  [...FUNDING_KIND_RULES, ...CAREER_STAGE_RULES, ...GEOGRAPHY_SCOPE_RULES].forEach((rule) => {
    rule.labels.forEach((label) => terms.add(label));
    rule.value && terms.add(rule.value);
  });
  return Array.from(terms).map((term) => normalizeWhitespace(term)).filter(Boolean);
}

export function applyArrayFilterOperation<T extends string>(
  current: T[],
  incoming: T[],
  operation: PhraseFilterOperation
) {
  if (incoming.length === 0) return current;
  if (operation === 'clear') return [];
  if (operation === 'remove') {
    const removeSet = new Set(incoming);
    return current.filter((value) => !removeSet.has(value));
  }
  if (operation === 'set') return Array.from(new Set(incoming));
  return Array.from(new Set([...current, ...incoming]));
}

export function clearCountryFiltersForValues(
  filters: Required<RecommendationSearchFilters>,
  countries: string[]
) {
  const removeSet = new Set(countries);
  filters.eligibleCountries = filters.eligibleCountries.filter((value) => !removeSet.has(value));
  filters.hostCountries = filters.hostCountries.filter((value) => !removeSet.has(value));
  filters.funderCountries = filters.funderCountries.filter((value) => !removeSet.has(value));
  filters.citizenshipRequirements = filters.citizenshipRequirements.filter((value) => !removeSet.has(value));
  filters.residencyRequirements = filters.residencyRequirements.filter((value) => !removeSet.has(value));
}
