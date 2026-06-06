import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { deriveGrantPrepPriorityAreaOptions } from '@/lib/grantPrep/priorityAreas';

type ImportMode = 'url' | 'file' | 'text';
type SourceMode = 'intake' | 'file' | 'url' | 'text' | 'skip';
type WizardStep = 'source' | 'review' | 'guidelines' | 'template' | 'ready';
type ArtifactStatus = 'idle' | 'extracting' | 'ready' | 'accepted' | 'skipped' | 'failed';

type FundingImportDetails = {
  job: {
    id: string;
    status: string;
    duplicate_status: string;
    linked_funding_call_id?: string | null;
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

type FundingCallSearchResult = {
  id: string;
  title: string;
  agencyName?: string | null;
  sourceUrl?: string | null;
  summary?: string | null;
  deadlineAt?: string | null;
  updatedAt: string;
};

type FundingImportCreateResponse = {
  jobId?: string;
  fundingCallId?: string | null;
  job?: {
    id?: string;
    resultFundingCallId?: string | null;
  } | null;
  status?: string;
  existingCall?: ExistingFundingCall;
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
  onBeginWriting: (fundingCallId: string, options?: { projectName?: string; selectedPriorityAreas?: string[] }) => void;
  importEndpoint?: '/api/funding/import' | '/api/funding/imports';
  allowedCallModes?: ImportMode[];
  allowedGuidelineModes?: SourceMode[];
  allowedTemplateModes?: SourceMode[];
  storageKey?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  showProjectNameField?: boolean;
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

const defaultWizardStorageKey = 'funding-call-upload-wizard-v1';
const emptyArtifactState: ArtifactState = { status: 'idle', error: null };
const defaultCallModes: ImportMode[] = ['url', 'file', 'text'];
const defaultGuidelineModes: SourceMode[] = ['intake', 'file', 'url', 'text', 'skip'];
const defaultTemplateModes: SourceMode[] = ['intake', 'file', 'url', 'text', 'skip'];
const quickSearchStopWords = new Set([
  'about',
  'after',
  'against',
  'also',
  'and',
  'application',
  'applications',
  'available',
  'call',
  'calls',
  'can',
  'deadline',
  'for',
  'from',
  'funding',
  'grant',
  'grants',
  'guideline',
  'guidelines',
  'into',
  'may',
  'must',
  'not',
  'only',
  'proposal',
  'proposals',
  'research',
  'shall',
  'should',
  'submit',
  'submission',
  'that',
  'the',
  'their',
  'this',
  'through',
  'under',
  'with',
]);

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('auth_token') : null;

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    credentials: options?.credentials || 'include',
    headers,
  });
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

function formatShortDate(value?: string | null) {
  if (!value) return 'Deadline not specified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildCompactCallSearchQuery(text: string) {
  const normalized = text.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length < 40) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8 && line.length <= 180)
    .slice(0, 40);
  const titleLikeLine = lines.find((line) =>
    /\b(call|proposal|proposals|programme|program|scheme|funding|opportunity|fellowship|grant)\b/i.test(line)
  ) || lines[0] || '';

  const counts = new Map<string, number>();
  for (const token of normalized.toLowerCase().slice(0, 2500).match(/[\p{L}\p{N}][\p{L}\p{N}._/-]{1,}/gu) || []) {
    if (quickSearchStopWords.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const keywords = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, 8)
    .map(([token]) => token);

  return [titleLikeLine, ...keywords]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
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
  importEndpoint = '/api/funding/import',
  allowedCallModes = defaultCallModes,
  allowedGuidelineModes = defaultGuidelineModes,
  allowedTemplateModes = defaultTemplateModes,
  storageKey = defaultWizardStorageKey,
  eyebrow = 'User upload',
  title = 'Upload New Call For Proposal',
  description = 'Add a call, review the extracted details, then optionally add guidelines and templates before grant writing.',
  showProjectNameField = false,
}: FundingCallImportModalProps) {
  const [step, setStep] = useState<WizardStep>('source');
  const [mode, setMode] = useState<ImportMode>(() => allowedCallModes[0] || 'text');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [quickSearchInput, setQuickSearchInput] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState<FundingCallSearchResult[]>([]);
  const [quickSearchLoading, setQuickSearchLoading] = useState(false);
  const [quickSearchError, setQuickSearchError] = useState<string | null>(null);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [details, setDetails] = useState<FundingImportDetails | null>(null);
  const [existingCall, setExistingCall] = useState<ExistingFundingCall | null>(null);
  const [fundingCallId, setFundingCallId] = useState<string | null>(null);
  const [guidelineMode, setGuidelineMode] = useState<SourceMode>(() => allowedGuidelineModes[0] || 'skip');
  const [guidelineUrl, setGuidelineUrl] = useState('');
  const [guidelineText, setGuidelineText] = useState('');
  const [guidelineFile, setGuidelineFile] = useState<File | null>(null);
  const [guidelineState, setGuidelineState] = useState<ArtifactState>(emptyArtifactState);
  const [templateMode, setTemplateMode] = useState<SourceMode>(() => allowedTemplateModes[0] || 'skip');
  const [templateUrl, setTemplateUrl] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateState, setTemplateState] = useState<ArtifactState>(emptyArtifactState);
  const [projectName, setProjectName] = useState('');
  const [selectedPriorityAreas, setSelectedPriorityAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPollNonce, setImportPollNonce] = useState(0);
  const parallelExtractionStartedFor = useRef<string | null>(null);
  const startParallelArtifactExtractionRef = useRef<(callId: string) => void>(() => undefined);

  const importing = Boolean(details && ['queued', 'fetching', 'extracting'].includes(details.job.status));
  const callWaitMessage = useWaitMessage(loading || importing, waitMessages);
  const guidelineWaitMessage = useWaitMessage(guidelineState.status === 'extracting', guidelineWaitMessages);
  const templateWaitMessage = useWaitMessage(templateState.status === 'extracting', templateWaitMessages);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const activeMode = allowedCallModes.includes(mode) ? mode : allowedCallModes[0] || 'text';
  const activeGuidelineMode = allowedGuidelineModes.includes(guidelineMode) ? guidelineMode : allowedGuidelineModes[0] || 'skip';
  const activeTemplateMode = allowedTemplateModes.includes(templateMode) ? templateMode : allowedTemplateModes[0] || 'skip';
  const callTextOnly = allowedCallModes.length === 1 && allowedCallModes[0] === 'text';
  const guidelineTextOnly = allowedGuidelineModes.every((candidate) => candidate === 'text' || candidate === 'skip');
  const templateFileOrTextOnly = allowedTemplateModes.every((candidate) => candidate === 'file' || candidate === 'text' || candidate === 'skip');
  const compactPastedCallQuery = activeMode === 'text' ? buildCompactCallSearchQuery(sourceText) : '';
  const effectiveQuickSearchQuery = (quickSearchInput.trim() || compactPastedCallQuery).trim();
  const quickSearchSourceLabel = quickSearchInput.trim() ? 'manual search' : 'pasted text';

  const clearSavedProgress = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey);
    }
    setResumeNotice(null);
  };

  const resetWizardState = useCallback(() => {
    setStep('source');
    setMode(allowedCallModes[0] || 'text');
    setSourceUrl('');
    setSourceText('');
    setSourceFile(null);
    setQuickSearchInput('');
    setQuickSearchResults([]);
    setQuickSearchLoading(false);
    setQuickSearchError(null);
    setQuickSearchQuery('');
    setJobId(null);
    setDetails(null);
    setExistingCall(null);
    setFundingCallId(null);
    setGuidelineMode(allowedGuidelineModes[0] || 'skip');
    setGuidelineUrl('');
    setGuidelineText('');
    setGuidelineFile(null);
    setGuidelineState(emptyArtifactState);
    setTemplateMode(allowedTemplateModes[0] || 'skip');
    setTemplateUrl('');
    setTemplateText('');
    setTemplateFile(null);
    setTemplateState(emptyArtifactState);
    setProjectName('');
    setSelectedPriorityAreas([]);
    setLoading(false);
    setActionLoading(false);
    setError(null);
    setImportPollNonce(0);
    setResumeNotice(null);
    parallelExtractionStartedFor.current = null;
  }, [allowedCallModes, allowedGuidelineModes, allowedTemplateModes]);

  useEffect(() => {
    if (!open) {
      resetWizardState();
    }
  }, [open, resetWizardState]);

  useEffect(() => {
    if (!allowedCallModes.includes(mode)) {
      setMode(allowedCallModes[0] || 'text');
    }
    if (!allowedGuidelineModes.includes(guidelineMode)) {
      setGuidelineMode(allowedGuidelineModes[0] || 'skip');
    }
    if (!allowedTemplateModes.includes(templateMode)) {
      setTemplateMode(allowedTemplateModes[0] || 'skip');
    }
  }, [allowedCallModes, allowedGuidelineModes, allowedTemplateModes, guidelineMode, mode, templateMode]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const raw = window.localStorage.getItem(storageKey);
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
      setProjectName(saved.projectName || '');
      setSelectedPriorityAreas(Array.isArray(saved.selectedPriorityAreas) ? saved.selectedPriorityAreas : []);
      setResumeNotice('Restored your previous upload progress. You can continue from here.');
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [open, storageKey]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const hasProgress = Boolean(jobId || fundingCallId || details || step !== 'source');
    if (!hasProgress) return;

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        step,
        mode: activeMode,
        sourceUrl,
        sourceText: sourceText.length > 12000 ? sourceText.slice(0, 12000) : sourceText,
        jobId,
        details,
        existingCall,
        fundingCallId,
        guidelineMode: activeGuidelineMode,
        guidelineUrl,
        guidelineText: guidelineText.length > 12000 ? guidelineText.slice(0, 12000) : guidelineText,
        guidelineState,
        templateMode: activeTemplateMode,
        templateUrl,
        templateText: templateText.length > 12000 ? templateText.slice(0, 12000) : templateText,
        templateState,
        projectName,
        selectedPriorityAreas,
        savedAt: new Date().toISOString(),
      })
    );
  }, [
    details,
    existingCall,
    activeGuidelineMode,
    activeMode,
    activeTemplateMode,
    fundingCallId,
    guidelineMode,
    guidelineState,
    guidelineText,
    guidelineUrl,
    jobId,
    mode,
    open,
    projectName,
    selectedPriorityAreas,
    sourceText,
    sourceUrl,
    step,
    templateMode,
    templateState,
    templateText,
    storageKey,
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
        if (nextDetails.job.linked_funding_call_id) {
          setFundingCallId(nextDetails.job.linked_funding_call_id);
          startParallelArtifactExtractionRef.current(nextDetails.job.linked_funding_call_id);
        }

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
  }, [open, jobId, importPollNonce]);

  useEffect(() => {
    if (!open || step !== 'source') return undefined;

    const query = effectiveQuickSearchQuery;
    if (query.length < 3) {
      setQuickSearchResults([]);
      setQuickSearchError(null);
      setQuickSearchLoading(false);
      setQuickSearchQuery('');
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      setQuickSearchLoading(true);
      setQuickSearchError(null);
      setQuickSearchQuery(query);

      try {
        const params = new URLSearchParams({ limit: '8' });
        if (quickSearchInput.trim()) {
          params.set('title', query);
        } else {
          params.set('text', query);
        }
        const payload = await apiRequest<{ calls?: FundingCallSearchResult[] }>(`/api/funding/calls?${params.toString()}`, {
          signal: controller.signal,
        });
        setQuickSearchResults(Array.isArray(payload.calls) ? payload.calls : []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setQuickSearchResults([]);
        setQuickSearchError(err instanceof Error ? err.message : 'Failed to search existing funding calls');
      } finally {
        if (!controller.signal.aborted) {
          setQuickSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [effectiveQuickSearchQuery, open, quickSearchInput, step]);

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

  const draftValues = details?.draftValues || {};
  const priorityAreaOptions = useMemo(
    () => deriveGrantPrepPriorityAreaOptions({
      disciplines: draftValues.disciplines,
      focusAreas: draftValues.focusAreas || draftValues.focus_areas,
    }),
    [draftValues.disciplines, draftValues.focusAreas, draftValues.focus_areas]
  );
  const priorityAreaOptionsKey = priorityAreaOptions.join('\u0001');

  useEffect(() => {
    if (!open) return;

    if (priorityAreaOptions.length === 1) {
      setSelectedPriorityAreas(priorityAreaOptions);
      return;
    }

    if (priorityAreaOptions.length > 1) {
      setSelectedPriorityAreas((current) =>
        current.filter((selected) =>
          priorityAreaOptions.some((option) => option.toLowerCase() === selected.toLowerCase())
        )
      );
    }
  }, [open, priorityAreaOptions, priorityAreaOptionsKey]);

  if (!open) return null;

  const failedImportMessage = details?.job.error_message
    || (details?.job.error_code === 'LLM_RATE_LIMITED'
      ? 'The AI provider is rate limiting requests right now. Retry the import in about a minute.'
      : callTextOnly
        ? 'Import failed. Paste the call text again and retry.'
        : 'Import failed. Try a different URL, upload the PDF, or paste the call text instead.');
  const canSubmit = activeMode === 'url'
    ? sourceUrl.trim().length > 0
    : activeMode === 'file'
      ? Boolean(sourceFile)
      : sourceText.trim().length >= 80;
  const guidelineSummary = buildGuidelineSummary(guidelineState.run);
  const templateSummary = buildTemplateSummary(templateState.run);
  const isGuidelineComplete = (status = guidelineState.status) => status === 'accepted' || status === 'skipped';
  const isTemplateComplete = (status = templateState.status) => status === 'accepted' || status === 'skipped';
  const hasFailedImport = details?.job.status === 'failed';
  const hasFailedGuidelines = guidelineState.status === 'failed';
  const hasFailedTemplate = templateState.status === 'failed';
  const failedRequestCount = [hasFailedImport, hasFailedGuidelines, hasFailedTemplate].filter(Boolean).length;
  const hasFailedRequests = failedRequestCount > 0;
  const retryFailedLabel = failedRequestCount > 1 ? 'Retry failed requests' : 'Retry failed request';
  const activeFundingCallId = fundingCallId || details?.job.linked_funding_call_id || null;
  const requiresPriorityAreaSelection = priorityAreaOptions.length > 1;
  const canStartGrantWriting = Boolean(fundingCallId) &&
    (!requiresPriorityAreaSelection || selectedPriorityAreas.length > 0);

  const togglePriorityArea = (area: string) => {
    if (priorityAreaOptions.length === 1) {
      setSelectedPriorityAreas(priorityAreaOptions);
      return;
    }

    setSelectedPriorityAreas((current) => {
      const selected = current.some((item) => item.toLowerCase() === area.toLowerCase());
      if (selected) {
        return current.filter((item) => item.toLowerCase() !== area.toLowerCase());
      }
      return [...current, area];
    });
  };

  const submitImport = async () => {
    setLoading(true);
    setError(null);
    setDetails(null);
    setJobId(null);
    setExistingCall(null);

    try {
      let response: FundingImportCreateResponse;

      if (activeMode === 'file') {
        if (!sourceFile) return;
        const formData = new FormData();
        formData.append('inputType', 'file');
        formData.append('file', sourceFile);
        response = await apiRequest(importEndpoint, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest(importEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputType: activeMode,
            sourceUrl: activeMode === 'url' ? sourceUrl : undefined,
            sourceText: activeMode === 'text' ? sourceText : undefined,
            rawText: activeMode === 'text' ? sourceText : undefined,
          }),
        });
      }

      if (response.status === 'existing_call_found' && response.existingCall) {
        setExistingCall(response.existingCall);
        return;
      }

      const nextJobId = response.jobId || response.job?.id || null;
      if (nextJobId) {
        setJobId(nextJobId);
      }

      const nextFundingCallId = response.fundingCallId || response.job?.resultFundingCallId || null;
      if (nextFundingCallId) {
        setFundingCallId(nextFundingCallId);
        startParallelArtifactExtraction(nextFundingCallId);
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
        startParallelArtifactExtraction(response.fundingCallId);
        setStep(isGuidelineComplete() && isTemplateComplete() ? 'ready' : isGuidelineComplete() ? 'template' : 'guidelines');
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

  async function retryImportJob() {
    if (!jobId) return;
    await apiRequest(`/api/funding/imports/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    });
    setDetails((current) => current
      ? {
          ...current,
          job: {
            ...current.job,
            status: 'queued',
            error_code: null,
            error_message: null,
          },
        }
      : current
    );
    setImportPollNonce((current) => current + 1);
  }

  async function retryFailedRequests() {
    setLoading(true);
    setError(null);

    try {
      const tasks: Promise<void>[] = [];
      if (hasFailedImport && jobId) {
        tasks.push(retryImportJob());
      }
      if (activeFundingCallId && hasFailedGuidelines) {
        tasks.push(extractGuidelinesForCall(activeFundingCallId, { advanceOnSkip: false }));
      }
      if (activeFundingCallId && hasFailedTemplate) {
        tasks.push(extractTemplateForCall(activeFundingCallId, { advanceOnSkip: false }));
      }

      if (tasks.length === 0) {
        return;
      }

      const results = await Promise.allSettled(tasks);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected) {
        throw rejected.reason;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry failed requests');
    } finally {
      setLoading(false);
    }
  }

  function startParallelArtifactExtraction(callId: string, options: { includeFailed?: boolean } = {}) {
    if (!options.includeFailed && parallelExtractionStartedFor.current === callId) return;
    parallelExtractionStartedFor.current = callId;

    const tasks: Promise<void>[] = [];
    if (guidelineState.status === 'idle' || (options.includeFailed && guidelineState.status === 'failed')) {
      tasks.push(extractGuidelinesForCall(callId, { advanceOnSkip: false, skipMissingInput: true }));
    }
    if (templateState.status === 'idle' || (options.includeFailed && templateState.status === 'failed')) {
      tasks.push(extractTemplateForCall(callId, { advanceOnSkip: false, skipMissingInput: true }));
    }

    if (tasks.length > 0) {
      void Promise.allSettled(tasks);
    }
  }
  startParallelArtifactExtractionRef.current = startParallelArtifactExtraction;

  async function extractGuidelinesForCall(
    callId: string,
    options: { advanceOnSkip?: boolean; skipMissingInput?: boolean } = { advanceOnSkip: true }
  ) {
    if (activeGuidelineMode === 'skip') {
      setGuidelineState({ status: 'skipped', error: null });
      if (options.advanceOnSkip) {
        setStep(isTemplateComplete() ? 'ready' : 'template');
      }
      return;
    }

    if (options.skipMissingInput) {
      const missingFile = activeGuidelineMode === 'file' && !guidelineFile;
      const missingUrl = activeGuidelineMode === 'url' && !guidelineUrl.trim();
      const missingText = activeGuidelineMode === 'text' && guidelineText.trim().length < 40;
      if (missingFile || missingUrl || missingText) {
        setGuidelineState({ status: 'skipped', error: null });
        return;
      }
    }

    setGuidelineState({ status: 'extracting', error: null });
    setError(null);

    try {
      let response: { run: any };
      if (activeGuidelineMode === 'file') {
        if (!guidelineFile) throw new Error('Upload a guideline PDF first');
        const formData = new FormData();
        formData.append('file', guidelineFile);
        response = await apiRequest(`/api/funding/calls/${callId}/user-guidelines/extract`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest(`/api/funding/calls/${callId}/user-guidelines/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceMode: activeGuidelineMode,
            sourceUrl: activeGuidelineMode === 'url' ? guidelineUrl : undefined,
            sourceText: activeGuidelineMode === 'text' ? guidelineText : undefined,
          }),
        });
      }

      setGuidelineState({ status: 'ready', run: response.run, error: null });
    } catch (err) {
      setGuidelineState({ status: 'failed', error: err instanceof Error ? err.message : 'Failed to extract guidelines' });
    }
  }

  const extractGuidelines = async () => {
    if (!fundingCallId) return;
    await extractGuidelinesForCall(fundingCallId, { advanceOnSkip: true });
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
      setStep(isTemplateComplete() ? 'ready' : 'template');
    } catch (err) {
      setGuidelineState((current) => ({ ...current, error: err instanceof Error ? err.message : 'Failed to accept guidelines' }));
    } finally {
      setActionLoading(false);
    }
  };

  async function extractTemplateForCall(
    callId: string,
    options: { advanceOnSkip?: boolean; skipMissingInput?: boolean } = { advanceOnSkip: true }
  ) {
    if (activeTemplateMode === 'skip') {
      setTemplateState({ status: 'skipped', error: null });
      if (options.advanceOnSkip) {
        setStep(isGuidelineComplete() ? 'ready' : 'guidelines');
      }
      return;
    }

    if (options.skipMissingInput) {
      const missingFile = activeTemplateMode === 'file' && !templateFile;
      const missingUrl = activeTemplateMode === 'url' && !templateUrl.trim();
      const missingText = activeTemplateMode === 'text' && templateText.trim().length < 40;
      if (missingFile || missingUrl || missingText) {
        setTemplateState({ status: 'skipped', error: null });
        return;
      }
    }

    setTemplateState({ status: 'extracting', error: null });
    setError(null);

    try {
      let response: { asset?: any; run: any };
      if (activeTemplateMode === 'file') {
        if (!templateFile) throw new Error('Upload a template file first');
        const formData = new FormData();
        formData.append('file', templateFile);
        response = await apiRequest(`/api/funding/calls/${callId}/user-template/extract`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await apiRequest(`/api/funding/calls/${callId}/user-template/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceType: activeTemplateMode,
            sourceUrl: activeTemplateMode === 'url' ? templateUrl : undefined,
            sourceText: activeTemplateMode === 'text' ? templateText : undefined,
          }),
        });
      }

      setTemplateState({ status: 'ready', run: response.run, error: null });
    } catch (err) {
      setTemplateState({ status: 'failed', error: err instanceof Error ? err.message : 'Failed to extract template' });
    }
  }

  const extractTemplate = async () => {
    if (!fundingCallId) return;
    await extractTemplateForCall(fundingCallId, { advanceOnSkip: true });
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
      setStep(isGuidelineComplete() ? 'ready' : 'guidelines');
    } catch (err) {
      setTemplateState((current) => ({ ...current, error: err instanceof Error ? err.message : 'Failed to accept template' }));
    } finally {
      setActionLoading(false);
    }
  };

  const startGrantWriting = () => {
    if (requiresPriorityAreaSelection && selectedPriorityAreas.length === 0) {
      setError('Select at least one target priority area before starting Grant Prep.');
      return;
    }

    if (fundingCallId) {
      clearSavedProgress();
      onBeginWriting(fundingCallId, {
        projectName: showProjectNameField ? projectName.trim() || undefined : undefined,
        selectedPriorityAreas,
      });
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
                {eyebrow}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {description}
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
                  {callTextOnly
                    ? 'Paste the funding call text. URL and PDF uploads are disabled for this project creation flow.'
                    : 'Use the official URL when available. HTTP and HTTPS URLs are supported. If the call is only in a document, upload the PDF.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {allowedCallModes.includes('url') ? (
                    <SourceButton active={activeMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setMode('url')} />
                  ) : null}
                  {allowedCallModes.includes('file') ? (
                    <SourceButton active={activeMode === 'file'} icon={<FaFilePdf />} label="PDF" onClick={() => setMode('file')} />
                  ) : null}
                  {allowedCallModes.includes('text') ? (
                    <SourceButton active={activeMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setMode('text')} />
                  ) : null}
                </div>

                <div className="mt-4 rounded-md border border-amber-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Check if this call already exists</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Search by call title or funder. If you paste the call text, we also run a compact keyword check automatically.
                      </p>
                    </div>
                    {quickSearchLoading ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        <FaSpinner className="animate-spin" />
                        Searching
                      </span>
                    ) : null}
                  </div>

                  <input
                    value={quickSearchInput}
                    onChange={(event) => setQuickSearchInput(event.target.value)}
                    placeholder="Search existing calls by title, funder, or keywords"
                    className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                  />
                  {compactPastedCallQuery && !quickSearchInput.trim() ? (
                    <div className="mt-2 text-xs text-slate-500">
                      Auto-checking from pasted text: <span className="font-medium text-slate-700">{compactPastedCallQuery}</span>
                    </div>
                  ) : null}
                  {quickSearchError ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {quickSearchError}
                    </div>
                  ) : null}
                  {quickSearchResults.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50">
                      <div className="border-b border-amber-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                        Possible existing calls found from {quickSearchSourceLabel}. Review before uploading.
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {quickSearchResults.map((call) => (
                          <div key={call.id} className="border-b border-amber-100 bg-white px-3 py-3 last:border-b-0">
                            <div className="text-sm font-semibold text-slate-950">{call.title}</div>
                            <div className="mt-1 text-xs text-slate-600">
                              {[call.agencyName, formatShortDate(call.deadlineAt)].filter(Boolean).join(' • ')}
                            </div>
                            {call.summary ? (
                              <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{call.summary}</div>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a
                                href={`/finder/calls/${encodeURIComponent(call.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <FaLink />
                                Show details
                              </a>
                              <button
                                type="button"
                                onClick={() => handleExistingCall(call.id)}
                                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                              >
                                <FaPlay />
                                Use this call
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : quickSearchQuery && !quickSearchLoading && !quickSearchError ? (
                    <div className="mt-2 text-xs text-slate-500">
                      No existing calls matched “{quickSearchQuery}”.
                    </div>
                  ) : null}
                </div>

                <div className="mt-4">
                  {activeMode === 'url' ? (
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      placeholder="https://funder.example/calls/example"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : activeMode === 'file' ? (
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

              <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-sm font-semibold text-emerald-950">Parallel extraction inputs</div>
                <p className="mt-1 text-sm text-emerald-800">
                  Add guidelines and a proposal template now. After the call source is submitted, GrantMentor starts the available LLM extraction jobs in parallel.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Guidelines</div>
                      <p className="mt-1 text-sm text-slate-600">
                        {guidelineTextOnly
                          ? 'Paste separate guideline text if available, or skip.'
                          : 'Use the call source, upload a separate PDF, provide a URL, paste text, or skip.'}
                      </p>
                    </div>
                    {guidelineState.status !== 'idle' ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {guidelineState.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {allowedGuidelineModes.includes('intake') ? (
                      <SourceButton active={activeGuidelineMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setGuidelineMode('intake')} />
                    ) : null}
                    {allowedGuidelineModes.includes('file') ? (
                      <SourceButton active={activeGuidelineMode === 'file'} icon={<FaFilePdf />} label="PDF" onClick={() => setGuidelineMode('file')} />
                    ) : null}
                    {allowedGuidelineModes.includes('url') ? (
                      <SourceButton active={activeGuidelineMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setGuidelineMode('url')} />
                    ) : null}
                    {allowedGuidelineModes.includes('text') ? (
                      <SourceButton active={activeGuidelineMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setGuidelineMode('text')} />
                    ) : null}
                    {allowedGuidelineModes.includes('skip') ? (
                      <SourceButton active={activeGuidelineMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setGuidelineMode('skip')} />
                    ) : null}
                  </div>
                  <div className="mt-4">
                    {activeGuidelineMode === 'file' ? (
                      <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                        <FaFilePdf className="mb-3 text-xl text-emerald-700" />
                        <span className="font-semibold text-slate-900">{guidelineFile ? guidelineFile.name : 'Upload guideline PDF'}</span>
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(event) => setGuidelineFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    ) : activeGuidelineMode === 'url' ? (
                      <input
                        value={guidelineUrl}
                        onChange={(event) => setGuidelineUrl(event.target.value)}
                        placeholder="https://funder.example/guidelines"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    ) : activeGuidelineMode === 'text' ? (
                      <textarea
                        value={guidelineText}
                        onChange={(event) => setGuidelineText(event.target.value)}
                        rows={5}
                        placeholder="Paste the guideline text here"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    ) : activeGuidelineMode === 'skip' ? (
                      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                        Guidelines will be skipped for now.
                      </div>
                    ) : (
                      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                        Guidelines will be extracted from the call source in parallel.
                      </div>
                    )}
                  </div>
                  {guidelineState.error ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{guidelineState.error}</div>
                  ) : null}
                </div>

                <div className="rounded-md border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Proposal template</div>
                      <p className="mt-1 text-sm text-slate-600">
                        {templateFileOrTextOnly
                          ? 'Upload a funder template as PDF or image, paste template text, or skip to use the standard fallback template.'
                          : 'Upload a funder template when available. If skipped, the standard fallback template is used.'}
                      </p>
                    </div>
                    {templateState.status !== 'idle' ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {templateState.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {allowedTemplateModes.includes('intake') ? (
                      <SourceButton active={activeTemplateMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setTemplateMode('intake')} />
                    ) : null}
                    {allowedTemplateModes.includes('file') ? (
                      <SourceButton active={activeTemplateMode === 'file'} icon={<FaUpload />} label="PDF/image" onClick={() => setTemplateMode('file')} />
                    ) : null}
                    {allowedTemplateModes.includes('url') ? (
                      <SourceButton active={activeTemplateMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setTemplateMode('url')} />
                    ) : null}
                    {allowedTemplateModes.includes('text') ? (
                      <SourceButton active={activeTemplateMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setTemplateMode('text')} />
                    ) : null}
                    {allowedTemplateModes.includes('skip') ? (
                      <SourceButton active={activeTemplateMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setTemplateMode('skip')} />
                    ) : null}
                  </div>
                  <div className="mt-4">
                    {activeTemplateMode === 'file' ? (
                      <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                        <FaUpload className="mb-3 text-xl text-emerald-700" />
                        <span className="font-semibold text-slate-900">{templateFile ? templateFile.name : 'Upload template file'}</span>
                        <span className="mt-1 text-xs text-slate-500">PDF, PNG, JPG, JPEG, or WebP files are supported.</span>
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                          className="hidden"
                          onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    ) : activeTemplateMode === 'url' ? (
                      <input
                        value={templateUrl}
                        onChange={(event) => setTemplateUrl(event.target.value)}
                        placeholder="https://funder.example/template"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    ) : activeTemplateMode === 'text' ? (
                      <textarea
                        value={templateText}
                        onChange={(event) => setTemplateText(event.target.value)}
                        rows={5}
                        placeholder="Paste the proposal template text here"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    ) : activeTemplateMode === 'skip' ? (
                      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                        The standard grant application template will be used as fallback.
                      </div>
                    ) : (
                      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                        Proposal structure will be extracted from the call source in parallel.
                      </div>
                    )}
                  </div>
                  {templateState.error ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{templateState.error}</div>
                  ) : null}
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
                onClick={hasFailedRequests ? retryFailedRequests : submitImport}
                disabled={loading || importing || (!hasFailedRequests && !canSubmit)}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading || importing ? <FaSpinner className="animate-spin" /> : <FaMagic />}
                {loading || importing
                  ? 'Extracting...'
                  : hasFailedRequests
                    ? retryFailedLabel
                    : 'Start parallel extraction'}
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

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guidelines extraction</div>
                  <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${
                    guidelineState.status === 'ready' || guidelineState.status === 'accepted'
                      ? 'text-emerald-700'
                      : guidelineState.status === 'failed'
                        ? 'text-red-700'
                        : 'text-slate-600'
                  }`}>
                    {guidelineState.status === 'extracting' ? <FaSpinner className="animate-spin" /> : guidelineState.status === 'ready' || guidelineState.status === 'accepted' ? <FaCheckCircle /> : <FaArrowRight />}
                    {guidelineState.status === 'idle' ? 'Waiting for call shell' : guidelineState.status}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Template extraction</div>
                  <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${
                    templateState.status === 'ready' || templateState.status === 'accepted'
                      ? 'text-emerald-700'
                      : templateState.status === 'failed'
                        ? 'text-red-700'
                        : 'text-slate-600'
                  }`}>
                    {templateState.status === 'extracting' ? <FaSpinner className="animate-spin" /> : templateState.status === 'ready' || templateState.status === 'accepted' ? <FaCheckCircle /> : <FaArrowRight />}
                    {templateState.status === 'idle' ? 'Waiting for call shell' : templateState.status === 'skipped' ? 'standard fallback' : templateState.status}
                  </div>
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
                {hasFailedRequests ? (
                  <button
                    type="button"
                    onClick={retryFailedRequests}
                    disabled={loading || importing || actionLoading}
                    className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                  >
                    {loading || importing ? <FaSpinner className="animate-spin" /> : <FaMagic />}
                    {retryFailedLabel}
                  </button>
                ) : null}
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
                  {guidelineTextOnly
                    ? 'Guidelines help Grant Prep follow priorities, word limits, budgets, review criteria, and submission rules. Paste guideline text if available, or skip.'
                    : 'Guidelines help Grant Prep follow priorities, word limits, budgets, review criteria, and submission rules. HTTP and HTTPS URLs are supported.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {allowedGuidelineModes.includes('intake') ? (
                    <SourceButton active={activeGuidelineMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setGuidelineMode('intake')} />
                  ) : null}
                  {allowedGuidelineModes.includes('file') ? (
                    <SourceButton active={activeGuidelineMode === 'file'} icon={<FaFilePdf />} label="PDF" onClick={() => setGuidelineMode('file')} />
                  ) : null}
                  {allowedGuidelineModes.includes('url') ? (
                    <SourceButton active={activeGuidelineMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setGuidelineMode('url')} />
                  ) : null}
                  {allowedGuidelineModes.includes('text') ? (
                    <SourceButton active={activeGuidelineMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setGuidelineMode('text')} />
                  ) : null}
                  {allowedGuidelineModes.includes('skip') ? (
                    <SourceButton active={activeGuidelineMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setGuidelineMode('skip')} />
                  ) : null}
                </div>

                <div className="mt-4">
                  {activeGuidelineMode === 'file' ? (
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
                  ) : activeGuidelineMode === 'url' ? (
                    <input
                      value={guidelineUrl}
                      onChange={(event) => setGuidelineUrl(event.target.value)}
                      placeholder="https://funder.example/guidelines"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : activeGuidelineMode === 'text' ? (
                    <textarea
                      value={guidelineText}
                      onChange={(event) => setGuidelineText(event.target.value)}
                      rows={7}
                      placeholder="Paste the guideline text here"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : activeGuidelineMode === 'skip' ? (
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
                        setStep(isTemplateComplete() ? 'ready' : 'template');
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
                    {activeGuidelineMode === 'skip' ? 'Continue without guidelines' : 'Extract guidelines'}
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
                  {templateFileOrTextOnly
                    ? 'Templates help Grant Prep write into the right sections and keep required attachments visible. Upload a PDF/image template, paste text, or skip.'
                    : 'Templates help Grant Prep write into the right sections and keep required attachments visible. HTTP and HTTPS URLs are supported.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {allowedTemplateModes.includes('intake') ? (
                    <SourceButton active={activeTemplateMode === 'intake'} icon={<FaFileAlt />} label="Use call source" onClick={() => setTemplateMode('intake')} />
                  ) : null}
                  {allowedTemplateModes.includes('file') ? (
                    <SourceButton active={activeTemplateMode === 'file'} icon={<FaUpload />} label="PDF/image" onClick={() => setTemplateMode('file')} />
                  ) : null}
                  {allowedTemplateModes.includes('url') ? (
                    <SourceButton active={activeTemplateMode === 'url'} icon={<FaLink />} label="URL" onClick={() => setTemplateMode('url')} />
                  ) : null}
                  {allowedTemplateModes.includes('text') ? (
                    <SourceButton active={activeTemplateMode === 'text'} icon={<FaAlignLeft />} label="Paste text" onClick={() => setTemplateMode('text')} />
                  ) : null}
                  {allowedTemplateModes.includes('skip') ? (
                    <SourceButton active={activeTemplateMode === 'skip'} icon={<FaArrowRight />} label="Skip" onClick={() => setTemplateMode('skip')} />
                  ) : null}
                </div>

                <div className="mt-4">
                  {activeTemplateMode === 'file' ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-600 hover:border-emerald-300 hover:bg-emerald-50">
                      <FaUpload className="mb-3 text-xl text-emerald-700" />
                      <span className="font-semibold text-slate-900">{templateFile ? templateFile.name : 'Upload template file'}</span>
                      <span className="mt-1 text-xs text-slate-500">PDF, PNG, JPG, JPEG, or WebP files are supported.</span>
                      <input
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        onChange={(event) => setTemplateFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : activeTemplateMode === 'url' ? (
                    <input
                      value={templateUrl}
                      onChange={(event) => setTemplateUrl(event.target.value)}
                      placeholder="https://funder.example/template"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : activeTemplateMode === 'text' ? (
                    <textarea
                      value={templateText}
                      onChange={(event) => setTemplateText(event.target.value)}
                      rows={7}
                      placeholder="Paste the proposal template text here"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                  ) : activeTemplateMode === 'skip' ? (
                    <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                      You can continue without a funder template. Grant Prep will use the standard grant application template as a fallback.
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
                        setStep(isGuidelineComplete() ? 'ready' : 'guidelines');
                      }}
                      disabled={actionLoading}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Use standard template
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
                  {activeTemplateMode === 'skip' ? 'Use standard template' : 'Extract template'}
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
                    {templateState.status === 'accepted' ? 'Accepted' : 'Standard fallback'}
                  </div>
                </div>
              </div>

              {priorityAreaOptions.length > 0 ? (
                <div className="rounded-md border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-950">Target Priority Areas</div>
                  <p className="mt-1 text-sm text-slate-600">
                    {priorityAreaOptions.length === 1
                      ? 'This call has one basic-call priority area, so it will be used as the Grant Prep alignment anchor.'
                      : 'Select the basic-call priority areas this grant should target.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {priorityAreaOptions.map((area) => {
                      const selected = priorityAreaOptions.length === 1 ||
                        selectedPriorityAreas.some((item) => item.toLowerCase() === area.toLowerCase());
                      return (
                        <button
                          key={area}
                          type="button"
                          onClick={() => togglePriorityArea(area)}
                          disabled={priorityAreaOptions.length === 1 || actionLoading}
                          className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                            selected
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                          } ${priorityAreaOptions.length === 1 || actionLoading ? 'cursor-not-allowed opacity-75' : ''}`}
                        >
                          {area}
                        </button>
                      );
                    })}
                  </div>
                  {requiresPriorityAreaSelection && selectedPriorityAreas.length === 0 ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Select at least one target priority area to start Grant Prep.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showProjectNameField ? (
                <div className="rounded-md border border-slate-200 p-4">
                  <label htmlFor="grantProjectName" className="text-sm font-semibold text-slate-950">
                    Project name
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    Leave this blank to use the funding call title.
                  </p>
                  <input
                    id="grantProjectName"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    maxLength={200}
                    placeholder="e.g., Rural Diabetes Implementation Grant"
                    className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                </div>
              ) : null}

              <button
                type="button"
                onClick={startGrantWriting}
                disabled={!canStartGrantWriting}
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
