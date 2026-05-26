import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FaAlignLeft,
  FaArrowRight,
  FaCheckCircle,
  FaClock,
  FaFileAlt,
  FaFilePdf,
  FaLink,
  FaMagic,
  FaPlay,
  FaSpinner,
  FaTimes,
  FaUpload,
} from 'react-icons/fa';

type ImportMode = 'url' | 'file' | 'text';
type SourceMode = 'intake' | 'file' | 'url' | 'text' | 'skip';
type WizardStep = 'source' | 'review' | 'guidelines' | 'template' | 'ready';
type ArtifactStatus = 'idle' | 'extracting' | 'ready' | 'accepted' | 'skipped' | 'failed';

type FundingImportDetails = {
  job: {
    id: string;
    status: string;
    duplicate_status: string;
    error_code?: string | null;
    error_message?: string | null;
  };
  draftValues?: Record<string, any>;
  duplicates?: Array<{
    id: string;
    match_type: string;
    match_score: number;
    candidate_funding_call_id: string;
    candidate: {
      id: string;
      agency_name: string;
      scheme_title: string;
      source_url: string | null;
      close_date: string | null;
    } | null;
  }>;
  domainDuplicates?: Array<{
    candidate_funding_call_id: string;
    match_type: 'same_source_domain';
    match_score: number;
    source_domain: string;
    strong_similarity: boolean;
    candidate: {
      id: string;
      agency_name: string;
      scheme_title: string;
      source_url: string | null;
      close_date: string | null;
    };
  }>;
};

type ExistingFundingCall = {
  id: string;
  agencyName: string;
  schemeTitle: string;
  sourceUrl: string | null;
  officialUrls: string[];
  closeDate: string | null;
  isRolling: boolean | null;
};

type ArtifactState = {
  status: ArtifactStatus;
  run?: any;
  bundle?: any;
  error?: string | null;
};

type FundingCallImportModalProps = {
  open: boolean;
  onClose: () => void;
  onBeginWriting: (fundingCallId: string) => void;
};

const waitMessages = [
  'Please wait while the AI reads the document.',
  'Extracting call details. This can take a few minutes for long PDFs.',
  'Checking deadlines, eligibility, amounts, and official links.',
  'Still working. You can keep this window open while the AI finishes.',
];

const guidelineWaitMessages = [
  'Please wait while the AI reads the guidelines.',
  'Finding must-follow rules, review criteria, and submission instructions.',
  'Preparing a simple summary for your review.',
];

const templateWaitMessages = [
  'Please wait while the AI reads the template.',
  'Detecting proposal sections, questions, attachments, and formatting rules.',
  'Preparing the template for your review.',
];

const wizardStorageKey = 'funding-call-upload-wizard-v1';
const emptyArtifactState: ArtifactState = { status: 'idle', error: null };

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || payload?.details || 'Request failed');
  }
  return payload as T;
}

function useWaitMessage(active: boolean, messages: string[]) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return undefined;
    }

    const intervalId = setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, 3500);

    return () => clearInterval(intervalId);
  }, [active, messages.length]);

  return messages[index] || messages[0];
}

function formatValue(value: unknown, fallback = 'Not found yet') {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || '').trim()).filter(Boolean);
    return items.length > 0 ? items.join(', ') : fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  return fallback;
}

function formatMoneyRange(draftValues?: Record<string, any>) {
  if (!draftValues) return 'Not found yet';
  const min = draftValues.amount_min;
  const max = draftValues.amount_max;
  const currency = formatValue(draftValues.currency, '').trim();
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (!hasMin && !hasMax) return 'Not found yet';
  if (hasMin && hasMax) {
    return `${currency ? `${currency} ` : ''}${min} - ${max}`;
  }
  if (hasMin) return `${currency ? `${currency} ` : ''}${min}+`;
  return `${currency ? `${currency} ` : ''}${max}`;
}

