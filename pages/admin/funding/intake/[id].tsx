import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import Header from '@/components/Header';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import { createEmptyGuidelinePack, normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils';
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types';
import { createEmptyGrantTemplate, normalizeGrantTemplate } from '@/lib/fundingTemplates/utils';
import type { GrantTemplateDocument } from '@/lib/fundingTemplates/types';
import { FUNDING_FIELD_DEFINITIONS, BOOLEAN_FIELD_KEYS, NUMERIC_FIELD_KEYS } from '@/lib/fundingIntake/constants';

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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  return new Date(value).toLocaleString();
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

function readAssetMetadata(value: Record<string, any> | null | undefined) {
  return value && typeof value === 'object' ? value : {};
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

function SpinnerIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function LlmWaitingNotice(props: {
  title: string;
  description: string;
  accent?: 'slate' | 'amber' | 'sky';
}) {
  const accentClasses = props.accent === 'amber'
    ? {
        border: 'border-amber-200',
        bg: 'bg-amber-50',
        text: 'text-amber-900',
        spinner: 'text-amber-700',
        dot: 'bg-amber-500',
      }
    : props.accent === 'sky'
      ? {
          border: 'border-sky-200',
          bg: 'bg-sky-50',
          text: 'text-sky-900',
          spinner: 'text-sky-700',
          dot: 'bg-sky-500',
        }
      : {
          border: 'border-slate-200',
          bg: 'bg-slate-50',
          text: 'text-slate-900',
          spinner: 'text-slate-700',
          dot: 'bg-slate-500',
        };

  return (
    <div className={`rounded-2xl border ${accentClasses.border} ${accentClasses.bg} p-4`}>
      <div className="flex items-start gap-3">
        <SpinnerIcon className={`mt-0.5 h-5 w-5 ${accentClasses.spinner}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${accentClasses.text}`}>{props.title}</div>
          <div className="mt-1 text-sm text-slate-600">{props.description}</div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${accentClasses.dot} animate-bounce`} />
            <span className={`h-2.5 w-2.5 rounded-full ${accentClasses.dot} animate-bounce [animation-delay:120ms]`} />
            <span className={`h-2.5 w-2.5 rounded-full ${accentClasses.dot} animate-bounce [animation-delay:240ms]`} />
            <span className="ml-2 text-xs uppercase tracking-[0.18em] text-slate-500">Waiting for model response</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FundingIntakeJobPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, any>>({});
  const [duplicateResolutions, setDuplicateResolutions] = useState<Record<string, string>>({});
  const [linkedCallOverrideId, setLinkedCallOverrideId] = useState<string | null>(null);
  const [guidelineJsonText, setGuidelineJsonText] = useState('');
  const [guidelineSourceMode, setGuidelineSourceMode] = useState<'intake' | 'url' | 'text' | 'pdf'>('intake');
  const [guidelineSourceUrl, setGuidelineSourceUrl] = useState('');
  const [guidelineSourceText, setGuidelineSourceText] = useState('');
  const [guidelineSourcePdf, setGuidelineSourcePdf] = useState<File | null>(null);
  const [templateJsonText, setTemplateJsonText] = useState('');
  const [templateSourceType, setTemplateSourceType] = useState<'url' | 'text'>('url');
  const [templateSourceUrl, setTemplateSourceUrl] = useState('');
  const [templateSourceText, setTemplateSourceText] = useState('');
  const [selectedTemplateAssetIds, setSelectedTemplateAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [extractingAll, setExtractingAll] = useState(false);
  const [guidelineBusy, setGuidelineBusy] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
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
  const canAutoCreateDraft = useMemo(
    () =>
      Boolean(
        details &&
        !callId &&
        ['needs_review', 'draft_created', 'failed'].includes(details.job.status) &&
        !hasPendingDuplicates &&
        hasDraftMinimumFields(draftValues)
      ),
    [callId, details, draftValues, hasPendingDuplicates]
  );
  const canWorkOnGuidelines = canWriteFundingIntake && Boolean(callId || canAutoCreateDraft);
  const canWorkOnTemplates = canWriteFundingIntake && Boolean(callId || canAutoCreateDraft);
  const canSaveDraftFromCurrentStatus = Boolean(
    details && ['needs_review', 'draft_created', 'failed'].includes(details.job.status)
  );
  const intakeTemplateAssetIds = useMemo(
    () =>
      (details?.template?.assets || [])
        .filter((asset) => {
          const metadata = readAssetMetadata(asset.source_metadata_json);
          return metadata.auto_managed === true && metadata.intake_job_id === details?.job.id;
        })
        .map((asset) => asset.id),
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
      setGuidelineJsonText(JSON.stringify(data.guidelines?.guideline?.guideline_pack_json || createEmptyGuidelinePack(), null, 2));
      setTemplateJsonText(JSON.stringify(data.template?.template?.grant_template_json || createEmptyGrantTemplate(), null, 2));
      setSelectedTemplateAssetIds((data.template?.assets || []).map((asset: { id: string }) => asset.id));
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

  async function ensureDraftExists() {
    if (!canWriteFundingIntake) {
      throw new Error('Write access required. You have viewer-only access.');
    }

    if (callId) {
      return callId;
    }

    if (!id) {
      throw new Error('Invalid intake job id');
    }

    if (!hasDraftMinimumFields(draftValues)) {
      throw new Error('Complete agency name, scheme title, and description first.');
    }

    if (hasPendingDuplicates) {
      throw new Error('Resolve duplicate candidates before continuing.');
    }

    setSavingDraft(true);
    try {
      const response = await fetch(`/api/admin/funding/intake/${id}/create-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draftValues,
          extractAll: false,
          duplicateResolutions: Object.entries(duplicateResolutions).map(([duplicateId, resolution]) => ({
            duplicateId,
            resolution,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.requiredFieldsRemaining?.length) {
          throw new Error(`Missing required fields: ${data.requiredFieldsRemaining.join(', ')}`);
        }
        throw new Error(data.message || 'Failed to create working draft');
      }

      if (!data.fundingCallId) {
        throw new Error('Working draft was created without a funding call id');
      }

      setLinkedCallOverrideId(data.fundingCallId);
      setDetails((current) =>
        current
          ? {
              ...current,
              job: {
                ...current.job,
                linked_funding_call_id: data.fundingCallId,
                status: 'draft_created',
              },
            }
          : current
      );
      await loadDetails(false);
      return data.fundingCallId as string;
    } finally {
      setSavingDraft(false);
    }
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

  async function handleSaveDraftAndOpen(target: 'guidelines' | 'template') {
    try {
      const activeCallId = callId || await handleSaveDraft(false);
      if (!activeCallId) {
        return;
      }

      await router.push(
        target === 'guidelines'
          ? `/admin/funding/catalog/${activeCallId}/guidelines`
          : `/admin/funding/catalog/${activeCallId}/template`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to open ${target} workspace`);
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

  async function handleGuidelineSave() {
    setGuidelineBusy('save');
    try {
      const activeCallId = await ensureDraftExists();
      const guidelinePack = normalizeGuidelinePack(JSON.parse(guidelineJsonText));
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/guidelines`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guideline_pack_json: guidelinePack,
          changeNotes: 'Updated from unified intake workspace',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save guidelines');
      }
      toast.success('Guidelines saved.');
      setGuidelineJsonText(JSON.stringify(data.guideline?.guideline_pack_json || guidelinePack, null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save guidelines');
    } finally {
      setGuidelineBusy(null);
    }
  }

  async function handleGuidelineApprove() {
    setGuidelineBusy('approve');
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/guidelines/approve`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to approve guidelines');
      }
      toast.success('Guidelines approved.');
      setGuidelineJsonText(JSON.stringify(data.guideline?.guideline_pack_json || createEmptyGuidelinePack(), null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve guidelines');
    } finally {
      setGuidelineBusy(null);
    }
  }

  async function handleGuidelineExtract() {
    setGuidelineBusy('extract');
    try {
      const activeCallId = await ensureDraftExists();
      const response = await (async () => {
        if (guidelineSourceMode === 'pdf') {
          if (!guidelineSourcePdf) {
            throw new Error('Choose a PDF guideline source first.');
          }

          const formData = new FormData();
          formData.append('file', guidelineSourcePdf);
          return fetch(`/api/admin/funding/calls/${activeCallId}/guidelines/extract`, {
            method: 'POST',
            body: formData,
          });
        }

        const payload = guidelineSourceMode === 'url'
          ? { sourceMode: 'url', sourceUrl: guidelineSourceUrl }
          : guidelineSourceMode === 'text'
            ? { sourceMode: 'text', sourceText: guidelineSourceText }
            : { sourceMode: 'intake' };

        return fetch(`/api/admin/funding/calls/${activeCallId}/guidelines/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      })();
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to re-extract guidelines');
      }
      toast.success(`Guideline extraction run ${data.run?.status || 'created'}.`);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to re-extract guidelines');
    } finally {
      setGuidelineBusy(null);
    }
  }

  async function handleGuidelineRevert(revisionNo: number) {
    setGuidelineBusy(`revert-${revisionNo}`);
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/guidelines/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionNo,
          changeNotes: `Reverted from unified intake workspace to guideline revision ${revisionNo}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to revert guidelines');
      }
      toast.success(`Guidelines reverted to revision ${revisionNo}.`);
      setGuidelineJsonText(JSON.stringify(data.guideline?.guideline_pack_json || createEmptyGuidelinePack(), null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revert guidelines');
    } finally {
      setGuidelineBusy(null);
    }
  }

  async function handleTemplateSave() {
    setTemplateBusy('save');
    try {
      const activeCallId = await ensureDraftExists();
      const template = normalizeGrantTemplate(JSON.parse(templateJsonText));
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_template_json: template,
          changeNotes: 'Updated from unified intake workspace',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save template');
      }
      toast.success('Template saved.');
      setTemplateJsonText(JSON.stringify(data.template?.grant_template_json || template, null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateApprove() {
    setTemplateBusy('approve');
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/approve`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to approve template');
      }
      toast.success('Template approved.');
      setTemplateJsonText(JSON.stringify(data.template?.grant_template_json || createEmptyGrantTemplate(), null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve template');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateExtract() {
    setTemplateBusy('extract');
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetIds: selectedTemplateAssetIds.length > 0 ? selectedTemplateAssetIds : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to run template extraction');
      }
      toast.success(`Template extraction run ${data.run?.status || 'created'}.`);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run template extraction');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateApplyRun(runId: string) {
    setTemplateBusy(`apply-${runId}`);
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/runs/${runId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'replace' }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to apply template extraction run');
      }
      toast.success('Latest extraction is now the current template.');
      setTemplateJsonText(JSON.stringify(data.template?.grant_template_json || createEmptyGrantTemplate(), null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply template extraction run');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateRevert(revisionNo: number) {
    setTemplateBusy(`revert-${revisionNo}`);
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionNo,
          changeNotes: `Reverted from unified intake workspace to template revision ${revisionNo}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to revert template');
      }
      toast.success(`Template reverted to revision ${revisionNo}.`);
      setTemplateJsonText(JSON.stringify(data.template?.grant_template_json || createEmptyGrantTemplate(), null, 2));
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revert template');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateDeleteAsset(assetId: string) {
    setTemplateBusy(`delete-${assetId}`);
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/assets/${assetId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete template asset');
      }
      toast.success('Template asset deleted.');
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete template asset');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateAddSource() {
    setTemplateBusy('add-source');
    try {
      const activeCallId = await ensureDraftExists();
      const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          templateSourceType === 'url'
            ? { sourceType: 'url', sourceUrl: templateSourceUrl }
            : { sourceType: 'text', sourceText: templateSourceText }
        ),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to add template source');
      }
      toast.success('Template source added.');
      setTemplateSourceUrl('');
      setTemplateSourceText('');
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add template source');
    } finally {
      setTemplateBusy(null);
    }
  }

  async function handleTemplateFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }

    setTemplateBusy('upload');
    try {
      const activeCallId = await ensureDraftExists();
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`/api/admin/funding/calls/${activeCallId}/template/assets`, {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || `Failed to upload ${file.name}`);
        }
      }

      toast.success(`Uploaded ${files.length} template asset${files.length === 1 ? '' : 's'} in order.`);
      await loadDetails(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload template assets');
    } finally {
      event.target.value = '';
      setTemplateBusy(null);
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
  const extractionWarnings = details.extraction?.warnings_json || details.extraction?.extracted_json?.warnings || [];
  const guidelineSummary = details.guidelines?.guideline?.summary_json;
  const templateCounts = getTemplateCounts(details.template?.template?.grant_template_json);
  const templateConflicts = details.template?.template?.compatibility_json?.conflicts || [];
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
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Draft</div>
              <div className="flex flex-wrap gap-2">
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
                  {savingDraft ? 'Saving...' : details.job.input_type === 'json' ? 'Save Draft + Import JSON' : 'Save Draft + Extract All'}
                </button>
                <button
                  type="button"
                  onClick={handleExtractAll}
                  disabled={!canWriteFundingIntake || extractingAll || !callId}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {extractingAll ? 'Running...' : details.job.input_type === 'json' ? 'Import JSON Artifacts' : 'Extract All From Source'}
                </button>
              </div>
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
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-sky-700">Template</div>
              <div className="mt-2 text-2xl font-semibold text-sky-950">{stepStatusLabel(details.call?.template_status)}</div>
              <div className="mt-3 text-sm text-sky-900">Sources added: {(details.template?.assets || []).length}</div>
              <div className="mt-1 text-sm text-sky-900">Template items: {templateCounts.questions + templateCounts.sections + templateCounts.attachments + templateCounts.evaluationCriteria + templateCounts.submissionRules + templateCounts.budget}</div>
            </div>
          </div>
        </section>

        <div className="mt-8 space-y-8">
          {details && ((details) => false && (
            <div className="hidden">
            <>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Source and extraction</h2>
                <p className="mt-1 text-sm text-slate-600">Canonical source text for this intake job. URL, text, PDF, and JSON all feed the same review workspace. Guideline and template-specific extraction happens in the dedicated tabs or from the uploaded JSON artifacts.</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Latest extraction: {formatDateTime(details.extraction?.created_at)}
              </div>
            </div>

            {extractionWarnings.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-medium">Extraction warnings</div>
                <ul className="mt-2 space-y-1">
                  {extractionWarnings.map((warning: string) => (
                    <li key={warning}>- {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr),22rem]">
              <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {details.job.source_url && <p className="mb-3 break-all font-medium text-slate-900">{details.job.source_url}</p>}
                {details.job.source_file_path && <p className="mb-3 break-all font-medium text-slate-900">Stored PDF: {details.job.source_file_path}</p>}
                <div className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap">
                  {(details.job.raw_text || details.job.normalized_text || 'No source text captured yet.').slice(0, 16000)}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Lifecycle</div>
                  <div className="mt-2 text-sm text-slate-700">Duplicate status: {details.job.duplicate_status.replace(/_/g, ' ')}</div>
                  <div className="mt-2 text-sm text-slate-700">Linked call: {callId || 'Not saved yet'}</div>
                </div>
                {callId && (
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Extraction actions</div>
                    <p className="mt-2 text-sm text-slate-600">
                      {details.job.input_type === 'json'
                        ? 'Import guideline and template artifacts from the uploaded JSON, or move into the tabs to edit them directly.'
                        : 'Run the full downstream pipeline from this original source, or move into the Guidelines and Template tabs to run those extractions separately with the intake source or override sources.'}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleExtractAll}
                        disabled={!canWriteFundingIntake || extractingAll}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {extractingAll ? 'Running...' : details.job.input_type === 'json' ? 'Import JSON Artifacts' : 'Extract All From Source'}
                      </button>
                      <span className="text-xs text-slate-500">Use the tabs above for guideline-only or template-only runs.</span>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Audit</div>
                  <div className="mt-3 space-y-2">
                    {details.events.slice(-4).map((event) => (
                      <div key={event.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <div className="font-medium text-slate-900">{event.event_type.replace(/_/g, ' ')}</div>
                        <div className="mt-1">{event.message || `${event.previous_status || 'none'} -> ${event.next_status}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Guidelines and Template Tabs</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  The original guideline and template workspaces are preserved. Use the step tabs above to continue with those existing authoring screens. This Call tab no longer contains separate inline editors for them.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {callId ? (
                  <>
                    <Link href={`/admin/funding/catalog/${callId}/guidelines`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
                      Open Guidelines Tab
                    </Link>
                    <Link href={`/admin/funding/catalog/${callId}/template`} className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900">
                      Open Template Tab
                    </Link>
                  </>
                ) : canAutoCreateDraft ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSaveDraftAndOpen('guidelines')}
                      disabled={!canWriteFundingIntake || savingDraft}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50"
                    >
                      {savingDraft ? 'Saving...' : 'Save Draft and Open Guidelines'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveDraftAndOpen('template')}
                      disabled={!canWriteFundingIntake || savingDraft}
                      className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-900 disabled:opacity-50"
                    >
                      {savingDraft ? 'Saving...' : 'Save Draft and Open Template'}
                    </button>
                  </>
                ) : (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Save the call draft once agency name, scheme title, description, and duplicate resolution are ready. That first save unlocks the preserved guideline and template tabs.
                  </div>
                )}
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Guidelines</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{details.call?.guideline_status || 'none'}</div>
                <div className="mt-3 text-sm text-slate-600">Recent runs: {(details.guidelines?.runs || []).length}</div>
                <div className="mt-1 text-sm text-slate-600">Revisions: {(details.guidelines?.revisions || []).length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Template</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{details.call?.template_status || 'none'}</div>
                <div className="mt-3 text-sm text-slate-600">Assets: {(details.template?.assets || []).length}</div>
                <div className="mt-1 text-sm text-slate-600">Runs: {(details.template?.runs || []).length}</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Call fields and duplicate resolution</h2>
                <p className="mt-1 text-sm text-slate-600">Review the extracted funding call, fix duplicates, and save the draft. Draft save can trigger extract-all automatically.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveDraft(false)}
                  disabled={!canWriteFundingIntake || savingDraft || !['needs_review', 'draft_created'].includes(details.job.status)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDraft ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveDraft(true)}
                  disabled={!canWriteFundingIntake || savingDraft || !['needs_review', 'draft_created'].includes(details.job.status)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDraft ? 'Saving...' : details.job.input_type === 'json' ? 'Save Draft + Import JSON' : 'Save Draft + Extract All'}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,0.95fr),minmax(0,1.05fr)]">
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">Duplicate candidates</h3>
                  <div className="mt-4 space-y-3">
                    {details.duplicates.length === 0 ? (
                      <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">No duplicate candidates were detected.</div>
                    ) : (
                      details.duplicates.map((duplicate) => (
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
                      ))
                    )}
                  </div>
                </div>

                {(details.domainDuplicates || []).length > 0 && (
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">Same-domain matches</h3>
                    <div className="mt-4 space-y-3">
                      {(details.domainDuplicates || []).map((duplicate) => (
                        <div key={duplicate.candidate_funding_call_id} className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                          <div className="font-medium text-slate-900">{duplicate.candidate.scheme_title}</div>
                          <div className="mt-1">{duplicate.candidate.agency_name}</div>
                          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {duplicate.source_domain} | {Math.round(duplicate.match_score * 100)}% | {duplicate.strong_similarity ? 'strong' : 'review'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {FUNDING_FIELD_DEFINITIONS.map((field) => {
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
                          rows={5}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                        />
                      ) : field.type === 'number' ? (
                        <input
                          type="number"
                          value={currentValue ?? ''}
                          onChange={(event) => updateDraftValue(field.key, event.target.value === '' ? null : Number(event.target.value))}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                        />
                      ) : field.type === 'date' ? (
                        <input
                          type="date"
                          value={currentValue || ''}
                          onChange={(event) => updateDraftValue(field.key, event.target.value || null)}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                        />
                      ) : field.type === 'boolean' ? (
                        <label className="mt-4 inline-flex items-center gap-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(currentValue)}
                            onChange={(event) => updateDraftValue(field.key, event.target.checked)}
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
                                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
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
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                      ) : (
                        <input
                          type={NUMERIC_FIELD_KEYS.has(field.key as any) ? 'number' : BOOLEAN_FIELD_KEYS.has(field.key as any) ? 'text' : 'text'}
                          value={Array.isArray(currentValue) ? currentValue.join(', ') : currentValue ?? ''}
                          onChange={(event) => updateDraftValue(field.key, event.target.value)}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                        />
                      )}

                      {evidenceLines.length > 0 && (
                        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                          Evidence: {evidenceLines.join(' | ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
            </>
            </div>
          ))(details)}

          {false && (
            <>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Guidelines</h2>
                <p className="mt-1 text-sm text-slate-600">Edit, extract, approve, and revert the guideline pack inline. Use the intake source or override it with a separate URL, text block, or PDF.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleGuidelineExtract}
                  disabled={!canWorkOnGuidelines || guidelineBusy !== null || savingDraft}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {guidelineBusy === 'extract' ? 'Running...' : 'Run Guideline Extraction'}
                </button>
                <button
                  type="button"
                  onClick={handleGuidelineSave}
                  disabled={!canWorkOnGuidelines || guidelineBusy !== null || savingDraft}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {guidelineBusy === 'save' ? 'Saving...' : 'Save Guidelines'}
                </button>
                <button
                  type="button"
                  onClick={handleGuidelineApprove}
                  disabled={!canWorkOnGuidelines || guidelineBusy !== null || savingDraft}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {guidelineBusy === 'approve' ? 'Approving...' : 'Approve Guidelines'}
                </button>
              </div>
            </div>

            {!canWorkOnGuidelines ? (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Complete the basic funding call fields first. Guideline actions will create the working draft automatically once agency name, scheme title, and description are present.
              </div>
            ) : (
              <div className="mt-6 grid gap-6 xl:grid-cols-[20rem,minmax(0,1fr),22rem]">
                <div className="space-y-4">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Status</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{details?.call?.guideline_status || 'none'}</div>
                    <div className="mt-3 text-sm text-slate-600">Rules: {guidelineSummary?.totalRules || 0}</div>
                    <div className="mt-1 text-sm text-slate-600">Last edited: {formatDateTime(details?.guidelines?.guideline?.last_edited_at)}</div>
                    <div className="mt-1 text-sm text-slate-600">Approved: {formatDateTime(details?.guidelines?.guideline?.approved_at)}</div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Guideline source</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['intake', 'url', 'text', 'pdf'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setGuidelineSourceMode(mode)}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            guidelineSourceMode === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {mode === 'intake' ? 'Use Intake' : mode.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {guidelineSourceMode === 'url' && (
                      <input
                        value={guidelineSourceUrl}
                        onChange={(event) => setGuidelineSourceUrl(event.target.value)}
                        className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="https://example.org/guidelines"
                      />
                    )}

                    {guidelineSourceMode === 'text' && (
                      <textarea
                        value={guidelineSourceText}
                        onChange={(event) => setGuidelineSourceText(event.target.value)}
                        rows={5}
                        className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        placeholder="Paste separate guideline text here"
                      />
                    )}

                    {guidelineSourceMode === 'pdf' && (
                      <label className="mt-4 block text-sm font-medium text-slate-700">
                        Separate guideline PDF
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(event) => setGuidelineSourcePdf(event.target.files?.[0] || null)}
                          className="mt-2 block w-full text-sm text-slate-700"
                        />
                      </label>
                    )}

                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      {guidelineSourceMode === 'intake'
                        ? 'Guideline extraction will use the same canonical intake source as the funding call.'
                        : 'Guideline extraction will use this separate source without changing the template source selection.'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Recent runs</div>
                    <div className="mt-3 space-y-3">
                      {(details?.guidelines?.runs || []).length === 0 && (
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No guideline extraction runs yet.</div>
                      )}
                      {(details?.guidelines?.runs || []).map((run) => (
                        <div key={run.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <div className="font-medium text-slate-900">{run.status.replace(/_/g, ' ')}</div>
                          <div className="mt-1 text-xs text-slate-500">{run.extractor_model || 'manual'} | {formatDateTime(run.created_at)}</div>
                          {run.error_message && <div className="mt-2 text-xs text-rose-600">{run.error_message}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Guideline pack JSON</label>
                  <textarea
                    value={guidelineJsonText}
                    onChange={(event) => setGuidelineJsonText(event.target.value)}
                    rows={26}
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-4 font-mono text-xs leading-6 text-slate-900"
                  />
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Revisions</div>
                  <div className="mt-3 space-y-3">
                    {(details?.guidelines?.revisions || []).length === 0 && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No guideline revisions yet.</div>
                    )}
                    {(details?.guidelines?.revisions || []).map((revision) => (
                      <div key={revision.id} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-900">Revision {revision.revision_no}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{revision.revision_type.replace(/_/g, ' ')} | {revision.approved_state}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleGuidelineRevert(revision.revision_no)}
                            disabled={guidelineBusy !== null}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Revert
                          </button>
                        </div>
                        {revision.diff_summary && <div className="mt-2 text-xs text-slate-600">{revision.diff_summary}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Template</h2>
                <p className="mt-1 text-sm text-slate-600">Manage ordered assets, use the intake source or separate sources, run extraction on the selected set, apply runs, edit JSON, approve, and revert without leaving this page.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTemplateExtract}
                  disabled={!canWorkOnTemplates || templateBusy !== null || savingDraft}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {templateBusy === 'extract' ? 'Running...' : 'Extract From Selected Assets'}
                </button>
                <button
                  type="button"
                  onClick={handleTemplateSave}
                  disabled={!canWorkOnTemplates || templateBusy !== null || savingDraft}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {templateBusy === 'save' ? 'Saving...' : 'Save Template'}
                </button>
                <button
                  type="button"
                  onClick={handleTemplateApprove}
                  disabled={!canWorkOnTemplates || templateBusy !== null || savingDraft}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {templateBusy === 'approve' ? 'Approving...' : 'Approve Template'}
                </button>
              </div>
            </div>

            {!canWorkOnTemplates ? (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Complete the basic funding call fields first. Template actions will create the working draft automatically once agency name, scheme title, and description are present.
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div className="grid gap-6 xl:grid-cols-[20rem,minmax(0,1fr),22rem]">
                  <div className="space-y-4">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Status</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{details?.call?.template_status || 'none'}</div>
                      <div className="mt-3 text-sm text-slate-600">Questions: {templateCounts.questions}</div>
                      <div className="mt-1 text-sm text-slate-600">Sections: {templateCounts.sections}</div>
                      <div className="mt-1 text-sm text-slate-600">Attachments: {templateCounts.attachments}</div>
                      <div className="mt-1 text-sm text-slate-600">Conflicts: {templateConflicts.length}</div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Add source</div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTemplateSourceType('url')}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${templateSourceType === 'url' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                        >
                          URL
                        </button>
                        <button
                          type="button"
                          onClick={() => setTemplateSourceType('text')}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${templateSourceType === 'text' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                        >
                          Text
                        </button>
                      </div>

                      {templateSourceType === 'url' ? (
                        <input
                          value={templateSourceUrl}
                          onChange={(event) => setTemplateSourceUrl(event.target.value)}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                          placeholder="https://example.org/template"
                        />
                      ) : (
                        <textarea
                          value={templateSourceText}
                          onChange={(event) => setTemplateSourceText(event.target.value)}
                          rows={5}
                          className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                          placeholder="Paste template instructions or field text"
                        />
                      )}

                      <button
                        type="button"
                        onClick={handleTemplateAddSource}
                        disabled={templateBusy !== null}
                        className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {templateBusy === 'add-source' ? 'Adding...' : 'Add Source'}
                      </button>

                      <label className="mt-4 block text-sm font-medium text-slate-700">
                        Snapshot images or PDF
                        <input
                          type="file"
                          accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                          multiple
                          onChange={handleTemplateFileUpload}
                          className="mt-2 block w-full text-sm text-slate-700"
                        />
                      </label>
                      <p className="mt-2 text-xs text-slate-500">Upload order is preserved and used to reconstruct field order across snapshot images.</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700">Template JSON</label>
                    <textarea
                      value={templateJsonText}
                      onChange={(event) => setTemplateJsonText(event.target.value)}
                      rows={26}
                      className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-4 font-mono text-xs leading-6 text-slate-900"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Ordered assets</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTemplateAssetIds(intakeTemplateAssetIds)}
                          disabled={templateBusy !== null || intakeTemplateAssetIds.length === 0}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Use Intake Source Only
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedTemplateAssetIds((details?.template?.assets || []).map((asset) => asset.id))}
                          disabled={templateBusy !== null || (details?.template?.assets || []).length === 0}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Select All Sources
                        </button>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        Keep only the auto-managed intake asset selected to use the same source. Add or select different assets to run template extraction from separate sources.
                      </p>
                      <div className="mt-3 space-y-3">
                        {(details?.template?.assets || []).length === 0 && (
                          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No template assets yet.</div>
                        )}
                        {(details?.template?.assets || []).map((asset) => {
                          const metadata = readAssetMetadata(asset.source_metadata_json);
                          const autoManaged = metadata.auto_managed === true;
                          return (
                            <div key={asset.id} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={selectedTemplateAssetIds.includes(asset.id)}
                                  onChange={() =>
                                    setSelectedTemplateAssetIds((current) =>
                                      current.includes(asset.id)
                                        ? current.filter((entry) => entry !== asset.id)
                                        : [...current, asset.id]
                                    )
                                  }
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-700">
                                      Seq {asset.sequence_no}
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-700">
                                      {asset.source_type}
                                    </span>
                                    {autoManaged && (
                                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-800">
                                        auto-managed
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 break-all text-xs text-slate-600">
                                    {asset.source_url || asset.storage_path || (asset.normalized_text || asset.raw_text || '').slice(0, 120) || asset.id}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleTemplateDeleteAsset(asset.id)}
                                  disabled={templateBusy !== null}
                                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Runs</div>
                      <div className="mt-3 space-y-3">
                        {(details?.template?.runs || []).length === 0 && (
                          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No template extraction runs yet.</div>
                        )}
                        {(details?.template?.runs || []).map((run) => (
                          <div key={run.id} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-slate-900">{run.status.replace(/_/g, ' ')}</div>
                                <div className="mt-1 text-xs text-slate-500">{run.extractor_model || 'manual'} | {formatDateTime(run.created_at)}</div>
                              </div>
                              {run.status === 'needs_review' && (
                                <button
                                  type="button"
                                  onClick={() => handleTemplateApplyRun(run.id)}
                                  disabled={templateBusy !== null}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Use Extraction
                                </button>
                              )}
                            </div>
                            {run.warnings_json && run.warnings_json.length > 0 && (
                              <div className="mt-2 text-xs text-amber-700">{run.warnings_json.join(' | ')}</div>
                            )}
                            {run.error_message && <div className="mt-2 text-xs text-rose-600">{run.error_message}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Template revisions</div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {(details?.template?.revisions || []).length === 0 && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No template revisions yet.</div>
                    )}
                    {(details?.template?.revisions || []).map((revision) => (
                      <div key={revision.id} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-900">Revision {revision.revision_no}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{revision.revision_type.replace(/_/g, ' ')} | {revision.approved_state}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleTemplateRevert(revision.revision_no)}
                            disabled={templateBusy !== null}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Revert
                          </button>
                        </div>
                        {revision.diff_summary && <div className="mt-2 text-xs text-slate-600">{revision.diff_summary}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
            </>
          )}

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
