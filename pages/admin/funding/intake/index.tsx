import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import { FUNDING_JSON_UPLOAD_CHATGPT_PROMPT } from '@/lib/fundingIntake/jsonPrompt';

type JobSummary = {
  id: string;
  batch_id?: string | null;
  input_type: 'url' | 'text' | 'pdf' | 'json';
  source_url: string | null;
  status: string;
  processing_phase?: string | null;
  error_code: string | null;
  error_message: string | null;
  duplicate_status: string;
  linked_funding_call_id: string | null;
  linked_call_status: string | null;
  created_at: string;
  updated_at: string;
  submitted_by: {
    id: string;
    email: string;
    name: string | null;
  } | null;
};

type BatchSummary = {
  id: string;
  label: string | null;
  status: string;
  total_jobs: number;
  counts: Record<string, number>;
  created_at: string;
  updated_at: string;
  submitted_by: {
    id: string;
    email: string;
    name: string | null;
  } | null;
};

type BatchSourceForm = {
  sourceKey: 'source_1' | 'source_2' | 'source_3';
  inputType: 'url' | 'text' | 'pdf' | 'json';
  sourceUrl: string;
  sourceText: string;
  sourceFile: File | null;
};

type BatchJobForm = {
  localId: string;
  operatorNotes: string;
  detailsSourceKey: 'source_1' | 'source_2' | 'source_3';
  guidelinesSourceKey: 'source_1' | 'source_2' | 'source_3';
  templateSourceKey: 'source_1' | 'source_2' | 'source_3';
  sources: BatchSourceForm[];
};

const SOURCE_KEYS: Array<BatchSourceForm['sourceKey']> = ['source_1', 'source_2', 'source_3'];

function createBatchSource(index = 0): BatchSourceForm {
  return {
    sourceKey: SOURCE_KEYS[index] || 'source_1',
    inputType: 'url',
    sourceUrl: '',
    sourceText: '',
    sourceFile: null,
  };
}

function createBatchJob(): BatchJobForm {
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operatorNotes: '',
    detailsSourceKey: 'source_1',
    guidelinesSourceKey: 'source_1',
    templateSourceKey: 'source_1',
    sources: [createBatchSource(0)],
  };
}

function readApiErrorMessage(data: any, fallback: string) {
  if (data && typeof data === 'object') {
    const message = typeof data.message === 'string'
      ? data.message
      : typeof data.error === 'string'
        ? data.error
        : null;
    if (message && message.trim()) {
      return message;
    }
  }
  return fallback;
}

function formatJobErrorCode(errorCode: string | null | undefined) {
  switch (errorCode) {
    case 'LLM_RATE_LIMITED':
      return 'Gemini rate limited';
    case 'pdf_intake_requires_gemini':
      return 'Gemini required for PDF intake';
    default:
      return errorCode || 'Processing failed';
  }
}

function getBatchStatusBadgeClass(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'needs_review':
      return 'bg-amber-100 text-amber-800';
    case 'partially_failed':
    case 'failed':
      return 'bg-rose-100 text-rose-700';
    case 'canceled':
      return 'bg-slate-200 text-slate-700';
    case 'processing':
    default:
      return 'bg-sky-100 text-sky-700';
  }
}

