import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import Header from '@/components/Header';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import { BOOLEAN_FIELD_KEYS, FUNDING_FIELD_DEFINITIONS, NUMERIC_FIELD_KEYS } from '@/lib/fundingIntake/constants';
import type {
  FundingCallResearchAreaTaxonomyRecord,
  ResearchAreaTaxonomyGroup,
  ResearchAreaTaxonomyPayload,
} from '@/lib/researcherProfile/types';

// Plain-language labels for guideline/template statuses shown to admins.
const STEP_STATUS_LABELS: Record<string, string> = {
  none: 'Not started',
  draft: 'In progress',
  needs_review: 'Needs review',
  approved: 'Approved',
};

function stepStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return STEP_STATUS_LABELS.none;
  }
  return STEP_STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

type CatalogDetails = {
  call: {
    id: string;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
    is_active: boolean;
    template_status: string;
    guideline_status: string;
    active_template_id: string | null;
    active_guideline_id: string | null;
    source_url: string | null;
    intake_job_id: string | null;
    metadata: Record<string, any> | null;
    published_at: string | null;
    published_by: string | null;
    embedding_status: 'not_generated' | 'generated' | 'failed' | 'stale';
  };
  draftValues: Record<string, any>;
  publishReadiness: {
    ready: boolean;
    missingFields: string[];
  };
  sourceProvenance: {
    id: string;
    input_type: string;
    source_url: string | null;
    created_at: string;
    status: string;
  } | null;
};

