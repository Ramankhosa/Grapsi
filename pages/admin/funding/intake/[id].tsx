import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import Header from '@/components/Header';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types';
import type { GrantTemplateDocument } from '@/lib/fundingTemplates/types';
import { FUNDING_FIELD_DEFINITIONS, BOOLEAN_FIELD_KEYS, NUMERIC_FIELD_KEYS } from '@/lib/fundingIntake/constants';
import { summarizeJsonArtifacts } from '@/lib/fundingIntake/jsonArtifactPreview';

// Plain-language labels for guideline/template statuses shown across this page.
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

type EvidenceAnchor = {
  sourceType: 'segment';
  segmentId: string;
  quote: string;
  heading?: string | null;
};

type JobDetails = {
  job: {
    id: string;
    status: string;
    input_type: 'url' | 'text' | 'pdf' | 'json';
    source_url: string | null;
    source_file_path: string | null;
    raw_text: string | null;
    normalized_text: string | null;
    processing_phase: string | null;
    error_code: string | null;
    error_message: string | null;
    duplicate_status: string;
    linked_funding_call_id: string | null;
    fetch_metadata_json?: Record<string, any> | null;
    created_at: string;
    updated_at: string;
  };
  submitter: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  extraction: {
    extracted_json: {
      fields: Record<string, { value: any; status: 'supported' | 'unsupported' | 'ambiguous'; confidence: number; evidence: EvidenceAnchor[] }>;
      warnings?: string[];
    } | null;
    warnings_json?: string[] | null;
    created_at: string;
  } | null;
  draft: {
    id: string;
    status: string;
  } | null;
  draftValues: Record<string, any>;
  call: {
    id: string;
    status: string;
    guideline_status: string;
    template_status: string;
    published_at: string | null;
    published_by: string | null;
    embedding_status: string;
    metadata?: Record<string, unknown> | null;
  } | null;
  publishReadiness: {
    ready: boolean;
    missingFields: string[];
  } | null;
  publishWarnings: Array<{
    code: string;
    message: string;
  }>;
  draftingReadiness: {
    ready: boolean;
    mode: string;
    guidelineApproved: boolean;
    templateApproved: boolean;
    issues: string[];
  };
  guidelines: {
    guideline: {
      id: string;
      status: string;
      current_revision_no: number;
      guideline_pack_json: GuidelinePackDocument;
      summary_json: {
        totalRules: number;
        blockCounts: Record<string, number>;
      };
      approved_by: string | null;
      approved_at: string | null;
      last_edited_by: string | null;
      last_edited_at: string | null;
    } | null;
    runs: Array<{
      id: string;
      status: string;
      extractor_model: string | null;
      error_message: string | null;
      created_at: string;
    }>;
    revisions: Array<{
      id: string;
      revision_no: number;
      revision_type: string;
      diff_summary: string | null;
      approved_state: string;
      change_notes: string | null;
      created_at: string;
    }>;
  } | null;
  template: {
    template: {
      id: string;
      status: string;
      current_revision_no: number;
      grant_template_json: GrantTemplateDocument;
      compatibility_json: {
        supportCounts: Record<string, number>;
        conflicts: Array<{ block: string; key: string; message: string; createdAt: string }>;
        warnings: string[];
      } | null;
      approved_by: string | null;
      approved_at: string | null;
      last_edited_by: string | null;
      last_edited_at: string | null;
    } | null;
    assets: Array<{
      id: string;
      sequence_no: number;
      source_type: 'url' | 'pdf' | 'image' | 'text';
      source_url: string | null;
      storage_path: string | null;
      normalized_text: string | null;
      raw_text: string | null;
      source_metadata_json?: Record<string, any> | null;
      created_at: string;
    }>;
    runs: Array<{
      id: string;
      status: string;
      extractor_model: string | null;
      warnings_json: string[] | null;
      normalized_template_json: GrantTemplateDocument | null;
      error_message: string | null;
      created_at: string;
    }>;
    revisions: Array<{
      id: string;
      revision_no: number;
      revision_type: string;
      diff_summary: string | null;
      approved_state: string;
      change_notes: string | null;
      created_at: string;
    }>;
  } | null;
  duplicates: Array<{
    id: string;
    match_type: string;
    match_score: number;
    resolution: string;
    candidate: {
      id: string;
      agency_name: string;
      scheme_title: string;
      status: string;
      source_url: string | null;
      close_date: string | null;
    } | null;
  }>;
  domainDuplicates?: Array<{
    candidate_funding_call_id: string;
    match_score: number;
    source_domain: string;
    matched_url: string | null;
    strong_similarity: boolean;
    candidate: {
      id: string;
      agency_name: string;
      scheme_title: string;
    };
  }>;
  events: Array<{
    id: string;
    previous_status: string | null;
    next_status: string;
    event_type: string;
    message: string | null;
    created_at: string;
  }>;
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

function formatJobErrorCode(errorCode: string | null | undefined) {
  switch (errorCode) {
    case 'LLM_RATE_LIMITED':
      return 'LLM rate limit or quota reached';
    case 'pdf_intake_requires_gemini':
      return 'PDF extraction needs Gemini multimodal configuration';
    case 'SOURCE_PREPARATION_FAILED':
      return 'Source could not be prepared';
    case 'PROCESSING_FAILED':
      return 'Call details extraction failed';
    default:
      return errorCode || 'Processing failed';
  }
}

function formatEvidenceAnchors(value: EvidenceAnchor[] | null | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  return value.map((anchor) => {
    const parts = [anchor.segmentId];
    if (anchor.heading) {
      parts.push(anchor.heading);
    }
    parts.push(anchor.quote);
    return parts.join(': ');
  });
}

function hasDraftMinimumFields(values: Record<string, any>) {
  return ['agency_name', 'scheme_title', 'description'].every((key) => String(values?.[key] || '').trim().length > 0);
}

function getTemplateCounts(template: GrantTemplateDocument | null | undefined) {
  return {
    questions: template?.questions.length || 0,
    sections: template?.sections.length || 0,
    attachments: template?.attachments.length || 0,
    evaluationCriteria: template?.evaluationCriteria.length || 0,
    submissionRules: template?.submissionRules.items.length || 0,
    budget: template?.budget ? 1 : 0,
  };
}

export default function FundingIntakeJobPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, any>>({});
  const [duplicateResolutions, setDuplicateResolutions] = useState<Record<string, string>>({});
  const [linkedCallOverrideId, setLinkedCallOverrideId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [extractingAll, setExtractingAll] = useState(false);
  const [callBusy, setCallBusy] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<'url' | 'text' | 'pdf'>('text');
  const [recoverySourceUrl, setRecoverySourceUrl] = useState('');
  const [recoverySourceText, setRecoverySourceText] = useState('');
  const [recoverySourcePdf, setRecoverySourcePdf] = useState<File | null>(null);
  const [deletingJob, setDeletingJob] = useState(false);

  const userRoles = user?.roles || [];
  const platformPermissions = user?.platformPermissions || [];
  const isPlatformAdmin = userRoles.includes('ADMIN') && user?.ati_id === 'PLATFORM';
  const canReadFundingIntake =
    userRoles.includes('SUPER_ADMIN') ||
    userRoles.includes('SUPER_ADMIN_VIEWER') ||
    isPlatformAdmin ||
    platformPermissions.includes('platform.support.read') ||
    platformPermissions.includes('funding.operations.write') ||
    platformPermissions.includes('funding.publisher.write');
  const canWriteFundingIntake =
    userRoles.includes('SUPER_ADMIN') || isPlatformAdmin || platformPermissions.includes('funding.operations.write');
  const canPublishFunding =
    userRoles.includes('SUPER_ADMIN') || isPlatformAdmin || platformPermissions.includes('funding.publisher.write');
  const callId = details?.call?.id || details?.job.linked_funding_call_id || linkedCallOverrideId || null;
  const isActiveJob = useMemo(
    () => details && ['queued', 'fetching', 'extracting'].includes(details.job.status),
    [details]
  );
  const isCallBasicsLlmInProcess = useMemo(
    () =>
      Boolean(
        details &&
        details.job.status === 'extracting' &&
        (!details.job.processing_phase || details.job.processing_phase === 'core_extraction')
      ),
    [details]
  );
  const activeGuidelineRuns = useMemo(
    () => (details?.guidelines?.runs || []).filter((run) => run.status === 'queued' || run.status === 'extracting'),
    [details?.guidelines?.runs]
  );
  const activeTemplateRuns = useMemo(
    () => (details?.template?.runs || []).filter((run) => run.status === 'queued' || run.status === 'extracting'),
    [details?.template?.runs]
  );
  const isPublishedLinkedCall = details?.call?.status === 'PUBLISHED';
  const hasPendingDuplicates = useMemo(
    () => (details?.duplicates || []).some((duplicate) => (duplicateResolutions[duplicate.id] || duplicate.resolution || 'pending') === 'pending'),
    [details?.duplicates, duplicateResolutions]
  );
  const canSaveDraftFromCurrentStatus = Boolean(
    details && ['needs_review', 'draft_created', 'failed'].includes(details.job.status)
  );
  // For JSON/CSV uploads, guideline/template artifacts are parsed at upload time and
  // parked on the job until the draft is saved — show the admin what is waiting.
  const jsonArtifactPreview = useMemo(
    () => (details?.job.input_type === 'json' ? summarizeJsonArtifacts(details.job.fetch_metadata_json) : null),
    [details]
  );
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && canReadFundingIntake && id) {
      void loadDetails(true);
    }
  }, [user, id, canReadFundingIntake]);

  useEffect(() => {
    if ((!isActiveJob && activeGuidelineRuns.length === 0 && activeTemplateRuns.length === 0) || !id) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadDetails(false);
    }, 3500);

    return () => window.clearInterval(interval);
  }, [id, isActiveJob, activeGuidelineRuns.length, activeTemplateRuns.length]);

  async function loadDetails(showSpinner = true) {
    if (!id) {
      return;
    }

    if (showSpinner) {
      setLoading(true);
    }

    try {
      const response = await fetch(`/api/admin/funding/intake/${id}?t=${Date.now()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load funding intake job');
      }

      setDetails(data);
      setLinkedCallOverrideId(data.call?.id || data.job?.linked_funding_call_id || null);
      setDraftValues(data.draftValues || {});
      setDuplicateResolutions((current) => {
        const next = { ...current };
        for (const duplicate of data.duplicates || []) {
          next[duplicate.id] = next[duplicate.id] || duplicate.resolution || 'pending';
        }
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load funding intake job');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  function updateDraftValue(key: string, value: any) {
    setDraftValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSaveDraft(extractAll: boolean) {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return null;
    }

    if (!id) {
      return null;
    }

    setSavingDraft(true);
    try {
      const response = await fetch(`/api/admin/funding/intake/${id}/create-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draftValues,
          extractAll,
          duplicateResolutions: Object.entries(duplicateResolutions).map(([duplicateId, resolution]) => ({
            duplicateId,
            resolution,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.reason === 'duplicate_resolution_required') {
          toast.error('Resolve duplicate candidates before saving the draft.');
          await loadDetails(false);
          return;
        }

        if (data.requiredFieldsRemaining?.length) {
          throw new Error(`Missing required fields: ${data.requiredFieldsRemaining.join(', ')}`);
        }

        throw new Error(data.message || 'Failed to save draft');
      }

      if (data.fundingCallId) {
        setLinkedCallOverrideId(data.fundingCallId);
        setDetails((current) =>
          current
            ? {
                ...current,
                job: {
                  ...current.job,
                  linked_funding_call_id: data.fundingCallId,
                },
              }
            : current
        );
      }

      if (data.extractAllSkippedReason === 'merged_to_existing') {
        toast.success('Linked this intake job to the existing funding call.');
      } else if (extractAll) {
        toast.success(details?.job.input_type === 'json' ? 'Draft saved and JSON artifacts imported.' : 'Draft saved and extract-all started.');
      } else {
        toast.success('Draft saved.');
      }

      if (data.guidelineExtractionError) {
        toast.error(`Guideline extraction warning: ${data.guidelineExtractionError}`);
      }
      if (data.templateExtractionError) {
        toast.error(`Template extraction warning: ${data.templateExtractionError}`);
      }
      if (data.jsonGuidelineImported || data.jsonTemplateImported) {
        toast.success(`Imported JSON artifacts:${data.jsonGuidelineImported ? ' guidelines' : ''}${data.jsonTemplateImported ? ' template' : ''}.`);
      }

      await loadDetails(false);
      return (data.fundingCallId || linkedCallOverrideId || null) as string | null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save draft');
      return null;
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleExtractAll() {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }

    if (!id) {
      return;
    }

    setExtractingAll(true);
    try {
      const response = await fetch(`/api/admin/funding/intake/${id}/extract-all`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to run extract all');
      }

      toast.success(details?.job.input_type === 'json' ? 'JSON artifact import completed.' : 'Extract all completed.');
      if (data.guidelineExtractionError) {
        toast.error(`Guideline extraction warning: ${data.guidelineExtractionError}`);
      }
      if (data.templateExtractionError) {
        toast.error(`Template extraction warning: ${data.templateExtractionError}`);
      }
      if (data.jsonGuidelineImported || data.jsonTemplateImported) {
        toast.success(`Imported JSON artifacts:${data.jsonGuidelineImported ? ' guidelines' : ''}${data.jsonTemplateImported ? ' template' : ''}.`);
      }

      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run extract all');
    } finally {
      setExtractingAll(false);
    }
  }

  async function handleJobAction(action: 'retry' | 'cancel') {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }

    if (!id) {
      return;
    }

    const response = await fetch(`/api/admin/funding/intake/${id}/${action}`, {
      method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.message || `Failed to ${action} job`);
      return;
    }
    toast.success(`Job ${action}ed.`);
    await loadDetails(false);
  }

  async function handleRecoveryRetry(mode: 'same' | 'url' | 'text' | 'pdf') {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }

    if (!id) {
      return;
    }

    setRecoveryBusy(mode);
    try {
      let response: Response;
      if (mode === 'same') {
        response = await fetch(`/api/admin/funding/intake/${id}/retry`, { method: 'POST' });
      } else if (mode === 'pdf') {
        if (!recoverySourcePdf) {
          throw new Error('Choose a recovery PDF first.');
        }
        const formData = new FormData();
        formData.append('sourceMode', 'pdf');
        formData.append('file', recoverySourcePdf);
        response = await fetch(`/api/admin/funding/intake/${id}/retry`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(`/api/admin/funding/intake/${id}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'url'
              ? { sourceMode: 'url', sourceUrl: recoverySourceUrl }
              : { sourceMode: 'text', sourceText: recoverySourceText }
          ),
        });
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to restart call details extraction');
      }

      toast.success(mode === 'same' ? 'Retry started from the original source.' : 'Recovery extraction started from the alternate source.');
      setRecoverySourcePdf(null);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restart call details extraction');
    } finally {
      setRecoveryBusy(null);
    }
  }

  function scrollToCallBasics() {
    document.getElementById('call-basics')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleDeleteJob() {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }

    if (!id) {
      return;
    }

    if (
      !window.confirm(
        'Delete this intake job? Any unpublished draft, guideline, template, and uploaded intake artifacts created by this job will also be removed.'
      )
    ) {
      return;
    }

    setDeletingJob(true);
    try {
      const response = await fetch(`/api/admin/funding/intake/${id}/delete`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.reason === 'must_unpublish_first') {
          throw new Error('Archive the published call first, then delete this intake job.');
        }
        if (response.status === 409 && data.reason === 'cancel_before_delete') {
          throw new Error('Cancel the active job first, then delete it.');
        }
        throw new Error(data.message || 'Failed to delete intake job');
      }

      toast.success(data.deletedFundingCallId ? 'Intake job and linked unpublished call deleted.' : 'Intake job deleted.');
      await router.push('/admin/funding/intake');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete intake job');
    } finally {
      setDeletingJob(false);
    }
  }

  async function handleCallAction(action: 'publish' | 'archive' | 'reject') {
    if (!canPublishFunding) {
      toast.error('Funding publishing access required.');
      return;
    }

    if (!callId) {
      return;
    }

    if (
      action === 'publish' &&
      details?.publishWarnings?.length &&
      !window.confirm(
        `Publish with warnings?\n\n${details.publishWarnings.map((warning) => `- ${warning.message}`).join('\n')}`
      )
    ) {
      return;
    }

    setCallBusy(action);
    try {
      const response = await fetch(`/api/admin/funding/calls/${callId}/${action}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.requiredFieldsRemaining?.length) {
          throw new Error(`Missing publish fields: ${data.requiredFieldsRemaining.join(', ')}`);
        }
        throw new Error(data.message || `Failed to ${action} call`);
      }
      toast.success(`Funding call ${action}ed.`);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${action} call`);
    } finally {
      setCallBusy(null);
    }
  }

  if (isLoading || loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-600">Loading funding intake workspace...</div>;
  }

  if (!canReadFundingIntake || !details) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-600">This funding intake job is not available.</p>
          <Link href="/admin/funding/intake" className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Back to Intake
          </Link>
        </div>
      </div>
    );
  }

  const extractedFields = details.extraction?.extracted_json?.fields || {};
  const guidelineSummary = details.guidelines?.guideline?.summary_json;
  const templateCounts = getTemplateCounts(details.template?.template?.grant_template_json);
  const callBasicsFieldKeys = new Set(['agency_name', 'scheme_title', 'description', 'open_date', 'close_date', 'official_urls']);
  const callBasicsFields = FUNDING_FIELD_DEFINITIONS.filter((field) => callBasicsFieldKeys.has(field.key));
  const secondaryFieldGroups = [
    {
      title: 'Eligibility and Fit',
      description: 'Fields used for search filters, matching, and applicant fit.',
      keys: [
        'geography_scope',
        'eligible_countries',
        'eligible_regions',
        'host_countries',
        'funder_country',
        'funding_kinds',
        'institution_types',
        'career_stages',
        'citizenship_requirements',
        'residency_requirements',
        'application_languages',
        'disciplines',
        'sponsor_type',
      ],
    },
    {
      title: 'Funding and Timing',
      description: 'Amounts, duration, rolling status, and currency fields.',
      keys: [
        'is_rolling',
        'amount_min',
        'amount_max',
        'currency',
        'project_duration_min_months',
        'project_duration_max_months',
        'project_duration_text',
      ],
    },
    {
      title: 'Application Text and Contact',
      description: 'Long-form eligibility, deliverables, and contact notes.',
      keys: ['eligibility_text', 'expected_deliverables_text', 'contact_info'],
    },
  ];

  function renderFundingField(field: (typeof FUNDING_FIELD_DEFINITIONS)[number]) {
    const extracted = extractedFields[field.key];
    const currentValue = draftValues[field.key];
    const evidenceLines = formatEvidenceAnchors(extracted?.evidence);
    const statusTone = extracted?.status === 'supported'
      ? 'bg-emerald-50 text-emerald-700'
      : extracted?.status === 'ambiguous'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-100 text-slate-600';

    return (
      <div key={field.key} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{field.label}</h3>
            <p className="mt-1 text-xs text-slate-500">{field.description || field.key}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {field.requiredForDraft && (
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-rose-700">
                required
              </span>
            )}
            {extracted?.status && (
              <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${statusTone}`}>
                {extracted.status}
              </span>
            )}
            {typeof extracted?.confidence === 'number' && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                {Math.round(extracted.confidence * 100)}% confidence
              </span>
            )}
          </div>
        </div>
        {field.type === 'textarea' ? (
          <textarea
            value={String(currentValue || '')}
            onChange={(event) => updateDraftValue(field.key, event.target.value)}
            rows={field.requiredForDraft ? 6 : 4}
            disabled={!canWriteFundingIntake}
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"
          />
        ) : field.type === 'number' ? (
          <input
            type="number"
            value={currentValue ?? ''}
            onChange={(event) => updateDraftValue(field.key, event.target.value === '' ? null : Number(event.target.value))}
            disabled={!canWriteFundingIntake}
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"
          />
        ) : field.type === 'date' ? (
          <input
            type="date"
            value={currentValue || ''}
            onChange={(event) => updateDraftValue(field.key, event.target.value || null)}
            disabled={!canWriteFundingIntake}
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"
          />
        ) : field.type === 'boolean' ? (
          <label className="mt-4 inline-flex items-center gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(currentValue)}
              onChange={(event) => updateDraftValue(field.key, event.target.checked)}
              disabled={!canWriteFundingIntake}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            True
          </label>
        ) : field.type === 'array' ? (
          <div className="mt-4 space-y-3">
            {field.suggestions && field.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {field.suggestions.map((option) => {
                  const selectedValues = Array.isArray(currentValue) ? currentValue.map((item) => String(item)) : [];
                  const selected = selectedValues.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => updateDraftValue(field.key, toggleArrayValue(currentValue, option))}
                      disabled={!canWriteFundingIntake}
                      className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                        selected ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              value={Array.isArray(currentValue) ? currentValue.join('\n') : ''}
              onChange={(event) => updateDraftValue(field.key, toTextArray(event.target.value))}
              rows={4}
              disabled={!canWriteFundingIntake}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"
              placeholder={field.placeholder}
            />
          </div>
        ) : (
          <input
            type={NUMERIC_FIELD_KEYS.has(field.key as any) ? 'number' : BOOLEAN_FIELD_KEYS.has(field.key as any) ? 'text' : 'text'}
            value={Array.isArray(currentValue) ? currentValue.join(', ') : currentValue ?? ''}
            onChange={(event) => updateDraftValue(field.key, event.target.value)}
            disabled={!canWriteFundingIntake}
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"
            placeholder={field.placeholder}
          />
        )}

        {evidenceLines.length > 0 && (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            Evidence: {evidenceLines.join(' | ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>Funding Intake Workspace</title>
      </Head>
      <Header />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FundingWorkspaceTabs
          current="call"
          callHref={`/admin/funding/intake/${details.job.id}`}
          guidelinesHref={callId ? `/admin/funding/catalog/${callId}/guidelines` : null}
          templateHref={callId ? `/admin/funding/catalog/${callId}/template` : null}
          documentsHref={callId ? `/admin/funding/catalog/${callId}/documents` : null}
          guidelineStatus={details.call?.guideline_status || null}
          templateStatus={details.call?.template_status || null}
        />

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Step 1 of 4 · Call Details</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Intake Job {details.job.id}</h1>
            <p className="mt-3 text-sm text-slate-600">
              Source: {details.job.input_type.toUpperCase()} | Status: {details.job.status.replace(/_/g, ' ')} | Submitted by {details.submitter?.email || 'unknown'}
            </p>
            {!canWriteFundingIntake && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Viewer access is read-only. Funding operations access is required for intake edits, and publishing access is required for publish/archive actions.
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            {isCallBasicsLlmInProcess && (
              <div
                role="status"
                aria-live="polite"
                className="w-full rounded-2xl border-2 border-red-600 bg-red-50 p-4 text-red-900 shadow-sm lg:min-w-[34rem]"
              >
                <div className="flex items-start gap-3">
                  <span className="relative mt-1 flex h-3 w-3 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700">In Progress</div>
                    <div className="mt-1 text-sm font-semibold text-red-950">
                      The AI is reading the source and filling in the call details.
                    </div>
                    <div className="mt-1 text-xs text-red-800">
                      Stage: {(details.job.processing_phase || details.job.status).replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Navigation</div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/funding/intake" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                  Back to Intake
                </Link>
                {callId && (
                  <>
                    <Link href={`/admin/funding/catalog/${callId}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                      Open Catalog Record
                    </Link>
                    <Link href={`/admin/funding/catalog/${callId}/guidelines`} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
                      Open Guidelines
                    </Link>
                    <Link href={`/admin/funding/catalog/${callId}/template`} className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900">
                      Open Template
                    </Link>
                  </>
                )}
              </div>
            </div>

            {(isActiveJob || !isPublishedLinkedCall || (callId && isPublishedLinkedCall)) && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">Danger Zone</div>
                <div className="flex flex-wrap gap-2">
                  {callId && isPublishedLinkedCall && (
                    <button
                      type="button"
                      onClick={() => handleCallAction('archive')}
                      disabled={!canPublishFunding || callBusy !== null}
                      className="rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callBusy === 'archive' ? 'Archiving...' : 'Archive Published Call'}
                    </button>
                  )}
                  {['queued', 'fetching', 'extracting'].includes(details.job.status) && (
                    <button
                      type="button"
                      onClick={() => handleJobAction('cancel')}
                      disabled={!canWriteFundingIntake}
                      className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel Active Job
                    </button>
                  )}
                  {!isActiveJob && !isPublishedLinkedCall && (
                    <button
                      type="button"
                      onClick={handleDeleteJob}
                      disabled={!canWriteFundingIntake || deletingJob}
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingJob ? 'Deleting...' : 'Delete Intake Job'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {isPublishedLinkedCall && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            This intake job is linked to a published funding call. Archive the call first, then delete the intake job.
          </div>
        )}
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          Ingesting a call has three main parts — Call Details, Guidelines, and Template — and each runs on its own. Once a draft call exists, you can work on any step in any order; you never have to wait for one to finish before starting another.
        </div>
        {(isActiveJob || activeGuidelineRuns.length > 0 || activeTemplateRuns.length > 0) && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="font-semibold">Call details</div>
              <div className="mt-1">{isActiveJob ? `AI is working (${(details.job.processing_phase || details.job.status).replace(/_/g, ' ')})` : 'Nothing running right now'}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">Guidelines</div>
              <div className="mt-1">{activeGuidelineRuns.length > 0 ? `AI is working (${activeGuidelineRuns.length} extraction${activeGuidelineRuns.length === 1 ? '' : 's'} in progress)` : 'Nothing running right now'}</div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <div className="font-semibold">Template</div>
              <div className="mt-1">{activeTemplateRuns.length > 0 ? `AI is working (${activeTemplateRuns.length} extraction${activeTemplateRuns.length === 1 ? '' : 's'} in progress)` : 'Nothing running right now'}</div>
            </div>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Progress Checkpoints</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Where this call stands</h2>
            <p className="mt-1 text-sm text-slate-600">Four quick checkpoints: can it be published, is it ready for applicants to draft with, and how far along Guidelines and Template are.</p>
          </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-300">Ready to publish?</div>
            <div className="mt-2 text-2xl font-semibold">{details.publishReadiness?.ready ? 'Yes' : 'Not yet'}</div>
            {!details.publishReadiness?.ready && <div className="mt-1 text-xs text-slate-300">Some required fields are still empty</div>}
          </div>
          <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-900 shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-700">Ready for drafting?</div>
            <div className="mt-2 text-2xl font-semibold">{details.draftingReadiness.ready ? 'Yes' : 'Not yet'}</div>
            {!details.draftingReadiness.ready && <div className="mt-1 text-xs text-emerald-800">Needs approved guidelines and template</div>}
          </div>
          <div className="rounded-2xl bg-amber-50 p-5 text-amber-900 shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-amber-700">Guidelines</div>
            <div className="mt-2 text-2xl font-semibold">{stepStatusLabel(details.call?.guideline_status)}</div>
          </div>
          <div className="rounded-2xl bg-sky-50 p-5 text-sky-900 shadow-sm">
            <div className="text-xs uppercase tracking-[0.18em] text-sky-700">Template</div>
            <div className="mt-2 text-2xl font-semibold">{stepStatusLabel(details.call?.template_status)}</div>
          </div>
        </div>
        </section>

        {details.job.status === 'failed' && (
          <section className="mt-8 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Something went wrong</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">The AI could not read the call details</h2>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  You have three options: retry with the same source, try again with a cleaner URL, text, or PDF, or skip the AI and type the required fields in yourself below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRecoveryRetry('same')}
                disabled={!canWriteFundingIntake || recoveryBusy !== null}
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recoveryBusy === 'same' ? 'Retrying...' : 'Retry Same Source'}
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <div className="font-medium">{formatJobErrorCode(details.job.error_code)}</div>
              <div className="mt-2">{details.job.error_message || 'No extra error details were recorded.'}</div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[16rem,minmax(0,1fr)]">
              <div className="space-y-2">
                {(['text', 'url', 'pdf'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRecoveryMode(mode)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium ${
                      recoveryMode === mode
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    Rerun From {mode.toUpperCase()}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={scrollToCallBasics}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-900"
                >
                  Fill In Fields Manually
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 p-5">
                {recoveryMode === 'url' ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Alternate funding opportunity URL</span>
                    <input
                      value={recoverySourceUrl}
                      onChange={(event) => setRecoverySourceUrl(event.target.value)}
                      disabled={!canWriteFundingIntake}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                      placeholder="https://agency.example.org/funding/call"
                    />
                  </label>
                ) : recoveryMode === 'text' ? (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Alternate call text</span>
                    <textarea
                      value={recoverySourceText}
                      onChange={(event) => setRecoverySourceText(event.target.value)}
                      rows={8}
                      disabled={!canWriteFundingIntake}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                      placeholder="Paste clean call announcement text here"
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Alternate PDF</span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(event) => setRecoverySourcePdf(event.target.files?.[0] || null)}
                      disabled={!canWriteFundingIntake}
                      className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                    />
                    <span className="mt-2 block text-xs text-slate-500">{recoverySourcePdf ? recoverySourcePdf.name : 'PDF recovery uses the same intake upload checks.'}</span>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => void handleRecoveryRetry(recoveryMode)}
                  disabled={!canWriteFundingIntake || recoveryBusy !== null}
                  className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recoveryBusy === recoveryMode ? 'Starting Recovery...' : `Rerun From ${recoveryMode.toUpperCase()}`}
                </button>
              </div>
            </div>
          </section>
        )}

        <section id="call-basics" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Required Fields</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Check the call basics</h2>
              <p className="mt-1 text-sm text-slate-600">
                Confirm the agency name, scheme title, and description — these three must be filled in before a draft can be saved. If the AI failed, you can type them in yourself.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Save</div>
              <div className="flex flex-wrap gap-2">
                {details.job.input_type === 'json' ? (
                  <button
                    type="button"
                    onClick={() => handleSaveDraft(true)}
                    disabled={!canWriteFundingIntake || savingDraft || !canSaveDraftFromCurrentStatus}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingDraft ? 'Saving & importing...' : 'Save Call & Import Guidelines + Template'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(false)}
                      disabled={!canWriteFundingIntake || savingDraft || !canSaveDraftFromCurrentStatus}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingDraft ? 'Saving...' : 'Save Draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(true)}
                      disabled={!canWriteFundingIntake || savingDraft || !canSaveDraftFromCurrentStatus}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingDraft ? 'Saving...' : 'Save Draft + Run AI Extraction'}
                    </button>
                  </>
                )}
              </div>
              {details.job.input_type === 'json' && !callId && (
                <p className="mt-2 max-w-xs text-xs text-slate-500">
                  One click saves the call and imports the guidelines and template parsed from your uploaded file.
                </p>
              )}
            </div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {callBasicsFields.map((field) => renderFundingField(field))}
          </div>
        </section>

        {(details.duplicates.length > 0 || (details.domainDuplicates && details.domainDuplicates.length > 0)) && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Duplicate Review</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Resolve possible duplicate calls</h2>
              <p className="mt-1 text-sm text-slate-600">Choose how to handle each candidate before saving a new draft.</p>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                {details.duplicates.map((duplicate) => (
                  <div key={duplicate.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{duplicate.candidate?.scheme_title || 'Existing funding call'}</div>
                        <div className="mt-1 text-sm text-slate-600">{duplicate.candidate?.agency_name || 'Unknown agency'}</div>
                        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {duplicate.match_type.replace(/_/g, ' ')} | {Math.round(duplicate.match_score * 100)}% match
                        </div>
                      </div>
                      <select
                        value={duplicateResolutions[duplicate.id] || 'pending'}
                        onChange={(event) =>
                          setDuplicateResolutions((current) => ({
                            ...current,
                            [duplicate.id]: event.target.value,
                          }))
                        }
                        disabled={!canWriteFundingIntake}
                        className="w-full max-w-xs rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="pending">Pending</option>
                        <option value="ignored">Ignore candidate</option>
                        <option value="create_new_anyway">Create new anyway</option>
                        <option value="merged_to_existing">Use existing funding call</option>
                      </select>
                    </div>
                  </div>
                ))}
                {details.duplicates.length === 0 && (
                  <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">No blocking duplicate candidates were detected.</div>
                )}
              </div>

              <div className="space-y-3">
                {(details.domainDuplicates || []).map((duplicate) => (
                  <div key={duplicate.candidate_funding_call_id} className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{duplicate.candidate.scheme_title}</div>
                    <div className="mt-1">{duplicate.candidate.agency_name}</div>
                    <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                      {duplicate.source_domain} | {Math.round(duplicate.match_score * 100)}% | {duplicate.strong_similarity ? 'strong' : 'review'}
                    </div>
                  </div>
                ))}
                {(!details.domainDuplicates || details.domainDuplicates.length === 0) && (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No same-domain matches.</div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Optional Details</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Add search and matching details</h2>
            <p className="mt-1 text-sm text-slate-600">Optional but recommended — these fields help researchers find this call and improve the quality of AI-assisted drafting.</p>
          </div>
          <div className="mt-6 space-y-4">
            {secondaryFieldGroups.map((group) => {
              const groupFields = FUNDING_FIELD_DEFINITIONS.filter((field) => group.keys.includes(field.key));
              return (
                <details key={group.title} className="rounded-2xl border border-slate-200 p-5" open={group.title === 'Eligibility and Fit'}>
                  <summary className="cursor-pointer text-base font-semibold text-slate-900">
                    {group.title}
                    <span className="ml-3 text-sm font-normal text-slate-500">{group.description}</span>
                  </summary>
                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {groupFields.map((field) => renderFundingField(field))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next Steps</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Steps 2 &amp; 3 · Guidelines and Template</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Guidelines (the rules applicants must follow) and Template (the application form structure) each have their own workspace. Open them once the call draft is saved.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {callId ? (
                <>
                  <Link href={`/admin/funding/catalog/${callId}/guidelines`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
                    Open Guidelines
                  </Link>
                  <Link href={`/admin/funding/catalog/${callId}/template`} className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900">
                    Open Template
                  </Link>
                  <button
                    type="button"
                    onClick={handleExtractAll}
                    disabled={!canWriteFundingIntake || extractingAll}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {extractingAll
                      ? 'Running...'
                      : details.job.input_type === 'json'
                        ? 'Re-run Import From File'
                        : 'Re-run AI Extraction (Guidelines + Template)'}
                  </button>
                </>
              ) : (
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Save the call draft first — that unlocks the Guidelines and Template steps.</div>
              )}
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-amber-700">Guidelines</div>
              <div className="mt-2 text-2xl font-semibold text-amber-950">{stepStatusLabel(details.call?.guideline_status)}</div>
              <div className="mt-3 text-sm text-amber-900">AI extractions so far: {(details.guidelines?.runs || []).length}</div>
              <div className="mt-1 text-sm text-amber-900">Rules captured: {guidelineSummary?.totalRules || 0}</div>
              {!callId && jsonArtifactPreview?.hasGuidelines && (
                <div className="mt-3 rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-sm font-medium text-amber-950">
                  {jsonArtifactPreview.guidelineRuleCount} guideline rules parsed from your file — they will be imported when you save the call.
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-sky-700">Template</div>
              <div className="mt-2 text-2xl font-semibold text-sky-950">{stepStatusLabel(details.call?.template_status)}</div>
              <div className="mt-3 text-sm text-sky-900">Sources added: {(details.template?.assets || []).length}</div>
              <div className="mt-1 text-sm text-sky-900">Template items: {templateCounts.questions + templateCounts.sections + templateCounts.attachments + templateCounts.evaluationCriteria + templateCounts.submissionRules + templateCounts.budget}</div>
              {!callId && jsonArtifactPreview?.hasTemplate && (
                <div className="mt-3 rounded-xl border border-sky-300 bg-white/70 px-3 py-2 text-sm font-medium text-sky-950">
                  {jsonArtifactPreview.templateItemCount} template items parsed from your file — they will be imported when you save the call.
                </div>
              )}
              {!callId && details.job.input_type === 'json' && !jsonArtifactPreview?.hasTemplate && (
                <div className="mt-3 text-xs text-sky-800">
                  Your file did not include a template — add one later in the Template workspace.
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-8 space-y-8">

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Final step · Publish</h2>
                <p className="mt-1 text-sm text-slate-600">Publishing makes this call visible to researchers. You can publish even if Guidelines or Template are not approved yet — you will just see a warning, not a block. The two readiness checks below tell you exactly what is missing.</p>
              </div>
              <div className="flex flex-col gap-3 lg:items-end">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Publishing</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCallAction('publish')}
                      disabled={!canPublishFunding || !callId || callBusy !== null || !details.publishReadiness?.ready}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callBusy === 'publish' ? 'Publishing...' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCallAction('archive')}
                      disabled={!canPublishFunding || !callId || callBusy !== null}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callBusy === 'archive' ? 'Archiving...' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCallAction('reject')}
                      disabled={!canPublishFunding || !callId || callBusy !== null}
                      className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callBusy === 'reject' ? 'Rejecting...' : 'Reject'}
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Navigation</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/admin/funding/intake"
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      Back to Intake Dashboard
                    </Link>
                    <Link
                      href="/admin/funding/intake#submit-intake-source"
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800"
                    >
                      Initiate Another Call
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {!callId ? (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Save the call draft first — publishing becomes available after that.</div>
            ) : (
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
                <div className="space-y-4">
                  <div className={`rounded-xl border p-4 ${details.publishReadiness?.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-600">Checkpoint 1 · Can this be published?</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{details.publishReadiness?.ready ? 'Yes — all required fields are filled in' : 'Not yet — some required fields are empty'}</div>
                    {!details.publishReadiness?.ready && (details.publishReadiness?.missingFields?.length || 0) > 0 && (
                      <div className="mt-3 text-sm text-slate-700">Still needed: {details.publishReadiness?.missingFields?.join(', ')}</div>
                    )}
                  </div>

                  <div className={`rounded-xl border p-4 ${details.draftingReadiness.ready ? 'border-emerald-200 bg-emerald-50' : 'border-sky-200 bg-sky-50'}`}>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-600">Checkpoint 2 · Can researchers draft with it?</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{details.draftingReadiness.ready ? 'Yes — fully ready for drafting' : `Not fully (mode: ${details.draftingReadiness.mode.replace(/_/g, ' ')})`}</div>
                    <div className="mt-3 space-y-1 text-sm text-slate-700">
                      {details.draftingReadiness.issues.length === 0 ? (
                        <div>Approved guidelines and an approved template are both in place.</div>
                      ) : (
                        details.draftingReadiness.issues.map((issue) => <div key={issue}>- {issue}</div>)
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Warnings (do not block publishing)</div>
                  <div className="mt-3 space-y-3">
                    {details.publishWarnings.length === 0 ? (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">No warnings — everything looks good.</div>
                    ) : (
                      details.publishWarnings.map((warning) => (
                        <div key={warning.code} className="rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900">
                          <div className="font-medium text-amber-950">{warning.code.replace(/_/g, ' ')}</div>
                          <div className="mt-1">{warning.message}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-5 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Call: {details.call?.status || 'DRAFT'} | Guidelines: {stepStatusLabel(details.call?.guideline_status)} | Template: {stepStatusLabel(details.call?.template_status)} | Search index: {(details.call?.embedding_status || 'not_generated').replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            )}

            <details className="mt-5 rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Recent activity</summary>
              <div className="mt-3 space-y-2">
                {details.events.length === 0 ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No activity recorded yet.</div>
                ) : (
                  details.events.slice(-15).reverse().map((event) => (
                    <div key={event.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{event.event_type.replace(/_/g, ' ')}</span>
                        <span className="text-slate-400">{new Date(event.created_at).toLocaleString()}</span>
                      </div>
                      <div className="mt-1">{event.message || `${event.previous_status || 'none'} -> ${event.next_status}`}</div>
                    </div>
                  ))
                )}
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  return {
    props: {},
  };
}
