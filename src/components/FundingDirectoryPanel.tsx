import { useState } from 'react';
import {
  FaAngleDown,
  FaAngleUp,
  FaChevronRight,
  FaExternalLinkAlt,
  FaFlask,
  FaGlobeAmericas,
  FaGraduationCap,
  FaHandHoldingUsd,
  FaIndustry,
  FaLayerGroup,
  FaMapMarkerAlt,
  FaSearch,
  FaSlidersH,
  FaTimes,
  FaUniversity,
} from 'react-icons/fa';
import type { DirectoryFacetDimension, DirectoryFacetItem, DirectoryFacetResponse, RecommendationRawResultItem, RecommendationSearchFilters } from '../lib/recommendations/types';

type BrowseCategory = DirectoryFacetDimension | null;

interface ActiveSelection {
  dimension: DirectoryFacetDimension;
  value: string;
}

const CATEGORY_META: Record<DirectoryFacetDimension, { label: string; icon: React.ReactNode }> = {
  researchArea: { label: 'Research Area', icon: <FaFlask /> },
  country: { label: 'Country', icon: <FaGlobeAmericas /> },
  fundingKind: { label: 'Funding Type', icon: <FaHandHoldingUsd /> },
  careerStage: { label: 'Career Stage', icon: <FaGraduationCap /> },
  discipline: { label: 'Discipline', icon: <FaLayerGroup /> },
  sponsorType: { label: 'Sponsor', icon: <FaIndustry /> },
  region: { label: 'Region', icon: <FaMapMarkerAlt /> },
  institutionType: { label: 'Institution', icon: <FaUniversity /> },
};

const DIMENSION_ORDER: DirectoryFacetDimension[] = [
  'researchArea', 'country', 'fundingKind', 'careerStage',
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
  onSelectFacet: (dimension: DirectoryFacetDimension, value: string) => void;
  onRemoveFacet: (dimension: DirectoryFacetDimension, value: string) => void;
  onClearAllSelections: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  activeSelections: ActiveSelection[];
  onOpenAdvancedFilters: () => void;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
}

