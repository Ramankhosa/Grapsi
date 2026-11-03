import ImportedAreaPicker from './finder/ImportedAreaPicker';
import PersonalGrantActions, { PersonalGrantProvider, PersonalGrantLoadError } from './funding/PersonalGrantActions';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Clock3, ExternalLink, Globe2, Search, SlidersHorizontal, X, LayoutGrid, List, Wallet, MapPin } from 'lucide-react';
import WorkspaceDialog from './ui/WorkspaceDialog';
import FinderPreferencesPanel, { type FinderPreferenceValues } from './FinderPreferencesPanel';
import CountryPicker from './finder/CountryPicker';
import FunderPicker from './finder/FunderPicker';
import { ELIGIBILITY_BADGE } from './funding/eligibilityBadge';
import { useFunderNames } from '../hooks/useFunderNames';
import {
  APPLICATION_ROUTE_LABELS,
  INDIRECT_COST_LABELS,
  MOBILITY_LABELS,
  PROJECT_DURATION_BUCKETS,
  RECOMMENDATION_AMOUNT_CURRENCY_OPTIONS,
  RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS,
} from '../lib/recommendations/constants';
import { facetValues, toggleFacetValue } from '../lib/recommendations/directorySelections';
import type {
  DirectoryFacetDimension,
  DirectoryFacetItem,
  DirectoryFacetResponse,
  RecommendationRawResultItem,
  RecommendationSearchFilters,
} from '../lib/recommendations/types';

type Filters = Required<RecommendationSearchFilters>;

const FACET_LABEL: Record<DirectoryFacetDimension, string> = {
  careerStage: 'Career stage',
  institutionType: 'Applying organisation',
  fundingKind: 'Funding type',
  funder: 'Funder',
  sponsorType: 'Funder type',
  taxonomyArea: 'Previous Grapsi areas',
  sdgGoal: 'Sustainable Development Goal',
  programmeFramework: 'Programme',
  region: 'Region',
  geographyScope: 'Geographic scope',
  qualification: 'Qualification asked for',
  projectDuration: 'Project length',
  targetGroup: 'Aimed at',
  indirectCosts: 'Indirect costs',
  mobility: 'Mobility',
  applicationRoute: 'How to apply',
};

/** Coded facet values and their labels. */
const VALUE_LABELS: Partial<Record<DirectoryFacetDimension, Record<string, string>>> = {
  projectDuration: Object.fromEntries(Object.entries(PROJECT_DURATION_BUCKETS).map(([value, bucket]) => [value, bucket.label])),
  indirectCosts: INDIRECT_COST_LABELS,
  mobility: MOBILITY_LABELS,
  applicationRoute: APPLICATION_ROUTE_LABELS,
};

/** Facts only the external catalogue states: choosing one leaves out calls that say nothing about it. */
const CATALOGUE_ONLY_HINT = 'Only calls that state this are shown.';

const VISIBLE_FACET_VALUES = 8;
/** A facet gets its own search box only when its list is long. */
const SEARCHABLE_FACET_VALUES = 12;

/** Today in the viewer's calendar, as the date inputs and deadline presets use it. */
function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount(result: RecommendationRawResultItem) {
  if (result.amountMin === null && result.amountMax === null) return null;
  const format = (value: number) => {
    if (result.currency === 'INR') {
      if (value >= 10000000) return `₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(value / 10000000)} Cr`;
      if (value >= 100000) return `₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(value / 100000)} L`;
      return `₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(value)}`;
    }
    return `${result.currency || ''} ${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value)}`.trim();
  };
  if (result.amountMin !== null && result.amountMax !== null && result.amountMin !== result.amountMax) {
    return `${format(Number(result.amountMin))} – ${format(Number(result.amountMax))}`;
  }
  return format(Number(result.amountMin ?? result.amountMax));
}


// ------------------------------------------------------------- applied filters

type AppliedChip = { key: string; label: string; remove: (filters: Filters) => Filters };

