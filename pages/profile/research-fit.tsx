import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaBookOpen, FaCheck, FaCompass, FaPen, FaPlus, FaSearch, FaSlidersH, FaTimes, FaTrash } from 'react-icons/fa';

import ResearcherWorkspaceShell from '@/components/ResearcherWorkspaceShell';
import { useAuth } from '@/lib/auth-context';
import type {
  ResearchAreaTaxonomyAreaRecord,
  ResearchAreaTaxonomyPayload,
  ResearcherSavedResearchAreaRecord,
} from '@/lib/researcherProfile/types';
import type { FundingPublicationRecord } from '@/lib/researcherProfile/funding-publications';
import {
  buildFundingPublicationPayload,
  buildResearchAreaPayload,
  emptyPublicationForm,
  emptyResearchAreaForm,
  publicationToForm,
  researchAreaToForm,
  validateFundingPublicationForm,
  validateResearchAreaForm,
  type FundingPublicationForm,
  type ResearchAreaFitForm,
} from '@/lib/researcherProfile/research-fit-utils';

type TabKey = 'areas' | 'publications';

async function apiRequest<T>(
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.details || payload?.error || 'Request failed');
  }
  return payload as T;
}

function formatTaxonomy(area: ResearcherSavedResearchAreaRecord) {
  return [area.taxonomy?.level1Name, area.taxonomy?.level2Name].filter(Boolean).join(' / ');
}

function formatTaxonomyOption(area: ResearchAreaTaxonomyAreaRecord) {
  return [area.level1Name, area.level2Name || area.level2Code || 'General'].filter(Boolean).join(' / ');
}

