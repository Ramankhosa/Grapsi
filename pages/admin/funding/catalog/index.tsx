import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';

type CatalogCallSummary = {
  id: string;
  agency_name: string;
  scheme_title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
  is_active: boolean;
  source_url: string | null;
  intake_job_id: string | null;
  close_date: string | null;
  is_rolling: boolean;
  published_at: string | null;
  published_by: string | null;
  embedding_status: 'not_generated' | 'generated' | 'failed';
};

type EmbeddingCoverage = {
  publishedActiveTotal: number;
  publishedActiveEmbedded: number;
  publishedActiveMissingEmbedding: number;
  publishedActiveFailedEmbedding: number;
};

type EmbeddingHealth = {
  configured: boolean;
  circuitOpen: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  modelName: string;
  outputDimensionality: number;
};

type ResearchAreaCoverage = {
  total: number;
  current: number;
  missing: number;
  stale: number;
  embeddingVersion: string;
};

const STATUS_OPTIONS = ['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED', 'REJECTED'] as const;

export default function FundingCatalogAdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [calls, setCalls] = useState<CatalogCallSummary[]>([]);
  const [coverage, setCoverage] = useState<EmbeddingCoverage | null>(null);
  const [embeddingHealth, setEmbeddingHealth] = useState<EmbeddingHealth | null>(null);
  const [researchAreaCoverage, setResearchAreaCoverage] = useState<ResearchAreaCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfillBusy, setBackfillBusy] = useState<'funding_calls' | 'research_areas' | 'all' | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>('ALL');

  const userRoles = user?.roles || [];
  const platformPermissions = user?.platformPermissions || [];
  const isPlatformAdmin = userRoles.includes('ADMIN') && user?.ati_id === 'PLATFORM';
  const isFundingOperator =
    userRoles.includes('SUPER_ADMIN') ||
    userRoles.includes('SUPER_ADMIN_VIEWER') ||
    isPlatformAdmin ||
    platformPermissions.includes('platform.support.read') ||
    platformPermissions.includes('funding.operations.write') ||
    platformPermissions.includes('funding.publisher.write');

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && isFundingOperator) {
      void loadCalls();
    }
  }, [user, isFundingOperator]);

  async function loadCalls() {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/funding/calls');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load funding catalog');
      }
      setCalls(data.calls || []);
      setCoverage(data.coverage || null);
      setEmbeddingHealth(data.embeddingHealth || null);
      setResearchAreaCoverage(data.researchAreaCoverage || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load funding catalog');
    } finally {
      setLoading(false);
    }
  }

  async function runBackfill(target: 'funding_calls' | 'research_areas' | 'all') {
    setBackfillBusy(target);
    try {
      const response = await fetch('/api/admin/funding/embeddings/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, limit: 25 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to backfill embeddings');
      }
      toast.success('Embedding backfill completed');
      await loadCalls();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to backfill embeddings');
    } finally {
      setBackfillBusy(null);
    }
  }

  const visibleCalls = useMemo(() => {
    if (statusFilter === 'ALL') {
      return calls;
    }
    return calls.filter((call) => call.status === statusFilter);
  }, [calls, statusFilter]);

  if (isLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading funding catalog...</div>;
  }

  if (!isFundingOperator) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Funding catalog is restricted</h1>
          <p className="mt-3 text-sm text-slate-600">
            This module is available only to users with ADMIN or CURATOR access.
          </p>
          <Link href="/admin" className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Back to Admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>Funding Catalog</title>
      </Head>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding Catalog</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Manage drafts, publication, and live funding records</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              Publish vetted funding calls, archive expired records, and keep embeddings and search visibility aligned with the catalog state.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/funding/intake" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Funding Intake
            </Link>
            <Link href="/admin" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Back to Admin
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {STATUS_OPTIONS.slice(1).map((statusValue) => (
            <div key={statusValue} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{statusValue}</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">
                {calls.filter((call) => call.status === statusValue).length}
              </div>
            </div>
          ))}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Embedding Failed</div>
            <div className="mt-2 text-3xl font-semibold text-rose-700">
              {calls.filter((call) => call.embedding_status === 'failed').length}
            </div>
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Embedding Operations</h2>
              <p className="mt-1 text-sm text-slate-600">
                Coverage is measured against published active funding calls and saved researcher areas.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runBackfill('funding_calls')}
                disabled={backfillBusy !== null}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {backfillBusy === 'funding_calls' ? 'Backfilling Funding...' : 'Backfill Funding'}
              </button>
              <button
                type="button"
                onClick={() => runBackfill('research_areas')}
                disabled={backfillBusy !== null}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {backfillBusy === 'research_areas' ? 'Backfilling Research Areas...' : 'Backfill Research Areas'}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Published Active</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{coverage?.publishedActiveTotal || 0}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Embedded</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">{coverage?.publishedActiveEmbedded || 0}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Missing Vectors</div>
              <div className="mt-2 text-2xl font-semibold text-amber-700">{coverage?.publishedActiveMissingEmbedding || 0}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Failed Embeddings</div>
              <div className="mt-2 text-2xl font-semibold text-rose-700">{coverage?.publishedActiveFailedEmbedding || 0}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Embedding Provider</div>
              <div className="mt-2 text-sm font-medium text-slate-900">
                {embeddingHealth?.configured ? embeddingHealth.modelName : 'Not configured'}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Circuit: {embeddingHealth?.circuitOpen ? 'open' : 'closed'}
                {embeddingHealth?.nextRetryAt ? ` · retry ${new Date(embeddingHealth.nextRetryAt).toLocaleTimeString()}` : ''}
              </div>
              {embeddingHealth?.lastError && (
                <div className="mt-2 text-xs text-rose-700">{embeddingHealth.lastError}</div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Research Area Vectors</div>
              <div className="mt-2 text-sm text-slate-700">
                Current: <span className="font-semibold text-slate-900">{researchAreaCoverage?.current || 0}</span> / {researchAreaCoverage?.total || 0}
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Missing: <span className="font-semibold text-amber-700">{researchAreaCoverage?.missing || 0}</span>
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Stale: <span className="font-semibold text-rose-700">{researchAreaCoverage?.stale || 0}</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Failure Count</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{embeddingHealth?.consecutiveFailures || 0}</div>
              <div className="mt-2 text-xs text-slate-500">
                Output dims: {embeddingHealth?.outputDimensionality || 0}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Catalog records</h2>
              <p className="mt-1 text-sm text-slate-600">Only published active records should be visible to search and chatbot flows.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_OPTIONS)[number])}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'ALL' ? 'All statuses' : option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadCalls()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            {visibleCalls.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">No funding calls match this filter.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Funding Call</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Embedding</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Deadline</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Published By</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visibleCalls.map((call) => (
                    <tr key={call.id}>
                      <td className="px-4 py-4 align-top">
                        <div className="font-semibold text-slate-900">{call.scheme_title}</div>
                        <div className="mt-1 text-slate-600">{call.agency_name}</div>
                        {call.source_url && (
                          <div className="mt-2 max-w-sm break-all text-xs text-slate-500">{call.source_url}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                          {call.status}
                        </span>
                        <div className="mt-2 text-xs text-slate-500">
                          {call.is_active ? 'Active' : 'Inactive'}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${
                          call.embedding_status === 'generated'
                            ? 'bg-emerald-100 text-emerald-800'
                            : call.embedding_status === 'failed'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}>
                          {call.embedding_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">
                        {call.is_rolling
                          ? 'Rolling'
                          : call.close_date
                            ? new Date(call.close_date).toLocaleDateString()
                            : 'Not specified'}
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">
                        {call.published_by || 'Not published'}
                        {call.published_at && (
                          <div className="mt-1 text-xs text-slate-500">{new Date(call.published_at).toLocaleString()}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/funding/catalog/${call.id}`}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
                          >
                            Open
                          </Link>
                          {call.intake_job_id && (
                            <Link
                              href={`/admin/funding/intake/${call.intake_job_id}`}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                            >
                              Intake
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