export default function FundingIntakeAdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [inputType, setInputType] = useState<'url' | 'text' | 'pdf' | 'json'>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourcePdf, setSourcePdf] = useState<File | null>(null);
  const [sourceJson, setSourceJson] = useState<File | null>(null);
  const [showJsonPrompt, setShowJsonPrompt] = useState(false);
  const [operatorNotes, setOperatorNotes] = useState('');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchLabel, setBatchLabel] = useState('');
  const [batchJobs, setBatchJobs] = useState<BatchJobForm[]>([createBatchJob()]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [actioningJobId, setActioningJobId] = useState<string | null>(null);

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

  const activeJobs = useMemo(
    () => jobs.filter((job) => ['queued', 'fetching', 'extracting'].includes(job.status)),
    [jobs]
  );
  const activeBatches = useMemo(
    () => batches.filter((batch) => batch.status === 'processing'),
    [batches]
  );

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && canReadFundingIntake) {
      void loadJobs();
      void loadBatches();
    }
  }, [user, canReadFundingIntake]);

  useEffect(() => {
    if (!activeJobs.length && !activeBatches.length) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJobs(false);
      void loadBatches(false);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [activeJobs.length, activeBatches.length]);

  async function loadJobs(showSpinner = true) {
    if (showSpinner) {
      setLoadingJobs(true);
    }

    try {
      const response = await fetch('/api/admin/funding/intake');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, 'Failed to load intake jobs'));
      }
      setJobs(data.jobs || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load intake jobs');
    } finally {
      if (showSpinner) {
        setLoadingJobs(false);
      }
    }
  }

  async function loadBatches(showSpinner = true) {
    if (showSpinner) {
      setLoadingBatches(true);
    }

    try {
      const response = await fetch('/api/admin/funding/intake/batches');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, 'Failed to load intake batches'));
      }
      setBatches(data.batches || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load intake batches');
    } finally {
      if (showSpinner) {
        setLoadingBatches(false);
      }
    }
  }

  function updateBatchJob(jobIndex: number, patch: Partial<BatchJobForm>) {
    setBatchJobs((current) => current.map((job, index) => index === jobIndex ? { ...job, ...patch } : job));
  }

  function updateBatchSource(jobIndex: number, sourceIndex: number, patch: Partial<BatchSourceForm>) {
    setBatchJobs((current) => current.map((job, index) => {
      if (index !== jobIndex) {
        return job;
      }
      const nextSources = job.sources.map((source, itemIndex) => itemIndex === sourceIndex ? { ...source, ...patch } : source);
      const availableKeys = nextSources.map((source) => source.sourceKey);
      const fallbackKey = availableKeys[0] || 'source_1';
      return {
        ...job,
        sources: nextSources,
        detailsSourceKey: availableKeys.includes(job.detailsSourceKey) ? job.detailsSourceKey : fallbackKey,
        guidelinesSourceKey: availableKeys.includes(job.guidelinesSourceKey) ? job.guidelinesSourceKey : fallbackKey,
        templateSourceKey: availableKeys.includes(job.templateSourceKey) ? job.templateSourceKey : fallbackKey,
      };
    }));
  }

  function addBatchSource(jobIndex: number) {
    setBatchJobs((current) => current.map((job, index) => {
      if (index !== jobIndex || job.sources.length >= 3) {
        return job;
      }
      const usedKeys = new Set(job.sources.map((source) => source.sourceKey));
      const nextKey = SOURCE_KEYS.find((key) => !usedKeys.has(key)) || SOURCE_KEYS[job.sources.length];
      return {
        ...job,
        sources: [...job.sources, createBatchSource(SOURCE_KEYS.indexOf(nextKey))],
      };
    }));
  }

  function removeBatchSource(jobIndex: number, sourceIndex: number) {
    setBatchJobs((current) => current.map((job, index) => {
      if (index !== jobIndex || job.sources.length === 1) {
        return job;
      }
      const nextSources = job.sources.filter((_, itemIndex) => itemIndex !== sourceIndex);
      const fallbackKey = nextSources[0]?.sourceKey || 'source_1';
      const availableKeys = nextSources.map((source) => source.sourceKey);
      return {
        ...job,
        sources: nextSources,
        detailsSourceKey: availableKeys.includes(job.detailsSourceKey) ? job.detailsSourceKey : fallbackKey,
        guidelinesSourceKey: availableKeys.includes(job.guidelinesSourceKey) ? job.guidelinesSourceKey : fallbackKey,
        templateSourceKey: availableKeys.includes(job.templateSourceKey) ? job.templateSourceKey : fallbackKey,
      };
    }));
  }

  async function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteFundingIntake) {
      toast.error('Funding operations write access required.');
      return;
    }

    setBatchSubmitting(true);
    try {
      const hasFiles = batchJobs.some((job) => job.sources.some((source) => source.sourceFile));
      const payload = {
        label: batchLabel.trim() || undefined,
        jobs: batchJobs.map((job) => ({
          operatorNotes: job.operatorNotes.trim() || undefined,
          detailsSourceKey: job.detailsSourceKey,
          guidelinesSourceKey: job.guidelinesSourceKey,
          templateSourceKey: job.templateSourceKey,
          autoCreateDraft: true,
          extractAll: true,
          sources: job.sources.map((source) => ({
            sourceKey: source.sourceKey,
            inputType: source.inputType,
            sourceUrl: source.inputType === 'url' ? source.sourceUrl : undefined,
            sourceText: source.inputType === 'text' ? source.sourceText : undefined,
          })),
        })),
      };

      const response = hasFiles
        ? await (async () => {
            const formData = new FormData();
            formData.append('payload', JSON.stringify(payload));
            batchJobs.forEach((job, jobIndex) => {
              job.sources.forEach((source) => {
                if (source.sourceFile) {
                  formData.append(`file_${jobIndex}_${source.sourceKey}`, source.sourceFile);
                }
              });
            });
            return fetch('/api/admin/funding/intake/batches', {
              method: 'POST',
              body: formData,
            });
          })()
        : await fetch('/api/admin/funding/intake/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, 'Failed to create funding intake batch'));
      }

      toast.success('Funding intake batch created');
      setBatchLabel('');
      setBatchJobs([createBatchJob()]);
      await Promise.all([loadJobs(false), loadBatches(false)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create funding intake batch');
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteFundingIntake) {
      toast.error('Funding operations write access required.');
      return;
    }
    setSubmitting(true);

    try {
      const response = inputType === 'pdf' || inputType === 'json'
        ? await (async () => {
            const formData = new FormData();
            const file = inputType === 'json' ? sourceJson : sourcePdf;
            if (file) {
              formData.append('file', file);
            }
            formData.append('inputType', inputType);
            formData.append('operatorNotes', operatorNotes);
            return fetch('/api/admin/funding/intake', {
              method: 'POST',
              body: formData,
            });
          })()
        : await fetch('/api/admin/funding/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputType,
              sourceUrl: inputType === 'url' ? sourceUrl : undefined,
              sourceText: inputType === 'text' ? sourceText : undefined,
              operatorNotes,
            }),
          });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, 'Failed to create funding intake job'));
      }

      toast.success('Funding intake job created');
      setSourceUrl('');
      setSourceText('');
      setSourcePdf(null);
      setSourceJson(null);
      setOperatorNotes('');
      await loadJobs(false);
      router.push(`/admin/funding/intake/${data.jobId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create funding intake job');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJobAction(jobId: string, action: 'retry' | 'cancel') {
    if (!canWriteFundingIntake) {
      toast.error('Funding operations write access required.');
      return;
    }
    try {
      setActioningJobId(`${jobId}:${action}`);
      const response = await fetch(`/api/admin/funding/intake/${jobId}/${action}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, `Failed to ${action} job`));
      }
      toast.success(`Job ${action}ed`);
      await loadJobs(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${action} job`);
    } finally {
      setActioningJobId(null);
    }
  }

  async function handleArchiveLinkedCall(job: JobSummary) {
    if (!job.linked_funding_call_id) {
      return;
    }

    if (!canPublishFunding) {
      toast.error('Funding publishing access required.');
      return;
    }

    if (!window.confirm('Archive the published funding call first? You can delete the intake job after archiving.')) {
      return;
    }

    try {
      setActioningJobId(`${job.id}:archive`);
      const response = await fetch(`/api/admin/funding/calls/${job.linked_funding_call_id}/archive`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(readApiErrorMessage(data, 'Failed to archive funding call'));
      }
      toast.success('Published funding call archived. Delete is now enabled.');
      await loadJobs(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive funding call');
    } finally {
      setActioningJobId(null);
    }
  }

  async function handleDeleteJob(job: JobSummary) {
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }

    if (
      !window.confirm(
        'Delete this intake job? Any unpublished draft, guideline, template, and uploaded intake artifacts created by this job will also be removed.'
      )
    ) {
      return;
    }

    try {
      setActioningJobId(`${job.id}:delete`);
      const response = await fetch(`/api/admin/funding/intake/${job.id}/delete`, {
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
        throw new Error(readApiErrorMessage(data, 'Failed to delete intake job'));
      }
      toast.success(data.deletedFundingCallId ? 'Intake job and linked unpublished call deleted.' : 'Intake job deleted.');
      await loadJobs(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete intake job');
    } finally {
      setActioningJobId(null);
    }
  }

  async function handleCopyJsonPrompt() {
    try {
      await navigator.clipboard.writeText(FUNDING_JSON_UPLOAD_CHATGPT_PROMPT);
      toast.success('JSON extraction prompt copied.');
    } catch {
      toast.error('Could not copy prompt from this browser.');
    }
  }

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading...</div>;
  }

  if (!canReadFundingIntake) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Funding intake is restricted</h1>
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
        <title>Funding Intake</title>
      </Head>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding Intake</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Create structured funding drafts from URL, text, PDF, or JSON</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              Submit a funding opportunity source, or upload a ChatGPT-extracted JSON file that can seed call fields, guidelines, and templates from one intake job.
            </p>
          </div>
          <Link href="/admin" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
            Back to Admin
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
          <section id="submit-intake-source" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Submit intake source</h2>
            {!canWriteFundingIntake && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Viewer access is read-only. Funding operations access is required to create or modify intake jobs.
              </div>
            )}
            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setInputType('url')}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${inputType === 'url' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  URL
                </button>
                <button
                  type="button"
                  onClick={() => setInputType('text')}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${inputType === 'text' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => setInputType('pdf')}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${inputType === 'pdf' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setInputType('json')}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${inputType === 'json' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  JSON Uploading
                </button>
              </div>

              {inputType === 'url' ? (
                <label key="intake-url-input" className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Funding opportunity URL</span>
                  <input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    disabled={!canWriteFundingIntake}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="https://agency.example.org/funding/call"
                  />
                </label>
              ) : inputType === 'text' ? (
                <label key="intake-text-input" className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Funding opportunity text</span>
                  <textarea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    rows={12}
                    disabled={!canWriteFundingIntake}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    placeholder="Paste the funding opportunity announcement here"
                  />
                </label>
              ) : inputType === 'pdf' ? (
                <label key="intake-pdf-input" className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Funding opportunity PDF</span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(event) => setSourcePdf(event.target.files?.[0] || null)}
                    disabled={!canWriteFundingIntake}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-2 text-xs text-slate-500">PDF intake stores the uploaded file once, derives canonical text from it, and reuses that same source for extract-all.</p>
                </label>
              ) : (
                <div key="intake-json-input" className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">ChatGPT extraction JSON</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(event) => setSourceJson(event.target.files?.[0] || null)}
                      disabled={!canWriteFundingIntake}
                      className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    />
                    <p className="mt-2 text-xs text-slate-500">JSON intake skips the internal extractor for call fields. When the draft is saved, included guideline and template JSON are imported into their review tabs.</p>
                  </label>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">ChatGPT JSON extraction prompt</div>
                        <div className="mt-1 text-xs text-slate-500">Use this prompt with the call data, then upload the returned JSON here.</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowJsonPrompt((value) => !value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                        >
                          {showJsonPrompt ? 'Hide Prompt' : 'Show Prompt'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyJsonPrompt}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                        >
                          Copy Prompt
                        </button>
                      </div>
                    </div>
                    {showJsonPrompt && (
                      <textarea
                        readOnly
                        value={FUNDING_JSON_UPLOAD_CHATGPT_PROMPT}
                        rows={14}
                        className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 font-mono text-xs leading-5 text-slate-700"
                      />
                    )}
                  </div>
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Operator notes</span>
                <textarea
                  value={operatorNotes}
                  onChange={(event) => setOperatorNotes(event.target.value)}
                  rows={3}
                  disabled={!canWriteFundingIntake}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Optional reviewer notes for the draft or source"
                />
              </label>

              <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                V1 rules: only HTTPS URLs are accepted for web intake, private-network URLs are blocked, PDF transcription requires Gemini multimodal support, JSON uploads must match the prompt schema, and extraction runs asynchronously.
              </div>

                <button
                  type="submit"
                  disabled={!canWriteFundingIntake || submitting || (inputType === 'pdf' && !sourcePdf) || (inputType === 'json' && !sourceJson)}
                  className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                {submitting ? 'Submitting...' : 'Create Intake Job'}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Queue snapshot</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-900 p-4 text-white">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Active jobs</div>
                <div className="mt-2 text-3xl font-semibold">{activeJobs.length}</div>
              </div>
              <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
                <div className="text-xs uppercase tracking-[0.2em] text-amber-700">Needs review</div>
                <div className="mt-2 text-3xl font-semibold">{jobs.filter((job) => job.status === 'needs_review').length}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
                <div className="text-xs uppercase tracking-[0.2em] text-emerald-700">Drafts saved</div>
                <div className="mt-2 text-3xl font-semibold">{jobs.filter((job) => job.status === 'draft_created').length}</div>
              </div>
            </div>
          </section>
        </div>

        <section id="batch-composer" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Batch composer</h2>
              <p className="mt-1 text-sm text-slate-600">Submit multiple calls with reusable source slots. Details are required; guidelines and template default to the details source.</p>
            </div>
            <button
              type="button"
              onClick={() => setBatchJobs((current) => [...current, createBatchJob()])}
              disabled={!canWriteFundingIntake}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Call
            </button>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleBatchSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Batch label</span>
              <input
                value={batchLabel}
                onChange={(event) => setBatchLabel(event.target.value)}
                disabled={!canWriteFundingIntake}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                placeholder="June batch, agency scrape, manual import..."
              />
            </label>

            {batchJobs.map((batchJob, jobIndex) => {
              const sourceKeys = batchJob.sources.map((source) => source.sourceKey);
              return (
                <div key={batchJob.localId} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">Call {jobIndex + 1}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addBatchSource(jobIndex)}
                        disabled={!canWriteFundingIntake || batchJob.sources.length >= 3}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add Source
                      </button>
                      {batchJobs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setBatchJobs((current) => current.filter((_, index) => index !== jobIndex))}
                          disabled={!canWriteFundingIntake}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
                        >
                          Remove Call
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    {batchJob.sources.map((source, sourceIndex) => (
                      <div key={source.sourceKey} className="rounded-lg bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={source.sourceKey}
                            onChange={(event) => updateBatchSource(jobIndex, sourceIndex, { sourceKey: event.target.value as BatchSourceForm['sourceKey'] })}
                            disabled={!canWriteFundingIntake}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                          >
                            {SOURCE_KEYS.map((key) => (
                              <option key={key} value={key} disabled={sourceKeys.includes(key) && key !== source.sourceKey}>
                                {key.replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                          {batchJob.sources.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeBatchSource(jobIndex, sourceIndex)}
                              disabled={!canWriteFundingIntake}
                              className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-medium text-rose-700"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <select
                          value={source.inputType}
                          onChange={(event) => updateBatchSource(jobIndex, sourceIndex, { inputType: event.target.value as BatchSourceForm['inputType'], sourceFile: null })}
                          disabled={!canWriteFundingIntake}
                          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <option value="url">URL</option>
                          <option value="text">Text</option>
                          <option value="pdf">PDF</option>
                          <option value="json">JSON</option>
                        </select>

                        {source.inputType === 'url' ? (
                          <input
                            value={source.sourceUrl}
                            onChange={(event) => updateBatchSource(jobIndex, sourceIndex, { sourceUrl: event.target.value })}
                            disabled={!canWriteFundingIntake}
                            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                            placeholder="https://..."
                          />
                        ) : source.inputType === 'text' ? (
                          <textarea
                            value={source.sourceText}
                            onChange={(event) => updateBatchSource(jobIndex, sourceIndex, { sourceText: event.target.value })}
                            rows={5}
                            disabled={!canWriteFundingIntake}
                            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                            placeholder="Paste source text"
                          />
                        ) : (
                          <input
                            type="file"
                            accept={source.inputType === 'pdf' ? '.pdf,application/pdf' : '.json,application/json'}
                            onChange={(event) => updateBatchSource(jobIndex, sourceIndex, { sourceFile: event.target.files?.[0] || null })}
                            disabled={!canWriteFundingIntake}
                            className="mt-3 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      ['detailsSourceKey', 'Details source'],
                      ['guidelinesSourceKey', 'Guidelines source'],
                      ['templateSourceKey', 'Template source'],
                    ].map(([field, label]) => (
                      <label key={field} className="block">
                        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                        <select
                          value={(batchJob as any)[field]}
                          onChange={(event) => updateBatchJob(jobIndex, { [field]: event.target.value } as any)}
                          disabled={!canWriteFundingIntake}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          {sourceKeys.map((key) => (
                            <option key={key} value={key}>{key.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  <textarea
                    value={batchJob.operatorNotes}
                    onChange={(event) => updateBatchJob(jobIndex, { operatorNotes: event.target.value })}
                    rows={2}
                    disabled={!canWriteFundingIntake}
                    className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                    placeholder="Optional notes for this call"
                  />
                </div>
              );
            })}

            <button
              type="submit"
              disabled={!canWriteFundingIntake || batchSubmitting}
              className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {batchSubmitting ? 'Submitting Batch...' : 'Submit Batch'}
            </button>
          </form>
        </section>

        <section id="recent-batches" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent batches</h2>
              <p className="mt-1 text-sm text-slate-600">Batch status is derived from its child jobs.</p>
            </div>
            <button
              type="button"
              onClick={() => loadBatches()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Refresh
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            {loadingBatches ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading batches...</div>
            ) : batches.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No batch submissions yet.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Batch</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Jobs</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Created</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td className="px-4 py-4 align-top">
                        <div className="font-medium text-slate-900">{batch.label || 'Untitled batch'}</div>
                        <div className="mt-1 text-xs text-slate-500">{batch.submitted_by?.name || batch.submitted_by?.email || 'Unknown'}</div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${getBatchStatusBadgeClass(batch.status)}`}>
                          {batch.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">
                        {batch.total_jobs} total · {batch.counts.needs_review || 0} review · {batch.counts.draft_created || 0} saved · {batch.counts.failed || 0} failed
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">{new Date(batch.created_at).toLocaleString()}</td>
                      <td className="px-4 py-4 align-top">
                        <Link
                          href={`/api/admin/funding/intake/batches/${batch.id}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                        >
                          JSON Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section id="recent-intake-jobs" className="mt-8 scroll-mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent intake jobs</h2>
              <p className="mt-1 text-sm text-slate-600">Review progress, duplicate state, and linked drafts.</p>
            </div>
            <button
              type="button"
              onClick={() => loadJobs()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Refresh
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            {loadingJobs ? (
              <div className="py-12 text-center text-sm text-slate-500">Loading intake jobs...</div>
            ) : jobs.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">No funding intake jobs yet.</div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Source</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Submitter</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Duplicates</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Created</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Draft</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="px-4 py-4 align-top text-slate-700">
                        <div className="font-medium uppercase tracking-[0.18em] text-xs text-slate-500">{job.input_type}</div>
                        <div className="mt-1 max-w-sm break-all text-slate-800">
                          {job.source_url || (job.input_type === 'json' ? 'JSON upload' : job.input_type === 'pdf' ? 'PDF upload' : 'Text submission')}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">
                        {job.submitted_by?.name || job.submitted_by?.email || 'Unknown'}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                          {job.status.replace('_', ' ')}
                        </span>
                        {job.status === 'failed' && job.error_message && (
                          <div className="mt-2 max-w-sm rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                            <div className="font-medium text-rose-800">{formatJobErrorCode(job.error_code)}</div>
                            <div className="mt-1">{job.error_message}</div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-slate-600">{job.duplicate_status.replace('_', ' ')}</td>
                      <td className="px-4 py-4 align-top text-slate-600">{new Date(job.created_at).toLocaleString()}</td>
                      <td className="px-4 py-4 align-top text-slate-600">
                        {job.linked_funding_call_id ? (
                          <div className="space-y-2">
                            <Link
                              href={`/admin/funding/catalog/${job.linked_funding_call_id}`}
                              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                            >
                              Open Draft
                            </Link>
                            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                              {job.linked_call_status || 'unknown'}
                            </div>
                          </div>
                        ) : (
                          'Not saved'
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/funding/intake/${job.id}`}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
                          >
                            Open
                          </Link>
                          {job.linked_funding_call_id && (
                            <Link
                              href={`/admin/funding/catalog/${job.linked_funding_call_id}`}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                            >
                              Catalog
                            </Link>
                          )}
                          {job.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => handleJobAction(job.id, 'retry')}
                              disabled={!canWriteFundingIntake || actioningJobId !== null}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
                            >
                              {actioningJobId === `${job.id}:retry` ? 'Retrying...' : 'Retry'}
                            </button>
                          )}
                          {['queued', 'fetching', 'extracting'].includes(job.status) && (
                            <button
                              type="button"
                              onClick={() => handleJobAction(job.id, 'cancel')}
                              disabled={!canWriteFundingIntake || actioningJobId !== null}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
                            >
                              {actioningJobId === `${job.id}:cancel` ? 'Canceling...' : 'Cancel'}
                            </button>
                          )}
                          {!['queued', 'fetching', 'extracting'].includes(job.status) && job.linked_call_status === 'PUBLISHED' && job.linked_funding_call_id && (
                            <button
                              type="button"
                              onClick={() => handleArchiveLinkedCall(job)}
                              disabled={!canPublishFunding || actioningJobId !== null}
                              className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actioningJobId === `${job.id}:archive` ? 'Archiving...' : 'Archive Call'}
                            </button>
                          )}
                          {!['queued', 'fetching', 'extracting'].includes(job.status) && job.linked_call_status !== 'PUBLISHED' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteJob(job)}
                              disabled={!canWriteFundingIntake || actioningJobId !== null}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actioningJobId === `${job.id}:delete` ? 'Deleting...' : 'Delete'}
                            </button>
                          )}
                        </div>
                        {job.linked_call_status === 'PUBLISHED' && (
                          <div className="mt-2 text-xs text-slate-500">Archive the published call first, then delete.</div>
                        )}
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
