import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Globe2, Search, SlidersHorizontal, X } from 'lucide-react';
import FinderPreferencesPanel, { type FinderPreferenceValues } from './FinderPreferencesPanel';
import FunderPicker from './finder/FunderPicker';
import { ELIGIBILITY_BADGE } from './funding/eligibilityBadge';
import { useFunderNames } from '../hooks/useFunderNames';
import { allCountryCodes, countryNameFor, resolveCountryList } from '../lib/geo/countries';
import { RECOMMENDATION_AMOUNT_CURRENCY_OPTIONS } from '../lib/recommendations/constants';
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
  taxonomyArea: 'Research area',
  sdgGoal: 'Sustainable Development Goal',
  programmeFramework: 'Programme',
  region: 'Region',
  geographyScope: 'Geographic scope',
};

const COUNTRY_NAMES = Array.from(new Set(allCountryCodes().map(countryNameFor))).sort((a, b) => a.localeCompare(b));
const COUNTRY_LIST_ID = 'directory-country-names';
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
  if (result.amountMin !== null && result.amountMax !== null && result.amountMin !== result.amountMax) {
    return `${result.currency || ''} ${Number(result.amountMin).toLocaleString()} – ${Number(result.amountMax).toLocaleString()}`.trim();
  }
  return `${result.currency || ''} ${Number(result.amountMin ?? result.amountMax).toLocaleString()}`.trim();
}

const sameCountry = (a: string, b: string) => {
  const [codeA] = resolveCountryList([a]).codes;
  const [codeB] = resolveCountryList([b]).codes;
  return Boolean(codeA) && codeA === codeB;
};

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
  // Filters the directory does not offer, but a shared link or the AI advisor may carry.
  list('applicationLanguages', 'Language', filters.applicationLanguages);
  list('citizenshipRequirements', 'Citizenship', filters.citizenshipRequirements);
  list('residencyRequirements', 'Residency', filters.residencyRequirements);

  if (filters.deadlineFrom || filters.deadlineTo) {
    const label = filters.deadlineFrom && filters.deadlineTo
      ? `Deadline: ${formatDay(filters.deadlineFrom)} – ${formatDay(filters.deadlineTo)}`
      : filters.deadlineFrom
        ? `Deadline from ${formatDay(filters.deadlineFrom)}`
        : `Deadline by ${formatDay(filters.deadlineTo)}`;
    chips.push({ key: 'deadline', label, remove: (current) => ({ ...current, deadlineFrom: '', deadlineTo: '' }) });
  }
  if (filters.rollingOnly) chips.push({ key: 'rolling', label: 'Rolling calls only', remove: (current) => ({ ...current, rollingOnly: false }) });
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
}: {
  dimension: DirectoryFacetDimension;
  items: DirectoryFacetItem[];
  filters: Filters;
  labelFor: (dimension: DirectoryFacetDimension, value: string) => string;
  onChange: (filters: Filters) => void;
  defaultOpen?: boolean;
  footer?: React.ReactNode;
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
      {footer}
    </Disclosure>
  );
}

