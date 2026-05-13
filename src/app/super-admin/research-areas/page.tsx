'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import type { ResearchAreaTaxonomyPayload } from '@/lib/researcherProfile/types';

const SAMPLE_COLUMNS = 'level1_code,level1_name,level2_code,level2_name,description,aliases,sort_order,is_active';

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

export default function SuperAdminResearchAreasPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const [taxonomy, setTaxonomy] = useState<ResearchAreaTaxonomyPayload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState('OECD FORD');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isSuperAdmin = useMemo(
    () =>
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('SUPER_ADMIN_VIEWER') ||
      user?.platformPermissions?.includes('platform.support.read') ||
      user?.platformPermissions?.includes('funding.operations.write'),
    [user?.platformPermissions, user?.roles]
  );
  const canUpload = Boolean(user?.roles?.includes('SUPER_ADMIN') || user?.platformPermissions?.includes('funding.operations.write'));

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isSuperAdmin) {
      router.replace('/dashboard');
    }
  }, [isLoading, isSuperAdmin, router, user]);

  const loadTaxonomy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch('/api/super-admin/research-area-taxonomy');
      const payload = await readJson<ResearchAreaTaxonomyPayload & { error?: string; details?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to load taxonomy');
      }
      setTaxonomy(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load taxonomy');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!user || !isSuperAdmin) return;
    loadTaxonomy();
  }, [loadTaxonomy, user, isSuperAdmin]);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a CSV file to upload.');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);
    setWarnings([]);

    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('sourceName', sourceName);

      const response = await authFetch('/api/super-admin/research-area-taxonomy/upload', {
        method: 'POST',
        body: formData,
      });
      const payload = await readJson<ResearchAreaTaxonomyPayload & { error?: string; details?: string; warnings?: string[] }>(response);
      if (!response.ok) {
        throw new Error(payload.details || payload.error || 'Failed to upload taxonomy');
      }

      setTaxonomy(payload);
      setWarnings(payload.warnings || []);
      setSuccess('Research area taxonomy uploaded and activated.');
      setFile(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to upload taxonomy');
    } finally {
      setUploading(false);
    }
  }

  if (isLoading || !user || !isSuperAdmin) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-sm text-slate-600">Checking platform access...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Super Admin</div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Research Area Taxonomy</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Upload the two-level OECD FORD-style research area CSV used by researcher profiles, embeddings, Finder, and later funding-call classification.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">CSV Upload</div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Replace Active Taxonomy</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              A successful upload archives the previous active taxonomy and activates the new CSV in one transaction.
            </p>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
              Required columns:
              <div className="mt-2 overflow-x-auto rounded-xl bg-white px-3 py-2 font-mono text-slate-900">
                {SAMPLE_COLUMNS}
              </div>
            </div>

            <form onSubmit={handleUpload} className="mt-6 space-y-4">
              <label className="block">
                <div className="text-sm font-medium text-slate-700">Source name</div>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="block">
                <div className="text-sm font-medium text-slate-700">CSV file</div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={!canUpload}
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="mt-2 block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>

              {!canUpload ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Viewer accounts can inspect the active taxonomy but cannot upload replacements.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canUpload || uploading || !file}
                className="inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {uploading ? 'Uploading...' : 'Upload and activate'}
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Active Version</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">
                  {taxonomy?.upload ? taxonomy.upload.sourceName : 'No taxonomy uploaded'}
                </h2>
              </div>
              <button
                type="button"
                onClick={loadTaxonomy}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="mt-8 text-sm text-slate-600">Loading taxonomy...</div>
            ) : taxonomy?.upload ? (
              <>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Rows</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{taxonomy.upload.rowCount}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Active</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{taxonomy.upload.activeRowCount}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Level 1</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">{taxonomy.groups.length}</div>
                  </div>
                </div>

                <div className="mt-6 text-sm leading-6 text-slate-600">
                  Uploaded file: {taxonomy.upload.originalFilename || 'CSV upload'}
                  <br />
                  Activated: {taxonomy.upload.activatedAt ? new Date(taxonomy.upload.activatedAt).toLocaleString() : 'Not recorded'}
                </div>

                <div className="mt-6 max-h-[420px] overflow-auto rounded-2xl border border-slate-200">
                  {taxonomy.groups.slice(0, 30).map((group) => (
                    <div key={group.level1Code} className="border-b border-slate-100 p-4 last:border-b-0">
                      <div className="font-semibold text-slate-900">{group.level1Name}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {group.areas.slice(0, 10).map((area) => (
                          <span key={area.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                            {area.level2Name || 'General'}
                          </span>
                        ))}
                        {group.areas.length > 10 ? (
                          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                            +{group.areas.length - 10}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-600">
                Upload a CSV to make Level 1 and Level 2 research area selectors available in researcher profiles.
              </div>
            )}
          </section>
        </div>

        {(error || success || warnings.length > 0) ? (
          <div className="space-y-3">
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
            {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{success}</div> : null}
            {warnings.map((warning) => (
              <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {warning}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