function ExpandableCard({
  result,
  defaultExpanded,
  onBeginWriting,
}: {
  result: RecommendationRawResultItem;
  defaultExpanded?: boolean;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const amount = formatAmount(result);
  const geography =
    result.eligibleCountries.slice(0, 3).join(', ') ||
    result.eligibleRegions.slice(0, 3).join(', ') ||
    result.hostCountries.slice(0, 3).join(', ');

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full cursor-pointer text-left"
      >
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">{result.agencyName}</p>
              <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-slate-900">{result.schemeTitle}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {result.isRolling ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Rolling</span>
              ) : result.closeDate ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {new Date(result.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              ) : null}
              {expanded ? <FaAngleUp className="text-slate-400" /> : <FaAngleDown className="text-slate-400" />}
            </div>
          </div>

          {result.shortDescription ? (
            <p className={`mt-2 text-sm leading-relaxed text-slate-600 ${expanded ? '' : 'line-clamp-2'}`}>
              {result.shortDescription}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {result.fundingKinds.slice(0, 2).map((v) => (
              <span key={v} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{v}</span>
            ))}
            {result.disciplines.slice(0, 2).map((v) => (
              <span key={v} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">{v}</span>
            ))}
            {geography ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{geography}</span>
            ) : null}
            {amount ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">{amount}</span>
            ) : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {result.fullDescription || result.description ? (
              <div className="sm:col-span-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Description</div>
                <p className="mt-1.5 leading-relaxed text-slate-700">{result.fullDescription || result.description}</p>
              </div>
            ) : null}

            {result.eligibilitySummary || result.eligibilityText ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Eligibility</div>
                <p className="mt-1.5 leading-relaxed text-slate-700">{result.eligibilityText || result.eligibilitySummary}</p>
              </div>
            ) : null}

            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Details</div>
              <div className="mt-1.5 space-y-1 text-slate-700">
                {result.careerStages.length > 0 ? <p>Career stages: {result.careerStages.join(', ')}</p> : null}
                {result.institutionTypes.length > 0 ? <p>Institutions: {result.institutionTypes.join(', ')}</p> : null}
                {result.sponsorType ? <p>Sponsor: {result.sponsorType}</p> : null}
                {result.geographyScope ? <p>Scope: {result.geographyScope}</p> : null}
                {result.applicationLanguages.length > 0 ? <p>Languages: {result.applicationLanguages.join(', ')}</p> : null}
              </div>
            </div>

            {result.contactInfo ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Contact</div>
                <p className="mt-1.5 leading-relaxed text-slate-700">{result.contactInfo}</p>
              </div>
            ) : null}
          </div>

          {result.officialUrls[0] || onBeginWriting ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onBeginWriting ? (
                <button
                  type="button"
                  onClick={() => onBeginWriting(result)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  Begin writing
                </button>
              ) : null}
              {result.officialUrls[0] ? (
              <a
                href={result.officialUrls[0]}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
              >
                View Full Call <FaExternalLinkAlt className="text-[10px]" />
              </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function FundingDirectoryPanel({
  query,
  filters,
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
}: FundingDirectoryPanelProps) {
  const [openCategory, setOpenCategory] = useState<BrowseCategory>(null);
  const [facetSearch, setFacetSearch] = useState('');

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
    return items.filter((item) => item.value.toLowerCase().includes(q));
  }

  function countSelectionsForDimension(dim: DirectoryFacetDimension) {
    return activeSelections.filter((s) => s.dimension === dim).length;
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/92 shadow-[0_28px_70px_rgba(15,23,42,0.10)] backdrop-blur">
        {/* Header */}
        <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-600">Funding Directory</p>
              <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950">Browse Funding Opportunities</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
                Click a category to explore available values, select facets to progressively narrow results, or use the search bar for keyword matching.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
              {loading || facetsLoading ? 'Loading...' : `${totalResults.toLocaleString()} opportunities`}
            </div>
          </div>

          {/* Search bar */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRunSearch(); } }}
                placeholder="Search by topic, agency, keyword..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex gap-2">
              {query ? (
                <button type="button" onClick={onClearQuery} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300">
                  <FaTimes /> Clear
                </button>
              ) : null}
              <button type="button" onClick={onRunSearch} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700">
                <FaSearch /> Search
              </button>
              <button type="button" onClick={onOpenAdvancedFilters} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-400 hover:text-emerald-700">
                <FaSlidersH /> Advanced
              </button>
            </div>
          </div>
        </div>

        {/* Active selections breadcrumb bar */}
        {activeSelections.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-emerald-50/50 px-6 py-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Active:</span>
            {activeSelections.map((sel) => (
              <span
                key={`${sel.dimension}-${sel.value}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 py-1 pl-3 pr-1.5 text-xs font-semibold text-emerald-900"
              >
                <span className="text-emerald-600">{CATEGORY_META[sel.dimension].label}:</span> {sel.value}
                <button
                  type="button"
                  onClick={() => onRemoveFacet(sel.dimension, sel.value)}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-200 hover:text-emerald-900"
                >
                  <FaTimes className="text-[8px]" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={onClearAllSelections}
              className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-900"
            >
              Clear All
            </button>
          </div>
        ) : null}

        {/* Category browse bar */}
        <div className="border-b border-slate-200/80 bg-slate-50/60 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {DIMENSION_ORDER.map((dim) => {
              const meta = CATEGORY_META[dim];
              const count = facets?.facets[dim]?.length || 0;
              const selCount = countSelectionsForDimension(dim);
              const isOpen = openCategory === dim;

              return (
                <button
                  key={dim}
                  type="button"
                  onClick={() => toggleCategory(dim)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                    isOpen
                      ? 'bg-emerald-600 text-white shadow-md'
                      : selCount > 0
                        ? 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  <span className="text-[11px]">{meta.icon}</span>
                  {meta.label}
                  {selCount > 0 ? (
                    <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${isOpen ? 'bg-white/25 text-white' : 'bg-emerald-600 text-white'}`}>
                      {selCount}
                    </span>
                  ) : count > 0 ? (
                    <span className={`text-[10px] font-normal ${isOpen ? 'text-emerald-100' : 'text-slate-400'}`}>({count})</span>
                  ) : null}
                  {isOpen ? <FaAngleUp className="text-[9px]" /> : <FaChevronRight className="text-[9px]" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Facet value picker */}
        {openCategory ? (
          <div className="border-b border-slate-200/80 bg-white px-6 py-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input
                  value={facetSearch}
                  onChange={(e) => setFacetSearch(e.target.value)}
                  placeholder={`Filter ${CATEGORY_META[openCategory].label.toLowerCase()} values...`}
                  className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-emerald-400"
                />
              </div>
              <span className="text-[10px] text-slate-500">
                {getFilteredFacetItems(openCategory).length} values
              </span>
            </div>

            {facetsLoading ? (
              <div className="flex h-20 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              </div>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {getFilteredFacetItems(openCategory).map((item) => {
                  const selected = isSelected(openCategory, item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => selected ? onRemoveFacet(openCategory, item.value) : onSelectFacet(openCategory, item.value)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        selected
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {item.value}
                      <span className={`text-[10px] ${selected ? 'text-emerald-200' : 'text-slate-400'}`}>
                        ({item.count})
                      </span>
                    </button>
                  );
                })}
                {getFilteredFacetItems(openCategory).length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">No values found{facetSearch ? ' matching your search' : ' for current filters'}.</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {/* Results grid */}
        <div className="bg-[linear-gradient(180deg,rgba(248,250,252,0.5),rgba(255,255,255,0.98))] px-6 py-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-emerald-500 border-t-transparent" />
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <p className="text-lg font-semibold text-slate-900">No opportunities match the current selection.</p>
              <p className="mt-2 text-sm text-slate-600">
                Try removing some filters, broadening your search, or clearing all selections.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Pagination top */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  Page {page} of {totalPages} &middot; {totalResults.toLocaleString()} total
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

              {/* Card grid */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {results.map((result) => (
                  <ExpandableCard key={result.id} result={result} onBeginWriting={onBeginWriting} />
                ))}
              </div>

              {/* Pagination bottom */}
              {totalPages > 1 ? (
                <div className="flex justify-center pt-2">
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
      </section>
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
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={!hasPreviousPage}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      {pageWindow.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onGoToPage(p)}
          className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            p === page
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={onNextPage}
        disabled={!hasNextPage}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
