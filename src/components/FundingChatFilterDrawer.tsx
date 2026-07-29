import { useState } from 'react';
import { Check, Clock, Globe2, SlidersHorizontal, Search, Wallet, X } from 'lucide-react';
import type { RecommendationSearchFilters } from '../lib/recommendations/types';
import {
  RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS,
  RECOMMENDATION_CAREER_STAGE_OPTIONS,
  RECOMMENDATION_FUNDING_KIND_OPTIONS,
  RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS,
  RECOMMENDATION_INSTITUTION_TYPE_OPTIONS,
  RECOMMENDATION_REGION_OPTIONS,
  RECOMMENDATION_SORT_OPTIONS,
  RECOMMENDATION_SPONSOR_TYPE_OPTIONS,
} from '../lib/recommendations/constants';

type FilterCategoryKey = 'geography' | 'funding' | 'eligibility' | 'timing' | 'search';

interface FundingChatFilterDrawerProps {
  filters: RecommendationSearchFilters;
  onChange: (filters: RecommendationSearchFilters) => void;
  onApply: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleListValue(values: string[] | undefined, nextValue: string) {
  const current = values || [];
  return current.includes(nextValue)
    ? current.filter((value) => value !== nextValue)
    : [...current, nextValue];
}

function FilterChips({
  label,
  values,
  options,
  onToggle,
}: {
  label: string;
  values: string[] | undefined;
  options: readonly string[];
  onToggle: (nextValue: string) => void;
}) {
  return (
    <div>
      <div className="cb-label">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = (values || []).includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={`cb-chip ${active ? 'cb-chip-active' : ''}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextArrayField({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[] | undefined;
  onChange: (nextValues: string[]) => void;
}) {
  return (
    <label className="block">
      <div className="cb-label">{label}</div>
      <textarea
        rows={3}
        value={(values || []).join(', ')}
        onChange={(event) => onChange(parseList(event.target.value))}
        placeholder={placeholder}
        className="cb-textarea mt-2"
      />
    </label>
  );
}

const filterCategories: Array<{ key: FilterCategoryKey; label: string; icon: JSX.Element }> = [
  { key: 'geography', label: 'Geography', icon: <Globe2 className="h-4 w-4" /> },
  { key: 'funding', label: 'Funding type', icon: <Wallet className="h-4 w-4" /> },
  { key: 'eligibility', label: 'Eligibility', icon: <Check className="h-4 w-4" /> },
  { key: 'timing', label: 'Timing & budget', icon: <Clock className="h-4 w-4" /> },
  { key: 'search', label: 'Search settings', icon: <Search className="h-4 w-4" /> },
];

/**
 * Advanced filter editor. A two-pane modal on desktop; on phones the category
 * rail collapses into a scrollable tab row above a full-height sheet.
 */
export default function FundingChatFilterDrawer({
  filters,
  onChange,
  onApply,
  onClearAll,
  onClose,
}: FundingChatFilterDrawerProps) {
  const [activeCategory, setActiveCategory] = useState<FilterCategoryKey>('geography');

  const update = (patch: Partial<RecommendationSearchFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 sm:items-center sm:p-4">
      <div className="flex h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-ground shadow-cb-sheet sm:h-auto sm:max-h-[88vh] sm:max-w-4xl sm:flex-row sm:rounded-xl">
        {/* Category rail */}
        <aside className="shrink-0 border-b border-hairline bg-inset sm:w-56 sm:border-b-0 sm:border-r sm:p-3">
          <div className="hidden px-1 pb-2 sm:block">
            <div className="text-[15px] font-semibold text-ink">Refine opportunities</div>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              Choose a category, then narrow the funding search.
            </p>
          </div>

          <div className="cb-scroll-x flex gap-1 p-2 sm:mt-2 sm:flex-col sm:p-0">
            {filterCategories.map((category) => {
              const active = category.key === activeCategory;
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={`cb-tab shrink-0 sm:w-full sm:justify-start ${active ? 'cb-tab-active' : ''}`}
                >
                  {category.icon}
                  {category.label}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <SlidersHorizontal className="h-4 w-4 text-muted" />
                {filterCategories.find((category) => category.key === activeCategory)?.label}
              </div>
              <p className="mt-0.5 text-[12px] text-muted">Apply the filters you want before your next search.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="cb-btn-ghost cb-btn-sm shrink-0 px-2">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {activeCategory === 'geography' ? (
              <div className="space-y-5">
                <FilterChips
                  label="Geography scope"
                  values={filters.geographyScope}
                  options={RECOMMENDATION_GEOGRAPHY_SCOPE_OPTIONS}
                  onToggle={(value) => update({ geographyScope: toggleListValue(filters.geographyScope, value) })}
                />
                <FilterChips
                  label="Eligible regions"
                  values={filters.eligibleRegions}
                  options={RECOMMENDATION_REGION_OPTIONS}
                  onToggle={(value) => update({ eligibleRegions: toggleListValue(filters.eligibleRegions, value) })}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <TextArrayField
                    label="Eligible countries"
                    placeholder="India, Germany, United States"
                    values={filters.eligibleCountries}
                    onChange={(value) => update({ eligibleCountries: value })}
                  />
                  <TextArrayField
                    label="Host countries"
                    placeholder="United Kingdom, Singapore"
                    values={filters.hostCountries}
                    onChange={(value) => update({ hostCountries: value })}
                  />
                </div>
                <TextArrayField
                  label="Funder country"
                  placeholder="United States, Germany"
                  values={filters.funderCountries}
                  onChange={(value) => update({ funderCountries: value })}
                />
              </div>
            ) : null}

            {activeCategory === 'funding' ? (
              <div className="space-y-5">
                <FilterChips
                  label="Funding type"
                  values={filters.fundingKinds}
                  options={RECOMMENDATION_FUNDING_KIND_OPTIONS}
                  onToggle={(value) => update({ fundingKinds: toggleListValue(filters.fundingKinds, value) })}
                />
                <FilterChips
                  label="Sponsor type"
                  values={filters.sponsorTypes}
                  options={RECOMMENDATION_SPONSOR_TYPE_OPTIONS}
                  onToggle={(value) => update({ sponsorTypes: toggleListValue(filters.sponsorTypes, value) })}
                />
              </div>
            ) : null}

            {activeCategory === 'eligibility' ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <FilterChips
                    label="Institution type"
                    values={filters.institutionTypes}
                    options={RECOMMENDATION_INSTITUTION_TYPE_OPTIONS}
                    onToggle={(value) => update({ institutionTypes: toggleListValue(filters.institutionTypes, value) })}
                  />
                  <FilterChips
                    label="Career stage"
                    values={filters.careerStages}
                    options={RECOMMENDATION_CAREER_STAGE_OPTIONS}
                    onToggle={(value) => update({ careerStages: toggleListValue(filters.careerStages, value) })}
                  />
                </div>
                <FilterChips
                  label="Application language"
                  values={filters.applicationLanguages}
                  options={RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS}
                  onToggle={(value) => update({ applicationLanguages: toggleListValue(filters.applicationLanguages, value) })}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <TextArrayField
                    label="Citizenship requirements"
                    placeholder="Citizens of EU member states"
                    values={filters.citizenshipRequirements}
                    onChange={(value) => update({ citizenshipRequirements: value })}
                  />
                  <TextArrayField
                    label="Residency requirements"
                    placeholder="Must reside in Canada"
                    values={filters.residencyRequirements}
                    onChange={(value) => update({ residencyRequirements: value })}
                  />
                </div>
              </div>
            ) : null}

            {activeCategory === 'timing' ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="cb-label">Deadline from</div>
                    <input
                      type="date"
                      value={filters.deadlineFrom || ''}
                      onChange={(event) => update({ deadlineFrom: event.target.value || undefined })}
                      className="cb-input mt-2"
                    />
                  </label>
                  <label className="block">
                    <div className="cb-label">Deadline to</div>
                    <input
                      type="date"
                      value={filters.deadlineTo || ''}
                      onChange={(event) => update({ deadlineTo: event.target.value || undefined })}
                      className="cb-input mt-2"
                    />
                  </label>
                  <label className="block">
                    <div className="cb-label">Minimum amount</div>
                    <input
                      type="number"
                      value={filters.amountMin ?? ''}
                      onChange={(event) => update({ amountMin: event.target.value === '' ? null : Number(event.target.value) })}
                      className="cb-input mt-2"
                    />
                  </label>
                  <label className="block">
                    <div className="cb-label">Maximum amount</div>
                    <input
                      type="number"
                      value={filters.amountMax ?? ''}
                      onChange={(event) => update({ amountMax: event.target.value === '' ? null : Number(event.target.value) })}
                      className="cb-input mt-2"
                    />
                  </label>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline bg-ground px-3 py-2.5 text-[13px] text-ink-soft">
                    <input
                      type="checkbox"
                      checked={Boolean(filters.rollingOnly)}
                      onChange={(event) => update({ rollingOnly: event.target.checked })}
                      className="h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
                    />
                    Rolling opportunities only
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline bg-ground px-3 py-2.5 text-[13px] text-ink-soft">
                    <input
                      type="checkbox"
                      checked={Boolean(filters.includeExpired)}
                      onChange={(event) => update({ includeExpired: event.target.checked })}
                      className="h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
                    />
                    Include expired opportunities
                  </label>
                </div>
              </div>
            ) : null}

            {activeCategory === 'search' ? (
              <div className="space-y-5">
                <label className="block">
                  <div className="cb-label">Sort order</div>
                  <select
                    value={filters.sort || 'best_match'}
                    onChange={(event) => update({ sort: event.target.value as RecommendationSearchFilters['sort'] })}
                    className="cb-select mt-2"
                  >
                    {RECOMMENDATION_SORT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === 'best_match' ? 'Best match' : 'Deadline soonest'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="cb-label">Results limit</div>
                  <select
                    value={filters.limit || 10}
                    onChange={(event) => update({ limit: Number(event.target.value) })}
                    className="cb-select mt-2"
                  >
                    {[5, 10, 15, 20, 25].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3 sm:px-5">
            <button type="button" onClick={onClearAll} className="cb-btn-danger cb-btn-sm">
              Clear all filters
            </button>
            <div className="flex flex-1 justify-end gap-2">
              <button type="button" onClick={onClose} className="cb-btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={onApply} className="cb-btn-primary">
                <Check className="h-4 w-4" />
                Apply filters
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
