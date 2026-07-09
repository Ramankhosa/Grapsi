import type { FinderFilterSuggestionChip, RecommendationFilterMode } from './chatTypes';
import type { RecommendationSearchFilters } from './types';
import { createDefaultFilters } from './conversationUtils';

export const FILTER_LABELS: Partial<Record<keyof RecommendationSearchFilters, string>> = {
  geographyScope: 'Geography scope',
  eligibleCountries: 'Eligible countries',
  eligibleRegions: 'Eligible regions',
  hostCountries: 'Host countries',
  funderCountries: 'Funder countries',
  fundingKinds: 'Funding types',
  institutionTypes: 'Institution types',
  careerStages: 'Career stages',
  citizenshipRequirements: 'Citizenship',
  residencyRequirements: 'Residency',
  applicationLanguages: 'Application languages',
  sponsorTypes: 'Sponsor types',
  taxonomyAreaIds: 'Research taxonomy',
  deadlineFrom: 'Deadline window',
  deadlineTo: 'Deadline window',
  rollingOnly: 'Rolling only',
  amountMin: 'Minimum amount',
  amountMax: 'Maximum amount',
};

const ARRAY_FILTER_KEYS = [
  'geographyScope',
  'eligibleCountries',
  'eligibleRegions',
  'hostCountries',
  'funderCountries',
  'fundingKinds',
  'institutionTypes',
  'careerStages',
  'citizenshipRequirements',
  'residencyRequirements',
  'applicationLanguages',
  'sponsorTypes',
  'taxonomyAreaIds',
] as const;

type ArrayFilterKey = (typeof ARRAY_FILTER_KEYS)[number];

// Keys that constrain the search space. `limit`/`sort` are presentation-only and are
// deliberately excluded so manual mode still honors "show more" / "sort by deadline".
const SEARCH_SPACE_FILTER_KEYS: Array<keyof RecommendationSearchFilters> = [
  ...ARRAY_FILTER_KEYS,
  'deadlineFrom',
  'deadlineTo',
  'rollingOnly',
  'amountMin',
  'amountMax',
  'includeExpired',
];

const MAX_SUGGESTION_CHIPS = 4;

export function normalizeFilterMode(value: unknown): RecommendationFilterMode {
  return value === 'auto' ? 'auto' : 'manual';
}

export function cloneRequiredFilters(filters: Required<RecommendationSearchFilters>): Required<RecommendationSearchFilters> {
  const next = { ...filters };
  for (const key of ARRAY_FILTER_KEYS) {
    next[key] = [...filters[key]];
  }
  return next;
}

export function isActiveFilterValue(value: Required<RecommendationSearchFilters>[keyof RecommendationSearchFilters]) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && value !== false && value !== '';
}

export function formatFilterDescription(
  filters: Required<RecommendationSearchFilters>,
  key: keyof RecommendationSearchFilters
) {
  const label = FILTER_LABELS[key] || String(key);

  switch (key) {
    case 'deadlineFrom':
    case 'deadlineTo': {
      if (!filters.deadlineFrom && !filters.deadlineTo) return null;
      return `${label}: ${filters.deadlineFrom || 'any time'} to ${filters.deadlineTo || 'open end'}`;
    }
    case 'rollingOnly':
      return filters.rollingOnly ? 'Rolling only' : null;
    case 'amountMin':
      return filters.amountMin !== null ? `${label}: ${filters.amountMin}` : null;
    case 'amountMax':
      return filters.amountMax !== null ? `${label}: ${filters.amountMax}` : null;
    default: {
      const value = filters[key];
      if (!Array.isArray(value) || value.length === 0) {
        return null;
      }
      return `${label}: ${value.slice(0, 3).join(', ')}`;
    }
  }
}

/** Keys whose current value differs from the defaults and constrains the search space. */
export function getActiveSearchSpaceFilterKeys(
  filters: Required<RecommendationSearchFilters>
): Array<keyof RecommendationSearchFilters> {
  const defaults = createDefaultFilters();
  return SEARCH_SPACE_FILTER_KEYS.filter(
    (key) => JSON.stringify(filters[key]) !== JSON.stringify(defaults[key])
  );
}

/**
 * Diff filters the assistant proposed against the conversation's current filters and turn
 * every net-new constraint into a suggestion chip. Used in manual filter mode, where the
 * assistant never applies filters itself.
 */
