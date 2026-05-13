import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { FaCompass, FaMagic, FaPlus, FaSave, FaTrash } from 'react-icons/fa';
import { useAuth } from '@/lib/auth-context';
import ResearcherWorkspaceShell from '@/components/ResearcherWorkspaceShell';
import type {
  ResearchAreaTaxonomyPayload,
  ResearcherSavedResearchAreaRecord,
} from '@/lib/researcherProfile/types';

type ResearchAreaForm = {
  id?: string;
  taxonomyLevel1Code: string;
  taxonomyAreaId: string;
  label: string;
  researchArea: string;
  keywords: string;
  disciplines: string;
  isDefault: boolean;
  useForAlerts: boolean;
};

function parseList(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[]) {
  return values.join(', ');
}

async function apiRequest<T>(authFetch: (url: string, options?: RequestInit) => Promise<Response>, url: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || 'Request failed');
  }
  return payload as T;
}

function toForm(area?: ResearcherSavedResearchAreaRecord | null): ResearchAreaForm {
  return {
    id: area?.id,
    taxonomyLevel1Code: area?.taxonomy?.level1Code || '',
    taxonomyAreaId: area?.taxonomy?.areaId || '',
    label: area?.label || '',
    researchArea: area?.researchArea || '',
    keywords: joinList(area?.keywords || []),
    disciplines: joinList(area?.disciplines || []),
    isDefault: area?.isDefault || false,
    useForAlerts: area?.useForAlerts ?? true,
  };
}

