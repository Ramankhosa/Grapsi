import { useState } from 'react';
import {
  Building2,
  ChevronDown,
  ExternalLink,
  Factory,
  FlaskConical,
  GraduationCap,
  Globe2,
  Layers,
  MapPin,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import FinderPreferencesPanel, { type FinderPreferenceValues } from './FinderPreferencesPanel';
import type { DirectoryFacetDimension, DirectoryFacetItem, DirectoryFacetResponse, RecommendationRawResultItem, RecommendationSearchFilters } from '../lib/recommendations/types';

type BrowseCategory = DirectoryFacetDimension | null;

interface ActiveSelection {
  dimension: DirectoryFacetDimension;
  value: string;
  label?: string;
}

const CATEGORY_META: Record<DirectoryFacetDimension, { label: string; icon: React.ReactNode }> = {
  taxonomyArea: { label: 'Research taxonomy', icon: <Layers className="h-4 w-4" /> },
  researchArea: { label: 'Research area', icon: <FlaskConical className="h-4 w-4" /> },
  country: { label: 'Country', icon: <Globe2 className="h-4 w-4" /> },
  fundingKind: { label: 'Funding type', icon: <Wallet className="h-4 w-4" /> },
  careerStage: { label: 'Career stage', icon: <GraduationCap className="h-4 w-4" /> },
  discipline: { label: 'Discipline', icon: <Layers className="h-4 w-4" /> },
  sponsorType: { label: 'Sponsor', icon: <Factory className="h-4 w-4" /> },
  region: { label: 'Region', icon: <MapPin className="h-4 w-4" /> },
  institutionType: { label: 'Institution', icon: <Building2 className="h-4 w-4" /> },
};

const DIMENSION_ORDER: DirectoryFacetDimension[] = [
  'taxonomyArea', 'researchArea', 'country', 'fundingKind', 'careerStage',
  'discipline', 'sponsorType', 'region', 'institutionType',
];

function formatAmount(result: RecommendationRawResultItem) {
  if (result.amountMin === null && result.amountMax === null) return null;
  if (result.amountMin !== null && result.amountMax !== null) {
    return `${result.currency || ''} ${Number(result.amountMin).toLocaleString()} – ${Number(result.amountMax).toLocaleString()}`.trim();
  }
  return `${result.currency || ''} ${Number(result.amountMin ?? result.amountMax).toLocaleString()}`.trim();
}

interface FundingDirectoryPanelProps {
  query: string;
  filters: Required<RecommendationSearchFilters>;
  facets: DirectoryFacetResponse | null;
  facetsLoading: boolean;
  loading: boolean;
  results: RecommendationRawResultItem[];
  totalResults: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onQueryChange: (value: string) => void;
  onRunSearch: () => void;
  onClearQuery: () => void;
  onSelectFacet: (dimension: DirectoryFacetDimension, value: string, label?: string) => void;
  onRemoveFacet: (dimension: DirectoryFacetDimension, value: string) => void;
  onClearAllSelections: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  activeSelections: ActiveSelection[];
  onOpenAdvancedFilters: () => void;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
  getCallDetailsHref?: (result: RecommendationRawResultItem) => string;
  preferences: FinderPreferenceValues;
  onChangePreferences: (preferences: FinderPreferenceValues) => void;
}

function ExpandableCard({
  result,
  defaultExpanded,
  onBeginWriting,
  getCallDetailsHref,
}: {
  result: RecommendationRawResultItem;
  defaultExpanded?: boolean;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
  getCallDetailsHref?: (result: RecommendationRawResultItem) => string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const amount = formatAmount(result);
  const callDetailsHref = getCallDetailsHref?.(result) || `/finder/calls/${encodeURIComponent(result.id)}`;
  const geography =
    result.eligibleCountries.slice(0, 3).join(', ') ||
    result.eligibleRegions.slice(0, 3).join(', ') ||
    result.hostCountries.slice(0, 3).join(', ');

  return (
    <article className="cb-card overflow-hidden transition hover:border-cobalt-300">
      <button type="button" onClick={() => setExpanded((prev) => !prev)} className="w-full text-left">
        <div className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-muted">{result.agencyName}</p>
              <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-ink">{result.schemeTitle}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {result.isRolling ? (
                <span className="cb-badge">Rolling</span>
              ) : result.closeDate ? (
                <span className="cb-badge">
                  {new Date(result.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              ) : null}
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-soft transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>

          {result.shortDescription ? (
            <p className={`mt-1.5 text-[13px] leading-6 text-muted ${expanded ? '' : 'line-clamp-2'}`}>
              {result.shortDescription}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {result.profileMatch?.reasons.slice(0, 1).map((reason) => (
              <span key={reason} className="cb-badge-cobalt">{reason}</span>
            ))}
            {result.fundingKinds.slice(0, 2).map((v) => (
              <span key={v} className="cb-badge">{v}</span>
            ))}
            {result.disciplines.slice(0, 2).map((v) => (
              <span key={v} className="cb-badge">{v}</span>
            ))}
            {geography ? <span className="cb-badge">{geography}</span> : null}
            {amount ? <span className="cb-badge">{amount}</span> : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-hairline bg-inset px-4 py-4">
          <div className="grid gap-4 text-[13px] sm:grid-cols-2">
            {result.fullDescription || result.description ? (
              <div className="sm:col-span-2">
                <div className="cb-eyebrow">Description</div>
                <p className="mt-1 leading-6 text-muted">{result.fullDescription || result.description}</p>
              </div>
            ) : null}

            {result.eligibilitySummary || result.eligibilityText ? (
              <div>
                <div className="cb-eyebrow">Eligibility</div>
                <p className="mt-1 leading-6 text-muted">{result.eligibilityText || result.eligibilitySummary}</p>
              </div>
            ) : null}

            {result.profileMatch?.reasons.length ? (
              <div>
                <div className="cb-eyebrow">Preference match</div>
                <ul className="mt-1 space-y-0.5 leading-6 text-muted">
                  {result.profileMatch.reasons.slice(0, 4).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <div className="cb-eyebrow">Details</div>
              <div className="mt-1 space-y-0.5 leading-6 text-muted">
                {result.careerStages.length > 0 ? <p>Career stages: {result.careerStages.join(', ')}</p> : null}
                {result.institutionTypes.length > 0 ? <p>Institutions: {result.institutionTypes.join(', ')}</p> : null}
                {result.sponsorType ? <p>Sponsor: {result.sponsorType}</p> : null}
                {result.geographyScope ? <p>Scope: {result.geographyScope}</p> : null}
                {result.applicationLanguages.length > 0 ? <p>Languages: {result.applicationLanguages.join(', ')}</p> : null}
              </div>
            </div>

            {result.contactInfo ? (
              <div>
                <div className="cb-eyebrow">Contact</div>
                <p className="mt-1 leading-6 text-muted">{result.contactInfo}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {onBeginWriting ? (
              <button type="button" onClick={() => onBeginWriting(result)} className="cb-btn-primary cb-btn-sm">
                Begin writing
              </button>
            ) : null}
            <a href={callDetailsHref} target="_blank" rel="noreferrer" className="cb-btn-secondary cb-btn-sm">
              Show details
            </a>
            {result.officialUrls[0] ? (
              <a href={result.officialUrls[0]} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-sm">
                View full call
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function FundingDirectoryPanel({
  query,
  facets,
  facetsLoading,
  loading,
  results,
  totalResults,
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onQueryChange,
  onRunSearch,
  onClearQuery,
  onSelectFacet,
  onRemoveFacet,
  onClearAllSelections,
  onPreviousPage,
  onNextPage,
  onGoToPage,
  activeSelections,
  onOpenAdvancedFilters,
  onBeginWriting,
  getCallDetailsHref,
  preferences,
  onChangePreferences,
}: FundingDirectoryPanelProps) {
  const [openCategory, setOpenCategory] = useState<BrowseCategory>('taxonomyArea');
  const [facetSearch, setFacetSearch] = useState('');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const pageWindow = Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return start + i;
  }).filter((v, i, a) => v >= 1 && v <= totalPages && a.indexOf(v) === i);

  function toggleCategory(dim: DirectoryFacetDimension) {
    setOpenCategory((prev) => (prev === dim ? null : dim));
    setFacetSearch('');
  }

  function isSelected(dim: DirectoryFacetDimension, value: string) {
    return activeSelections.some((s) => s.dimension === dim && s.value === value);
  }

  function getFilteredFacetItems(dim: DirectoryFacetDimension): DirectoryFacetItem[] {
    const items = facets?.facets[dim] || [];
    if (!facetSearch.trim()) return items;
    const q = facetSearch.toLowerCase();
    return items.filter((item) => `${item.label || ''} ${item.value}`.toLowerCase().includes(q));
  }

  function countSelectionsForDimension(dim: DirectoryFacetDimension) {
    return activeSelections.filter((s) => s.dimension === dim).length;
  }

  const activePreferenceCount =
    (preferences.useEligibilityProfile ? 1 : 0) + (preferences.usePublicationContext ? 1 : 0);

  /** The facet tree — rendered inline on desktop and inside a sheet on phones. */
  const facetTree = (
    <div>
      {DIMENSION_ORDER.map((dim) => {
        const meta = CATEGORY_META[dim];
        const count = facets?.facets[dim]?.length || 0;
        const selCount = countSelectionsForDimension(dim);
        const isOpen = openCategory === dim;
        const items = isOpen ? getFilteredFacetItems(dim) : [];

        return (
          <section key={dim} className="border-b border-hairline last:border-b-0">
            <button
              type="button"
              onClick={() => toggleCategory(dim)}
              aria-expanded={isOpen}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 py-2 text-left"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink">
                <span className="text-muted">{meta.icon}</span>
                <span className="truncate">{meta.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {selCount > 0 ? (
                  <span className="cb-badge-cobalt">{selCount}</span>
                ) : count > 0 ? (
                  <span className="text-[11px] text-muted-soft">{count}</span>
                ) : null}
                <ChevronDown className={`h-4 w-4 text-muted-soft transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>

            {isOpen ? (
              <div className="pb-3">
                {(facets?.facets[dim]?.length || 0) > 8 ? (
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-soft" />
                    <input
                      value={facetSearch}
                      onChange={(e) => setFacetSearch(e.target.value)}
                      placeholder={`Filter ${meta.label.toLowerCase()}…`}
                      className="cb-input py-1.5 pl-8 text-[13px]"
                    />
                  </div>
                ) : null}

                {facetsLoading ? (
                  <div className="flex h-16 items-center justify-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
                  </div>
                ) : items.length === 0 ? (
                  <p className="py-2 text-[12px] text-muted">
                    No values found{facetSearch ? ' matching your search' : ' for current filters'}.
                  </p>
                ) : (
                  <div className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
                    {items.map((item) => {
                      const selected = isSelected(dim, item.value);
                      const displayValue = item.label || item.value;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() =>
                            selected ? onRemoveFacet(dim, item.value) : onSelectFacet(dim, item.value, displayValue)
                          }
                          className={`flex min-h-[34px] w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[13px] transition ${
                            selected ? 'bg-cobalt-50 text-cobalt-800' : 'text-ink-soft hover:bg-inset'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                                selected ? 'border-cobalt-600 bg-cobalt-600' : 'border-hairline bg-ground'
                              }`}
                            >
                              {selected ? (
                                <svg viewBox="0 0 10 10" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path d="M1 5l2.5 2.5L9 2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : null}
                            </span>
                            <span className="truncate">{displayValue}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-soft">{item.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="flex-1">
      {/* Search bar */}
      <div className="cb-card mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRunSearch(); } }}
              placeholder="Search by topic, agency, keyword…"
              className="cb-input pl-9 pr-9"
            />
            {query ? (
              <button
                type="button"
                onClick={onClearQuery}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-soft transition hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onRunSearch} className="cb-btn-primary flex-1 sm:flex-none">
              Search
            </button>
            <button type="button" onClick={onOpenAdvancedFilters} className="cb-btn-secondary flex-1 sm:flex-none">
              <SlidersHorizontal className="h-4 w-4" />
              Advanced
            </button>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="cb-btn-secondary flex-1 lg:hidden"
            >
              Browse
              {activeSelections.length > 0 ? <span className="cb-badge-cobalt">{activeSelections.length}</span> : null}
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-muted">
            {loading || facetsLoading ? 'Loading…' : `${totalResults.toLocaleString()} opportunities`}
          </span>
          <button
            type="button"
            onClick={() => setPreferencesOpen((open) => !open)}
            className={`cb-btn-sm inline-flex items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition ${
              activePreferenceCount > 0 ? 'bg-cobalt-50 text-cobalt-700' : 'text-muted hover:bg-inset hover:text-ink'
            }`}
          >
            My preferences
            <span className="text-[11px]">{activePreferenceCount > 0 ? `${activePreferenceCount} on` : 'off'}</span>
          </button>
        </div>

        {preferencesOpen ? (
          <div className="mt-3 border-t border-hairline pt-3">
            <FinderPreferencesPanel preferences={preferences} onChange={onChangePreferences} compact />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* Facet rail — desktop */}
        <aside className="hidden lg:block">
          <div className="cb-card sticky top-32 max-h-[calc(100vh-10rem)] overflow-y-auto px-3.5 py-1">
            {facetTree}
          </div>
        </aside>

        {/* Facet sheet — phones and tablets */}
        {mobileFiltersOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Browse categories">
            <button type="button" aria-label="Close filters" onClick={() => setMobileFiltersOpen(false)} className="absolute inset-0 bg-ink/25" />
            <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col bg-ground shadow-cb-sheet">
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
                <span className="text-[15px] font-semibold text-ink">Browse</span>
                <button type="button" onClick={() => setMobileFiltersOpen(false)} aria-label="Close" className="cb-btn-ghost cb-btn-sm px-2">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4">{facetTree}</div>
              <div className="border-t border-hairline p-3">
                <button type="button" onClick={() => setMobileFiltersOpen(false)} className="cb-btn-primary w-full">
                  Show {totalResults.toLocaleString()} results
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Results */}
        <div className="min-w-0">
          {activeSelections.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {activeSelections.map((sel) => (
                <span
                  key={`${sel.dimension}-${sel.value}`}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-cobalt-200 bg-cobalt-50 py-0.5 pl-2.5 pr-1 text-[12px] text-cobalt-800"
                >
                  <span className="text-cobalt-600">{CATEGORY_META[sel.dimension].label}:</span>
                  {sel.label || sel.value}
                  <button
                    type="button"
                    onClick={() => onRemoveFacet(sel.dimension, sel.value)}
                    aria-label={`Remove ${sel.label || sel.value}`}
                    className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-cobalt-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={onClearAllSelections} className="cb-btn-ghost cb-btn-sm">
                Clear all
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline bg-ground px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-ink">No opportunities match the current selection.</p>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-6 text-muted">
                Try removing some filters, broadening your search, or clearing all selections.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-muted">
                  Page {page} of {totalPages} · {totalResults.toLocaleString()} total
                </p>
                <PaginationControls
                  page={page}
                  totalPages={totalPages}
                  hasNextPage={hasNextPage}
                  hasPreviousPage={hasPreviousPage}
                  pageWindow={pageWindow}
                  onPreviousPage={onPreviousPage}
                  onNextPage={onNextPage}
                  onGoToPage={onGoToPage}
                />
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {results.map((result) => (
                  <ExpandableCard
                    key={result.id}
                    result={result}
                    onBeginWriting={onBeginWriting}
                    getCallDetailsHref={getCallDetailsHref}
                  />
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="flex justify-center pt-1">
                  <PaginationControls
                    page={page}
                    totalPages={totalPages}
                    hasNextPage={hasNextPage}
                    hasPreviousPage={hasPreviousPage}
                    pageWindow={pageWindow}
                    onPreviousPage={onPreviousPage}
                    onNextPage={onNextPage}
                    onGoToPage={onGoToPage}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  pageWindow,
  onPreviousPage,
  onNextPage,
  onGoToPage,
}: {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  pageWindow: number[];
  onPreviousPage: () => void;
  onNextPage: () => void;
  onGoToPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onPreviousPage} disabled={!hasPreviousPage} className="cb-btn-secondary cb-btn-sm">
        Prev
      </button>
      {pageWindow.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onGoToPage(p)}
          aria-current={p === page ? 'page' : undefined}
          className={`inline-flex h-[34px] min-w-[34px] items-center justify-center rounded-lg text-[13px] font-medium transition ${
            p === page ? 'bg-cobalt-600 text-white' : 'text-muted hover:bg-inset hover:text-ink'
          }`}
        >
          {p}
        </button>
      ))}
      <button type="button" onClick={onNextPage} disabled={!hasNextPage} className="cb-btn-secondary cb-btn-sm">
        Next
      </button>
    </div>
  );
}
