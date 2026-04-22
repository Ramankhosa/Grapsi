import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import type {
  FundingGuidelineBlockKey,
  FundingGuidelineRuleImportance,
  FundingGuidelineRuleItem,
  GuidelinePackDocument,
} from '@/lib/fundingGuidelines/types';
import { createEmptyGuidelinePack, normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils';
import { FUNDING_GUIDELINE_BLOCK_KEYS } from '@/lib/fundingGuidelines/types';
import type {
  GrantDraftingSubmissionMode,
  GrantEnforcementLevel,
  GrantRuleClass,
} from '@/types/grant';

const RULE_CLASSES: GrantRuleClass[] = [
  'priority',
  'must_address',
  'avoid',
  'evaluation',
  'budget',
  'duration',
  'format',
  'submission',
  'deliverable',
  'reviewer_signal',
  'other',
];

const ENFORCEMENT_LEVELS: GrantEnforcementLevel[] = ['hard', 'soft', 'info'];
const DRAFTING_SUBMISSION_MODES: GrantDraftingSubmissionMode[] = ['drafting', 'submission', 'both'];

export async function getServerSideProps() {
  return {
    props: {},
  };
}

type Bundle = {
  fundingCall: {
    id: string;
    agency_name: string;
    scheme_title: string;
    intake_job_id: string | null;
    guideline_status: string;
    template_status: string;
  };
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
    guideline_pack_json: GuidelinePackDocument | null;
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
};

const BLOCK_LABELS: Record<FundingGuidelineBlockKey, string> = {
  priorities: 'Priorities',
  mustAddress: 'Must Address',
  avoid: 'Avoid',
  evaluationCriteria: 'Evaluation Criteria',
  budgetRules: 'Budget Rules',
  durationRules: 'Duration Rules',
  formatRules: 'Format Rules',
  submissionRules: 'Submission Rules',
  deliverableRules: 'Deliverable Rules',
  reviewerSignals: 'Reviewer Signals',
};

const IMPORTANCE_LEVELS: FundingGuidelineRuleImportance[] = ['high', 'medium', 'low'];

function createRule(block: FundingGuidelineBlockKey): FundingGuidelineRuleItem {
  return {
    key: `${block}_${Date.now()}`,
    text: 'New rule',
    importance: 'medium',
    ruleClass:
      block === 'priorities'
        ? 'priority'
        : block === 'mustAddress'
          ? 'must_address'
          : block === 'avoid'
            ? 'avoid'
            : block === 'evaluationCriteria'
              ? 'evaluation'
              : block === 'budgetRules'
                ? 'budget'
                : block === 'durationRules'
                  ? 'duration'
                  : block === 'formatRules'
                    ? 'format'
                    : block === 'submissionRules'
                      ? 'submission'
                      : block === 'deliverableRules'
                        ? 'deliverable'
                        : block === 'reviewerSignals'
                          ? 'reviewer_signal'
                          : 'other',
    enforcementLevel:
      block === 'submissionRules'
        || block === 'budgetRules'
        || block === 'durationRules'
        || block === 'formatRules'
        ? 'hard'
        : block === 'reviewerSignals' || block === 'priorities'
          ? 'soft'
          : 'soft',
    appliesTo: ['all'],
    draftingStage: [],
    draftingVsSubmission: block === 'submissionRules' ? 'submission' : 'drafting',
    detectorHints: [],
    rationale: null,
    confidence: 1,
    sourceAnchors: [],
  };
}

function summarizeAnchors(rule: FundingGuidelineRuleItem) {
  if (!rule.sourceAnchors.length) {
    return null;
  }

  return rule.sourceAnchors
    .slice(0, 2)
    .map((anchor) => {
      const bits: string[] = [anchor.sourceType];
      if (anchor.fieldKey) {
        bits.push(anchor.fieldKey);
      }
      if (anchor.url) {
        bits.push(anchor.url);
      }
      return bits.join(' • ');
    })
    .join(' | ');
}

function totalRuleCount(pack: GuidelinePackDocument | null | undefined) {
  if (!pack) {
    return 0;
  }

  return FUNDING_GUIDELINE_BLOCK_KEYS.reduce((sum, block) => sum + pack[block].length, 0);
}

function SpinnerIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ExtractionWaitingNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <SpinnerIcon className="mt-0.5 h-5 w-5 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-950">{title}</div>
          <div className="mt-1 text-sm text-amber-900">{description}</div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-amber-500" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-amber-500 [animation-delay:120ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-amber-500 [animation-delay:240ms]" />
            <span className="ml-2 text-xs uppercase tracking-[0.18em] text-amber-700">Waiting for model response</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewBlock({
  title,
  rules,
}: {
  title: string;
  rules: FundingGuidelineRuleItem[];
}) {
  if (!rules.length) {
    return null;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">{title}</h3>
      <div className="mt-3 space-y-3">
        {rules.map((rule, index) => {
          const anchorSummary = summarizeAnchors(rule);
          return (
            <div key={`${rule.key}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Rule {index + 1}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{rule.text}</div>
                  <div className="mt-1 text-xs text-slate-500">{rule.key}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {rule.importance}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {(rule.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              {rule.rationale && (
                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{rule.rationale}</div>
              )}
              {anchorSummary && <div className="mt-3 text-xs text-slate-500">Evidence: {anchorSummary}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GuidelinePreviewCard({
  title,
  subtitle,
  pack,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  pack: GuidelinePackDocument | null;
  emptyMessage: string;
}) {
  const totalRules = totalRuleCount(pack);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Rules</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalRules}</div>
        </div>
      </div>

      {totalRules === 0 ? (
        <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{emptyMessage}</div>
      ) : (
        <div className="mt-6 space-y-6">
          {FUNDING_GUIDELINE_BLOCK_KEYS.map((block) => (
            <PreviewBlock key={block} title={BLOCK_LABELS[block]} rules={pack?.[block] || []} />
          ))}
        </div>
      )}
    </section>
  );
}

function GuidelineBlockEditor({
  block,
  rules,
  onChange,
}: {
  block: FundingGuidelineBlockKey;
  rules: FundingGuidelineRuleItem[];
  onChange: (rules: FundingGuidelineRuleItem[]) => void;
}) {
  function update(index: number, patch: Partial<FundingGuidelineRuleItem>) {
    onChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    onChange([...rules, createRule(block)]);
  }

  function remove(index: number) {
    onChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rules.length) {
      return;
    }
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(nextIndex, 0, rule);
    onChange(next);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{BLOCK_LABELS[block]}</h2>
          <p className="mt-1 text-sm text-slate-600">Review, reorder, and refine the rules in this guideline block.</p>
        </div>
        <button type="button" onClick={addRule} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Add Rule
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {rules.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No rules in this block.</div>}
        {rules.map((rule, index) => (
          <div key={`${rule.key}-${index}`} className="rounded-2xl border border-slate-200 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <input
                value={rule.key}
                onChange={(event) => update(index, { key: event.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Key"
              />
              <select
                value={rule.importance}
                onChange={(event) => update(index, { importance: event.target.value as FundingGuidelineRuleImportance })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {IMPORTANCE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={rule.confidence}
                onChange={(event) => update(index, { confidence: Number(event.target.value || 0) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Confidence"
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <select
                value={rule.ruleClass || 'other'}
                onChange={(event) => update(index, { ruleClass: event.target.value as GrantRuleClass })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {RULE_CLASSES.map((ruleClass) => (
                  <option key={ruleClass} value={ruleClass}>
                    {ruleClass}
                  </option>
                ))}
              </select>
              <select
                value={rule.enforcementLevel || 'soft'}
                onChange={(event) => update(index, { enforcementLevel: event.target.value as GrantEnforcementLevel })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {ENFORCEMENT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              <select
                value={rule.draftingVsSubmission || 'drafting'}
                onChange={(event) => update(index, { draftingVsSubmission: event.target.value as GrantDraftingSubmissionMode })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {DRAFTING_SUBMISSION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <input
                value={(rule.appliesTo || []).join(', ')}
                onChange={(event) => update(index, { appliesTo: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Applies to sections"
              />
              <input
                value={(rule.draftingStage || []).join(', ')}
                onChange={(event) => update(index, { draftingStage: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Drafting stages"
              />
              <input
                value={(rule.detectorHints || []).join(', ')}
                onChange={(event) => update(index, { detectorHints: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Detector hints"
              />
            </div>
            <textarea
              value={rule.text}
              onChange={(event) => update(index, { text: event.target.value })}
              rows={3}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Rule text"
            />
            <textarea
              value={rule.rationale || ''}
              onChange={(event) => update(index, { rationale: event.target.value || null })}
              rows={2}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Rationale or reviewer interpretation"
            />
            <textarea
              value={JSON.stringify(rule.sourceAnchors || [], null, 2)}
              onChange={(event) => {
                try {
                  const nextAnchors = JSON.parse(event.target.value);
                  update(index, { sourceAnchors: Array.isArray(nextAnchors) ? nextAnchors : [] });
                } catch {
                  // Keep editor free-form until valid JSON is entered.
                }
              }}
              rows={5}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              placeholder="Source anchors JSON"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => move(index, -1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
                Move Up
              </button>
              <button type="button" onClick={() => move(index, 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
                Move Down
              </button>
              <button type="button" onClick={() => remove(index)} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function FundingGuidelineWorkspacePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [guidelinePack, setGuidelinePack] = useState<GuidelinePackDocument>(createEmptyGuidelinePack());
  const [rawJson, setRawJson] = useState(JSON.stringify(createEmptyGuidelinePack(), null, 2));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [selectedRevisionNo, setSelectedRevisionNo] = useState<number | null>(null);
  const [sourceMode, setSourceMode] = useState<'intake' | 'url' | 'text' | 'pdf'>('intake');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourcePdf, setSourcePdf] = useState<File | null>(null);

  const userRoles = user?.roles || [];
  const isFundingOperator = userRoles.includes('SUPER_ADMIN') || userRoles.includes('SUPER_ADMIN_VIEWER');

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && isFundingOperator && id) {
      void loadBundle(true);
    }
  }, [user, id, isFundingOperator]);

  useEffect(() => {
    setRawJson(JSON.stringify(guidelinePack, null, 2));
  }, [guidelinePack]);

  const latestRunPack = useMemo(() => {
    return bundle?.runs.find((run) => run.guideline_pack_json)?.guideline_pack_json || null;
  }, [bundle]);

  async function loadBundle(showSpinner = true) {
    if (!id) {
      return;
    }

    if (showSpinner) {
      setLoading(true);
    }

    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/guidelines`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load guideline workspace');
      }
      setBundle(data);
      const latestRunPreview = data.runs?.find((run: Bundle['runs'][number]) => run.guideline_pack_json)?.guideline_pack_json;
      const nextPack = normalizeGuidelinePack(data.guideline?.guideline_pack_json || latestRunPreview || createEmptyGuidelinePack());
      setGuidelinePack(nextPack);
      if (data.revisions?.length > 0) {
        setSelectedRevisionNo(data.revisions[0].revision_no);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load guidelines');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function handleCreateBlank() {
    if (!id) {
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/guidelines`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create blank guidelines');
      }
      setBundle(data);
      setGuidelinePack(normalizeGuidelinePack(data.guideline?.guideline_pack_json || createEmptyGuidelinePack()));
      toast.success('Blank guideline pack created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create blank guidelines');
    } finally {
      setCreating(false);
    }
  }

  async function handleExtract() {
    if (!id) {
      return;
    }

    setExtracting(true);
    try {
      let response: Response;

      if (sourceMode === 'pdf') {
        if (!sourcePdf) {
          throw new Error('Select a PDF guideline source first');
        }
        const formData = new FormData();
        formData.append('file', sourcePdf);
        response = await fetch(`/api/admin/funding/calls/${id}/guidelines/extract`, {
          method: 'POST',
          body: formData,
        });
      } else {
        const payload =
          sourceMode === 'url'
            ? { sourceMode: 'url', sourceUrl }
            : sourceMode === 'text'
              ? { sourceMode: 'text', sourceText }
              : { sourceMode: 'intake' };

        response = await fetch(`/api/admin/funding/calls/${id}/guidelines/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to run guideline extraction');
      }

      await loadBundle(false);
      setSourcePdf(null);
      toast.success('Guideline extraction completed and loaded into the workspace');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run guideline extraction');
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!id) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/guidelines`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guideline_pack_json: guidelinePack }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save guidelines');
      }
      setBundle(data);
      setGuidelinePack(normalizeGuidelinePack(data.guideline?.guideline_pack_json || guidelinePack));
      toast.success('Guidelines saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save guidelines');
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    if (!id) {
      return;
    }

    setApproving(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/guidelines/approve`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to approve guidelines');
      }
      setBundle(data);
      toast.success('Guidelines approved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve guidelines');
    } finally {
      setApproving(false);
    }
  }

  async function handleRevert() {
    if (!id || !selectedRevisionNo) {
      return;
    }

    setReverting(true);
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/guidelines/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionNo: selectedRevisionNo }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to revert guidelines');
      }
      setBundle(data);
      setGuidelinePack(normalizeGuidelinePack(data.guideline?.guideline_pack_json || createEmptyGuidelinePack()));
      toast.success(`Reverted to revision ${selectedRevisionNo}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revert guidelines');
    } finally {
      setReverting(false);
    }
  }

  function updateBlock(block: FundingGuidelineBlockKey, rules: FundingGuidelineRuleItem[]) {
    setGuidelinePack((current) => ({
      ...current,
      [block]: rules,
    }));
  }

  function applyRawJson() {
    try {
      const parsed = JSON.parse(rawJson);
      setGuidelinePack(normalizeGuidelinePack(parsed));
      toast.success('Raw guideline JSON applied');
    } catch (error) {
      toast.error('Guideline JSON is invalid');
    }
  }

  if (isLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading guideline workspace...</div>;
  }

  if (!isFundingOperator || !bundle) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-600">This guideline workspace is not available.</p>
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
        <title>Funding Guideline Workspace</title>
      </Head>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FundingWorkspaceTabs
          current="guidelines"
          callHref={bundle.fundingCall.intake_job_id ? `/admin/funding/intake/${bundle.fundingCall.intake_job_id}` : `/admin/funding/catalog/${bundle.fundingCall.id}`}
          guidelinesHref={`/admin/funding/catalog/${bundle.fundingCall.id}/guidelines`}
          templateHref={`/admin/funding/catalog/${bundle.fundingCall.id}/template`}
          guidelineStatus={bundle.fundingCall.guideline_status}
          templateStatus={bundle.fundingCall.template_status}
        />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding Guidelines</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{bundle.fundingCall.scheme_title}</h1>
            <p className="mt-3 text-sm text-slate-600">
              {bundle.fundingCall.agency_name} • Guideline status: {bundle.fundingCall.guideline_status} • Template status: {bundle.fundingCall.template_status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/funding/catalog/${bundle.fundingCall.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Back to Record
            </Link>
            <Link href={`/admin/funding/catalog/${bundle.fundingCall.id}/template`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Open Template Workspace
            </Link>
            <button type="button" onClick={() => void loadBundle(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
              Refresh
            </button>
            <button type="button" onClick={handleExtract} disabled={extracting} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50">
              {extracting ? 'Running Extraction...' : 'Run Extraction'}
            </button>
            {!bundle.guideline && (
              <button type="button" onClick={handleCreateBlank} disabled={creating} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
                {creating ? 'Creating...' : 'Create Blank'}
              </button>
            )}
            <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Guidelines'}
            </button>
            <button type="button" onClick={handleApprove} disabled={approving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {approving ? 'Approving...' : 'Approve'}
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,0.75fr),minmax(0,1.25fr)]">
          <div className="space-y-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Run Guideline Extraction</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Use the saved intake source automatically, or override this run with a separate URL, text block, or PDF for the same call.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Default source: {bundle.fundingCall.intake_job_id ? 'saved intake source' : 'saved call source'}
                </div>
              </div>

              {extracting && (
                <div className="mt-5">
                  <ExtractionWaitingNotice
                    title="Guideline extraction is running"
                    description="The model is reading the selected source, combining it with the saved call facts, and generating a reviewed guideline pack."
                  />
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSourceMode('intake')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${sourceMode === 'intake' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  Use Existing Source
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('url')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${sourceMode === 'url' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  Separate URL
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('text')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${sourceMode === 'text' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  Separate Text
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('pdf')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${sourceMode === 'pdf' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  Separate PDF
                </button>
              </div>

              <div className="mt-5">
                {sourceMode === 'intake' && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    This run will reuse the source originally saved with the call. No extra source input is required.
                  </div>
                )}

                {sourceMode === 'url' && (
                  <input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                    placeholder="https://example.org/guidelines"
                  />
                )}

                {sourceMode === 'text' && (
                  <textarea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    rows={6}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
                    placeholder="Paste guideline text for this extraction run"
                  />
                )}

                {sourceMode === 'pdf' && (
                  <div className="space-y-3">
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => setSourcePdf(event.target.files?.[0] || null)}
                      className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
                    />
                    <div className="text-xs text-slate-500">
                      {sourcePdf ? `Selected PDF: ${sourcePdf.name}` : 'Select a PDF only when you want to override the saved source for this run.'}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {extracting ? 'Running Extraction...' : 'Run Guideline Extraction'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Workspace status</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div><span className="font-medium text-slate-900">Stored status:</span> {bundle.guideline?.status || 'none'}</div>
                <div><span className="font-medium text-slate-900">Current revision:</span> {bundle.guideline?.current_revision_no || 0}</div>
                <div><span className="font-medium text-slate-900">Total stored rules:</span> {bundle.guideline?.summary_json?.totalRules || 0}</div>
                <div><span className="font-medium text-slate-900">Latest run:</span> {bundle.runs[0] ? `${bundle.runs[0].status} (${new Date(bundle.runs[0].created_at).toLocaleString()})` : 'None'}</div>
                {bundle.guideline?.approved_at && (
                  <div><span className="font-medium text-slate-900">Approved at:</span> {new Date(bundle.guideline.approved_at).toLocaleString()}</div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Revision history</h2>
              <div className="mt-4 space-y-3">
                {bundle.revisions.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No revisions yet.</div>}
                {bundle.revisions.length > 0 && (
                  <>
                    <select
                      value={selectedRevisionNo ?? ''}
                      onChange={(event) => setSelectedRevisionNo(event.target.value ? Number(event.target.value) : null)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {bundle.revisions.map((revision) => (
                        <option key={revision.id} value={revision.revision_no}>
                          Revision {revision.revision_no} • {revision.revision_type} • {revision.approved_state}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={handleRevert} disabled={!selectedRevisionNo || reverting} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
                      {reverting ? 'Reverting...' : 'Revert to Selected Revision'}
                    </button>
                  </>
                )}
                <div className="space-y-3">
                  {bundle.revisions.map((revision) => (
                    <div key={revision.id} className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">Revision {revision.revision_no}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{revision.revision_type}</div>
                        </div>
                        <div className="text-xs text-slate-500">{new Date(revision.created_at).toLocaleString()}</div>
                      </div>
                      {revision.diff_summary && <div className="mt-3">{revision.diff_summary}</div>}
                      {revision.change_notes && <div className="mt-2 text-xs text-slate-500">{revision.change_notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Raw JSON</h2>
              <p className="mt-1 text-sm text-slate-600">Use this for fast bulk edits or to paste a reviewed guideline pack.</p>
              <textarea
                value={rawJson}
                onChange={(event) => setRawJson(event.target.value)}
                rows={18}
                className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-xs text-slate-900"
              />
              <button type="button" onClick={applyRawJson} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                Apply JSON to Editor
              </button>
            </section>
          </div>

          <div className="space-y-8">
            <GuidelinePreviewCard
              title="Preview Stored Guidelines"
              subtitle="This preview is reconstructed from the stored guideline pack currently attached to the funding call."
              pack={bundle.guideline ? normalizeGuidelinePack(bundle.guideline.guideline_pack_json) : null}
              emptyMessage="No stored guideline pack exists yet."
            />

            <GuidelinePreviewCard
              title="Preview Latest Extraction Run"
              subtitle="This shows the latest extracted guideline draft from the automated LLM pass."
              pack={latestRunPack ? normalizeGuidelinePack(latestRunPack) : null}
              emptyMessage="No extraction run has produced a guideline draft yet."
            />

            {FUNDING_GUIDELINE_BLOCK_KEYS.map((block) => (
              <GuidelineBlockEditor
                key={block}
                block={block}
                rules={guidelinePack[block]}
                onChange={(rules) => updateBlock(block, rules)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