function appliedChips(filters: Filters, labelFor: (dimension: DirectoryFacetDimension, value: string) => string): AppliedChip[] {
  const chips: AppliedChip[] = [];
  const list = (field: keyof Filters, prefix: string, values: string[]) =>
    values.forEach((value) =>
      chips.push({
        key: `${String(field)}:${value}`,
        label: `${prefix}: ${value}`,
        remove: (current) => ({ ...current, [field]: (current[field] as string[]).filter((item) => item !== value) }),
      })
    );

  list('eligibleCountries', 'Open to applicants from', filters.eligibleCountries);
  (Object.keys(FACET_LABEL) as DirectoryFacetDimension[]).forEach((dimension) =>
    facetValues(filters, dimension).forEach((value) =>
      chips.push({
        key: `${dimension}:${value}`,
        label: `${FACET_LABEL[dimension]}: ${labelFor(dimension, value)}`,
        remove: (current) => toggleFacetValue(current, dimension, value),
      })
    )
  );
  list('hostCountries', 'Work carried out in', filters.hostCountries);
  list('funderCountries', 'Funder based in', filters.funderCountries);
  list('applicationLanguages', 'Language (or not stated)', filters.applicationLanguages);
  list('citizenshipRequirements', 'Citizen of', filters.citizenshipRequirements);
  list('residencyRequirements', 'Living in', filters.residencyRequirements);

  if (filters.deadlineFrom || filters.deadlineTo) {
    const label = filters.deadlineFrom && filters.deadlineTo
      ? `Deadline: ${formatDay(filters.deadlineFrom)} – ${formatDay(filters.deadlineTo)}`
      : filters.deadlineFrom
        ? `Deadline from ${formatDay(filters.deadlineFrom)}`
        : `Deadline by ${formatDay(filters.deadlineTo)}`;
    chips.push({ key: 'deadline', label, remove: (current) => ({ ...current, deadlineFrom: '', deadlineTo: '' }) });
  }
  if (filters.rollingOnly) chips.push({ key: 'rolling', label: 'Rolling calls only', remove: (current) => ({ ...current, rollingOnly: false, lifecycleStatuses:['OPEN','ROLLING'] }) });
  if (filters.noMembershipNeeded) {
    chips.push({ key: 'membership', label: 'No society membership needed', remove: (current) => ({ ...current, noMembershipNeeded: false }) });
  }
  if (filters.includeExpired) chips.push({ key: 'closed', label: 'Including closed calls', remove: (current) => ({ ...current, includeExpired: false }) });
  if (filters.amountMin !== null || filters.amountMax !== null) {
    const currency = filters.amountCurrency ? ` ${filters.amountCurrency}` : '';
    const label = filters.amountMin !== null && filters.amountMax !== null
      ? `Amount: ${filters.amountMin.toLocaleString()} – ${filters.amountMax.toLocaleString()}${currency}`
      : filters.amountMin !== null
        ? `Amount: at least ${filters.amountMin.toLocaleString()}${currency}`
        : `Amount: up to ${(filters.amountMax as number).toLocaleString()}${currency}`;
    chips.push({
      key: 'amount',
      label: filters.includeUnknownAmount ? `${label}, or not stated` : label,
      remove: (current) => ({ ...current, amountMin: null, amountMax: null, amountCurrency: '', includeUnknownAmount: false }),
    });
  }
  return chips;
}

