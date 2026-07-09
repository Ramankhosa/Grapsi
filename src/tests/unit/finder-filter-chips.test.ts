import { describe, expect, it } from 'vitest';

import { createDefaultFilters } from '@/lib/recommendations/conversationUtils';
import {
  applyFilterSuggestionChip,
  buildClearAllFiltersChip,
  buildFilterSuggestionChips,
  buildZeroResultRemovalChips,
  coerceFilterSuggestionChips,
  getActiveSearchSpaceFilterKeys,
  normalizeFilterMode,
} from '@/lib/recommendations/filterChips';

describe('filterChips', () => {
  it('normalizes filter mode with manual as the default', () => {
    expect(normalizeFilterMode('auto')).toBe('auto');
    expect(normalizeFilterMode('manual')).toBe('manual');
    expect(normalizeFilterMode(undefined)).toBe('manual');
    expect(normalizeFilterMode('anything-else')).toBe('manual');
  });

  it('builds chips only for net-new constraints', () => {
    const current = createDefaultFilters();
    current.eligibleCountries = ['India'];

    const proposed = createDefaultFilters();
    proposed.eligibleCountries = ['india', 'Germany'];
    proposed.careerStages = ['Postdoctoral'];
    proposed.deadlineFrom = '2026-08-01';
    proposed.deadlineTo = '2026-08-31';

    const chips = buildFilterSuggestionChips(current, proposed, 'llm');
    const labels = chips.map((chip) => chip.label);

    expect(labels).toContain('Eligible countries: Germany');
    expect(labels).toContain('Career stages: Postdoctoral');
    expect(labels).toContain('Deadline: 2026-08-01 to 2026-08-31');
    expect(labels.some((label) => label.includes('India'))).toBe(false);
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it('returns no chips when the proposal matches the current filters', () => {
    const current = createDefaultFilters();
    current.fundingKinds = ['Travel Grant'];
    const proposed = createDefaultFilters();
    proposed.fundingKinds = ['Travel Grant'];

    expect(buildFilterSuggestionChips(current, proposed, 'llm')).toHaveLength(0);
  });

  it('applies an additive chip as a union at click time', () => {
    const current = createDefaultFilters();
    current.eligibleCountries = ['India'];

    const next = applyFilterSuggestionChip(current, {
      label: 'Eligible countries: Germany',
      patch: { eligibleCountries: ['Germany', 'india'] },
      source: 'llm',
    });

    expect(next.eligibleCountries).toEqual(['India', 'Germany']);
    // The original filters must not be mutated.
    expect(current.eligibleCountries).toEqual(['India']);
  });

  it('applies clearKeys by resetting to defaults', () => {
    const current = createDefaultFilters();
    current.careerStages = ['PhD Student'];
    current.deadlineFrom = '2026-01-01';
    current.deadlineTo = '2026-03-01';
    current.rollingOnly = true;

    const next = applyFilterSuggestionChip(current, {
      label: 'Remove deadline window',
      patch: {},
      clearKeys: ['deadlineFrom', 'deadlineTo', 'rollingOnly'],
      source: 'zero_results',
    });

    expect(next.deadlineFrom).toBe('');
    expect(next.deadlineTo).toBe('');
    expect(next.rollingOnly).toBe(false);
    expect(next.careerStages).toEqual(['PhD Student']);
  });

  it('builds one removal chip per over-strict filter key, deduping the deadline pair', () => {
    const filters = createDefaultFilters();
    filters.careerStages = ['PhD Student'];
    filters.deadlineFrom = '2026-01-01';
    filters.deadlineTo = '2026-02-01';

    const chips = buildZeroResultRemovalChips(filters, ['careerStages', 'deadlineFrom', 'deadlineTo', 'fundingKinds']);
    const labels = chips.map((chip) => chip.label);

    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Remove Career stages: PhD Student');
    expect(labels[1]).toContain('Remove Deadline window');
    expect(chips.every((chip) => chip.source === 'zero_results')).toBe(true);

    const cleared = applyFilterSuggestionChip(filters, chips[1]);
    expect(cleared.deadlineFrom).toBe('');
    expect(cleared.deadlineTo).toBe('');
  });

  it('builds a clear-all chip covering every active search-space key', () => {
    const filters = createDefaultFilters();
    expect(buildClearAllFiltersChip(filters)).toBeNull();

    filters.eligibleCountries = ['India'];
    filters.rollingOnly = true;
    const chip = buildClearAllFiltersChip(filters);
    expect(chip).not.toBeNull();
    expect(chip!.clearKeys).toEqual(expect.arrayContaining(['eligibleCountries', 'rollingOnly']));

    const cleared = applyFilterSuggestionChip(filters, chip!);
    expect(getActiveSearchSpaceFilterKeys(cleared)).toHaveLength(0);
  });

  it('ignores limit and sort when deciding whether filters are active', () => {
    const filters = createDefaultFilters();
    filters.limit = 25;
    filters.sort = 'deadline_soonest';
    expect(getActiveSearchSpaceFilterKeys(filters)).toHaveLength(0);
  });

  it('round-trips chips through JSON coercion and drops malformed entries', () => {
    const chips = [
      { label: 'Eligible countries: Germany', patch: { eligibleCountries: ['Germany'] }, source: 'llm' },
      { label: '', patch: {}, source: 'llm' },
      { notAChip: true },
      { label: 'Remove Rolling only', patch: {}, clearKeys: ['rollingOnly'], source: 'zero_results' },
    ];

    const coerced = coerceFilterSuggestionChips(JSON.parse(JSON.stringify(chips)));
    expect(coerced).toHaveLength(2);
    expect(coerced![0].label).toBe('Eligible countries: Germany');
    expect(coerced![1].clearKeys).toEqual(['rollingOnly']);
    expect(coerceFilterSuggestionChips(null)).toBeUndefined();
    expect(coerceFilterSuggestionChips([])).toBeUndefined();
  });
});
