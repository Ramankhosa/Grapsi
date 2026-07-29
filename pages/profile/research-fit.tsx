import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  BellRing,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';

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

function doiHref(doi: string) {
  const trimmed = doi.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^10\./.test(trimmed)) return `https://doi.org/${trimmed}`;
  return null;
}

/**
 * Edit surface for areas and publications. A right-hand panel on desktop, a
 * full-height sheet on phones — the form is long, so it gets the whole screen.
 */
function Drawer({
  title,
  description,
  open,
  onClose,
  footer,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close drawer" onClick={onClose} className="absolute inset-0 bg-ink/25" />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-ground shadow-cb-sheet sm:max-w-xl md:max-w-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cb-btn-ghost cb-btn-sm shrink-0 px-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer ? <div className="border-t border-hairline bg-ground px-4 py-3 sm:px-6">{footer}</div> : null}
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="flex min-h-4 items-baseline justify-between gap-3">
        <span className="cb-label">{label}</span>
        {hint ? <span className="text-[11px] text-muted-soft">{hint}</span> : null}
      </div>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="cb-card flex items-center gap-3 p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold tracking-[-0.01em] text-ink">{value}</span>
        <span className="block truncate text-[12px] text-muted">{label}</span>
      </span>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-ground px-6 py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
        {icon}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-6 text-muted">{description}</p>
      <button type="button" onClick={onAction} className="cb-btn-primary mx-auto mt-5">
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
    </div>
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
  const [doiLookup, setDoiLookup] = useState('');
  const [doiLookupLoading, setDoiLookupLoading] = useState(false);
  const [doiLookupNote, setDoiLookupNote] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
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

  useEffect(() => {
    if (router.query.tab === 'publications') {
      setActiveTab('publications');
    }
  }, [router.query.tab]);

  useEffect(() => {
    if (message?.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

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
    setDoiLookup('');
    setDoiLookupNote(null);
    setMessage(null);
    setPublicationDrawerOpen(true);
  }

  function openEditPublication(publication: FundingPublicationRecord) {
    setPublicationForm(publicationToForm(publication));
    setPublicationMoreOpen(false);
    setDoiLookup('');
    setDoiLookupNote(null);
    setMessage(null);
    setPublicationDrawerOpen(true);
  }

  async function autofillFromDoi() {
    const query = doiLookup.trim();
    if (!query) {
      setDoiLookupNote({ type: 'error', text: 'Paste a DOI or doi.org link first.' });
      return;
    }

    setDoiLookupLoading(true);
    setDoiLookupNote(null);
    try {
      const payload = await apiRequest<{
        publication: { doi: string; title: string; abstract: string; year: number | null; venue: string | null };
      }>(authFetch, `/api/researcher/publication-lookup?doi=${encodeURIComponent(query)}`);
      const found = payload.publication;
      setPublicationForm((current) => ({
        ...current,
        title: found.title,
        abstract: found.abstract || current.abstract,
        year: found.year ? String(found.year) : current.year,
        venue: found.venue || current.venue,
        doi: found.doi,
      }));
      setPublicationMoreOpen(true);
      setDoiLookupNote(
        found.abstract
          ? { type: 'info', text: 'Details filled from the DOI record. Review and save.' }
          : { type: 'info', text: 'Found the publication, but no abstract is available — please paste it manually.' }
      );
    } catch (error) {
      setDoiLookupNote({
        type: 'error',
        text: error instanceof Error ? error.message : 'Publication lookup failed',
      });
    } finally {
      setDoiLookupLoading(false);
    }
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

  const alertAreaCount = areas.filter((area) => area.useForAlerts).length;
  const areaSignal = Math.min(areas.length, 3) / 3;
  const publicationSignal = maxPublications > 0 ? publications.length / maxPublications : 0;
  const signalScore = Math.round(areaSignal * 55 + publicationSignal * 45);
  const signalLabel = signalScore >= 80 ? 'Strong' : signalScore >= 45 ? 'Growing' : 'Just starting';

  if (isLoading || loading) {
    return (
      <ResearcherWorkspaceShell
        title="Research Fit"
        description="Manage the research signals used by Finder and funding matching."
        eyebrow="Research Fit"
      >
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-xl bg-hairline/70" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-44 animate-pulse rounded-xl bg-hairline/60" />
            <div className="h-44 animate-pulse rounded-xl bg-hairline/60" />
          </div>
        </div>
      </ResearcherWorkspaceShell>
    );
  }

  const addButton =
    activeTab === 'areas' ? (
      <button type="button" onClick={openNewArea} className="cb-btn-primary">
        <Plus className="h-4 w-4" />
        Add research area
      </button>
    ) : (
      <button
        type="button"
        onClick={openNewPublication}
        disabled={publications.length >= maxPublications}
        className="cb-btn-primary"
      >
        <Plus className="h-4 w-4" />
        {publications.length >= maxPublications ? 'All slots used' : 'Add publication'}
      </button>
    );

  return (
    <ResearcherWorkspaceShell
      title="Research Fit"
      description="Keep the topics and key publications that should guide funding recommendations and researcher matching."
      eyebrow="Research Fit"
      actions={<span className="hidden sm:inline-flex">{addButton}</span>}
    >
      <div className="space-y-4">
        {/* Signal summary */}
        <section className="cb-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="cb-eyebrow">Research signal strength</div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-3xl font-semibold leading-none tracking-[-0.02em] text-ink">{signalScore}%</span>
                <span className="cb-badge-cobalt">{signalLabel}</span>
              </div>
              <div className="mt-3 h-1.5 max-w-md overflow-hidden rounded-full bg-inset">
                <div className="h-full rounded-full bg-cobalt-600 transition-all duration-500" style={{ width: `${signalScore}%` }} />
              </div>
              <p className="mt-3 max-w-xl text-[13px] leading-5 text-muted">
                These signals are embedded and matched semantically against funding calls. Richer topics and abstracts
                mean sharper AI recommendations in Finder — no keyword guessing needed.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-3 lg:w-[420px]">
              <StatCard icon={<Compass className="h-4 w-4" />} label="Research areas" value={String(areas.length)} />
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label="Key publications"
                value={`${publications.length}/${maxPublications}`}
              />
              <StatCard icon={<BellRing className="h-4 w-4" />} label="Alert topics" value={String(alertAreaCount)} />
            </div>
          </div>
        </section>

        {message ? (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[13px] ${
              message.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-cobalt-200 bg-cobalt-50 text-cobalt-800'
            }`}
          >
            <span className="flex items-start gap-2">
              {message.type === 'error' ? <X className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
              {message.text}
            </span>
            <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message" className="shrink-0 rounded p-1 opacity-60 transition hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {/* Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-2">
          <div role="tablist" aria-label="Research fit sections" className="cb-scroll-x flex gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'areas'}
              onClick={() => setActiveTab('areas')}
              className={`cb-tab ${activeTab === 'areas' ? 'cb-tab-active' : ''}`}
            >
              <Compass className="h-4 w-4" />
              Research Areas
              <span className={activeTab === 'areas' ? 'cb-badge-cobalt' : 'cb-badge'}>{areas.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'publications'}
              onClick={() => setActiveTab('publications')}
              className={`cb-tab ${activeTab === 'publications' ? 'cb-tab-active' : ''}`}
            >
              <BookOpen className="h-4 w-4" />
              Key Publications
              <span className={activeTab === 'publications' ? 'cb-badge-cobalt' : 'cb-badge'}>
                {publications.length}/{maxPublications}
              </span>
            </button>
          </div>
          <span className="sm:hidden">{addButton}</span>
        </div>

        {activeTab === 'areas' ? (
          <section aria-label="Research areas">
            {areas.length === 0 ? (
              <EmptyState
                icon={<Compass className="h-5 w-5" />}
                title="Teach the AI what you work on"
                description="Add one focused research topic — its description is embedded and matched against thousands of funding calls, so Finder can surface opportunities that actually fit your work."
                actionLabel="Add your first research area"
                onAction={openNewArea}
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {areas.map((area) => (
                  <article key={area.id} className="cb-card flex flex-col p-4 transition hover:border-cobalt-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-muted">{formatTaxonomy(area) || 'No classification'}</div>
                        <h3 className="mt-0.5 truncate text-[15px] font-semibold text-ink">{area.label}</h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {area.isDefault ? (
                          <span title="Default Finder topic" className="cb-badge-cobalt">
                            <Star className="h-3 w-3" />
                            Default
                          </span>
                        ) : null}
                        {area.useForAlerts ? (
                          <span title="Used for matching and alerts" className="cb-badge">
                            <BellRing className="h-3 w-3" />
                            Alerts
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-muted">{area.researchArea}</p>

                    {area.keywords.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {area.keywords.slice(0, 5).map((keyword) => (
                          <span key={keyword} className="cb-badge">{keyword}</span>
                        ))}
                        {area.keywords.length > 5 ? (
                          <span className="px-1 py-0.5 text-[11px] text-muted-soft">+{area.keywords.length - 5} more</span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                      <Link href="/finder" className="cb-btn-secondary cb-btn-sm">
                        <Search className="h-3.5 w-3.5" />
                        Find funding
                      </Link>
                      <button type="button" onClick={() => openEditArea(area)} className="cb-btn-ghost cb-btn-sm">
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteArea(area.id)}
                        aria-label={`Remove ${area.label}`}
                        className="cb-btn-danger cb-btn-sm ml-auto"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section aria-label="Key publications" className="space-y-3">
            <div className="cb-card flex items-center gap-3 px-4 py-3">
              <div className="flex flex-1 gap-1.5">
                {Array.from({ length: maxPublications }, (_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 flex-1 rounded-full ${index < publications.length ? 'bg-cobalt-600' : 'bg-hairline'}`}
                  />
                ))}
              </div>
              <span className="shrink-0 text-[12px] text-muted">
                {publications.length}/{maxPublications} slots used
              </span>
            </div>

            {publications.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="Anchor matching with your best work"
                description="Paste the title and abstract of a paper that represents where you want funding to go. The AI compares it directly with call priorities to rank opportunities."
                actionLabel="Add your first publication"
                onAction={openNewPublication}
              />
            ) : (
              <div className="grid gap-3">
                {publications.map((publication, index) => {
                  const doiLink = publication.doi ? doiHref(publication.doi) : null;
                  return (
                    <article key={publication.id} className="cb-card p-4 transition hover:border-cobalt-300">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-[13px] font-semibold text-cobalt-700">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[15px] font-semibold leading-snug text-ink">{publication.title}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                            {publication.year ? <span>{publication.year}</span> : null}
                            {publication.venue ? <span>{publication.venue}</span> : null}
                            {publication.doi ? (
                              doiLink ? (
                                <a
                                  href={doiLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-cobalt-700 hover:text-cobalt-800 hover:underline"
                                >
                                  {publication.doi}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span>{publication.doi}</span>
                              )
                            ) : null}
                          </div>
                          <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-muted">{publication.abstract}</p>
                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                            <Link href="/finder" className="cb-btn-secondary cb-btn-sm">
                              <Search className="h-3.5 w-3.5" />
                              Find funding
                            </Link>
                            <button type="button" onClick={() => openEditPublication(publication)} className="cb-btn-ghost cb-btn-sm">
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removePublication(publication.id)}
                              aria-label={`Remove ${publication.title}`}
                              className="cb-btn-danger cb-btn-sm ml-auto"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      <Drawer
        open={areaDrawerOpen}
        onClose={() => setAreaDrawerOpen(false)}
        title={areaForm.id ? 'Edit research area' : 'Add research area'}
        description="Keep this short and specific — it becomes the semantic fingerprint Finder matches against funding calls."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAreaDrawerOpen(false)} className="cb-btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={saveArea} disabled={savingArea} className="cb-btn-primary">
              <Check className="h-4 w-4" />
              {savingArea ? 'Saving…' : 'Save area'}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Classification">
            {hasActiveTaxonomy ? (
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-soft" />
                  <input
                    type="search"
                    value={areaSearch}
                    onChange={(event) => setAreaSearch(event.target.value)}
                    placeholder="Search a research classification"
                    className="cb-input pl-9"
                  />
                </div>
                {selectedTaxonomyArea ? (
                  <div className="flex items-center gap-2 rounded-lg border border-cobalt-200 bg-cobalt-50 px-3 py-2.5 text-[13px] text-cobalt-800">
                    <Check className="h-4 w-4 shrink-0" />
                    {formatTaxonomyOption(selectedTaxonomyArea)}
                  </div>
                ) : null}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-hairline">
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
                      className={`block w-full border-b border-hairline px-3 py-2.5 text-left text-[13px] transition last:border-b-0 hover:bg-inset ${
                        areaForm.taxonomyAreaId === area.id ? 'bg-cobalt-50 text-cobalt-800' : 'text-ink-soft'
                      }`}
                    >
                      <span className="block font-medium">{area.level2Name || area.level2Code || 'General'}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{area.level1Name}</span>
                    </button>
                  ))}
                  {filteredTaxonomyAreas.length === 0 ? (
                    <div className="px-3 py-4 text-[13px] text-muted">No matching classification found.</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[13px] text-amber-900">
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
              className="cb-input"
            />
          </Field>

          <Field label="Research focus" hint="Problems, methods, populations, impact">
            <textarea
              rows={5}
              value={areaForm.researchArea}
              onChange={(event) => setAreaForm((current) => ({ ...current, researchArea: event.target.value }))}
              placeholder="Describe the problems, methods, applications, or populations you want funding calls matched against."
              className="cb-textarea"
            />
          </Field>

          <button
            type="button"
            onClick={() => setAreaMoreOpen((current) => !current)}
            aria-expanded={areaMoreOpen}
            className="cb-btn-secondary cb-btn-sm"
          >
            <SlidersHorizontal className="h-4 w-4" />
            More details
            <ChevronRight className={`h-4 w-4 transition-transform ${areaMoreOpen ? 'rotate-90' : ''}`} />
          </button>

          {areaMoreOpen ? (
            <div className="space-y-4 rounded-lg border border-hairline bg-inset p-4">
              <Field label="Keywords" hint="Comma-separated">
                <textarea
                  rows={3}
                  value={areaForm.keywords}
                  onChange={(event) => setAreaForm((current) => ({ ...current, keywords: event.target.value }))}
                  placeholder="Comma-separated keywords"
                  className="cb-textarea"
                />
              </Field>
              <Field label="Disciplines" hint="Optional">
                <textarea
                  rows={3}
                  value={areaForm.disciplines}
                  onChange={(event) => setAreaForm((current) => ({ ...current, disciplines: event.target.value }))}
                  placeholder="Optional discipline labels"
                  className="cb-textarea"
                />
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-hairline bg-ground px-3 py-2.5 text-[13px] text-ink-soft">
                <span className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-muted-soft" />
                  Use as default Finder topic
                </span>
                <input
                  type="checkbox"
                  checked={areaForm.isDefault}
                  onChange={(event) => setAreaForm((current) => ({ ...current, isDefault: event.target.checked }))}
                  className="h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-hairline bg-ground px-3 py-2.5 text-[13px] text-ink-soft">
                <span className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-muted-soft" />
                  Use for matching and alerts
                </span>
                <input
                  type="checkbox"
                  checked={areaForm.useForAlerts}
                  onChange={(event) => setAreaForm((current) => ({ ...current, useForAlerts: event.target.checked }))}
                  className="h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
                />
              </label>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Drawer
        open={publicationDrawerOpen}
        onClose={() => setPublicationDrawerOpen(false)}
        title={publicationForm.id ? 'Edit publication' : 'Add publication'}
        description="Use publications that best represent the grants you want to find — the abstract drives semantic matching."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPublicationDrawerOpen(false)} className="cb-btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={savePublication} disabled={savingPublication} className="cb-btn-primary">
              <Check className="h-4 w-4" />
              {savingPublication ? 'Saving…' : 'Save publication'}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-hairline bg-inset p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Wand2 className="h-4 w-4 text-cobalt-600" />
              Autofill from DOI
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              Paste a DOI or doi.org link and we fetch the title, abstract, year, and venue for you.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={doiLookup}
                onChange={(event) => setDoiLookup(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    autofillFromDoi();
                  }
                }}
                placeholder="10.xxxx/xxxxx or https://doi.org/…"
                className="cb-input flex-1"
                disabled={doiLookupLoading}
              />
              <button type="button" onClick={autofillFromDoi} disabled={doiLookupLoading} className="cb-btn-primary shrink-0">
                {doiLookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {doiLookupLoading ? 'Fetching…' : 'Autofill'}
              </button>
            </div>
            {doiLookupNote ? (
              <p role="status" className={`mt-2 text-[12px] leading-5 ${doiLookupNote.type === 'error' ? 'text-red-700' : 'text-cobalt-700'}`}>
                {doiLookupNote.text}
              </p>
            ) : null}
          </div>

          <Field label="Title">
            <input
              type="text"
              value={publicationForm.title}
              onChange={(event) => setPublicationForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Publication title"
              className="cb-input"
            />
          </Field>
          <Field
            label="Abstract"
            hint={publicationForm.abstract ? `${publicationForm.abstract.length} characters` : 'Paste the full abstract'}
          >
            <textarea
              rows={8}
              value={publicationForm.abstract}
              onChange={(event) => setPublicationForm((current) => ({ ...current, abstract: event.target.value }))}
              placeholder="Paste the abstract here"
              className="cb-textarea"
            />
          </Field>

          <button
            type="button"
            onClick={() => setPublicationMoreOpen((current) => !current)}
            aria-expanded={publicationMoreOpen}
            className="cb-btn-secondary cb-btn-sm"
          >
            <SlidersHorizontal className="h-4 w-4" />
            More details
            <ChevronRight className={`h-4 w-4 transition-transform ${publicationMoreOpen ? 'rotate-90' : ''}`} />
          </button>

          {publicationMoreOpen ? (
            <div className="grid gap-4 rounded-lg border border-hairline bg-inset p-4 md:grid-cols-2">
              <Field label="Year">
                <input
                  type="number"
                  value={publicationForm.year}
                  onChange={(event) => setPublicationForm((current) => ({ ...current, year: event.target.value }))}
                  placeholder="2026"
                  className="cb-input"
                />
              </Field>
              <Field label="Venue">
                <input
                  type="text"
                  value={publicationForm.venue}
                  onChange={(event) => setPublicationForm((current) => ({ ...current, venue: event.target.value }))}
                  placeholder="Journal or conference"
                  className="cb-input"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="DOI">
                  <input
                    type="text"
                    value={publicationForm.doi}
                    onChange={(event) => setPublicationForm((current) => ({ ...current, doi: event.target.value }))}
                    placeholder="10.xxxx/xxxxx"
                    className="cb-input"
                  />
                </Field>
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>
    </ResearcherWorkspaceShell>
  );
}
