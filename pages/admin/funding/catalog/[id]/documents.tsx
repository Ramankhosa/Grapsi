import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';

import Header from '@/components/Header';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import { useAuth } from '@/lib/auth-context';

type DocumentRecord = {
  id: string;
  funding_call_id: string;
  version: number;
  is_active: boolean;
  document_kind: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  parsing_status: string;
  parsing_error: string | null;
  parsing_stats: Record<string, any> | null;
  embedding_status: string;
  quality_flags: QualityReport | null;
  needs_manual_review: boolean;
  created_at: string;
  counts?: {
    pages: number;
    sections: number;
    chunks: number;
    events: number;
    chunkEmbeddings: Record<string, number>;
  };
  sections?: DocumentSection[];
  events?: Array<{ id: string; event_type: string; created_at: string; payload: any }>;
};

type DocumentSection = {
  id: string;
  section_type: string;
  section_title: string | null;
  section_text: string;
  start_page: number;
  end_page: number;
  order_index: number;
  confidence: number | null;
  classification_method: string;
};

type QualityReport = {
  presence?: Record<string, boolean>;
  flags?: Array<{
    code: string;
    severity: 'info' | 'warning' | 'conflict';
    message: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    structuredValue?: unknown;
    documentValue?: unknown;
  }>;
  conflicts?: Array<{ code: string; message: string; structuredValue?: unknown; documentValue?: unknown }>;
  needsManualReview?: boolean;
};

function statusTone(status: string) {
  if (['completed', 'generated'].includes(status)) return 'bg-emerald-100 text-emerald-800';
  if (['processing', 'pending', 'not_generated', 'partial'].includes(status)) return 'bg-amber-100 text-amber-900';
  if (status === 'failed') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-slate-700';
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${statusTone(value)}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  call_document: 'Call document',
  guideline_document: 'Guidelines',
  template_document: 'Template',
};