function Drawer({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/30"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <FaTimes />
            </button>
          </div>
        </div>
        <div className="px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export default function ResearchFitPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('areas');
  const [areas, setAreas] = useState<ResearcherSavedResearchAreaRecord[]>([]);
  const [taxonomy, setTaxonomy] = useState<ResearchAreaTaxonomyPayload | null>(null);
  const [publications, setPublications] = useState<FundingPublicationRecord[]>([]);
  const [maxPublications, setMaxPublications] = useState(5);
  const [loading, setLoading] = useState(true);
  const [savingArea, setSavingArea] = useState(false);
  const [savingPublication, setSavingPublication] = useState(false);
  const [areaDrawerOpen, setAreaDrawerOpen] = useState(false);
  const [publicationDrawerOpen, setPublicationDrawerOpen] = useState(false);
  const [areaForm, setAreaForm] = useState<ResearchAreaFitForm>(emptyResearchAreaForm());
  const [publicationForm, setPublicationForm] = useState<FundingPublicationForm>(emptyPublicationForm());
  const [areaSearch, setAreaSearch] = useState('');
  const [areaMoreOpen, setAreaMoreOpen] = useState(false);
  const [publicationMoreOpen, setPublicationMoreOpen] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const taxonomyAreas = taxonomy?.areas || [];
  const hasActiveTaxonomy = Boolean(taxonomy?.hasActiveTaxonomy && taxonomyAreas.length > 0);
  const selectedTaxonomyArea = useMemo(
    () => taxonomyAreas.find((area) => area.id === areaForm.taxonomyAreaId) || null,
    [areaForm.taxonomyAreaId, taxonomyAreas]
  );
  const filteredTaxonomyAreas = useMemo(() => {
    const query = areaSearch.trim().toLowerCase();
    if (!query) return taxonomyAreas.slice(0, 18);
    return taxonomyAreas
      .filter((area) =>
        [
          area.level1Name,
          area.level2Name,
          area.level1Code,
          area.level2Code,
          area.description,
          ...(area.aliases || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 24);
  }, [areaSearch, taxonomyAreas]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, router, user]);

  const loadData = useCallback(async () => {
    const [researchAreaPayload, taxonomyPayload, publicationPayload] = await Promise.all([
      apiRequest<{ researchAreas: ResearcherSavedResearchAreaRecord[] }>(authFetch, '/api/researcher/research-areas'),
      apiRequest<ResearchAreaTaxonomyPayload>(authFetch, '/api/researcher/research-area-taxonomy'),
      apiRequest<{ publications: FundingPublicationRecord[]; max: number }>(
        authFetch,
        '/api/researcher/funding-publications'
      ),
    ]);

    setAreas(researchAreaPayload.researchAreas || []);
    setTaxonomy(taxonomyPayload);
    setPublications(publicationPayload.publications || []);
    setMaxPublications(publicationPayload.max || 5);
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    loadData()
      .catch((error) => setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load research fit' }))
      .finally(() => setLoading(false));
  }, [loadData, user]);

  function openNewArea() {
    setAreaForm(emptyResearchAreaForm());
    setAreaSearch('');
    setAreaMoreOpen(false);
    setMessage(null);
    setAreaDrawerOpen(true);
  }

  function openEditArea(area: ResearcherSavedResearchAreaRecord) {
    setAreaForm(researchAreaToForm(area));
    setAreaSearch(formatTaxonomy(area));
    setAreaMoreOpen(false);
    setMessage(null);
    setAreaDrawerOpen(true);
  }

  function openNewPublication() {
    setPublicationForm(emptyPublicationForm());
    setPublicationMoreOpen(false);
    setMessage(null);
    setPublicationDrawerOpen(true);
  }

  function openEditPublication(publication: FundingPublicationRecord) {
    setPublicationForm(publicationToForm(publication));
    setPublicationMoreOpen(false);
    setMessage(null);
    setPublicationDrawerOpen(true);
  }

  async function saveArea() {
    const validation = validateResearchAreaForm(areaForm, hasActiveTaxonomy);
    if (validation) {
      setMessage({ type: 'error', text: validation });
      return;
    }

    setSavingArea(true);
    setMessage(null);
    try {
      const body = buildResearchAreaPayload(areaForm, selectedTaxonomyArea);
      const payload = areaForm.id
        ? await apiRequest<{ researchArea: ResearcherSavedResearchAreaRecord }>(
            authFetch,
            `/api/researcher/research-areas/${areaForm.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          )
        : await apiRequest<{ researchArea: ResearcherSavedResearchAreaRecord }>(
            authFetch,
            '/api/researcher/research-areas',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );

      await loadData();
      setAreaForm(researchAreaToForm(payload.researchArea));
      setAreaDrawerOpen(false);
      setMessage({ type: 'success', text: 'Research area saved.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save research area' });
    } finally {
      setSavingArea(false);
    }
  }

  async function deleteArea(areaId: string) {
    if (!window.confirm('Remove this research area?')) return;
    try {
      await apiRequest(authFetch, `/api/researcher/research-areas/${areaId}`, { method: 'DELETE' });
      await loadData();
      setMessage({ type: 'success', text: 'Research area removed.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to remove research area' });
    }
  }

  async function savePublication() {
    const validation = validateFundingPublicationForm(publicationForm);
    if (validation) {
      setMessage({ type: 'error', text: validation });
      return;
    }

    setSavingPublication(true);
    setMessage(null);
    try {
      const body = buildFundingPublicationPayload(publicationForm);
      const payload = publicationForm.id
        ? await apiRequest<{ publication: FundingPublicationRecord }>(
            authFetch,
            `/api/researcher/funding-publications/${publicationForm.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          )
        : await apiRequest<{ publication: FundingPublicationRecord }>(
            authFetch,
            '/api/researcher/funding-publications',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );

      await loadData();
      setPublicationForm(publicationToForm(payload.publication));
      setPublicationDrawerOpen(false);
      setMessage({ type: 'success', text: 'Publication saved for funding matching.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save publication' });
    } finally {
      setSavingPublication(false);
    }
  }

  async function removePublication(publicationId: string) {
    if (!window.confirm('Remove this publication from funding matching?')) return;
    try {
      await apiRequest(authFetch, `/api/researcher/funding-publications/${publicationId}`, { method: 'DELETE' });
      await loadData();
      setMessage({ type: 'success', text: 'Publication removed from funding matching.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to remove publication' });
    }
  }

  if (isLoading || loading) {
    return (
      <ResearcherWorkspaceShell
        title="Research Fit"
        description="Manage the research signals used by Finder and funding matching."
        eyebrow="Research Fit"
      >
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading research fit...
        </div>
      </ResearcherWorkspaceShell>
    );
  }

  return (
    <ResearcherWorkspaceShell
      title="Research Fit"
      description="Keep the topics and key publications that should guide funding recommendations and researcher matching."
      eyebrow="Research Fit"
    >
      <div className="space-y-5">
        {message ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              message.type === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab('areas')}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${
                activeTab === 'areas' ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <FaCompass />
              Research Areas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('publications')}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${
                activeTab === 'publications' ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <FaBookOpen />
              Key Publications
            </button>
          </div>

          <div className="text-sm text-slate-600">
            {activeTab === 'areas'
              ? `${areas.length} research ${areas.length === 1 ? 'area' : 'areas'}`
              : `${publications.length}/${maxPublications} key publications`}
          </div>
        </div>

        {activeTab === 'areas' ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Research Areas</h2>
                <p className="mt-1 text-sm text-slate-600">Short, reusable topics for Finder and admin matching.</p>
              </div>
              <button
                type="button"
                onClick={openNewArea}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <FaPlus />
                Add area
              </button>
            </div>

            {areas.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                <h3 className="text-base font-semibold text-slate-950">No research areas yet</h3>
                <p className="mt-2 text-sm text-slate-600">Add one focused topic to make Finder and funding matching more accurate.</p>
                <button
                  type="button"
                  onClick={openNewArea}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <FaPlus />
                  Add area
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {areas.map((area) => (
                  <div key={area.id} className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-950">{area.label}</h3>
                        {area.isDefault ? (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">Default</span>
                        ) : null}
                        {area.useForAlerts ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Active</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        {formatTaxonomy(area) || 'No classification'}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{area.researchArea}</p>
                      {area.keywords.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {area.keywords.slice(0, 5).map((keyword) => (
                            <span key={keyword} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href="/finder"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Use in Finder
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEditArea(area)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FaPen />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteArea(area.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <FaTrash />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Key Publications</h2>
                <p className="mt-1 text-sm text-slate-600">Choose up to five publications that best represent your funding direction.</p>
              </div>
              <button
                type="button"
                onClick={openNewPublication}
                disabled={publications.length >= maxPublications}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <FaPlus />
                Add publication
              </button>
            </div>

            {publications.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                <h3 className="text-base font-semibold text-slate-950">No key publications selected</h3>
                <p className="mt-2 text-sm text-slate-600">Add the title and abstract of one important paper to improve funding matches.</p>
                <button
                  type="button"
                  onClick={openNewPublication}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <FaPlus />
                  Add publication
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {publications.map((publication, index) => (
                  <div key={publication.id} className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">
                          {index + 1}
                        </span>
                        <h3 className="text-base font-semibold text-slate-950">{publication.title}</h3>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{publication.abstract}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        {publication.year ? <span>{publication.year}</span> : null}
                        {publication.venue ? <span>{publication.venue}</span> : null}
                        {publication.doi ? <span>{publication.doi}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href="/finder"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Use in Finder
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEditPublication(publication)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FaPen />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removePublication(publication.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <FaTrash />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <Drawer
        open={areaDrawerOpen}
        onClose={() => setAreaDrawerOpen(false)}
        title={areaForm.id ? 'Edit Research Area' : 'Add Research Area'}
        description="Keep this short and specific. You can hide secondary details unless they improve matching."
      >
        <div className="space-y-5">
          <Field label="Classification">
            {hasActiveTaxonomy ? (
              <div className="space-y-3">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={areaSearch}
                    onChange={(event) => setAreaSearch(event.target.value)}
                    placeholder="Search a research classification"
                    className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                {selectedTaxonomyArea ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    <FaCheck />
                    {formatTaxonomyOption(selectedTaxonomyArea)}
                  </div>
                ) : null}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                  {filteredTaxonomyAreas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => {
                        setAreaForm((current) => ({
                          ...current,
                          taxonomyLevel1Code: area.level1Code,
                          taxonomyAreaId: area.id,
                        }));
                        setAreaSearch(formatTaxonomyOption(area));
                      }}
                      className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 ${
                        areaForm.taxonomyAreaId === area.id ? 'bg-emerald-50 text-emerald-950' : 'text-slate-700'
                      }`}
                    >
                      <span className="block font-semibold">{area.level2Name || area.level2Code || 'General'}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{area.level1Name}</span>
                    </button>
                  ))}
                  {filteredTaxonomyAreas.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-slate-500">No matching classification found.</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                No active taxonomy is available yet.
              </div>
            )}
          </Field>

          <Field label="Topic title">
            <input
              type="text"
              value={areaForm.label}
              onChange={(event) => setAreaForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="e.g., AI for medical imaging"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <Field label="Research focus">
            <textarea
              rows={5}
              value={areaForm.researchArea}
              onChange={(event) => setAreaForm((current) => ({ ...current, researchArea: event.target.value }))}
              placeholder="Describe the problems, methods, applications, or populations you want funding calls matched against."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <button
            type="button"
            onClick={() => setAreaMoreOpen((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FaSlidersH />
            More details
          </button>

          {areaMoreOpen ? (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <Field label="Keywords">
                <textarea
                  rows={3}
                  value={areaForm.keywords}
                  onChange={(event) => setAreaForm((current) => ({ ...current, keywords: event.target.value }))}
                  placeholder="Comma-separated keywords"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <Field label="Disciplines">
                <textarea
                  rows={3}
                  value={areaForm.disciplines}
                  onChange={(event) => setAreaForm((current) => ({ ...current, disciplines: event.target.value }))}
                  placeholder="Optional discipline labels"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <label className="flex items-center justify-between gap-4 rounded-lg bg-white px-3 py-3 text-sm text-slate-700">
                <span className="font-medium">Use as default Finder topic</span>
                <input
                  type="checkbox"
                  checked={areaForm.isDefault}
                  onChange={(event) => setAreaForm((current) => ({ ...current, isDefault: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg bg-white px-3 py-3 text-sm text-slate-700">
                <span className="font-medium">Use for matching and alerts</span>
                <input
                  type="checkbox"
                  checked={areaForm.useForAlerts}
                  onChange={(event) => setAreaForm((current) => ({ ...current, useForAlerts: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
              </label>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => setAreaDrawerOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveArea}
              disabled={savingArea}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingArea ? 'Saving...' : 'Save area'}
            </button>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={publicationDrawerOpen}
        onClose={() => setPublicationDrawerOpen(false)}
        title={publicationForm.id ? 'Edit Publication' : 'Add Publication'}
        description="Use publications that best represent the grants you want to find."
      >
        <div className="space-y-5">
          <Field label="Title">
            <input
              type="text"
              value={publicationForm.title}
              onChange={(event) => setPublicationForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Publication title"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>
          <Field label="Abstract">
            <textarea
              rows={8}
              value={publicationForm.abstract}
              onChange={(event) => setPublicationForm((current) => ({ ...current, abstract: event.target.value }))}
              placeholder="Paste the abstract here"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </Field>

          <button
            type="button"
            onClick={() => setPublicationMoreOpen((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FaSlidersH />
            More details
          </button>

          {publicationMoreOpen ? (
            <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
              <Field label="Year">
                <input
                  type="number"
                  value={publicationForm.year}
                  onChange={(event) => setPublicationForm((current) => ({ ...current, year: event.target.value }))}
                  placeholder="2026"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <Field label="Venue">
                <input
                  type="text"
                  value={publicationForm.venue}
                  onChange={(event) => setPublicationForm((current) => ({ ...current, venue: event.target.value }))}
                  placeholder="Journal or conference"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="DOI">
                  <input
                    type="text"
                    value={publicationForm.doi}
                    onChange={(event) => setPublicationForm((current) => ({ ...current, doi: event.target.value }))}
                    placeholder="10.xxxx/xxxxx"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => setPublicationDrawerOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={savePublication}
              disabled={savingPublication}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {savingPublication ? 'Saving...' : 'Save publication'}
            </button>
          </div>
        </div>
      </Drawer>
    </ResearcherWorkspaceShell>
  );
}