export function buildFilterSuggestionChips(
  current: Required<RecommendationSearchFilters>,
  proposed: Required<RecommendationSearchFilters>,
  source: FinderFilterSuggestionChip['source']
): FinderFilterSuggestionChip[] {
  const chips: FinderFilterSuggestionChip[] = [];

  for (const key of ARRAY_FILTER_KEYS) {
    const currentValues = new Set(current[key].map((value) => value.toLowerCase()));
    const added = proposed[key].filter((value) => !currentValues.has(value.toLowerCase()));
    if (added.length > 0) {
      chips.push({
        label: `${FILTER_LABELS[key] || key}: ${added.slice(0, 3).join(', ')}`,
        patch: { [key]: added } as Partial<RecommendationSearchFilters>,
        source,
      });
    }
  }

  const deadlineChanged =
    (proposed.deadlineFrom && proposed.deadlineFrom !== current.deadlineFrom) ||
    (proposed.deadlineTo && proposed.deadlineTo !== current.deadlineTo);
  if (deadlineChanged) {
    chips.push({
      label: `Deadline: ${proposed.deadlineFrom || 'any time'} to ${proposed.deadlineTo || 'open end'}`,
      patch: { deadlineFrom: proposed.deadlineFrom, deadlineTo: proposed.deadlineTo },
      source,
    });
  }

  if (proposed.rollingOnly && !current.rollingOnly) {
    chips.push({ label: 'Rolling opportunities only', patch: { rollingOnly: true }, source });
  }

  if (proposed.amountMin !== null && proposed.amountMin !== current.amountMin) {
    chips.push({ label: `Minimum amount: ${proposed.amountMin}`, patch: { amountMin: proposed.amountMin }, source });
  }

  if (proposed.amountMax !== null && proposed.amountMax !== current.amountMax) {
    chips.push({ label: `Maximum amount: ${proposed.amountMax}`, patch: { amountMax: proposed.amountMax }, source });
  }

  if (proposed.includeExpired && !current.includeExpired) {
    chips.push({ label: 'Include expired calls', patch: { includeExpired: true }, source });
  }

  return chips.slice(0, MAX_SUGGESTION_CHIPS);
}

/**
 * One removal chip per over-strict filter key from a zero-result search, so the user can
 * relax their own filters one manual click at a time.
 */
export function buildZeroResultRemovalChips(
  filters: Required<RecommendationSearchFilters>,
  relaxedFilterKeys: Array<keyof RecommendationSearchFilters>
): FinderFilterSuggestionChip[] {
  const chips: FinderFilterSuggestionChip[] = [];
  const seen = new Set<string>();

  for (const key of relaxedFilterKeys) {
    if (!isActiveFilterValue(filters[key])) continue;
    const description = formatFilterDescription(filters, key);
    if (!description) continue;
    const clearKeys: Array<keyof RecommendationSearchFilters> =
      key === 'deadlineFrom' || key === 'deadlineTo' ? ['deadlineFrom', 'deadlineTo'] : [key];
    const dedupeKey = clearKeys.join('|');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    chips.push({
      label: `Remove ${description}`,
      patch: {},
      clearKeys,
      source: 'zero_results',
    });
  }

  return chips.slice(0, MAX_SUGGESTION_CHIPS);
}

export function buildClearAllFiltersChip(
  filters: Required<RecommendationSearchFilters>
): FinderFilterSuggestionChip | null {
  const activeKeys = getActiveSearchSpaceFilterKeys(filters);
  if (activeKeys.length === 0) return null;
  return {
    label: 'Clear all filters',
    patch: {},
    clearKeys: activeKeys,
    source: 'llm',
  };
}

/**
 * Compose the next full filter set from the current filters and a clicked chip.
 * Array patches are unioned into the current values; scalar patches are assigned;
 * `clearKeys` reset to defaults. Evaluated at click time so chips never go stale.
 */
export function applyFilterSuggestionChip(
  current: Required<RecommendationSearchFilters>,
  chip: FinderFilterSuggestionChip
): Required<RecommendationSearchFilters> {
  const defaults = createDefaultFilters();
  const next = cloneRequiredFilters(current);

  for (const key of chip.clearKeys || []) {
    if (key in defaults) {
      next[key] = Array.isArray(defaults[key]) ? ([...(defaults[key] as string[])] as never) : (defaults[key] as never);
    }
  }

  for (const [rawKey, rawValue] of Object.entries(chip.patch)) {
    const key = rawKey as keyof RecommendationSearchFilters;
    if (rawValue === undefined) continue;
    if ((ARRAY_FILTER_KEYS as readonly string[]).includes(key)) {
      const existing = next[key as ArrayFilterKey];
      const existingLower = new Set(existing.map((value) => value.toLowerCase()));
      const additions = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((value) => String(value || '').trim())
        .filter((value) => value && !existingLower.has(value.toLowerCase()));
      next[key as ArrayFilterKey] = [...existing, ...additions];
    } else {
      next[key] = rawValue as never;
    }
  }

  return next;
}

/** Safely coerce chips persisted inside a message's intent_json. */
export function coerceFilterSuggestionChips(raw: unknown): FinderFilterSuggestionChip[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const chips: FinderFilterSuggestionChip[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.label !== 'string' || !candidate.label.trim()) continue;
    const patch = candidate.patch && typeof candidate.patch === 'object' && !Array.isArray(candidate.patch)
      ? (candidate.patch as Partial<RecommendationSearchFilters>)
      : {};
    const clearKeys = Array.isArray(candidate.clearKeys)
      ? (candidate.clearKeys.map((key) => String(key || '')).filter(Boolean) as Array<keyof RecommendationSearchFilters>)
      : undefined;
    const source =
      candidate.source === 'zero_results' || candidate.source === 'profile' ? candidate.source : 'llm';
    chips.push({ label: candidate.label.trim(), patch, clearKeys, source });
  }
  return chips.length > 0 ? chips.slice(0, MAX_SUGGESTION_CHIPS) : undefined;
}