// ------------------------------------------------------------- rail controls

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-hairline py-3 last:border-b-0">
      <h3 className="cb-eyebrow mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Disclosure({
  label,
  count,
  defaultOpen,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[40px] w-full items-center justify-between gap-2 text-left text-[13px] font-medium text-ink"
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {count ? <span className="cb-badge-cobalt">{count}</span> : null}
          <ChevronDown className={`h-4 w-4 text-muted-soft transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open ? <div className="pb-2">{children}</div> : null}
    </div>
  );
}

/** One facet: checkboxes with counts. Values inside it are alternatives. */
function FacetGroup({
  dimension,
  items,
  filters,
  labelFor,
  onChange,
  defaultOpen,
  footer,
  hint,
}: {
  dimension: DirectoryFacetDimension;
  items: DirectoryFacetItem[];
  filters: Filters;
  labelFor: (dimension: DirectoryFacetDimension, value: string) => string;
  onChange: (filters: Filters) => void;
  defaultOpen?: boolean;
  footer?: React.ReactNode;
  hint?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const selected = facetValues(filters, dimension);
  // A chosen value the facet no longer lists (no call left for it under the
  // other filters, or restored from a link) stays visible so it can be removed.
  const rows = [
    ...items.map((item) => ({ value: item.value, count: item.count as number | null, item })),
    ...selected.filter((value) => !items.some((item) => item.value === value)).map((value) => ({ value, count: 0, item: null })),
  ];
  const term = search.trim().toLowerCase();
  const matching = term ? rows.filter((row) => labelFor(dimension, row.value).toLowerCase().includes(term)) : rows;
  const visible = showAll || term
    ? matching
    : matching.filter((row, index) => index < VISIBLE_FACET_VALUES || selected.includes(row.value));
  const hidden = matching.length - visible.length;

  return (
    <Disclosure label={FACET_LABEL[dimension]} count={selected.length} defaultOpen={defaultOpen || selected.length > 0}>
      {rows.length > SEARCHABLE_FACET_VALUES ? (
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-soft" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Find a ${FACET_LABEL[dimension].toLowerCase()}`}
            aria-label={`Find a ${FACET_LABEL[dimension].toLowerCase()}`}
            className="cb-input py-1.5 pl-8 text-[13px]"
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-1 text-[12px] text-muted">No calls left for this under the current filters.</p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map((row) => {
            const checked = selected.includes(row.value);
            const sub = row.item?.level2Name && row.item.level1Name ? row.item.level1Name : null;
            return (
              <li key={row.value}>
                <label
                  className={`flex min-h-[34px] cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-[13px] transition ${
                    checked ? 'bg-cobalt-50 text-cobalt-800' : 'text-ink-soft hover:bg-inset'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(toggleFacetValue(filters, dimension, row.value))}
                    className="h-3.5 w-3.5 shrink-0 accent-cobalt-600"
                  />
                  <span className="min-w-0 flex-1 py-1 leading-snug">
                    {labelFor(dimension, row.value)}
                    {sub ? <span className="block text-[11px] text-muted-soft">{sub}</span> : null}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-soft">{row.count?.toLocaleString() ?? ''}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 ? (
        <button type="button" onClick={() => setShowAll(true)} className="mt-1 px-1.5 text-[12px] font-medium text-cobalt-700 hover:underline">
          Show {hidden} more
        </button>
      ) : showAll && !term && rows.length > VISIBLE_FACET_VALUES ? (
        <button type="button" onClick={() => setShowAll(false)} className="mt-1 px-1.5 text-[12px] font-medium text-cobalt-700 hover:underline">
          Show fewer
        </button>
      ) : null}
      {selected.length > 1 ? <p className="cb-hint mt-1.5 px-1.5">Showing calls that match any of these.</p> : null}
      {hint && rows.length > 0 ? <p className="cb-hint mt-1.5 px-1.5">{hint}</p> : null}
      {footer}
    </Disclosure>
  );
}

function DeadlineControl({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  const today = todayKey();
  const presets = [
    { key: 'any', label: 'Any time', from: '', to: '' },
    { key: '30', label: 'Next 30 days', from: today, to: todayKey(30) },
    { key: '90', label: 'Next 90 days', from: today, to: todayKey(90) },
  ];
  const active = presets.find((preset) => preset.from === filters.deadlineFrom && preset.to === filters.deadlineTo)?.key || 'custom';
  const [custom, setCustom] = useState(active === 'custom');
  const showDates = custom || active === 'custom';

  return (
    <div className="space-y-2.5 py-1">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Deadline">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={!showDates && active === preset.key}
            onClick={() => {
              setCustom(false);
              onChange({ ...filters, deadlineFrom: preset.from, deadlineTo: preset.to });
            }}
            className={`cb-chip ${!showDates && active === preset.key ? 'cb-chip-active' : ''}`}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" aria-pressed={showDates} onClick={() => setCustom(true)} className={`cb-chip ${showDates ? 'cb-chip-active' : ''}`}>
          Pick dates
        </button>
      </div>
      {showDates ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[12px] text-muted">From</span>
            <input
              type="date"
              value={filters.deadlineFrom}
              max={filters.deadlineTo || undefined}
              onChange={(event) => onChange({ ...filters, deadlineFrom: event.target.value })}
              className="cb-input mt-1 py-1.5 text-[13px]"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-muted">To</span>
            <input
              type="date"
              value={filters.deadlineTo}
              min={filters.deadlineFrom || undefined}
              onChange={(event) => onChange({ ...filters, deadlineTo: event.target.value })}
              className="cb-input mt-1 py-1.5 text-[13px]"
            />
          </label>
        </div>
      ) : null}
      {(filters.deadlineFrom || filters.deadlineTo) && !filters.rollingOnly ? (
        <p className="cb-hint">Rolling calls have no deadline, so a date range leaves them out.</p>
      ) : null}
      <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5 text-[13px] text-ink-soft">
        <input
          type="checkbox"
          checked={filters.rollingOnly}
          onChange={(event) => onChange({ ...filters, rollingOnly: event.target.checked, lifecycleStatuses:event.target.checked?['ROLLING']:['OPEN','ROLLING'] })}
          className="h-3.5 w-3.5 accent-cobalt-600"
        />
        Rolling calls only
      </label>
      <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5 text-[13px] text-ink-soft">
        <input
          type="checkbox"
          checked={filters.includeExpired}
          onChange={(event) => onChange({ ...filters, includeExpired: event.target.checked, lifecycleStatuses: event.target.checked ? [] : ['OPEN','ROLLING'] })}
          className="h-3.5 w-3.5 accent-cobalt-600"
        />
        Include closed calls
      </label>
    </div>
  );
}

function AmountControl({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  const [min, setMin] = useState(filters.amountMin === null ? '' : String(filters.amountMin));
  const [max, setMax] = useState(filters.amountMax === null ? '' : String(filters.amountMax));
  useEffect(() => setMin(filters.amountMin === null ? '' : String(filters.amountMin)), [filters.amountMin]);
  useEffect(() => setMax(filters.amountMax === null ? '' : String(filters.amountMax)), [filters.amountMax]);
  const parse = (value: string) => {
    const number = Number(value.replace(/[,\s]/g, ''));
    return value.trim() && Number.isFinite(number) && number >= 0 ? number : null;
  };
  const commit = () => {
    const nextMin = parse(min);
    const nextMax = parse(max);
    if (nextMin !== filters.amountMin || nextMax !== filters.amountMax) onChange({ ...filters, amountMin: nextMin, amountMax: nextMax });
  };
  const hasBound = filters.amountMin !== null || filters.amountMax !== null;

  return (
    <div className="space-y-2.5 py-1">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[12px] text-muted">At least</span>
          <input
            inputMode="numeric"
            value={min}
            onChange={(event) => setMin(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="0"
            className="cb-input mt-1 py-1.5 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="text-[12px] text-muted">Up to</span>
          <input
            inputMode="numeric"
            value={max}
            onChange={(event) => setMax(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === 'Enter' && commit()}
            placeholder="No limit"
            className="cb-input mt-1 py-1.5 text-[13px]"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[12px] text-muted">Currency</span>
        <select
          value={filters.amountCurrency}
          onChange={(event) => onChange({ ...filters, amountCurrency: event.target.value })}
          className="cb-select mt-1 py-1.5 text-[13px]"
        >
          <option value="">As listed (no conversion)</option>
          {RECOMMENDATION_AMOUNT_CURRENCY_OPTIONS.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </label>
      <p className="cb-hint">
        {filters.amountCurrency
          ? `Calls in other currencies are compared at approximate exchange rates.`
          : 'Numbers are compared as each call lists them, whatever the currency.'}
      </p>
      <label className={`flex min-h-[32px] items-center gap-2.5 text-[13px] ${hasBound ? 'cursor-pointer text-ink-soft' : 'text-muted-soft'}`}>
        <input
          type="checkbox"
          disabled={!hasBound}
          checked={filters.includeUnknownAmount}
          onChange={(event) => onChange({ ...filters, includeUnknownAmount: event.target.checked })}
          className="h-3.5 w-3.5 accent-cobalt-600"
        />
        Also show calls with no stated amount
      </label>
    </div>
  );
}

// ------------------------------------------------------------- results

function ExpandableCard({
  result,
  onBeginWriting,
  getCallDetailsHref,
  onOpenDetails,
  extraActions,
}: {
  result: RecommendationRawResultItem;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
  getCallDetailsHref?: (result: RecommendationRawResultItem) => string;
  onOpenDetails?: (result: RecommendationRawResultItem) => void;
  extraActions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const amount = formatAmount(result);
  const deadlineDay = result.closeDate?.slice(0, 10);
  const daysLeft = deadlineDay ? Math.round((Date.parse(`${deadlineDay}T00:00:00Z`) - Date.parse(`${todayKey()}T00:00:00Z`)) / 86400000) : null;
  const urgent = !result.isRolling && daysLeft !== null && daysLeft >= 0 && daysLeft <= 14;
  const callDetailsHref = getCallDetailsHref?.(result) || `/finder/calls/${encodeURIComponent(result.id)}`;
  const geography =
    result.eligibleCountries.slice(0, 3).join(', ') ||
    result.eligibleRegions.slice(0, 3).join(', ') ||
    result.hostCountries.slice(0, 3).join(', ');

  return (
    <article className="cb-card flex h-full flex-col overflow-hidden transition duration-200 hover:border-blue-200 hover:shadow-lg hover:shadow-slate-200/40">
      <div className="flex-1 text-left">
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-500">{result.agencyName || 'Funding opportunity'}</p>
              <h3 className="mt-2 text-lg font-semibold leading-snug tracking-[-0.015em] text-slate-950">{onOpenDetails
                ? <button type="button" onClick={() => onOpenDetails(result)} className="text-left hover:text-blue-700">{result.schemeTitle}</button>
                : <a href={callDetailsHref} target="_blank" rel="noreferrer" className="hover:text-blue-700">{result.schemeTitle}</a>}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {result.isRolling ? (
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Rolling</span>
              ) : urgent ? (
                <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">{daysLeft === 0 ? 'Closes today' : `${daysLeft} days left`}</span>
              ) : null}
            </div>
          </div>

          {result.shortDescription ? (
            <p className={`mt-3 text-sm leading-6 text-slate-500 ${expanded ? '' : 'line-clamp-2'}`}>
              {result.shortDescription}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {result.limitedSubmissions ? (
              <span className="cb-badge" title="The funder takes a limited number of applications per institution: your research office may need to pre-select.">
                Limited submissions
              </span>
            ) : null}
            {result.isCatalog ? (
              <span
                className="cb-badge"
                title="From the global funding catalogue: details are as the source publishes them. Check the funder's page before applying."
              >
                <Globe2 className="h-3 w-3" />
                Global catalogue
              </span>
            ) : null}
            {result.eligibilityVerdict ? (
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${ELIGIBILITY_BADGE[result.eligibilityVerdict].className}`}
                title={ELIGIBILITY_BADGE[result.eligibilityVerdict].title}
              >
                {ELIGIBILITY_BADGE[result.eligibilityVerdict].label}
              </span>
            ) : null}
            {result.profileMatch?.reasons.slice(0, 1).map((reason) => (
              <span key={reason} className="cb-badge-cobalt">{reason}</span>
            ))}
            {result.fundingKinds.slice(0, 2).map((v) => (
              <span key={v} className="cb-badge">{v}</span>
            ))}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3.5">
            <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Wallet className="h-3.5 w-3.5" />Funding</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{amount || 'Amount not specified'}</dd></div>
            <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />Entry deadline</dt><dd className={`mt-1 text-sm font-semibold ${urgent ? 'text-amber-800' : 'text-slate-800'}`}>{result.isRolling ? 'Applications accepted year-round' : deadlineDay ? formatDay(deadlineDay) : 'Check funder guidance'}</dd></div>
            {geography && <div className="col-span-2 flex items-start gap-1.5 border-t border-slate-200/70 pt-2 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" /><span>{geography}</span></div>}
          </dl>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5 sm:px-6">
        <PersonalGrantActions compact callId={result.id} title={result.schemeTitle} />
        <button type="button" onClick={() => setExpanded(prev => !prev)} aria-expanded={expanded} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">{expanded ? 'Less detail' : 'Quick details'}<ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
        <div className="flex flex-wrap items-center gap-2">
          {extraActions}
          {onBeginWriting && result.authoringReady !== false && <button type="button" onClick={() => onBeginWriting(result)} className="funding-button-secondary">Begin writing</button>}
          {onOpenDetails
            ? <>
                <a href={callDetailsHref} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-sm" aria-label={`Open ${result.schemeTitle} in a new tab`}>Full page<ArrowUpRight className="h-3.5 w-3.5" /></a>
                <button type="button" onClick={() => onOpenDetails(result)} className="funding-button-primary">Details</button>
              </>
            : <a href={callDetailsHref} target="_blank" rel="noreferrer" className="funding-button-primary">View opportunity<ArrowUpRight className="h-4 w-4" /></a>}
        </div>
      </div>

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
                <p className="mt-1 whitespace-pre-line leading-6 text-muted">{result.eligibilityText || result.eligibilitySummary}</p>
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
                {result.institutionTypes.length > 0 ? <p>Organisations: {result.institutionTypes.join(', ')}</p> : null}
                {result.sponsorType ? <p>Funder type: {result.sponsorType}</p> : null}
                {result.disciplines.length > 0 ? <p>Disciplines: {result.disciplines.slice(0, 6).join(', ')}</p> : null}
                {result.geographyScope ? <p>Scope: {result.geographyScope}</p> : null}
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