export default function ResearchAreasPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const [areas, setAreas] = useState<ResearcherSavedResearchAreaRecord[]>([]);
  const [taxonomy, setTaxonomy] = useState<ResearchAreaTaxonomyPayload | null>(null);
  const [form, setForm] = useState<ResearchAreaForm>(toForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, router, user]);

  const loadAreas = useCallback(async () => {
    const payload = await apiRequest<{ researchAreas: ResearcherSavedResearchAreaRecord[] }>(authFetch, '/api/researcher/research-areas');
    setAreas(payload.researchAreas);
  }, [authFetch]);

  const loadTaxonomy = useCallback(async () => {
    const payload = await apiRequest<ResearchAreaTaxonomyPayload>(authFetch, '/api/researcher/research-area-taxonomy');
    setTaxonomy(payload);
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    Promise.all([loadAreas(), loadTaxonomy()])
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load research areas'))
      .finally(() => setLoading(false));
  }, [loadAreas, loadTaxonomy, user]);

  const selectedArea = useMemo(
    () => areas.find((area) => area.id === form.id) || null,
    [areas, form.id]
  );
  const taxonomyGroups = useMemo(() => taxonomy?.groups || [], [taxonomy]);
  const selectedTaxonomyGroup = useMemo(
    () => taxonomyGroups.find((group) => group.level1Code === form.taxonomyLevel1Code) || null,
    [form.taxonomyLevel1Code, taxonomyGroups]
  );
  const selectedTaxonomyArea = useMemo(
    () => taxonomy?.areas.find((area) => area.id === form.taxonomyAreaId) || null,
    [form.taxonomyAreaId, taxonomy?.areas]
  );
  const hasActiveTaxonomy = Boolean(taxonomy?.hasActiveTaxonomy && taxonomyGroups.length > 0);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (hasActiveTaxonomy && !form.taxonomyAreaId && !form.id) {
        setError('Choose a Level 1 and Level 2 research area classification before saving.');
        setSaving(false);
        return;
      }

      const body = {
        ...((selectedTaxonomyArea || !form.id) ? { taxonomyAreaId: form.taxonomyAreaId || null } : {}),
        label: form.label,
        researchArea: form.researchArea,
        keywords: parseList(form.keywords),
        disciplines: parseList(form.disciplines),
        isDefault: form.isDefault,
        useForAlerts: form.useForAlerts,
      };

      const payload = form.id
        ? await apiRequest<{ researchArea: ResearcherSavedResearchAreaRecord }>(authFetch, `/api/researcher/research-areas/${form.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await apiRequest<{ researchArea: ResearcherSavedResearchAreaRecord }>(authFetch, '/api/researcher/research-areas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

      await loadAreas();
      setForm(toForm(payload.researchArea));
      setSuccess('Saved research area. Finder and alerts can now use its taxonomy-aligned embedding context.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save research area');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(areaId: string) {
    if (!window.confirm('Delete this saved research area?')) return;

    try {
      await apiRequest(authFetch, `/api/researcher/research-areas/${areaId}`, { method: 'DELETE' });
      await loadAreas();
      if (form.id === areaId) {
        setForm(toForm());
      }
      setSuccess('Saved research area deleted.');
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete research area');
    }
  }

  if (isLoading || loading) {
    return (
      <ResearcherWorkspaceShell
        title="Saved Research Areas"
        description="Create reusable research themes that can be loaded directly into Finder and future notification workflows."
        eyebrow="Research Memory"
      >
        <div className="rounded-[28px] border border-white/70 bg-white/80 p-8 text-sm text-slate-600 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
          Loading saved research areas...
        </div>
      </ResearcherWorkspaceShell>
    );
  }

  return (
    <ResearcherWorkspaceShell
      title="Saved Research Areas"
      description="Store high-signal research themes once, then reuse them in Finder, Finder Chat, and later alerts or collaborator discovery."
      eyebrow="Research Memory"
      actions={
        <button
          type="button"
          onClick={() => setForm(toForm())}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
        >
          <FaPlus />
          New Area
        </button>
      }
    >
      <div className="grid gap-8 xl:grid-cols-[1.15fr_1fr]">
        <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">Saved Themes</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Research Areas You Can Reuse</h2>
            </div>
            <div className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
              {areas.length} saved
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            {areas.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-7 text-slate-600">
                Save a research area once and use it directly inside Finder without retyping your topic every time.
              </div>
            ) : (
              areas.map((area) => (
                <div
                  key={area.id}
                  className={`rounded-[24px] border px-5 py-4 transition-all ${selectedArea?.id === area.id ? 'border-emerald-300 bg-emerald-50/70 shadow-[0_16px_40px_rgba(16,185,129,0.12)]' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button type="button" onClick={() => setForm(toForm(area))} className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-slate-950">{area.label}</span>
                        {area.isDefault ? <span className="rounded-full bg-slate-950 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">Default</span> : null}
                        {area.useForAlerts ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-800">Alerts On</span> : null}
                      </div>
                      {area.taxonomy ? (
                        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                          {area.taxonomy.level1Name}
                          {area.taxonomy.level2Name ? ` / ${area.taxonomy.level2Name}` : ' / General'}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                          Legacy area without classification
                        </div>
                      )}
                      <div className="mt-2 text-sm leading-7 text-slate-600">{area.researchArea}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {area.keywords.slice(0, 4).map((keyword) => (
                          <span key={keyword} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(area.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <FaTrash />
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">
            <FaCompass />
            Area Builder
          </div>
          <div className="mt-5 space-y-5">
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Label</div>
              <input type="text" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </label>
            {hasActiveTaxonomy ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Level 1 Research Area</div>
                  <select
                    value={form.taxonomyLevel1Code}
                    onChange={(event) => {
                      const nextCode = event.target.value;
                      setForm((current) => ({
                        ...current,
                        taxonomyLevel1Code: nextCode,
                        taxonomyAreaId: '',
                      }));
                    }}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Choose Level 1</option>
                    {taxonomyGroups.map((group) => (
                      <option key={group.level1Code} value={group.level1Code}>
                        {group.level1Name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Level 2 Research Area</div>
                  <select
                    value={form.taxonomyAreaId}
                    onChange={(event) => setForm((current) => ({ ...current, taxonomyAreaId: event.target.value }))}
                    disabled={!selectedTaxonomyGroup}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">{selectedTaxonomyGroup ? 'Choose Level 2' : 'Choose Level 1 first'}</option>
                    {selectedTaxonomyGroup?.areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.level2Name || 'General / not specified'}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedTaxonomyArea ? (
                  <div className="md:col-span-2 rounded-[22px] border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                    Classification: {selectedTaxonomyArea.level1Name}
                    {' / '}
                    {selectedTaxonomyArea.level2Name || 'General / not specified'}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-7 text-amber-900">
                No active two-level research area taxonomy has been uploaded yet. Superadmins can upload the OECD FORD-style CSV from the platform console.
              </div>
            )}
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Research Area</div>
              <textarea rows={4} value={form.researchArea} onChange={(event) => setForm((current) => ({ ...current, researchArea: event.target.value }))} className="mt-3 w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </label>
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Keywords</div>
              <textarea rows={3} value={form.keywords} onChange={(event) => setForm((current) => ({ ...current, keywords: event.target.value }))} className="mt-3 w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </label>
            <label className="block">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Disciplines</div>
              <textarea rows={3} value={form.disciplines} onChange={(event) => setForm((current) => ({ ...current, disciplines: event.target.value }))} className="mt-3 w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            </label>

            <label className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-medium">Use this as my default Finder topic</span>
              <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-medium">Use this topic for future alerts</span>
              <input type="checkbox" checked={form.useForAlerts} onChange={(event) => setForm((current) => ({ ...current, useForAlerts: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            </label>

            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <FaMagic className="text-emerald-600" />
                Future-ready
              </div>
              Saved research areas now store normalized text and embeddings so they can support future collaborator matching and notification seeding without reprocessing the same content.
            </div>

            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
              <FaSave />
              {saving ? 'Saving...' : form.id ? 'Update Research Area' : 'Save Research Area'}
            </button>

            {(error || success) ? (
              <div className={`rounded-[22px] border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                {error || success}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </ResearcherWorkspaceShell>
  );
}
