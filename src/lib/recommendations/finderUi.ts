import type { RecommendationConversationMessageRequest } from './chatTypes';
import type {
  RecommendationSearchFilters,
  RecommendationStrictFilterRecovery,
} from './types';
import type { ResearcherFinderContext } from '../researcherProfile/types';
import {
  cloneRequiredFilters,
  formatFilterDescription,
  isActiveFilterValue,
} from './filterChips';

export { FILTER_LABELS } from './filterChips';

export function describeFiltersByKeys(
  filters: Required<RecommendationSearchFilters>,
  keys: Array<keyof RecommendationSearchFilters>
) {
  const seen = new Set<string>();
  const descriptions: string[] = [];

  for (const key of keys) {
    if (!isActiveFilterValue(filters[key])) {
      continue;
    }
    const description = formatFilterDescription(filters, key);
    if (description && !seen.has(description)) {
      seen.add(description);
      descriptions.push(description);
    }
  }

  return descriptions;
}

export function describeStrictRecoveryFilters(
  filters: Required<RecommendationSearchFilters>,
  recovery: RecommendationStrictFilterRecovery
) {
  return describeFiltersByKeys(filters, recovery.relaxedFilterKeys);
}

export function describeStrictRecoverySentence(
  filters: Required<RecommendationSearchFilters>,
  recovery: RecommendationStrictFilterRecovery
) {
  const restrictiveFilters = describeStrictRecoveryFilters(filters, recovery);

  if (restrictiveFilters.length === 0) {
    return 'The last search found no matches with the current filters. Retry without these filters to broaden the search.';
  }

  return `The last search found no matches with these filters: ${restrictiveFilters.join('; ')}. Retry without these filters to broaden the search.`;
}

export function buildRetryWithoutFiltersRequest(
  recovery: RecommendationStrictFilterRecovery
): RecommendationConversationMessageRequest {
  return {
    message: 'Retry without the restrictive filters from the last no-results search.',
    manualFilterPatch: cloneRequiredFilters(recovery.retryFilters),
    replaceManualFilters: true,
  };
}

export function buildArrayValueRemovedFilters(
  filters: Required<RecommendationSearchFilters>,
  key: keyof RecommendationSearchFilters,
  value: string
) {
  const nextFilters = cloneRequiredFilters(filters);
  const current = Array.isArray(nextFilters[key]) ? ([...(nextFilters[key] as string[])] as string[]) : [];
  nextFilters[key] = current.filter((item) => item !== value) as never;
  return nextFilters;
}

export function buildClearedScalarFilters(
  filters: Required<RecommendationSearchFilters>,
  key: keyof RecommendationSearchFilters
) {
  const nextFilters = cloneRequiredFilters(filters);
  if (key === 'rollingOnly' || key === 'includeExpired') {
    nextFilters[key] = false as never;
  } else if (key === 'amountMin' || key === 'amountMax') {
    nextFilters[key] = null as never;
  } else if (key === 'deadlineFrom' || key === 'deadlineTo') {
    nextFilters[key] = '' as never;
  }
  return nextFilters;
}

function normalizePromptKey(value: string) {
  return value.trim().toLowerCase();
}

function pushUniquePrompt(prompts: string[], seen: Set<string>, value: string | null | undefined) {
  if (!value) return;
  const prompt = value.trim();
  if (!prompt) return;
  const key = normalizePromptKey(prompt);
  if (seen.has(key)) return;
  seen.add(key);
  prompts.push(prompt);
}

function formatSavedAreaTopic(context: ResearcherFinderContext | null) {
  const area = context?.researchAreas?.[0];
  if (!area) return '';
  const taxonomyPath = [
    area.taxonomy?.level1Name,
    area.taxonomy?.level2Name,
  ].filter(Boolean).join(' / ');
  return taxonomyPath || area.label?.trim() || area.researchArea?.trim() || '';
}

export function buildFinderConversationStarters(context: ResearcherFinderContext | null): string[] {
  const prompts: string[] = [];
  const seen = new Set<string>();
  const savedResearchAreas = context?.researchAreas || [];
  const profileResearchAreas = context?.profile.researchAreas || [];
  const profileKeywords = context?.profile.keywords || [];
  const countryOfResidence = context?.profile.countryOfResidence?.trim() || '';
  const careerStage = context?.profile.careerStage?.trim() || '';
  const primaryTopic =
    formatSavedAreaTopic(context) ||
    savedResearchAreas[0]?.label?.trim() ||
    savedResearchAreas[0]?.researchArea?.trim() ||
    profileResearchAreas[0]?.trim() ||
    profileKeywords.slice(0, 2).join(' and ').trim();

  if (primaryTopic) {
    pushUniquePrompt(prompts, seen, `Find funding opportunities for ${primaryTopic}.`);
  }

  if (primaryTopic && countryOfResidence) {
    pushUniquePrompt(prompts, seen, `Show ${primaryTopic} grants open to researchers in ${countryOfResidence}.`);
  }

  if (primaryTopic && careerStage) {
    pushUniquePrompt(prompts, seen, `Find fellowships for ${careerStage.toLowerCase()} researchers in ${primaryTopic}.`);
  }

  if (profileKeywords.length >= 2) {
    pushUniquePrompt(prompts, seen, `Find grants for ${profileKeywords[0]} and ${profileKeywords[1]}.`);
  }

  const fallbackPrompts = [
    'Find infrastructure funding for an AI and data lab.',
    'Find international fellowships in AI for healthcare.',
    'Show climate adaptation grants open to Indian universities.',
    'I need travel grants for presenting research in Europe.',
  ];

  if (!prompts.some((prompt) => normalizePromptKey(prompt) === normalizePromptKey(fallbackPrompts[0]))) {
    if (prompts.length >= 4) {
      prompts.splice(3);
    }
    pushUniquePrompt(prompts, seen, fallbackPrompts[0]);
  }

  for (const prompt of fallbackPrompts.slice(1)) {
    pushUniquePrompt(prompts, seen, prompt);
    if (prompts.length >= 4) {
      break;
    }
  }

  return prompts.slice(0, 4);
}