function PaginationControls({
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onGoToPage,
}: {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onGoToPage: (p: number) => void;
}) {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pageWindow = Array.from({ length: Math.min(totalPages, 5) }, (_, i) => start + i).filter((p) => p >= 1 && p <= totalPages);
  return (
    <nav className="flex items-center gap-1" aria-label="Pages">
      <button type="button" onClick={() => onGoToPage(page - 1)} disabled={!hasPreviousPage} className="cb-btn-secondary cb-btn-sm">
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
      <button type="button" onClick={() => onGoToPage(page + 1)} disabled={!hasNextPage} className="cb-btn-secondary cb-btn-sm">
        Next
      </button>
    </nav>
  );
}

// ------------------------------------------------------------- the panel

interface FundingDirectoryPanelProps {
  query: string;
  activeQuery: string;
  filters: Filters;
  facets: DirectoryFacetResponse | null;
  facetsLoading: boolean;
  loading: boolean;
  results: RecommendationRawResultItem[];
  totalResults: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** Labels learned from earlier facet responses (research-area ids). */
  facetLabels: Record<string, string>;
  /** The researcher's country of residence, offered as a one-click choice. */
  profileCountry?: string | null;
  onQueryChange: (value: string) => void;
  onRunSearch: () => void;
  onClearQuery: () => void;
  onFiltersChange: (filters: Filters) => void;
  onClearFilters: () => void;
  onGoToPage: (page: number) => void;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
  getCallDetailsHref?: (result: RecommendationRawResultItem) => string;
  /** When given, a call's title and a Details button open it in place; the full page stays a new-tab link. */
  onOpenDetails?: (result: RecommendationRawResultItem) => void;
  /** Extra buttons on each card, before the built-in ones. */
  renderResultActions?: (result: RecommendationRawResultItem) => ReactNode;
  /** Wording for a host page that searches differently (e.g. by research description). */
  searchCopy?: { placeholder: string; label: string; submit: string; help: ReactNode };
  /** Shown above the search box, e.g. a choice of how to search. */
  searchHeader?: ReactNode;
  /** Replaces the result-count line, for results that are not a full count. */
  resultSummary?: ReactNode;
  preferences: FinderPreferenceValues;
  onChangePreferences: (preferences: FinderPreferenceValues) => void;
}