function toTextArray(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleArrayValue(currentValue: unknown, nextValue: string): string[] {
  const currentItems = Array.isArray(currentValue) ? currentValue.map((item) => String(item)) : [];
  return currentItems.includes(nextValue)
    ? currentItems.filter((item) => item !== nextValue)
    : [...currentItems, nextValue];
}

export default function FundingCatalogDetailPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [details, setDetails] = useState<CatalogDetails | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [taxonomy, setTaxonomy] = useState<ResearchAreaTaxonomyPayload | null>(null);
  const [taxonomyMappings, setTaxonomyMappings] = useState<FundingCallResearchAreaTaxonomyRecord[]>([]);
  const [selectedTaxonomyAreaIds, setSelectedTaxonomyAreaIds] = useState<string[]>([]);
  const [taxonomySaving, setTaxonomySaving] = useState(false);

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
  const isFundingWriter =
    userRoles.includes('SUPER_ADMIN') || isPlatformAdmin || platformPermissions.includes('funding.operations.write');
  const isFundingPublisher =
    userRoles.includes('SUPER_ADMIN') || isPlatformAdmin || platformPermissions.includes('funding.publisher.write');
  const taxonomyAreaById = useMemo(() => {
    return new Map((taxonomy?.areas || []).map((area) => [area.id, area]));
  }, [taxonomy]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && isFundingOperator && id) {
      void loadDetails(true);
    }
  }, [user, id, isFundingOperator]);

  async function loadDetails(showSpinner = true) {
    if (!id) {
      return;
    }

    if (showSpinner) {
      setLoading(true);
    }

    try {
      const [response, taxonomyResponse, mappingsResponse] = await Promise.all([
        fetch(`/api/admin/funding/calls/${id}`),
        fetch('/api/super-admin/research-area-taxonomy'),
        fetch(`/api/admin/funding/calls/${id}/research-area-taxonomy`),
      ]);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load funding call');
      }
      setDetails(data);
      setDraftValues(data.draftValues || {});

      if (taxonomyResponse.ok) {
        const taxonomyData = await taxonomyResponse.json();
        setTaxonomy({
          upload: taxonomyData.upload || null,
          areas: taxonomyData.areas || [],
          groups: taxonomyData.groups || [],
          hasActiveTaxonomy: Boolean(taxonomyData.hasActiveTaxonomy),
        });
      } else {
        setTaxonomy(null);
      }

      if (mappingsResponse.ok) {
        const mappingData = await mappingsResponse.json();
        const mappings = Array.isArray(mappingData.mappings) ? mappingData.mappings : [];
        setTaxonomyMappings(mappings);
        setSelectedTaxonomyAreaIds(mappings.map((mapping: FundingCallResearchAreaTaxonomyRecord) => mapping.taxonomyAreaId));
      } else {
        setTaxonomyMappings([]);
        setSelectedTaxonomyAreaIds([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load funding call');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  function updateDraftValue(key: string, value: any) {
    setDraftValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!id) {
      return;
    }
    if (!isFundingWriter) {
      toast.error('Funding operations write access required.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftValues),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save funding call');
      }
      toast.success('Funding call updated');
      setDetails(data);
      setDraftValues(data.draftValues || {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save funding call');
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(action: 'publish' | 'archive' | 'reject') {
    if (!id) {
      return;
    }
    if (!isFundingPublisher) {
      toast.error('Funding publishing access required.');
      return;
    }

    setActing(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/${action}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.requiredFieldsRemaining) {
          toast.error(`Publish blocked: ${data.requiredFieldsRemaining.join(', ')}`);
          await loadDetails(false);
          return;
        }
        throw new Error(data.message || `Failed to ${action} funding call`);
      }
      toast.success(`Funding call ${action}ed`);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${action} funding call`);
    } finally {
      setActing(false);
    }
  }

  function getTaxonomyAreaLabel(areaId: string) {
    const area = taxonomyAreaById.get(areaId);
    if (area) {
      return [area.level1Name, area.level2Name || area.level2Code].filter(Boolean).join(' / ');
    }

    const mapping = taxonomyMappings.find((item) => item.taxonomyAreaId === areaId);
    if (mapping) {
      return [mapping.level1Name, mapping.level2Name || mapping.level2Code].filter(Boolean).join(' / ');
    }

    return areaId;
  }

  function toggleTaxonomyArea(areaId: string) {
    setSelectedTaxonomyAreaIds((current) =>
      current.includes(areaId)
        ? current.filter((idValue) => idValue !== areaId)
        : [...current, areaId]
    );
  }

  function toggleTaxonomyGroup(group: ResearchAreaTaxonomyGroup) {
    const activeAreaIds = group.areas.filter((area) => area.isActive).map((area) => area.id);
    if (activeAreaIds.length === 0) {
      return;
    }

    setSelectedTaxonomyAreaIds((current) => {
      const currentSet = new Set(current);
      const allSelected = activeAreaIds.every((areaId) => currentSet.has(areaId));
      if (allSelected) {
        return current.filter((areaId) => !activeAreaIds.includes(areaId));
      }
      return Array.from(new Set([...current, ...activeAreaIds]));
    });
  }

  function countSelectedInGroup(group: ResearchAreaTaxonomyGroup) {
    const selected = new Set(selectedTaxonomyAreaIds);
    return group.areas.filter((area) => area.isActive && selected.has(area.id)).length;
  }

  async function handleSaveTaxonomyMappings() {
    if (!id) {
      return;
    }

    setTaxonomySaving(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/research-area-taxonomy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomyAreaIds: selectedTaxonomyAreaIds }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to save research taxonomy mappings');
      }
      const mappings = Array.isArray(data.mappings) ? data.mappings : [];
      setTaxonomyMappings(mappings);
      setSelectedTaxonomyAreaIds(mappings.map((mapping: FundingCallResearchAreaTaxonomyRecord) => mapping.taxonomyAreaId));
      toast.success('Research taxonomy mappings updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save research taxonomy mappings');
    } finally {
      setTaxonomySaving(false);
    }
  }

  if (isLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading funding catalog record...</div>;
  }

  if (!isFundingOperator || !details) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-600">This funding call is not available.</p>
          <Link href="/admin/funding/catalog" className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Back to Catalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>Funding Catalog Record</title>
      </Head>
      <Header />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FundingWorkspaceTabs
          current="call"
          callHref={details.sourceProvenance ? `/admin/funding/intake/${details.sourceProvenance.id}` : `/admin/funding/catalog/${details.call.id}`}
          guidelinesHref={`/admin/funding/catalog/${details.call.id}/guidelines`}
          templateHref={`/admin/funding/catalog/${details.call.id}/template`}
          documentsHref={`/admin/funding/catalog/${details.call.id}/documents`}
          guidelineStatus={details.call.guideline_status}
          templateStatus={details.call.template_status}
        />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Step 1 of 4 · Call Details</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Funding Call {details.call.id}</h1>
            <p className="mt-3 text-sm text-slate-600">
              Status: {details.call.status} · {details.call.is_active ? 'Active' : 'Inactive'} · Search index: {details.call.embedding_status.replace('_', ' ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/funding/catalog" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Back to Catalog
            </Link>
            {details.sourceProvenance && (
              <Link href={`/admin/funding/intake/${details.sourceProvenance.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                Open Intake Job
              </Link>
            )}
            <Link href={`/admin/funding/catalog/${details.call.id}/guidelines`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Open Guidelines (Step 2)
            </Link>
            <Link href={`/admin/funding/catalog/${details.call.id}/template`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Open Template (Step 3)
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isFundingWriter || saving || acting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={() => handleAction('publish')}
              disabled={!isFundingPublisher || saving || acting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acting ? 'Working...' : 'Publish'}
            </button>
            <button
              type="button"
              onClick={() => handleAction('archive')}
              disabled={!isFundingPublisher || saving || acting}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Archive
            </button>
            <button
              type="button"
              onClick={() => handleAction('reject')}
              disabled={!isFundingPublisher || saving || acting}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,0.7fr),minmax(0,1.3fr)]">
          <div className="space-y-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Ready to publish?</h2>
              {details.publishReadiness.ready ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  Yes — all required fields are filled in. You can publish this call.
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Not yet. Fill in these fields first: {details.publishReadiness.missingFields.join(', ')}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Where things stand</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div>
                  <span className="font-medium text-slate-900">Published by:</span>{' '}
                  {details.call.published_by || 'Not published yet'}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Published at:</span>{' '}
                  {details.call.published_at ? new Date(details.call.published_at).toLocaleString() : 'Not published yet'}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Search index:</span>{' '}
                  {details.call.embedding_status.replace('_', ' ')}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Template (Step 3):</span>{' '}
                  {stepStatusLabel(details.call.template_status)}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Guidelines (Step 2):</span>{' '}
                  {stepStatusLabel(details.call.guideline_status)}
                </div>
                <div>
                  <span className="font-medium text-slate-900">Ready for drafting:</span>{' '}
                  {details.call.guideline_status === 'approved' && details.call.template_status === 'approved'
                    ? 'Yes — researchers can brainstorm and draft with this call'
                    : 'Not yet — Guidelines and Template both need to be approved first'}
                </div>
                {details.call.source_url && (
                  <div className="break-all">
                    <span className="font-medium text-slate-900">Source URL:</span> {details.call.source_url}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Research taxonomy</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Manually tag this call with Level 1 and Level 2 research areas for Finder directory filtering.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveTaxonomyMappings}
                  disabled={!isFundingWriter || taxonomySaving}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {taxonomySaving ? 'Saving...' : 'Save Tags'}
                </button>
              </div>

              {!isFundingWriter ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Viewer accounts can inspect taxonomy tags but cannot update them.
                </div>
              ) : null}

              {!taxonomy?.hasActiveTaxonomy ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  No active research taxonomy is available. Upload one from the superadmin research areas page first.
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {selectedTaxonomyAreaIds.length > 0 ? (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected tags</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedTaxonomyAreaIds.map((areaId) => (
                          <button
                            key={areaId}
                            type="button"
                            onClick={() => toggleTaxonomyArea(areaId)}
                            disabled={!isFundingWriter}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 disabled:cursor-not-allowed"
                          >
                            {getTaxonomyAreaLabel(areaId)} x
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                      No taxonomy tags selected for this funding call.
                    </div>
                  )}

                  <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                    {(taxonomy.groups || []).map((group) => {
                      const activeAreas = group.areas.filter((area) => area.isActive);
                      const selectedCount = countSelectedInGroup(group);
                      const allSelected = activeAreas.length > 0 && selectedCount === activeAreas.length;

                      if (activeAreas.length === 0) {
                        return null;
                      }

                      return (
                        <div key={`${group.level1Code}-${group.level1Name}`} className="rounded-xl border border-slate-200 p-3">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={() => toggleTaxonomyGroup(group)}
                              disabled={!isFundingWriter}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-slate-900">
                                {group.level1Name}
                              </span>
                              <span className="mt-1 block text-xs text-slate-500">
                                Level 1 {group.level1Code} - {selectedCount} of {activeAreas.length} Level 2 selected
                              </span>
                            </span>
                          </label>

                          <div className="mt-3 space-y-2 pl-7">
                            {activeAreas.map((area) => (
                              <label key={area.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={selectedTaxonomyAreaIds.includes(area.id)}
                                  onChange={() => toggleTaxonomyArea(area.id)}
                                  disabled={!isFundingWriter}
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm text-slate-800">{area.level2Name || area.level2Code}</span>
                                  <span className="block text-xs text-slate-500">Level 2 {area.level2Code}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Where this call came from</h2>
              {details.sourceProvenance ? (
                <div className="mt-4 space-y-3 text-sm text-slate-700">
                  <div><span className="font-medium text-slate-900">Intake Job:</span> {details.sourceProvenance.id}</div>
                  <div><span className="font-medium text-slate-900">Input Type:</span> {details.sourceProvenance.input_type}</div>
                  <div><span className="font-medium text-slate-900">Intake Status:</span> {details.sourceProvenance.status}</div>
                  <div><span className="font-medium text-slate-900">Created:</span> {new Date(details.sourceProvenance.created_at).toLocaleString()}</div>
                  {details.sourceProvenance.source_url && (
                    <div className="break-all"><span className="font-medium text-slate-900">Source URL:</span> {details.sourceProvenance.source_url}</div>
                  )}
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  This call was not created through the intake process, so there is no linked intake job.
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Call details editor</h2>
            <p className="mt-1 text-sm text-slate-600">
              Edit any field of this funding call here, then use “Save Changes” at the top. Publishing refreshes the search index so researchers can find the call.
            </p>

            <div className="mt-6 space-y-6">
              {FUNDING_FIELD_DEFINITIONS.map((field) => {
                const currentValue = draftValues[field.key];

                return (
                  <div key={field.key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{field.label}</h3>
                      {field.requiredForDraft && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          Required
                        </span>
                      )}
                    </div>

                    {field.description && (
                      <p className="mt-3 text-xs leading-5 text-slate-500">{field.description}</p>
                    )}

                    {Array.isArray(field.suggestions) && field.suggestions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {field.suggestions.map((suggestion) => {
                          const isSelected = field.type === 'array'
                            ? Array.isArray(currentValue) && currentValue.includes(suggestion)
                            : currentValue === suggestion;

                          return (
                            <button
                              key={`${field.key}-${suggestion}`}
                              type="button"
                              onClick={() => {
                                if (field.type === 'array') {
                                  updateDraftValue(field.key, toggleArrayValue(currentValue, suggestion));
                                  return;
                                }
                                updateDraftValue(field.key, suggestion);
                              }}
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                isSelected
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-300 bg-white text-slate-600'
                              }`}
                            >
                              {suggestion}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-4">
                      {field.type === 'textarea' ? (
                        <textarea
                          value={currentValue || ''}
                          onChange={(event) => updateDraftValue(field.key, event.target.value)}
                          rows={['description', 'eligibility_text', 'expected_deliverables_text', 'project_duration_text'].includes(field.key) ? 6 : 3}
                          placeholder={field.placeholder || ''}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        />
                      ) : field.type === 'array' ? (
                        <textarea
                          value={Array.isArray(currentValue) ? currentValue.join(', ') : ''}
                          onChange={(event) => updateDraftValue(field.key, toTextArray(event.target.value))}
                          rows={2}
                          placeholder={field.placeholder || ''}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        />
                      ) : field.type === 'boolean' ? (
                        <label className="inline-flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={Boolean(currentValue)}
                            onChange={(event) => updateDraftValue(field.key, event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                          />
                          <span className="text-sm text-slate-700">Mark as rolling opportunity</span>
                        </label>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={field.type === 'number' ? currentValue ?? '' : currentValue || ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (NUMERIC_FIELD_KEYS.has(field.key as any)) {
                              updateDraftValue(field.key, value === '' ? null : Number(value));
                              return;
                            }
                            if (BOOLEAN_FIELD_KEYS.has(field.key as any)) {
                              updateDraftValue(field.key, event.target.checked);
                              return;
                            }
                            updateDraftValue(field.key, value);
                          }}
                          placeholder={field.placeholder || ''}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
