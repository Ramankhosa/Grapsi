import { useEffect, useState } from 'react';

type ImportMode = 'url' | 'text';

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

type FundingCallImportModalProps = {
  open: boolean;
  onClose: () => void;
  onBeginWriting: (fundingCallId: string) => void;
};

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || 'Request failed');
  }
  return payload as T;
}

export default function FundingCallImportModal({
  open,
  onClose,
  onBeginWriting,
}: FundingCallImportModalProps) {
  const [mode, setMode] = useState<ImportMode>('url');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [details, setDetails] = useState<FundingImportDetails | null>(null);
  const [existingCall, setExistingCall] = useState<ExistingFundingCall | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    let canceled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const nextDetails = await apiRequest<FundingImportDetails>(`/api/funding/import/${jobId}`);
        if (canceled) return;
        setDetails(nextDetails);
        if (['queued', 'fetching', 'extracting'].includes(nextDetails.job.status)) {
          timeoutId = setTimeout(poll, 2000);
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

  if (!open) return null;

  const duplicateCandidates = [
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

  const submitImport = async () => {
    setLoading(true);
    setError(null);
    setDetails(null);
    setJobId(null);
    setExistingCall(null);
    try {
      const response = await apiRequest<{
        jobId?: string;
        status: string;
        existingCall?: ExistingFundingCall;
      }>('/api/funding/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputType: mode,
          sourceUrl: mode === 'url' ? sourceUrl : undefined,
          sourceText: mode === 'text' ? sourceText : undefined,
        }),
      });

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

  const handleExistingCall = (fundingCallId: string) => {
    if (!jobId) {
      onBeginWriting(fundingCallId);
      return;
    }

    decide('use_existing', fundingCallId);
  };

  const decide = async (action: 'use_existing' | 'create_private_draft' | 'cancel', fundingCallId?: string) => {
    if (!jobId) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ fundingCallId?: string; status: string }>(`/api/funding/import/${jobId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          existingFundingCallId: fundingCallId,
          draft: action === 'create_private_draft' ? details?.draftValues : undefined,
        }),
      });

      if (response.fundingCallId) {
        onBeginWriting(response.fundingCallId);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve import');
    } finally {
      setActionLoading(false);
    }
  };

  const importing = details && ['queued', 'fetching', 'extracting'].includes(details.job.status);
  const failedImportMessage = details?.job.error_message
    || (details?.job.error_code === 'LLM_RATE_LIMITED'
      ? 'Gemini is rate limiting requests right now. Retry the import in about a minute.'
      : 'Import failed. Try a different URL or paste the call text instead.');
  const canSubmit = mode === 'url' ? sourceUrl.trim().length > 0 : sourceText.trim().length >= 80;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Import funding call</h2>
              <p className="mt-1 text-sm text-slate-600">Paste a call URL or source text. PDF import will be added in v2.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
              Close
            </button>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : null}

          {!jobId && !existingCall ? (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('url')}
                  className={`rounded border px-3 py-2 text-sm font-medium ${mode === 'url' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}
                >
                  URL
                </button>
                <button
                  type="button"
                  onClick={() => setMode('text')}
                  className={`rounded border px-3 py-2 text-sm font-medium ${mode === 'text' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}
                >
                  Text
                </button>
              </div>

              {mode === 'url' ? (
                <input
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://funder.example/calls/example"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              ) : (
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  rows={8}
                  placeholder="Paste the funding call text here"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              )}

              <button
                type="button"
                onClick={submitImport}
                disabled={loading || !canSubmit}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Starting import...' : 'Start import'}
              </button>
            </>
          ) : null}

          {existingCall ? (
            <div className="space-y-4">
              <div className="rounded border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  This URL is already in the active funding catalog
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
                    className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Use this existing call
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExistingCall(null);
                      onClose();
                    }}
                    className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel import
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {jobId ? (
            <div className="space-y-4">
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Status: {details?.job.status || 'queued'}
                {importing ? <span className="ml-2 text-slate-500">Reading the funding call...</span> : null}
              </div>

              {details?.job.status === 'failed' ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {failedImportMessage}
                </div>
              ) : null}

              {details?.job.status === 'needs_review' || details?.job.status === 'draft_created' ? (
                <>
                  {duplicateCandidates.length > 0 ? (
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-900">Possible existing calls</div>
                      <div className="max-h-72 space-y-2 overflow-y-auto">
                        {duplicateCandidates.map((duplicate) => (
                          <div key={duplicate.id} className="rounded border border-slate-200 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{duplicate.label}</div>
                            <div className="mt-1 font-medium text-slate-950">{duplicate.candidate.scheme_title}</div>
                            <div className="mt-1 text-sm text-slate-600">{duplicate.candidate.agency_name}</div>
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => handleExistingCall(duplicate.id)}
                                disabled={actionLoading}
                                className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-700 disabled:opacity-60"
                              >
                                Use this existing call
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={() => decide('create_private_draft')}
                      disabled={actionLoading}
                      className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      This is not my call, create private draft
                    </button>
                    <button
                      type="button"
                      onClick={() => decide('cancel')}
                      disabled={actionLoading}
                      className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel import
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