function getRunPayload(run: any, key: string) {
  const value = run?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function previewRules(pack: Record<string, unknown>) {
  const buckets = ['priorities', 'mustAddress', 'evaluationCriteria', 'submissionRules', 'formatRules'];
  const previews: string[] = [];

  for (const bucket of buckets) {
    const items = Array.isArray(pack[bucket]) ? pack[bucket] as any[] : [];
    for (const item of items) {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (text) previews.push(text);
      if (previews.length >= 4) return previews;
    }
  }

  return previews;
}

function buildGuidelineSummary(run?: any) {
  const pack = getRunPayload(run, 'guideline_pack_json');
  return {
    counts: [
      ['Priorities', countArray(pack.priorities)],
      ['Must address', countArray(pack.mustAddress)],
      ['Evaluation criteria', countArray(pack.evaluationCriteria)],
      ['Submission rules', countArray(pack.submissionRules)],
      ['Format rules', countArray(pack.formatRules)],
    ],
    previews: previewRules(pack),
  };
}

function buildTemplateSummary(run?: any) {
  const template = getRunPayload(run, 'normalized_template_json');
  const sections = Array.isArray(template.sections) ? template.sections : [];
  const sectionLabels: string[] = sections
    .slice(0, 5)
    .map((section: any, index: number) => formatValue(section?.label || section?.title || section?.name, `Section ${index + 1}`));

  return {
    counts: [
      ['Sections', sections.length],
      ['Questions', countArray(template.questions)],
      ['Attachments', countArray(template.attachments)],
      ['Evaluation criteria', countArray(template.evaluationCriteria)],
    ],
    sectionLabels,
  };
}

function StepPill({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        active
          ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
          : done
            ? 'border-slate-200 bg-white text-slate-700'
            : 'border-slate-200 bg-slate-50 text-slate-400'
      }`}
    >
      {done ? <FaCheckCircle className="text-emerald-600" /> : active ? <FaClock className="text-emerald-700" /> : null}
      {label}
    </div>
  );
}

function SourceButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProgressNotice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex items-center gap-3 font-semibold">
        <FaSpinner className="animate-spin" />
        {message}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-500" />
      </div>
    </div>
  );
}

export default function FundingCallImportModal({
  open,
  onClose,
  onBeginWriting,
}: FundingCallImportModalProps) {
  const [step, setStep] = useState<WizardStep>('source');
  const [mode, setMode] = useState<ImportMode>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [details, setDetails] = useState<FundingImportDetails | null>(null);
  const [existingCall, setExistingCall] = useState<ExistingFundingCall | null>(null);
  const [fundingCallId, setFundingCallId] = useState<string | null>(null);
  const [guidelineMode, setGuidelineMode] = useState<SourceMode>('intake');
  const [guidelineUrl, setGuidelineUrl] = useState('');
  const [guidelineText, setGuidelineText] = useState('');
  const [guidelineFile, setGuidelineFile] = useState<File | null>(null);
  const [guidelineState, setGuidelineState] = useState<ArtifactState>(emptyArtifactState);
  const [templateMode, setTemplateMode] = useState<SourceMode>('skip');
  const [templateUrl, setTemplateUrl] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateState, setTemplateState] = useState<ArtifactState>(emptyArtifactState);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importing = Boolean(details && ['queued', 'fetching', 'extracting'].includes(details.job.status));
  const callWaitMessage = useWaitMessage(loading || importing, waitMessages);
  const guidelineWaitMessage = useWaitMessage(guidelineState.status === 'extracting', guidelineWaitMessages);
  const templateWaitMessage = useWaitMessage(templateState.status === 'extracting', templateWaitMessages);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  const clearSavedProgress = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(wizardStorageKey);
    }
    setResumeNotice(null);
  };

  const resetWizardState = () => {
    setStep('source');
    setMode('url');
    setSourceUrl('');
    setSourceText('');
    setSourceFile(null);
    setJobId(null);
    setDetails(null);
    setExistingCall(null);
    setFundingCallId(null);
    setGuidelineMode('intake');
    setGuidelineUrl('');
    setGuidelineText('');
    setGuidelineFile(null);
    setGuidelineState(emptyArtifactState);
    setTemplateMode('skip');
    setTemplateUrl('');
    setTemplateText('');
    setTemplateFile(null);
    setTemplateState(emptyArtifactState);
    setLoading(false);
    setActionLoading(false);
    setError(null);
    setResumeNotice(null);
  };

  useEffect(() => {
    if (!open) {
      resetWizardState();
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const raw = window.localStorage.getItem(wizardStorageKey);
    if (!raw) return;

    try {
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;

      setStep(saved.step || 'source');
      setMode(saved.mode || 'url');
      setSourceUrl(saved.sourceUrl || '');
      setSourceText(saved.sourceText || '');
      setJobId(saved.jobId || null);
      setDetails(saved.details || null);
      setExistingCall(saved.existingCall || null);
      setFundingCallId(saved.fundingCallId || null);
      setGuidelineMode(saved.guidelineMode || 'intake');
      setGuidelineUrl(saved.guidelineUrl || '');
      setGuidelineText(saved.guidelineText || '');
      setGuidelineState(saved.guidelineState || emptyArtifactState);
      setTemplateMode(saved.templateMode || 'skip');
      setTemplateUrl(saved.templateUrl || '');
      setTemplateText(saved.templateText || '');
      setTemplateState(saved.templateState || emptyArtifactState);
      setResumeNotice('Restored your previous upload progress. You can continue from here.');
    } catch {
      window.localStorage.removeItem(wizardStorageKey);
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const hasProgress = Boolean(jobId || fundingCallId || details || step !== 'source');
    if (!hasProgress) return;

    window.localStorage.setItem(
      wizardStorageKey,
      JSON.stringify({
        step,
        mode,
        sourceUrl,
        sourceText: sourceText.length > 12000 ? sourceText.slice(0, 12000) : sourceText,
        jobId,
        details,
        existingCall,
        fundingCallId,
        guidelineMode,
        guidelineUrl,
        guidelineText: guidelineText.length > 12000 ? guidelineText.slice(0, 12000) : guidelineText,
        guidelineState,
        templateMode,
        templateUrl,
        templateText: templateText.length > 12000 ? templateText.slice(0, 12000) : templateText,
        templateState,
        savedAt: new Date().toISOString(),
      })
    );
  }, [
    details,
    existingCall,
    fundingCallId,
    guidelineMode,
    guidelineState,
    guidelineText,
    guidelineUrl,
    jobId,
    mode,
    open,
    sourceText,
    sourceUrl,
    step,
    templateMode,
    templateState,
    templateText,
    templateUrl,
  ]);

  useEffect(() => {
    if (!open || !jobId) return undefined;
    let canceled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const nextDetails = await apiRequest<FundingImportDetails>(`/api/funding/import/${jobId}`);
        if (canceled) return;
        setDetails(nextDetails);

        if (['queued', 'fetching', 'extracting'].includes(nextDetails.job.status)) {
          timeoutId = setTimeout(poll, 2000);
          return;
        }

        if (['needs_review', 'draft_created'].includes(nextDetails.job.status)) {
          setStep('review');
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : 'Failed to load import status');
        }
      }
    };

    poll();

    return () => {
      canceled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [open, jobId]);

  const duplicateCandidates = useMemo(() => {
    return [
      ...(details?.duplicates || [])
        .filter((duplicate) => duplicate.candidate)
        .map((duplicate) => ({
          id: duplicate.candidate_funding_call_id,
          label: duplicate.match_type === 'same_source_url' ? 'Exact source URL match' : 'Possible duplicate',
          score: duplicate.match_score,
          candidate: duplicate.candidate!,
        })),
      ...(details?.domainDuplicates || []).map((duplicate) => ({
        id: duplicate.candidate_funding_call_id,
        label: duplicate.strong_similarity ? 'Same source website with similar call details' : 'Same source website',
        score: duplicate.match_score,
        candidate: duplicate.candidate,
      })),
    ].filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index);
  }, [details]);

  if (!open) return null;

  const draftValues = details?.draftValues || {};
  const failedImportMessage = details?.job.error_message
    || (details?.job.error_code === 'LLM_RATE_LIMITED'
      ? 'The AI provider is rate limiting requests right now. Retry the import in about a minute.'
      : 'Import failed. Try a different URL, upload the PDF, or paste the call text instead.');
  const canSubmit = mode === 'url'
    ? sourceUrl.trim().length > 0
    : mode === 'file'
      ? Boolean(sourceFile)
      : sourceText.trim().length >= 80;
  const guidelineSummary = buildGuidelineSummary(guidelineState.run);
  const templateSummary = buildTemplateSummary(templateState.run);

  const submitImport = async () => {
    setLoading(true);
    setError(null);
    setDetails(null);
    setJobId(null);
    setExistingCall(null);

    try {
      let response: { jobId?: string; status: string; existingCall?: ExistingFundingCall };

      if (mode === 'file') {
        if (!sourceFile) return;
        const formData = new FormData();
        formData.append('inputType', 'file');
        formData.append('file', sourceFile);
        response = await apiRequest('/api/funding/import', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest('/api/funding/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputType: mode,
            sourceUrl: mode === 'url' ? sourceUrl : undefined,
            sourceText: mode === 'text' ? sourceText : undefined,
          }),
        });
      }

      if (response.status === 'existing_call_found' && response.existingCall) {
        setExistingCall(response.existingCall);
        return;
      }

      if (response.jobId) {
        setJobId(response.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import');
    } finally {
      setLoading(false);
    }
  };

  const decide = async (action: 'use_existing' | 'create_private_draft' | 'cancel', existingFundingCallId?: string) => {
    if (!jobId) return;
    setActionLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{ fundingCallId?: string; status: string }>(`/api/funding/import/${jobId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          existingFundingCallId,
          draft: action === 'create_private_draft' ? details?.draftValues : undefined,
        }),
      });

      if (action === 'use_existing' && response.fundingCallId) {
        onBeginWriting(response.fundingCallId);
        return;
      }

      if (action === 'create_private_draft' && response.fundingCallId) {
        setFundingCallId(response.fundingCallId);
        setStep('guidelines');
        return;
      }

      clearSavedProgress();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve import');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExistingCall = (callId: string) => {
    if (!jobId) {
      onBeginWriting(callId);
      return;
    }

    decide('use_existing', callId);
  };

  const extractGuidelines = async () => {
    if (!fundingCallId) return;
    if (guidelineMode === 'skip') {
      setGuidelineState({ status: 'skipped', error: null });
      setStep('template');
      return;
    }

    setGuidelineState({ status: 'extracting', error: null });
    setError(null);

    try {
      let response: { run: any };
      if (guidelineMode === 'file') {
        if (!guidelineFile) throw new Error('Upload a guideline PDF first');
        const formData = new FormData();
        formData.append('file', guidelineFile);
        response = await apiRequest(`/api/funding/calls/${fundingCallId}/user-guidelines/extract`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest(`/api/funding/calls/${fundingCallId}/user-guidelines/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceMode: guidelineMode,
            sourceUrl: guidelineMode === 'url' ? guidelineUrl : undefined,
            sourceText: guidelineMode === 'text' ? guidelineText : undefined,
          }),
        });
      }

      setGuidelineState({ status: 'ready', run: response.run, error: null });
    } catch (err) {
      setGuidelineState({ status: 'failed', error: err instanceof Error ? err.message : 'Failed to extract guidelines' });
    }
  };

  const acceptGuidelines = async () => {
    if (!fundingCallId || !guidelineState.run?.id) return;
    setActionLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{ bundle: any }>(`/api/funding/calls/${fundingCallId}/user-guidelines/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: guidelineState.run.id }),
      });
      setGuidelineState((current) => ({ ...current, status: 'accepted', bundle: response.bundle, error: null }));
      setStep('template');
    } catch (err) {
      setGuidelineState((current) => ({ ...current, error: err instanceof Error ? err.message : 'Failed to accept guidelines' }));
    } finally {
      setActionLoading(false);
    }
  };

  const extractTemplate = async () => {
    if (!fundingCallId) return;
    if (templateMode === 'skip') {
      setTemplateState({ status: 'skipped', error: null });
      setStep('ready');
      return;
    }

    setTemplateState({ status: 'extracting', error: null });
    setError(null);

    try {
      let response: { asset?: any; run: any };
      if (templateMode === 'file') {
        if (!templateFile) throw new Error('Upload a template file first');
        const formData = new FormData();
        formData.append('file', templateFile);
        response = await apiRequest(`/api/funding/calls/${fundingCallId}/user-template/extract`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest(`/api/funding/calls/${fundingCallId}/user-template/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceType: templateMode,
            sourceUrl: templateMode === 'url' ? templateUrl : undefined,
            sourceText: templateMode === 'text' ? templateText : undefined,
          }),
        });
      }

      setTemplateState({ status: 'ready', run: response.run, error: null });
    } catch (err) {
      setTemplateState({ status: 'failed', error: err instanceof Error ? err.message : 'Failed to extract template' });
    }
  };

  const acceptTemplate = async () => {
    if (!fundingCallId || !templateState.run?.id) return;
    setActionLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{ bundle: any }>(`/api/funding/calls/${fundingCallId}/user-template/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: templateState.run.id }),
      });
      setTemplateState((current) => ({ ...current, status: 'accepted', bundle: response.bundle, error: null }));
      setStep('ready');
    } catch (err) {
      setTemplateState((current) => ({ ...current, error: err instanceof Error ? err.message : 'Failed to accept template' }));
    } finally {
      setActionLoading(false);
    }
  };

  const startGrantWriting = () => {
    if (fundingCallId) {
      clearSavedProgress();
      onBeginWriting(fundingCallId);
    }
  };

  const startOver = () => {
    clearSavedProgress();
    resetWizardState();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                <FaUpload />
                User upload
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">Upload New Call For Proposal</h2>
              <p className="mt-1 text-sm text-slate-600">
                Add a call, review the extracted details, then optionally add guidelines and templates before grant writing.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {jobId || fundingCallId || step !== 'source' ? (
                <button
                  type="button"
                  onClick={startOver}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Start over
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                <FaTimes />
                Close
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <StepPill label="Call" active={step === 'source'} done={step !== 'source'} />
            <StepPill label="Review" active={step === 'review'} done={['guidelines', 'template', 'ready'].includes(step)} />
            <StepPill label="Guidelines" active={step === 'guidelines'} done={['template', 'ready'].includes(step)} />
            <StepPill label="Template" active={step === 'template'} done={step === 'ready'} />
            <StepPill label="Start writing" active={step === 'ready'} done={false} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {resumeNotice ? (
            <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              {resumeNotice}
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : null}

          {step === 'source' ? (
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Add the call source</div>
                <p className="mt-1 text-sm text-slate-600">
                  Use the official URL when available. If the call is only in a document, upload the PDF.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <SourceButton active={mode === 'url'} icon={<FaLink />} label="URL" onClick={() => setMode('url')} />
                  <SourceButton active={mode === 'file'} icon={<FaFilePdf />} label="PDF" onClick={() => setMode('file')} />
                  <SourceButton active={mode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setMode('text')} />
                </div>

                <div className="mt-4">
                  {mode === 'url' ? (
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="https://funder.example/calls/example"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : mode === 'file' ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                      <FaFilePdf className="mb-3 text-2xl text-emerald-700" />
                      <span className="font-semibold text-slate-900">{sourceFile ? sourceFile.name : 'Upload call PDF'}</span>
                      <span className="mt-1 text-xs text-slate-500">PDF files only</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : (
                    <textarea
                      value={sourceText}
                      onChange={(event) => setSourceText(event.target.value)}
                      rows={9}
                      placeholder="Paste the funding call text here"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  )}
                </div>
              </div>

              {loading || importing ? <ProgressNotice message={callWaitMessage} /> : null}

              {existingCall ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    This URL is already in the funding catalog
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-950">{existingCall.schemeTitle}</div>
                  <div className="mt-1 text-sm text-slate-700">{existingCall.agencyName}</div>
                  <div className="mt-2 text-sm text-slate-600">
                    {existingCall.isRolling ? 'Rolling deadline' : existingCall.closeDate ? `Deadline: ${existingCall.closeDate}` : 'Deadline not specified'}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleExistingCall(existingCall.id)}
                      className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      <FaPlay />
                      Use existing call
                    </button>
                    <button
                      type="button"
                      onClick={() => setExistingCall(null)}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Try another source
                    </button>
                  </div>
                </div>
              ) : null}

              {details?.job.status === 'failed' ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {failedImportMessage}
                </div>
              ) : null}

              <button
                type="button"
                onClick={submitImport}
                disabled={loading || importing || !canSubmit}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading || importing ? <FaSpinner className="animate-spin" /> : <FaMagic />}
                {loading || importing ? 'Extracting call details...' : 'Extract call details'}
              </button>
            </div>
          ) : null}

          {step === 'review' ? (
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-950">Review extracted call details</div>
                <p className="mt-1 text-sm text-slate-600">
                  Confirm the AI found the core details. You can refine later from the funding call page if needed.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{formatValue(draftValues.scheme_title)}</div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agency</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{formatValue(draftValues.agency_name)}</div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deadline</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">
                      {draftValues.is_rolling ? 'Rolling deadline' : formatValue(draftValues.close_date)}
                    </div>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{formatMoneyRange(draftValues)}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-md bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</div>
                  <div className="mt-1 line-clamp-5 text-sm leading-6 text-slate-700">{formatValue(draftValues.description)}</div>
                </div>
                <div className="mt-3 rounded-md bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Eligibility</div>
                  <div className="mt-1 line-clamp-4 text-sm leading-6 text-slate-700">{formatValue(draftValues.eligibility_text)}</div>
                </div>
              </div>

              {duplicateCandidates.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-950">Possible existing calls</div>
                  <p className="mt-1 text-sm text-amber-800">
                    If one of these is the same opportunity, use it. Otherwise create your private call.
                  </p>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {duplicateCandidates.map((duplicate) => (
                      <div key={duplicate.id} className="rounded-md border border-amber-200 bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{duplicate.label}</div>
                        <div className="mt-1 font-medium text-slate-950">{duplicate.candidate.scheme_title}</div>
                        <div className="mt-1 text-sm text-slate-600">{duplicate.candidate.agency_name}</div>
                        <button
                          type="button"
                          onClick={() => handleExistingCall(duplicate.id)}
                          disabled={actionLoading}
                          className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-700 disabled:opacity-60"
                        >
                          Use this existing call
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => decide('create_private_draft')}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {actionLoading ? <FaSpinner className="animate-spin" /> : <FaArrowRight />}
                  Create my private call
                </button>
                <button
                  type="button"
                  onClick={() => decide('cancel')}
                  disabled={actionLoading}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {step === 'guidelines' ? (
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-950">Add guidelines</div>
                <p className="mt-1 text-sm text-slate-600">
                  Guidelines help Grant Prep follow priorities, word limits, budgets, review criteria, and submission rules.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <SourceButton active={guidelineMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setGuidelineMode('intake')} />
                  <SourceButton active={guidelineMode === 'file'} icon={<FaFilePdf />} label="PDF" onClick={() => setGuidelineMode('file')} />
                  <SourceButton active={guidelineMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setGuidelineMode('url')} />
                  <SourceButton active={guidelineMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setGuidelineMode('text')} />
                  <SourceButton active={guidelineMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setGuidelineMode('skip')} />
                </div>

                <div className="mt-4">
                  {guidelineMode === 'file' ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                      <FaFilePdf className="mb-3 text-xl text-emerald-700" />
                      <span className="font-semibold text-slate-900">{guidelineFile ? guidelineFile.name : 'Upload guideline PDF'}</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(event) => setGuidelineFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : guidelineMode === 'url' ? (
                    <input
                      value={guidelineUrl}
                      onChange={(event) => setGuidelineUrl(event.target.value)}
                      placeholder="https://funder.example/guidelines"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : guidelineMode === 'text' ? (
                    <textarea
                      value={guidelineText}
                      onChange={(event) => setGuidelineText(event.target.value)}
                      rows={7}
                      placeholder="Paste the guideline text here"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : guidelineMode === 'skip' ? (
                    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      You can continue without guidelines. Grant Prep will use the call details and lighter guidance.
                    </div>
                  ) : (
                    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      The AI will reuse the original call source to extract guideline rules.
                    </div>
                  )}
                </div>
              </div>

              {guidelineState.status === 'extracting' ? <ProgressNotice message={guidelineWaitMessage} /> : null}
              {guidelineState.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{guidelineState.error}</div>
              ) : null}

              {guidelineState.status === 'ready' ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-sm font-semibold text-emerald-950">Guidelines ready to review</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-5">
                    {guidelineSummary.counts.map(([label, count]) => (
                      <div key={label} className="rounded-md bg-white px-3 py-2 text-center">
                        <div className="text-lg font-semibold text-slate-950">{count}</div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                      </div>
                    ))}
                  </div>
                  {guidelineSummary.previews.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {guidelineSummary.previews.map((preview, index) => (
                        <div key={`${preview}-${index}`} className="rounded-md bg-white p-3 text-sm leading-6 text-slate-700">
                          {preview}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={acceptGuidelines}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {actionLoading ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                      Accept guidelines
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGuidelineState({ status: 'skipped', error: null });
                        setStep('template');
                      }}
                      disabled={actionLoading}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Skip guidelines
                    </button>
                  </div>
                </div>
              ) : null}

              {guidelineState.status !== 'ready' ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={extractGuidelines}
                    disabled={guidelineState.status === 'extracting'}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {guidelineState.status === 'extracting' ? <FaSpinner className="animate-spin" /> : <FaMagic />}
                    {guidelineMode === 'skip' ? 'Continue without guidelines' : 'Extract guidelines'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 'template' ? (
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-950">Add proposal template</div>
                <p className="mt-1 text-sm text-slate-600">
                  Templates help Grant Prep write into the right sections and keep required attachments visible.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <SourceButton active={templateMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setTemplateMode('intake')} />
                  <SourceButton active={templateMode === 'file'} icon={<FaFilePdf />} label="File" onClick={() => setTemplateMode('file')} />
                  <SourceButton active={templateMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setTemplateMode('url')} />
                  <SourceButton active={templateMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setTemplateMode('text')} />
                  <SourceButton active={templateMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setTemplateMode('skip')} />
                </div>

                <div className="mt-4">
                  {templateMode === 'file' ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                      <FaFilePdf className="mb-3 text-xl text-emerald-700" />
                      <span className="font-semibold text-slate-900">{templateFile ? templateFile.name : 'Upload template file'}</span>
                      <span className="mt-1 text-xs text-slate-500">PDF or image files are supported by the current extractor.</span>
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : templateMode === 'url' ? (
                    <input
                      value={templateUrl}
                      onChange={(event) => setTemplateUrl(event.target.value)}
                      placeholder="https://funder.example/template"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : templateMode === 'text' ? (
                    <textarea
                      value={templateText}
                      onChange={(event) => setTemplateText(event.target.value)}
                      rows={7}
                      placeholder="Paste the proposal template text here"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : templateMode === 'skip' ? (
                    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      You can continue without a template. Grant Prep will use the standard grant-writing flow.
                    </div>
                  ) : (
                    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      The AI will reuse the original call source and look for proposal structure.
                    </div>
                  )}
                </div>
              </div>

              {templateState.status === 'extracting' ? <ProgressNotice message={templateWaitMessage} /> : null}
              {templateState.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{templateState.error}</div>
              ) : null}

              {templateState.status === 'ready' ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-sm font-semibold text-emerald-950">Template ready to review</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {templateSummary.counts.map(([label, count]) => (
                      <div key={label} className="rounded-md bg-white px-3 py-2 text-center">
                        <div className="text-lg font-semibold text-slate-950">{count}</div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                      </div>
                    ))}
                  </div>
                  {templateSummary.sectionLabels.length > 0 ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {templateSummary.sectionLabels.map((label, index) => (
                        <div key={`${label}-${index}`} className="rounded-md bg-white p-3 text-sm font-medium text-slate-700">
                          {label}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={acceptTemplate}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {actionLoading ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
                      Accept template
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateState({ status: 'skipped', error: null });
                        setStep('ready');
                      }}
                      disabled={actionLoading}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Skip template
                    </button>
                  </div>
                </div>
              ) : null}

              {templateState.status !== 'ready' ? (
                <button
                  type="button"
                  onClick={extractTemplate}
                  disabled={templateState.status === 'extracting'}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {templateState.status === 'extracting' ? <FaSpinner className="animate-spin" /> : <FaMagic />}
                  {templateMode === 'skip' ? 'Continue without template' : 'Extract template'}
                </button>
              ) : null}
            </div>
          ) : null}

          {step === 'ready' ? (
            <div className="space-y-5">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex items-center gap-3 text-lg font-semibold text-emerald-950">
                  <FaCheckCircle />
                  Your private call is ready
                </div>
                <p className="mt-2 text-sm leading-6 text-emerald-900">
                  The call is available privately and submitted for admin review. You can start grant writing now.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Call details</div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <FaCheckCircle />
                    Ready
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guidelines</div>
                  <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${guidelineState.status === 'accepted' ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {guidelineState.status === 'accepted' ? <FaCheckCircle /> : <FaArrowRight />}
                    {guidelineState.status === 'accepted' ? 'Accepted' : 'Skipped'}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Template</div>
                  <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${templateState.status === 'accepted' ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {templateState.status === 'accepted' ? <FaCheckCircle /> : <FaArrowRight />}
                    {templateState.status === 'accepted' ? 'Accepted' : 'Skipped'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={startGrantWriting}
                disabled={!fundingCallId}
                className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FaPlay />
                Start Grant Writing
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
