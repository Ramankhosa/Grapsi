import { FaExternalLinkAlt, FaFilter, FaSearch, FaTimes } from 'react-icons/fa';
import FinderActiveFilterBar from './FinderActiveFilterBar';
import type { RecommendationRawResultItem, RecommendationSearchFilters } from '../lib/recommendations/types';

interface FundingManualSearchPanelProps {
  query: string;
  activeQuery: string;
  filters: Required<RecommendationSearchFilters>;
  loading: boolean;
  results: RecommendationRawResultItem[];
  totalResults: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onQueryChange: (value: string) => void;
  onRunSearch: () => void;
  onOpenFilters: () => void;
  onClearQuery: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  onRemoveArrayValue: (key: keyof RecommendationSearchFilters, value: string) => void;
  onClearScalar: (key: keyof RecommendationSearchFilters) => void;
  onClearAllFilters: () => void;
  onUndo?: () => void;
}

function formatAmount(result: RecommendationRawResultItem) {
  if (result.amountMin === null && result.amountMax === null) {
    return null;
  }
  if (result.amountMin !== null && result.amountMax !== null) {
    return `${result.currency || ''} ${result.amountMin} - ${result.amountMax}`.trim();
  }
  return `${result.currency || ''} ${result.amountMin ?? result.amountMax}`.trim();
}

export default function FundingManualSearchPanel({
  query,
  activeQuery,
  filters,
  loading,
  results,
  totalResults,
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onQueryChange,
  onRunSearch,
  onOpenFilters,
  onClearQuery,
  onPreviousPage,
  onNextPage,
  onGoToPage,
  onRemoveArrayValue,
  onClearScalar,
  onClearAllFilters,
  onUndo,
}: FundingManualSearchPanelProps) {
  const pageWindow = Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
    const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
    return startPage + index;
  }).filter((value, index, array) => value >= 1 && value <= totalPages && array.indexOf(value) === index);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[30px] border border-white/70 bg-white/88 shadow-[0_28px_70px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Manual Search</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Browse Funding Opportunities</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Search the published funding directory directly, apply filters like a funding marketplace, and scan opportunities without chatting.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
              {loading ? 'Loading directory...' : `${totalResults} filtered opportunities`}
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <FaSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onRunSearch();
                  }
                }}
                placeholder="Search by topic, agency, scheme, or discipline"
                className="w-full rounded-[22px] border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenFilters}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-800"
              >
                <FaFilter />
                Filters
              </button>
              {query ? (
                <button
                  type="button"
                  onClick={onClearQuery}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400"
                >
                  <FaTimes />
                  Clear Query
                </button>
              ) : null}
              <button
                type="button"
                onClick={onRunSearch}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <FaSearch />
                Search
              </button>
            </div>
          </div>

          <div className="mt-3 text-sm text-slate-500">
            {activeQuery
              ? `Showing page ${page} of ${totalPages} for "${activeQuery}".`
              : `Showing page ${page} of ${totalPages} from the published funding directory, rigorously filtered by the active filters.`}
          </div>
        </div>

        <div className="px-6 py-5">
          <FinderActiveFilterBar
            filters={filters}
            onRemoveArrayValue={onRemoveArrayValue}
            onClearScalar={onClearScalar}
            onOpenFilters={onOpenFilters}
            onClearAllFilters={onClearAllFilters}
            onUndo={onUndo}
          />
        </div>

        <div className="border-t border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,0.65),_rgba(255,255,255,0.98))] px-6 py-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <div className="text-lg font-semibold text-slate-900">No opportunities match the current directory search.</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Try broadening the keyword query or removing some filters to see more published funding calls.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  {totalResults > 0
                    ? `Showing ${results.length} results on this page out of ${totalResults} filtered opportunities.`
                    : 'No filtered opportunities to show.'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onPreviousPage}
                    disabled={!hasPreviousPage}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {pageWindow.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => onGoToPage(pageNumber)}
                      className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
                        pageNumber === page
                          ? 'bg-slate-950 text-white'
                          : 'border border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-800'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={onNextPage}
                    disabled={!hasNextPage}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="-mx-2 overflow-x-auto pb-2">
                <div className="flex min-w-max snap-x snap-mandatory gap-4 px-2">
              {results.map((result) => {
                const amount = formatAmount(result);
                const geography =
                  result.eligibleCountries.slice(0, 3).join(', ') ||
                  result.eligibleRegions.slice(0, 3).join(', ') ||
                  result.hostCountries.slice(0, 3).join(', ');

                return (
                  <article
                    key={result.id}
                    className="w-[360px] shrink-0 snap-start rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                          {result.agencyName}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">{result.schemeTitle}</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {result.isRolling ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                            Rolling
                          </span>
                        ) : result.closeDate ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                            Deadline {new Date(result.closeDate).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {result.shortDescription ? (
                      <p className="mt-4 text-sm leading-7 text-slate-600">{result.shortDescription}</p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {result.fundingKinds.slice(0, 3).map((value) => (
                        <span
                          key={value}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-900"
                        >
                          {value}
                        </span>
                      ))}
                      {result.disciplines.slice(0, 2).map((value) => (
                        <span
                          key={value}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700"
                        >
                          {value}
                        </span>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Eligibility</div>
                        <div className="mt-1 leading-6">{result.eligibilitySummary}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Geography</div>
                        <div className="mt-1 leading-6">{geography || 'See opportunity details'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Amount</div>
                        <div className="mt-1 leading-6">{amount || 'Not specified'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sponsor Type</div>
                        <div className="mt-1 leading-6">{result.sponsorType || 'Not specified'}</div>
                      </div>
                    </div>

                    {activeQuery && result.matchReasons.length > 0 ? (
                      <div className="mt-5 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Why It Matched</div>
                        <div className="mt-2 space-y-1 text-sm text-emerald-950">
                          {result.matchReasons.slice(0, 3).map((reason) => (
                            <div key={reason}>- {reason}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-500">
                        {result.institutionTypes.length > 0 ? `Institution types: ${result.institutionTypes.slice(0, 2).join(', ')}` : 'Institution type not specified'}
                      </div>
                      {result.officialUrls[0] ? (
                        <a
                          href={result.officialUrls[0]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                        >
                          Open Call
                          <FaExternalLinkAlt className="text-xs" />
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