export default function FundingDirectoryPanel(props: FundingDirectoryPanelProps) {
  return <PersonalGrantProvider callIds={props.results.map(result => result.id)}><PersonalGrantLoadError /><FundingDirectoryPanelContent {...props} /></PersonalGrantProvider>;
}

function FundingDirectoryPanelContent({
  query,
  activeQuery,
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
  facetLabels,
  profileCountry,
  onQueryChange,
  onRunSearch,
  onClearQuery,
  onFiltersChange,
  onClearFilters,
  onGoToPage,
  onBeginWriting,
  getCallDetailsHref,
  onOpenDetails,
  renderResultActions,
  searchCopy,
  searchHeader,
  resultSummary,
  preferences,
  onChangePreferences,
}: FundingDirectoryPanelProps) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [wideLayout,setWideLayout]=useState(false);
  useEffect(()=>{
    const media=window.matchMedia('(min-width: 1024px)');
    const update=()=>{setWideLayout(media.matches);if(media.matches)setMobileFiltersOpen(false)};
    update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  const funderNames = useFunderNames(filters.funderIds);

  const labelFor = useMemo(() => {
    const fromFacets = new Map<string, string>();
    for (const [dimension, items] of Object.entries(facets?.facets || {})) {
      for (const item of items) {
        const label = dimension === 'taxonomyArea' ? item.level2Name || item.level1Name || item.label : item.label;
        if (label) fromFacets.set(`${dimension}:${item.value}`, label);
      }
    }
    return (dimension: DirectoryFacetDimension, value: string) => {
      if (dimension === 'funder') return fromFacets.get(`funder:${value}`) || funderNames[value] || 'Selected funder';
      return VALUE_LABELS[dimension]?.[value] || fromFacets.get(`${dimension}:${value}`) || facetLabels[`${dimension}:${value}`] || value;
    };
  }, [facets, facetLabels, funderNames]);

  const chips = appliedChips(filters, labelFor);
  const items = (dimension: DirectoryFacetDimension) => facets?.facets[dimension] || [];
  const activePreferenceCount = (preferences.useEligibilityProfile ? 1 : 0) + (preferences.usePublicationContext ? 1 : 0);
  const busy = loading || facetsLoading;
  const resultNoun = filters.lifecycleStatuses.length === 2 && filters.lifecycleStatuses.includes('OPEN') && filters.lifecycleStatuses.includes('ROLLING') ? 'open or rolling calls' : 'calls';
  const set = (next:Required<RecommendationSearchFilters>) => onFiltersChange({...next,rollingOnly:next.lifecycleStatuses.length===1&&next.lifecycleStatuses[0]==='ROLLING'});

  const rail = (
    <div className={facetsLoading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>

      <RailSection title="Who can apply">
        <CountryPicker
          id="directory-eligible-countries"
          label="Open to applicants from"
          hint="Includes calls open worldwide. With several countries, a call open to any of them is shown."
          values={filters.eligibleCountries}
          onChange={(eligibleCountries) => set({ ...filters, eligibleCountries })}
          suggestion={profileCountry}
        />
        <Disclosure label="Citizenship" count={filters.citizenshipRequirements.length} defaultOpen={filters.citizenshipRequirements.length > 0}>
          <CountryPicker
            id="directory-citizenship"
            label="Applicant is a citizen of"
            hint="Keeps calls that accept citizens of any chosen country, and calls that set no citizenship rule."
            values={filters.citizenshipRequirements}
            onChange={(citizenshipRequirements) => set({ ...filters, citizenshipRequirements })}
          />
        </Disclosure>
        <Disclosure label="Residence" count={filters.residencyRequirements.length} defaultOpen={filters.residencyRequirements.length > 0}>
          <CountryPicker
            id="directory-residence"
            label="Applicant lives in"
            hint="Keeps calls open to residents of any chosen country, and calls that set no residence rule."
            values={filters.residencyRequirements}
            onChange={(residencyRequirements) => set({ ...filters, residencyRequirements })}
            suggestion={profileCountry}
          />
        </Disclosure>
        <FacetGroup dimension="careerStage" items={items('careerStage')} filters={filters} labelFor={labelFor} onChange={set} defaultOpen />
        <FacetGroup dimension="institutionType" items={items('institutionType')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="qualification" items={items('qualification')} filters={filters} labelFor={labelFor} onChange={set} hint={CATALOGUE_ONLY_HINT} />
        <FacetGroup dimension="targetGroup" items={items('targetGroup')} filters={filters} labelFor={labelFor} onChange={set} hint={CATALOGUE_ONLY_HINT} />
        <FacetGroup dimension="applicationRoute" items={items('applicationRoute')} filters={filters} labelFor={labelFor} onChange={set} />
        <Disclosure label="Application language" count={filters.applicationLanguages.length} defaultOpen={filters.applicationLanguages.length > 0}>
          <fieldset>
            <legend className="sr-only">Application language</legend>
            {RECOMMENDATION_APPLICATION_LANGUAGE_OPTIONS.map((language) => (
              <label key={language} className="flex min-h-[32px] cursor-pointer items-center gap-2.5 px-1.5 text-[13px] text-ink-soft">
                <input
                  type="checkbox"
                  checked={filters.applicationLanguages.includes(language)}
                  onChange={() => set({
                    ...filters,
                    applicationLanguages: filters.applicationLanguages.includes(language)
                      ? filters.applicationLanguages.filter((value) => value !== language)
                      : [...filters.applicationLanguages, language],
                  })}
                  className="h-3.5 w-3.5 shrink-0 accent-cobalt-600"
                />
                {language}
              </label>
            ))}
            <p className="cb-hint mt-1 px-1.5">Calls that do not state a language are kept.</p>
          </fieldset>
        </Disclosure>
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={filters.noMembershipNeeded}
            onChange={(event) => set({ ...filters, noMembershipNeeded: event.target.checked })}
            className="h-3.5 w-3.5 shrink-0 accent-cobalt-600"
          />
          <span className="flex-1 font-medium">No society membership needed</span>
          {facets?.toggles ? (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-soft" title="Members-only calls this hides">
              hides {facets.toggles.membershipRequired.toLocaleString()}
            </span>
          ) : null}
        </label>
      </RailSection>

      <RailSection title="Call status">
        {(['OPEN','ROLLING','FORTHCOMING','CLOSED','UNKNOWN'] as const).map(status=><label key={status} className="flex items-center gap-2 py-1 text-xs"><input type="checkbox" checked={filters.lifecycleStatuses.includes(status)} onChange={()=>set({...filters,lifecycleStatuses:filters.lifecycleStatuses.includes(status)?filters.lifecycleStatuses.filter(s=>s!==status):[...filters.lifecycleStatuses,status],includeExpired:true})}/>{({OPEN:'Open',ROLLING:'Rolling',FORTHCOMING:'Upcoming',CLOSED:'Closed',UNKNOWN:'Unknown deadline'})[status]}</label>)}
        {!filters.lifecycleStatuses.length&&<p className="cb-hint">All statuses are included.</p>}
      </RailSection>
      <RailSection title="Deadline">
        <DeadlineControl filters={filters} onChange={set} />
      </RailSection>

      <RailSection title="Funding">
        <FacetGroup dimension="fundingKind" items={items('fundingKind')} filters={filters} labelFor={labelFor} onChange={set} defaultOpen />
        <Disclosure label="Amount" count={filters.amountMin !== null || filters.amountMax !== null ? 1 : 0}>
          <AmountControl filters={filters} onChange={set} />
        </Disclosure>
        <FacetGroup
          dimension="funder"
          items={items('funder')}
          filters={filters}
          labelFor={labelFor}
          onChange={set}
          footer={
            <div className="mt-2 px-1.5">
              <FunderPicker
                label={null}
                showSelected={false}
                placeholder="Search all funders"
                values={filters.funderIds}
                onChange={(funderIds) => set({ ...filters, funderIds })}
              />
            </div>
          }
        />
        <FacetGroup dimension="sponsorType" items={items('sponsorType')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="projectDuration" items={items('projectDuration')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="indirectCosts" items={items('indirectCosts')} filters={filters} labelFor={labelFor} onChange={set} hint={CATALOGUE_ONLY_HINT} />
      </RailSection>

      <RailSection title="Research">
        <ImportedAreaPicker filters={filters} query={activeQuery} onChange={set} />
        {filters.taxonomyAreaIds.length>0&&<FacetGroup dimension="taxonomyArea" items={items('taxonomyArea').filter(item=>filters.taxonomyAreaIds.includes(item.value))} filters={filters} labelFor={labelFor} onChange={set} />}
        <FacetGroup dimension="sdgGoal" items={items('sdgGoal')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="programmeFramework" items={items('programmeFramework')} filters={filters} labelFor={labelFor} onChange={set} />
      </RailSection>

      <RailSection title="More filters">
        <FacetGroup dimension="region" items={items('region')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="geographyScope" items={items('geographyScope')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="mobility" items={items('mobility')} filters={filters} labelFor={labelFor} onChange={set} hint={CATALOGUE_ONLY_HINT} />
        <Disclosure label="Where the work is done" count={filters.hostCountries.length} defaultOpen={filters.hostCountries.length > 0}>
          <CountryPicker
            id="directory-host-countries"
            label="Work carried out in"
            values={filters.hostCountries}
            onChange={(hostCountries) => set({ ...filters, hostCountries })}
          />
        </Disclosure>
        <Disclosure label="Funder's country" count={filters.funderCountries.length} defaultOpen={filters.funderCountries.length > 0}>
          <CountryPicker
            id="directory-funder-countries"
            label="Funder based in"
            values={filters.funderCountries}
            onChange={(funderCountries) => set({ ...filters, funderCountries })}
          />
        </Disclosure>
      </RailSection>
    </div>
  );

  return (
    <div className="flex-1">
      {/* Search */}
      <div className="cb-card mb-6 p-4 sm:p-5">
        {searchHeader}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            onRunSearch();
          }}
          role="search"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft" />
            <input
              type="text"
              enterKeyHint="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchCopy?.placeholder || 'Search titles, funders and descriptions'}
              aria-label={searchCopy?.label || 'Search the funding directory'}
              aria-describedby="directory-search-help"
              className="cb-input h-12 pl-10 pr-10 !text-base"
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
            <button type="submit" disabled={loading} className="funding-button-primary flex-1 sm:flex-none">
              <Search className="h-4 w-4" />{loading ? 'Searching…' : searchCopy ? searchCopy.submit : <><span className="hidden sm:inline">Find opportunities</span><span className="sm:hidden">Search calls</span></>}
            </button>
            <button type="button" onClick={() => setMobileFiltersOpen(true)} className="cb-btn-secondary flex-1 lg:hidden">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {chips.length > 0 ? <span className="cb-badge-cobalt">{chips.length}</span> : null}
            </button>
          </div>
        </form>
        {searchCopy ? <p id="directory-search-help" className="cb-hint mt-3">{searchCopy.help}</p> : <p id="directory-search-help" className="cb-hint mt-3">
          Every word must appear. Use <span className="font-medium text-ink-soft">or</span> for alternatives,{' '}
          <span className="font-medium text-ink-soft">-word</span> to exclude, and{' '}
          <span className="font-medium text-ink-soft">&ldquo;quotes&rdquo;</span> for an exact phrase.
        </p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
        {/* Filter rail — desktop */}
        {wideLayout ? <aside className="hidden lg:block" aria-label="Filters">
          <div className="cb-card sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto px-5 py-2"><div className="flex items-center justify-between border-b border-slate-100 py-3"><h2 className="text-sm font-semibold text-slate-900">Refine your search</h2><SlidersHorizontal className="h-4 w-4 text-slate-400" /></div>{rail}</div>
        </aside> : null}

        {/* Filter sheet — phones and tablets */}
        {!wideLayout&&mobileFiltersOpen ? (
          <WorkspaceDialog open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen} title="Refine your search" description="Changes update your results as you filter." sheet>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
                <span className="text-[15px] font-semibold text-ink">Filters</span>
                <div className="flex items-center gap-1">
                  {chips.length > 0 ? (
                    <button type="button" onClick={onClearFilters} className="cb-btn-ghost cb-btn-sm">Clear all</button>
                  ) : null}
                  <button type="button" onClick={() => setMobileFiltersOpen(false)} aria-label="Close" className="cb-btn-ghost cb-btn-sm px-2">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4">{rail}</div>
              <div className="border-t border-hairline p-3">
                <button type="button" onClick={() => setMobileFiltersOpen(false)} className="cb-btn-primary w-full">
                  {busy ? 'Updating…' : `Show ${totalResults.toLocaleString()} ${resultNoun}`}
                </button>
              </div>
            </div>
          </WorkspaceDialog>
        ) : null}

        {/* Results */}
        <div className="min-w-0">
          {chips.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Applied filters">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-cobalt-200 bg-cobalt-50 py-0.5 pl-2.5 pr-1 text-[12px] text-cobalt-800"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => onFiltersChange(chip.remove(filters))}
                    aria-label={`Remove ${chip.label}`}
                    className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-cobalt-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={onClearFilters} className="cb-btn-ghost cb-btn-sm">
                Clear all
              </button>
            </div>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted" aria-live="polite">
              {busy ? 'Updating…' : resultSummary ?? (
                <>
                  <span className="font-semibold text-ink">{totalResults.toLocaleString()}</span> {resultNoun}
                  {activeQuery ? <> for &ldquo;{activeQuery}&rdquo;</> : null}
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <div className="hidden items-center rounded-lg border border-slate-200 bg-white p-1 sm:flex" role="group" aria-label="Results layout">
                {([['grid', LayoutGrid, 'Grid view'], ['list', List, 'List view']] as const).map(([value, Icon, label]) => <button key={value} type="button" aria-label={label} aria-pressed={layout === value} onClick={() => setLayout(value)} className={`rounded-md p-2 ${layout === value ? 'bg-blue-50 text-blue-700' : 'text-slate-400 hover:text-slate-700'}`}><Icon className="h-4 w-4" /></button>)}
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                Sort
                <select
                  value={filters.sort}
                  onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as Filters['sort'] })}
                  className="cb-select w-auto py-1.5 text-[13px]"
                >
                  <option value="best_match">{activeQuery ? 'Best match' : 'Recommended'}</option>
                  <option value="deadline_soonest">Deadline, soonest first</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setPreferencesOpen((open) => !open)}
                aria-expanded={preferencesOpen}
                className={`cb-btn-sm inline-flex items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition ${
                  activePreferenceCount > 0 ? 'bg-cobalt-50 text-cobalt-700' : 'text-muted hover:bg-inset hover:text-ink'
                }`}
              >
                My preferences
                <span className="text-[11px]">{activePreferenceCount > 0 ? `${activePreferenceCount} on` : 'off'}</span>
              </button>
            </div>
          </div>

          {preferencesOpen ? (
            <div className="cb-card mb-3 p-3">
              <FinderPreferencesPanel preferences={preferences} onChange={onChangePreferences} compact />
              <p className="cb-hint mt-2">Preferences change the order of results and the eligibility badges, not which calls match.</p>
            </div>
          ) : null}

          {loading && results.length === 0 ? (
            <div role="status" aria-label="Loading opportunities" className="grid gap-4 xl:grid-cols-2">{[0,1,2,3].map(n => <div key={n} className="cb-card animate-pulse p-6"><div className="h-3 w-24 rounded bg-slate-100" /><div className="mt-4 h-5 w-4/5 rounded bg-slate-200" /><div className="mt-3 h-3 rounded bg-slate-100" /><div className="mt-6 h-20 rounded-xl bg-slate-50" /></div>)}</div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline bg-ground px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-ink">No calls match all of these.</p>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-6 text-muted">
                {chips.length > 0
                  ? 'Every filter must hold at once. Remove one of the filters above, or search with fewer words.'
                  : 'Search with fewer or different words.'}
              </p>
              {chips.length > 0 ? (
                <button type="button" onClick={onClearFilters} className="cb-btn-secondary cb-btn-sm mt-4">
                  Clear all filters
                </button>
              ) : null}
            </div>
          ) : (
            <div aria-busy={loading} className={`space-y-4 ${loading ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'}`} ref={node => { if (node) node.inert = loading }}>
              <div className={`grid gap-4 ${layout === 'grid' ? 'xl:grid-cols-2' : ''}`}>
                {results.map((result) => (
                  <ExpandableCard key={result.id} result={result} onBeginWriting={onBeginWriting} getCallDetailsHref={getCallDetailsHref}
                    onOpenDetails={onOpenDetails} extraActions={renderResultActions?.(result)} />
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-[12px] text-muted">Page {page} of {totalPages.toLocaleString()}</p>
                  <PaginationControls
                    page={page}
                    totalPages={totalPages}
                    hasNextPage={hasNextPage}
                    hasPreviousPage={hasPreviousPage}
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