function CountryPicker({
  id,
  label,
  hint,
  values,
  onChange,
  suggestion,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestion?: string | null;
}) {
  const [text, setText] = useState('');
  const [unknown, setUnknown] = useState(false);
  const add = (raw: string) => {
    const [code] = resolveCountryList([raw.trim()]).codes;
    if (!code) {
      setUnknown(Boolean(raw.trim()));
      return;
    }
    const name = countryNameFor(code);
    if (!values.some((value) => sameCountry(value, name))) onChange([...values, name]);
    setText('');
    setUnknown(false);
  };
  const showSuggestion = suggestion && !values.some((value) => sameCountry(value, suggestion));

  return (
    <div className="py-1">
      <label htmlFor={id} className="cb-label">{label}</label>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="cb-chip cb-chip-active"
              aria-label={`Remove ${value}`}
            >
              {value}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <input
          id={id}
          list={COUNTRY_LIST_ID}
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setUnknown(false);
            // Picked from the list (not typed letter by letter): add it now.
            const inputType = (event.nativeEvent as InputEvent).inputType;
            if ((!inputType || inputType === 'insertReplacementText') && COUNTRY_NAMES.includes(value)) add(value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(text);
            }
          }}
          placeholder="Type a country"
          className="cb-input py-2 text-[13px]"
        />
        <button type="button" onClick={() => add(text)} disabled={!text.trim()} className="cb-btn-secondary cb-btn-sm shrink-0">
          Add
        </button>
      </div>
      {unknown ? <p className="mt-1 text-[12px] text-amber-700">Not a country we recognise.</p> : null}
      {showSuggestion ? (
        <button type="button" onClick={() => add(suggestion)} className="mt-1.5 text-[12px] font-medium text-cobalt-700 hover:underline">
          + {suggestion} (your profile)
        </button>
      ) : null}
      {hint ? <p className="cb-hint mt-1.5">{hint}</p> : null}
    </div>
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
          onChange={(event) => onChange({ ...filters, rollingOnly: event.target.checked })}
          className="h-3.5 w-3.5 accent-cobalt-600"
        />
        Rolling calls only
      </label>
      <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5 text-[13px] text-ink-soft">
        <input
          type="checkbox"
          checked={filters.includeExpired}
          onChange={(event) => onChange({ ...filters, includeExpired: event.target.checked })}
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
}: {
  result: RecommendationRawResultItem;
  onBeginWriting?: (result: RecommendationRawResultItem) => void;
  getCallDetailsHref?: (result: RecommendationRawResultItem) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const amount = formatAmount(result);
  const callDetailsHref = getCallDetailsHref?.(result) || `/finder/calls/${encodeURIComponent(result.id)}`;
  const geography =
    result.eligibleCountries.slice(0, 3).join(', ') ||
    result.eligibleRegions.slice(0, 3).join(', ') ||
    result.hostCountries.slice(0, 3).join(', ');

  return (
    <article className="cb-card overflow-hidden transition hover:border-cobalt-300">
      <button type="button" onClick={() => setExpanded((prev) => !prev)} aria-expanded={expanded} className="w-full text-left">
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
                <span className="cb-badge" title="Deadline">
                  {new Date(result.closeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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
            {onBeginWriting && result.authoringReady !== false ? (
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
  preferences: FinderPreferenceValues;
  onChangePreferences: (preferences: FinderPreferenceValues) => void;
}

export default function FundingDirectoryPanel({
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
  preferences,
  onChangePreferences,
}: FundingDirectoryPanelProps) {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
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
      return fromFacets.get(`${dimension}:${value}`) || facetLabels[`${dimension}:${value}`] || value;
    };
  }, [facets, facetLabels, funderNames]);

  const chips = appliedChips(filters, labelFor);
  const items = (dimension: DirectoryFacetDimension) => facets?.facets[dimension] || [];
  const activePreferenceCount = (preferences.useEligibilityProfile ? 1 : 0) + (preferences.usePublicationContext ? 1 : 0);
  const busy = loading || facetsLoading;
  const resultNoun = filters.includeExpired ? 'calls' : 'open calls';
  const set = onFiltersChange;

  const rail = (
    <div className={facetsLoading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <datalist id={COUNTRY_LIST_ID}>
        {COUNTRY_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <RailSection title="Who can apply">
        <CountryPicker
          id="directory-eligible-countries"
          label="Open to applicants from"
          hint="Includes calls open worldwide. With several countries, a call open to any of them is shown."
          values={filters.eligibleCountries}
          onChange={(eligibleCountries) => set({ ...filters, eligibleCountries })}
          suggestion={profileCountry}
        />
        <FacetGroup dimension="careerStage" items={items('careerStage')} filters={filters} labelFor={labelFor} onChange={set} defaultOpen />
        <FacetGroup dimension="institutionType" items={items('institutionType')} filters={filters} labelFor={labelFor} onChange={set} />
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
      </RailSection>

      <RailSection title="Research">
        <FacetGroup dimension="taxonomyArea" items={items('taxonomyArea')} filters={filters} labelFor={labelFor} onChange={set} defaultOpen />
        <FacetGroup dimension="sdgGoal" items={items('sdgGoal')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="programmeFramework" items={items('programmeFramework')} filters={filters} labelFor={labelFor} onChange={set} />
      </RailSection>

      <RailSection title="More filters">
        <FacetGroup dimension="region" items={items('region')} filters={filters} labelFor={labelFor} onChange={set} />
        <FacetGroup dimension="geographyScope" items={items('geographyScope')} filters={filters} labelFor={labelFor} onChange={set} />
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
      <div className="cb-card mb-4 p-3 sm:p-4">
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
              placeholder="Search titles, funders and descriptions"
              aria-label="Search the funding directory"
              aria-describedby="directory-search-help"
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
            <button type="submit" className="cb-btn-primary flex-1 sm:flex-none">
              Search
            </button>
            <button type="button" onClick={() => setMobileFiltersOpen(true)} className="cb-btn-secondary flex-1 lg:hidden">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {chips.length > 0 ? <span className="cb-badge-cobalt">{chips.length}</span> : null}
            </button>
          </div>
        </form>
        <p id="directory-search-help" className="cb-hint mt-2">
          Every word must appear. Use <span className="font-medium text-ink-soft">or</span> for alternatives,{' '}
          <span className="font-medium text-ink-soft">-word</span> to exclude, and{' '}
          <span className="font-medium text-ink-soft">&ldquo;quotes&rdquo;</span> for an exact phrase.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
        {/* Filter rail — desktop */}
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="cb-card sticky top-32 max-h-[calc(100vh-10rem)] overflow-y-auto px-4 py-1">{rail}</div>
        </aside>

        {/* Filter sheet — phones and tablets */}
        {mobileFiltersOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
            <button type="button" aria-label="Close filters" onClick={() => setMobileFiltersOpen(false)} className="absolute inset-0 bg-ink/25" />
            <div className="absolute inset-y-0 left-0 flex w-[90%] max-w-sm flex-col bg-ground shadow-cb-sheet">
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
          </div>
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
              {busy ? 'Updating…' : (
                <>
                  <span className="font-semibold text-ink">{totalResults.toLocaleString()}</span> {resultNoun}
                  {activeQuery ? <> for &ldquo;{activeQuery}&rdquo;</> : null}
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
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
            <div className="flex h-40 items-center justify-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
            </div>
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
            <div className={`space-y-4 ${loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="grid gap-3 xl:grid-cols-2">
                {results.map((result) => (
                  <ExpandableCard key={result.id} result={result} onBeginWriting={onBeginWriting} getCallDetailsHref={getCallDetailsHref} />
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
