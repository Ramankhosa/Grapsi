import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';

type JobSummary = {
  id: string;
  input_type: 'url' | 'text' | 'pdf';
  source_url: string | null;
  status: string;
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

export default function FundingIntakeAdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [inputType, setInputType] = useState<'url' | 'text' | 'pdf'>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourcePdf, setSourcePdf] = useState<File | null>(null);
  const [operatorNotes, setOperatorNotes] = useState('');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actioningJobId, setActioningJobId] = useState<string | null>(null);

  const userRoles = user?.roles || [];
  const canReadFundingIntake = userRoles.includes('SUPER_ADMIN') || userRoles.includes('SUPER_ADMIN_VIEWER');
  const canWriteFundingIntake = userRoles.includes('SUPER_ADMIN');

  const activeJobs = useMemo(
    () => jobs.filter((job) => ['queued', 'fetching', 'extracting'].includes(job.status)),
    [jobs]
  );

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && canReadFundingIntake) {
      void loadJobs();
    }
  }, [user, canReadFundingIntake]);

  useEffect(() => {
    if (!activeJobs.length) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJobs(false);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [activeJobs.length]);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
      return;
    }
    setSubmitting(true);

    try {
      const response = inputType === 'pdf'
        ? await (async () => {
            const formData = new FormData();
            if (sourcePdf) {
              formData.append('file', sourcePdf);
            }
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
      toast.error('Write access required. You have viewer-only access.');
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

    if (!canWriteFundingIntake) {
      toast.error('Write access required. You have viewer-only access.');
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
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Create structured funding drafts from URL, text, or PDF</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600">
              Submit a funding opportunity source, let the extractor build a structured draft, then review, author guidelines and templates, and publish from the intake workspace.
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
                Viewer access is read-only. Only SUPER_ADMIN users can create or modify intake jobs.
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
              ) : (
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
                V1 rules: only HTTPS URLs are accepted for web intake, private-network URLs are blocked, PDF transcription requires Gemini multimodal support, and extraction runs asynchronously.
              </div>

                <button
                  type="submit"
                  disabled={!canWriteFundingIntake || submitting || (inputType === 'pdf' && !sourcePdf)}
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

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
                          {job.source_url || 'Text submission'}
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
                              disabled={!canWriteFundingIntake || actioningJobId !== null}
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
