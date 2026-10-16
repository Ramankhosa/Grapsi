import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';

import Header from '@/components/Header';
import { useAuth } from '@/lib/auth-context';

type CallSummary = {
  id: string;
  title: string | null;
  scheme_title: string | null;
  agency_name: string | null;
  catalog_status: string | null;
  visibility: string;
  import_run_id: string | null;
  close_date: string | null;
  open_date: string | null;
  is_rolling: boolean | null;
  amount_text: string | null;
  amount_min: number | null;
  amount_max: number | null;
  currency: string | null;
  source_url: string | null;
  description: string | null;
  eligibility_text: string | null;
  opportunity_status: string | null;
  review_status: string | null;
};

type ReviewItem = {
  id: string;
  run_id: string;
  reason: string;
  tier: string;
  score: number | null;
  signals: Record<string, any> | null;
  blocks_release: boolean;
  resolution: string;
  resolution_note: string | null;
  subject_call: CallSummary | null;
  candidate_call: CallSummary | null;
};

type Summary = {
  items: Array<{ reason: string; tier: string; resolution: string; blocksRelease: boolean; count: number }>;
  openListingVariants: number;
  importedCalls: Array<{ catalogStatus: string | null; reviewStatus: string | null; count: number }>;
  runs: Array<{ id: string; source_key: string; mode: string; status: string; started_at: string; finished_at: string | null }>;
};

const REASON_LABEL: Record<string, string> = {
  POSSIBLE_DUPLICATE: 'Possible duplicate',
  EXISTING_DUPLICATE: 'Duplicate among existing calls (report only)',
  READINESS_FAILED: 'Missing required facts',
  UNKNOWN_COUNTRY_VALUES: 'Unrecognised countries',
  UNPARSED_AMOUNT: 'Amount not understood',
  SOURCE_UNAVAILABLE: 'Source page gone',
  SOURCE_CONFLICT: 'Source changed a field someone edited',
  FUNDER_MATCH_UNCERTAIN: 'Funder match uncertain',
};

const TIER_LABEL: Record<string, string> = {
  LIKELY_DUPLICATE: 'Likely duplicate',
  POSSIBLE_DUPLICATE: 'Possible duplicate',
  RELATED: 'Related (not blocking)',
  INFO: 'Info',
};

const TIER_TONE: Record<string, string> = {
  LIKELY_DUPLICATE: 'border-rose-200 bg-rose-50 text-rose-800',
  POSSIBLE_DUPLICATE: 'border-amber-200 bg-amber-50 text-amber-800',
  RELATED: 'border-slate-200 bg-slate-50 text-slate-700',
  INFO: 'border-slate-200 bg-slate-50 text-slate-700',
};

function callTitle(call: CallSummary | null) {
  return call ? call.scheme_title || call.title || call.id : '—';
}

function fmtDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function CallPanel({ label, call }: { label: string; call: CallSummary | null }) {
  if (!call) return null;
  const imported = Boolean(call.import_run_id);
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${imported ? 'bg-cobalt-50 text-cobalt-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {imported ? `Imported · ${call.catalog_status}` : `Existing · ${call.catalog_status || 'legacy'}`}
        </span>
      </div>
      <a href={`/finder/calls/${call.id}`} target="_blank" rel="noreferrer" className="mt-1.5 block text-sm font-medium text-slate-900 hover:underline">
        {callTitle(call)}
      </a>
      <dl className="mt-2 space-y-1 text-[12px] text-slate-600">
        <div><dt className="inline text-slate-400">Funder </dt><dd className="inline">{call.agency_name || '—'}</dd></div>
        <div>
          <dt className="inline text-slate-400">Deadline </dt>
          <dd className="inline">{call.is_rolling ? 'Rolling' : fmtDate(call.close_date) || '—'}{call.opportunity_status ? ` · ${call.opportunity_status.toLowerCase()}` : ''}</dd>
        </div>
        <div><dt className="inline text-slate-400">Award </dt><dd className="inline">{call.amount_text || (call.amount_max ? `${call.currency || ''} ${call.amount_max.toLocaleString()}` : '—')}</dd></div>
        {call.source_url ? (
          <div className="truncate"><dt className="inline text-slate-400">Link </dt><dd className="inline"><a className="text-cobalt-700 hover:underline" href={call.source_url} target="_blank" rel="noreferrer">{call.source_url}</a></dd></div>
        ) : null}
      </dl>
      {call.description ? <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-slate-500">{call.description}</p> : null}
    </div>
  );
}

export default function ImportReviewPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('POSSIBLE_DUPLICATE');
  const [tier, setTier] = useState('');
  const [state, setState] = useState<'open' | 'resolved' | 'all'>('open');
  const [variant, setVariant] = useState<'' | 'only' | 'exclude'>('');
  const [query, setQuery] = useState('');

  const roles = user?.roles || [];
  const permissions = user?.platformPermissions || [];
  const isPlatformAdmin = roles.includes('ADMIN') && user?.ati_id === 'PLATFORM';
  const canView =
    roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER') || isPlatformAdmin ||
    permissions.includes('platform.support.read') || permissions.includes('funding.operations.write') || permissions.includes('funding.publisher.write');
  const canResolve = roles.includes('SUPER_ADMIN') || isPlatformAdmin || permissions.includes('funding.operations.write') || permissions.includes('funding.publisher.write');
  const canRelease = roles.includes('SUPER_ADMIN') || isPlatformAdmin || permissions.includes('funding.publisher.write');

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, router, user]);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (reason) params.set('reason', reason);
    if (tier) params.set('tier', tier);
    params.set('state', state);
    if (variant) params.set('variant', variant);
    if (query.trim()) params.set('q', query.trim());
    return params;
  }, [reason, tier, state, variant, query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(filterParams);
      params.set('page', String(page));
      const response = await fetch(`/api/admin/funding/import-review?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load the import review');
      setSummary(data.summary);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load the import review');
    } finally {
      setLoading(false);
    }
  }, [filterParams, page]);

  useEffect(() => {
    if (user && canView) void load();
  }, [user, canView, load]);

  async function resolve(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/funding/import-review/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to resolve');
      toast.success(`${data.resolved} item${data.resolved === 1 ? '' : 's'} resolved${data.skipped?.length ? `, ${data.skipped.length} skipped` : ''}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resolve');
    } finally {
      setBusy(false);
    }
  }

  async function release(runId: string, count: number) {
    if (!window.confirm(`Release ${count} reviewed imported call${count === 1 ? '' : 's'} to researcher discovery?\n\nThis is silent: no alerts or officer notices are sent, and funding-department queues are not affected.`)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/funding/import-review/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Release failed');
      toast.success(`Released ${data.released} calls; ${data.blocked} still held for review`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Release failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const imported = summary?.importedCalls || [];
    const sum = (pred: (r: Summary['importedCalls'][number]) => boolean) => imported.filter(pred).reduce((n, r) => n + r.count, 0);
    const openItems = (summary?.items || []).filter((r) => r.resolution === 'pending' || r.resolution === 'deferred');
    return {
      held: sum((r) => r.catalogStatus === 'STAGED' && r.reviewStatus === 'NEEDS_REVIEW'),
      clear: sum((r) => r.catalogStatus === 'STAGED' && r.reviewStatus !== 'NEEDS_REVIEW'),
      released: sum((r) => r.catalogStatus === 'PUBLISHED'),
      setAside: sum((r) => r.catalogStatus === 'REJECTED'),
      openBlocking: openItems.filter((r) => r.blocksRelease).reduce((n, r) => n + r.count, 0),
      openByReason: openItems.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] || 0) + r.count }), {}),
    };
  }, [summary]);

  const latestApply = summary?.runs.find((run) => run.mode === 'APPLY' && run.status === 'COMPLETED');
  const selectedIds = Array.from(selected);
  const pages = Math.max(1, Math.ceil(total / 25));
  const isDuplicateView = reason === 'POSSIBLE_DUPLICATE';

  if (isLoading || (loading && !summary)) {
    return <div className="flex min-h-screen items-center justify-center text-slate-600">Loading import review…</div>;
  }
  if (!canView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Import review is restricted</h1>
          <p className="mt-3 text-sm text-slate-600">Available to platform funding operators and publishers.</p>
          <Link href="/admin" className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Back to Admin</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>Import review</title>
      </Head>
      <Header />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding catalogue</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Import review</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Imported calls wait here until they are cleared. Suspected duplicates are never merged automatically, and no decision on this page changes an existing call.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/funding/catalog" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">Funding catalog</Link>
            {canRelease && latestApply ? (
              <button
                type="button"
                disabled={busy || counts.clear === 0}
                onClick={() => void release(latestApply.id, counts.clear)}
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              >
                Release {counts.clear.toLocaleString()} clear calls
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Held for review', value: counts.held, note: `${counts.openBlocking.toLocaleString()} open blocking items` },
            { label: 'Clear, not released', value: counts.clear, note: 'Invisible until released' },
            { label: 'Released', value: counts.released, note: 'In researcher discovery' },
            { label: 'Set aside', value: counts.setAside, note: 'Duplicates or rejected' },
            { label: 'Listing variants open', value: summary?.openListingVariants || 0, note: 'Same call listed per eligibility group' },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[12px] font-medium text-slate-500">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{card.value.toLocaleString()}</div>
              <div className="mt-1 text-[12px] text-slate-500">{card.note}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-[12px] text-slate-600">
            Category
            <select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} className="mt-1 block rounded-md border-slate-300 text-sm">
              <option value="">All categories</option>
              {Object.entries(REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}{counts.openByReason[value] ? ` (${counts.openByReason[value]})` : ''}</option>
              ))}
            </select>
          </label>
          {isDuplicateView ? (
            <label className="text-[12px] text-slate-600">
              Tier
              <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} className="mt-1 block rounded-md border-slate-300 text-sm">
                <option value="">All tiers</option>
                {['LIKELY_DUPLICATE', 'POSSIBLE_DUPLICATE', 'RELATED'].map((value) => <option key={value} value={value}>{TIER_LABEL[value]}</option>)}
              </select>
            </label>
          ) : null}
          {isDuplicateView ? (
            <label className="text-[12px] text-slate-600">
              Listing variants
              <select value={variant} onChange={(e) => { setVariant(e.target.value as any); setPage(1); }} className="mt-1 block rounded-md border-slate-300 text-sm">
                <option value="">Include</option>
                <option value="only">Only variants</option>
                <option value="exclude">Exclude variants</option>
              </select>
            </label>
          ) : null}
          <label className="text-[12px] text-slate-600">
            State
            <select value={state} onChange={(e) => { setState(e.target.value as any); setPage(1); }} className="mt-1 block rounded-md border-slate-300 text-sm">
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="min-w-[14rem] flex-1 text-[12px] text-slate-600">
            Search title or funder
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="e.g. Wellcome" className="mt-1 block w-full rounded-md border-slate-300 text-sm" />
          </label>
        </div>

        {canResolve && state === 'open' ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">{selectedIds.length > 0 ? `${selectedIds.length} selected` : `Apply to all ${total.toLocaleString()} matching`}:</span>
            {isDuplicateView ? (
              <>
                <button type="button" disabled={busy || total === 0} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => void resolve(selectedIds.length > 0 ? { ids: selectedIds, resolution: 'create_new_anyway' } : { filter: Object.fromEntries(filterParams), resolution: 'create_new_anyway' }, selectedIds.length > 0 ? undefined : `Mark all ${total} matching pairs as different opportunities (keep both)?`)}>
                  Different calls — keep both
                </button>
                <button type="button" disabled={busy || total === 0} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => void resolve(selectedIds.length > 0 ? { ids: selectedIds, resolution: 'merged_to_existing' } : { filter: Object.fromEntries(filterParams), resolution: 'merged_to_existing' }, `Treat ${selectedIds.length || total} pair(s) as the same opportunity? The imported copy is set aside (an existing call is always the one kept) and its source is linked to the survivor.`)}>
                  Same call — set the copy aside
                </button>
              </>
            ) : (
              <button type="button" disabled={busy || total === 0} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-50"
                onClick={() => void resolve(selectedIds.length > 0 ? { ids: selectedIds, resolution: reason === 'EXISTING_DUPLICATE' ? 'reviewed' : 'ignored' } : { filter: Object.fromEntries(filterParams), resolution: reason === 'EXISTING_DUPLICATE' ? 'reviewed' : 'ignored' }, selectedIds.length > 0 ? undefined : `Mark all ${total} matching items as reviewed?`)}>
                Mark reviewed
              </button>
            )}
            <button type="button" disabled={busy || selectedIds.length === 0} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-50"
              onClick={() => void resolve({ ids: selectedIds, resolution: 'deferred' })}>
              Defer
            </button>
            <button type="button" disabled={busy || selectedIds.length === 0} className="rounded-md border border-rose-200 bg-white px-3 py-1.5 font-medium text-rose-700 disabled:opacity-50"
              onClick={() => void resolve({ ids: selectedIds, resolution: 'rejected' }, 'Set the selected imported calls aside (they will not be released)?')}>
              Reject imported call
            </button>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Nothing here for these filters.</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {canResolve && state === 'open' ? (
                    <input
                      type="checkbox"
                      aria-label="Select item"
                      checked={selected.has(item.id)}
                      onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(item.id); else next.delete(item.id); return next; })}
                    />
                  ) : null}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_TONE[item.tier] || TIER_TONE.INFO}`}>{TIER_LABEL[item.tier] || item.tier}</span>
                  <span className="text-[12px] font-medium text-slate-700">{REASON_LABEL[item.reason] || item.reason}</span>
                  {item.blocks_release ? <span className="text-[11px] text-rose-700">Blocks release</span> : null}
                  {item.signals?.listingVariant ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Listing variant</span> : null}
                  {item.signals?.titleSimilarity != null ? <span className="text-[11px] text-slate-500">title match {Math.round(item.signals.titleSimilarity * 100)}%</span> : null}
                  {item.signals?.sameFunder ? <span className="text-[11px] text-slate-500">· same funder</span> : null}
                  {item.signals?.sameUrl ? <span className="text-[11px] text-slate-500">· same link</span> : null}
                  {item.signals?.round ? <span className="text-[11px] text-slate-500">· round {item.signals.round}</span> : null}
                  {item.resolution !== 'pending' ? <span className="ml-auto text-[11px] text-slate-500">Resolution: {item.resolution.replace(/_/g, ' ')}</span> : null}
                </div>
                {item.reason === 'READINESS_FAILED' && item.signals?.missing ? (
                  <p className="mt-2 text-[12px] text-slate-600">Missing: {(item.signals.missing as string[]).join(', ').replace(/_/g, ' ')}</p>
                ) : null}
                {item.reason === 'UNPARSED_AMOUNT' && item.signals?.text ? <p className="mt-2 text-[12px] text-slate-600">Amount text: “{item.signals.text}”</p> : null}
                <div className={`mt-3 grid gap-3 ${item.candidate_call ? 'md:grid-cols-2' : ''}`}>
                  <CallPanel label={item.reason === 'EXISTING_DUPLICATE' ? 'Existing call A' : 'Imported call'} call={item.subject_call} />
                  <CallPanel label={item.candidate_call?.import_run_id ? 'Other imported call' : 'Existing call'} call={item.candidate_call} />
                </div>
                {canResolve && (item.resolution === 'pending' || item.resolution === 'deferred') ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
                    {item.reason === 'POSSIBLE_DUPLICATE' ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: 'create_new_anyway' })} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700">Different — keep both</button>
                        {item.candidate_call?.import_run_id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: 'merged_to_existing', keep: 'subject' })} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700">Same — keep left</button>
                            <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: 'merged_to_existing', keep: 'candidate' })} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700">Same — keep right</button>
                          </>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: 'merged_to_existing' })} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700">Same — keep existing</button>
                        )}
                      </>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: item.reason === 'EXISTING_DUPLICATE' ? 'reviewed' : 'ignored' })} className="rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-700">Mark reviewed</button>
                    )}
                    {item.subject_call?.import_run_id ? (
                      <button type="button" disabled={busy} onClick={() => void resolve({ ids: [item.id], resolution: 'rejected' }, 'Set this imported call aside?')} className="rounded-md border border-rose-200 px-2.5 py-1 font-medium text-rose-700">Reject imported</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>{total.toLocaleString()} items · page {page} of {pages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50">Previous</button>
            <button type="button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