function KindBadge({ kind }: { kind: string | null | undefined }) {
  const tone = kind === 'guideline_document'
    ? 'bg-sky-100 text-sky-800'
    : kind === 'template_document'
      ? 'bg-violet-100 text-violet-800'
      : 'bg-slate-100 text-slate-700';
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${tone}`}>
      {DOCUMENT_KIND_LABELS[kind || 'call_document'] || 'Call document'}
    </span>
  );
}

function formatPages(start: number, end: number) {
  if (!start) return 'section';
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

function QualityPanel({ report }: { report: QualityReport | null }) {
  if (!report) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Quality</h2>
        <p className="mt-3 text-sm text-slate-500">Quality checks have not run yet.</p>
      </section>
    );
  }

  const conflicts = report.conflicts || [];
  const flags = report.flags || [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Quality</h2>
          <p className="mt-1 text-sm text-slate-600">Presence checks and structured-field conflict signals.</p>
        </div>
        {report.needsManualReview && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-900">
            Manual review
          </span>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-950">Possible conflict: manual review required</div>
          <div className="mt-3 space-y-2">
            {conflicts.map((conflict, index) => (
              <div key={`${conflict.code}-${index}`} className="text-sm text-amber-900">
                {conflict.message}
                {conflict.structuredValue !== undefined && (
                  <span> Structured: {String(conflict.structuredValue)}.</span>
                )}
                {conflict.documentValue !== undefined && (
                  <span> Document: {String(conflict.documentValue)}.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {Object.entries(report.presence || {}).map(([key, present]) => (
          <div key={key} className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{key}</div>
            <div className={`mt-1 text-sm font-semibold ${present ? 'text-emerald-700' : 'text-amber-800'}`}>
              {present ? 'Found' : 'Missing'}
            </div>
          </div>
        ))}
      </div>

      {flags.length > 0 && (
        <div className="mt-5 space-y-2">
          {flags.map((flag, index) => (
            <div key={`${flag.code}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium text-slate-900">{flag.severity}:</span> {flag.message}
              {flag.pageStart ? <span className="text-slate-500"> ({formatPages(flag.pageStart, flag.pageEnd || flag.pageStart)})</span> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionsTable({ sections }: { sections: DocumentSection[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!sections.length) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
        <p className="mt-3 text-sm text-slate-500">No sections extracted yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sections.map((section) => (
              <tr key={section.id} className="align-top">
                <td className="px-4 py-3 font-medium text-slate-900">{section.section_type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => (current === section.id ? null : section.id))}
                    className="text-left font-medium text-slate-900 hover:text-emerald-700"
                  >
                    {section.section_title || 'Untitled section'}
                  </button>
                  {expanded === section.id && (
                    <div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                      {section.section_text}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatPages(section.start_page, section.end_page)}</td>
                <td className="px-4 py-3 text-slate-600">{section.classification_method}</td>
                <td className="px-4 py-3 text-slate-600">{section.confidence == null ? '-' : `${Math.round(section.confidence * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}

export default function FundingDocumentsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<'call_document' | 'guideline_document' | 'template_document'>('call_document');

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
  const canWrite = userRoles.includes('SUPER_ADMIN') || isPlatformAdmin || platformPermissions.includes('funding.operations.write');
  const activeDocument = useMemo(() => documents.find((document) => document.is_active) || documents[0] || null, [documents]);
  const currentDocument = detail || activeDocument;
  const isBusy = documents.some((document) => (
    ['pending', 'processing'].includes(document.parsing_status) ||
    document.embedding_status === 'processing'
  ));

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && isFundingOperator && id) {
      void loadDocuments(true);
    }
  }, [user, id, isFundingOperator]);

  useEffect(() => {
    if (!isBusy || !id || !user || !isFundingOperator) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadDocuments(false);
      if (selectedId) {
        void loadDetail(selectedId, false);
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isBusy, id, user, isFundingOperator, selectedId]);

  useEffect(() => {
    const nextId = selectedId || activeDocument?.id || null;
    if (nextId && id) {
      void loadDetail(nextId, false);
    } else {
      setDetail(null);
    }
  }, [selectedId, activeDocument?.id, id]);

  async function loadDocuments(showSpinner = true) {
    if (!id) return;
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/documents`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load documents');
      setDocuments(data.documents || []);
      if (!selectedId && data.documents?.[0]) {
        setSelectedId(data.documents.find((document: DocumentRecord) => document.is_active)?.id || data.documents[0].id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load documents');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  async function loadDetail(documentId: string, showToast = true) {
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/documents/${documentId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load document detail');
      setDetail(data.document);
    } catch (error) {
      if (showToast) toast.error(error instanceof Error ? error.message : 'Failed to load document detail');
    }
  }

  async function handleUpload() {
    if (!id || !file) return;
    if (!canWrite) {
      toast.error('Funding operations write access required.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('documentKind', uploadKind);
      const response = await fetch(`/api/admin/funding/calls/${id}/documents`, {
        method: 'POST',
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to upload document');
      toast.success(data.message || 'Document uploaded');
      setFile(null);
      setSelectedId(data.document?.id || null);
      await loadDocuments(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function runAction(action: 'reprocess' | 'reembed' | 'activate' | 'deactivate' | 'sync-intake', documentId?: string) {
    if (!id) return;
    if (!canWrite) {
      toast.error('Funding operations write access required.');
      return;
    }
    setActing(true);
    try {
      const url = action === 'sync-intake'
        ? `/api/admin/funding/calls/${id}/documents`
        : `/api/admin/funding/calls/${id}/documents/${documentId}/${action === 'deactivate' ? 'activate' : action}`;
      const body = action === 'sync-intake'
        ? JSON.stringify({ sourceMode: 'intake' })
        : action === 'activate' || action === 'deactivate'
          ? JSON.stringify({ active: action === 'activate' })
          : undefined;
      const response = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Failed to ${action}`);
      toast.success(data.message || 'Action queued');
      if (data.document?.id) setSelectedId(data.document.id);
      await loadDocuments(false);
      if (documentId) await loadDetail(documentId, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${action}`);
    } finally {
      setActing(false);
    }
  }

  if (isLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading funding documents...</div>;
  }

  if (!isFundingOperator || !id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-600">This funding document workspace is not available.</p>
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
        <title>Funding Documents</title>
      </Head>
      <Header />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FundingWorkspaceTabs
          current="documents"
          callHref={`/admin/funding/catalog/${id}`}
          guidelinesHref={`/admin/funding/catalog/${id}/guidelines`}
          templateHref={`/admin/funding/catalog/${id}/template`}
          documentsHref={`/admin/funding/catalog/${id}/documents`}
          documentStatus={activeDocument ? activeDocument.parsing_status : null}
        />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding Documents</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Document Intelligence</h1>
            <p className="mt-3 text-sm text-slate-600">
              Active documents: {documents.filter((document) => document.is_active).length} | Total: {documents.length}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/funding/catalog/${id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Back to Catalog Record
            </Link>
            <button
              type="button"
              onClick={() => runAction('sync-intake')}
              disabled={!canWrite || acting}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sync Intake PDF
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,0.8fr),minmax(0,1.2fr)]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Upload</h2>
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                <label className="mb-3 block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Document kind</span>
                  <select
                    value={uploadKind}
                    onChange={(event) => setUploadKind(event.target.value as typeof uploadKind)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="call_document">Call document (announcement, annexure)</option>
                    <option value="guideline_document">Guidelines</option>
                    <option value="template_document">Application template</option>
                  </select>
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
                />
                {file && <p className="mt-3 text-sm text-slate-600">{file.name} | {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!canWrite || uploading || !file}
                  className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Versions</h2>
              <div className="mt-4 space-y-3">
                {documents.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No documents uploaded.</div>}
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => setSelectedId(document.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedId === document.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">v{document.version} {document.original_filename}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {document.is_active ? 'Active' : 'Inactive'} | {new Date(document.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <KindBadge kind={document.document_kind} />
                        <StatusBadge value={document.parsing_status} />
                        <StatusBadge value={document.embedding_status} />
                      </div>
                    </div>
                    {document.needs_manual_review && (
                      <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Manual review required</div>
                    )}
                    {document.parsing_error && (
                      <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">{document.parsing_error}</div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            {currentDocument ? (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">v{currentDocument.version} {currentDocument.original_filename}</h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <KindBadge kind={currentDocument.document_kind} />
                        <StatusBadge value={currentDocument.parsing_status} />
                        <StatusBadge value={currentDocument.embedding_status} />
                        {currentDocument.is_active && <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-white">Active</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => runAction(currentDocument.is_active ? 'deactivate' : 'activate', currentDocument.id)}
                        disabled={!canWrite || acting}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        {currentDocument.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction('reprocess', currentDocument.id)}
                        disabled={!canWrite || acting}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Reprocess
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction('reembed', currentDocument.id)}
                        disabled={!canWrite || acting}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                      >
                        Re-embed
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Pages</div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">{currentDocument.counts?.pages || 0}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Sections</div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">{currentDocument.counts?.sections || 0}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Chunks</div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">{currentDocument.counts?.chunks || 0}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Embedded</div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">{currentDocument.counts?.chunkEmbeddings?.generated || 0}</div>
                    </div>
                  </div>
                </section>

                <QualityPanel report={currentDocument.quality_flags} />
                <SectionsTable sections={currentDocument.sections || []} />
              </>
            ) : (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Document Detail</h2>
                <p className="mt-3 text-sm text-slate-500">Upload or sync a document to start extraction.</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
