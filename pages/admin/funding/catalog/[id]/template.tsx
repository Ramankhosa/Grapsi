import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import toast from 'react-hot-toast';
import FundingWorkspaceTabs from '@/components/FundingWorkspaceTabs';
import type {
  FundingTemplateItem,
  FundingTemplateItemType,
  FundingTemplateSupportLevel,
  GrantTemplateDocument,
} from '@/lib/fundingTemplates/types';
import { createEmptyGrantTemplate, normalizeGrantTemplate } from '@/lib/fundingTemplates/utils';
import type { GrantDraftingSubmissionMode, GrantWorkflowMode } from '@/types/grant';

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
    status: string;
    guideline_status: string;
    template_status: string;
    intake_job_id: string | null;
  };
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
    ocr_text: string | null;
    raw_text: string | null;
    source_metadata_json?: Record<string, unknown> | null;
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
};

const ITEM_TYPES: FundingTemplateItemType[] = ['field', 'section', 'table', 'budget', 'attachment', 'checklist', 'rule', 'rubric'];
const SUPPORT_LEVELS: FundingTemplateSupportLevel[] = ['full', 'partial', 'manual', 'unsupported'];
const WORKFLOW_MODES: GrantWorkflowMode[] = ['app_draft', 'app_support', 'team_manual'];
const DRAFTING_SUBMISSION_MODES: GrantDraftingSubmissionMode[] = ['drafting', 'submission', 'both'];

type TemplateCounts = {
  questions: number;
  sections: number;
  attachments: number;
  evaluationCriteria: number;
  submissionRules: number;
  hasBudget: boolean;
  total: number;
};

function createItem(type: FundingTemplateItemType): FundingTemplateItem {
  return {
    key: `${type}_${Date.now()}`,
    label: 'New Item',
    type,
    workflowMode: type === 'section' ? 'app_draft' : type === 'budget' || type === 'table' ? 'app_support' : 'team_manual',
    required: false,
    repeatable: false,
    visibleWhen: null,
    wordLimit: null,
    charLimit: null,
    options: [],
    schema: null,
    guidance: null,
    guidanceText: null,
    requiredFacts: [],
    reviewerGoal: null,
    forbiddenMoves: [],
    draftingVsSubmission:
      type === 'attachment'
        ? 'submission'
        : type === 'budget' || type === 'checklist' || type === 'rule'
          ? 'both'
          : 'drafting',
    supportLevel: 'full',
    confidence: 1,
    sourceAnchors: [],
  };
}

function getTemplateCounts(template: GrantTemplateDocument | null | undefined): TemplateCounts {
  const counts = {
    questions: template?.questions.length || 0,
    sections: template?.sections.length || 0,
    attachments: template?.attachments.length || 0,
    evaluationCriteria: template?.evaluationCriteria.length || 0,
    submissionRules: template?.submissionRules.items.length || 0,
    hasBudget: Boolean(template?.budget),
    total: 0,
  };

  counts.total =
    counts.questions +
    counts.sections +
    counts.attachments +
    counts.evaluationCriteria +
    counts.submissionRules +
    (counts.hasBudget ? 1 : 0);

  return counts;
}

function getPreferredRun(bundle: Bundle | null): Bundle['runs'][number] | null {
  if (!bundle) {
    return null;
  }

  return (
    bundle.runs.find(
      (run) => (run.status === 'needs_review' || run.status === 'applied') && run.normalized_template_json
    ) || null
  );
}

function readAssetMetadata(value: Record<string, unknown> | null | undefined) {
  return value && typeof value === 'object' ? value : {};
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
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex items-start gap-3">
        <SpinnerIcon className="mt-0.5 h-5 w-5 text-sky-700" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-sky-950">{title}</div>
          <div className="mt-1 text-sm text-sky-900">{description}</div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-sky-500" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-sky-500 [animation-delay:120ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-sky-500 [animation-delay:240ms]" />
            <span className="ml-2 text-xs uppercase tracking-[0.18em] text-sky-700">Waiting for model response</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAnchorSummary(item: FundingTemplateItem): string | null {
  if (!item.sourceAnchors || item.sourceAnchors.length === 0) {
    return null;
  }

  const preview = item.sourceAnchors.slice(0, 2).map((anchor) => {
    const parts = [`asset ${anchor.asset_id.slice(0, 8)}`];
    if (anchor.page) {
      parts.push(`page ${anchor.page}`);
    }
    if (anchor.section) {
      parts.push(anchor.section);
    }
    return parts.join(' • ');
  });

  const suffix = item.sourceAnchors.length > 2 ? ` +${item.sourceAnchors.length - 2} more` : '';
  return `${preview.join(' | ')}${suffix}`;
}

function getItemMeta(item: FundingTemplateItem): string[] {
  const values = [
    item.type,
    item.required ? 'required' : 'optional',
    item.repeatable ? 'repeatable' : null,
    item.wordLimit ? `word limit ${item.wordLimit}` : null,
    item.charLimit ? `char limit ${item.charLimit}` : null,
    item.supportLevel,
  ].filter(Boolean) as string[];

  return values;
}

function workflowTone(workflowMode: GrantWorkflowMode) {
  switch (workflowMode) {
    case 'app_draft':
      return 'bg-emerald-100 text-emerald-800';
    case 'app_support':
      return 'bg-sky-100 text-sky-800';
    case 'team_manual':
      return 'bg-amber-100 text-amber-900';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function workflowLabel(workflowMode: GrantWorkflowMode) {
  switch (workflowMode) {
    case 'app_draft':
      return 'App Draft';
    case 'app_support':
      return 'Manual Drafting';
    case 'team_manual':
      return 'Manual Drafting';
    default:
      return workflowMode;
  }
}

function workflowDetail(workflowMode: GrantWorkflowMode) {
  switch (workflowMode) {
    case 'app_support':
      return 'Support section';
    case 'team_manual':
      return 'Team-owned section';
    default:
      return null;
  }
}

function TemplatePreviewItem({
  item,
  index,
}: {
  item: FundingTemplateItem;
  index: number;
}) {
  const anchorSummary = formatAnchorSummary(item);
  const meta = getItemMeta(item);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Item {index + 1}</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{item.label}</div>
          <div className="mt-1 text-xs text-slate-500">{item.key}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${workflowTone(item.workflowMode)}`}>
            {workflowLabel(item.workflowMode)}
          </span>
          {workflowDetail(item.workflowMode) && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
              {workflowDetail(item.workflowMode)}
            </span>
          )}
          {meta.map((value) => (
            <span key={value} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
              {value}
            </span>
          ))}
        </div>
      </div>
      {item.guidance && (
        <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.guidance}</div>
      )}
      {item.visibleWhen && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Visible when: {item.visibleWhen}
        </div>
      )}
      {item.options && item.options.length > 0 && (
        <div className="mt-3 text-xs text-slate-600">Options: {item.options.join(', ')}</div>
      )}
      {anchorSummary && (
        <div className="mt-3 text-xs text-slate-500">Source anchors: {anchorSummary}</div>
      )}
    </div>
  );
}

function TemplatePreviewCard({
  title,
  subtitle,
  template,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  template: GrantTemplateDocument | null;
  emptyMessage: string;
}) {
  const counts = getTemplateCounts(template);
  const workflowCounts = useMemo(() => {
    const items = [
      ...(template?.sections || []),
      ...(template?.questions || []),
      ...(template?.attachments || []),
      ...(template?.evaluationCriteria || []),
      ...(template?.submissionRules.items || []),
    ];
    const appDraft = items.filter((item) => item.workflowMode === 'app_draft').length;
    const appSupport = items.filter((item) => item.workflowMode === 'app_support').length + (template?.budget?.workflowMode === 'app_support' ? 1 : 0);
    const teamManual = items.filter((item) => item.workflowMode === 'team_manual').length;
    const manualDrafting = appSupport + teamManual;
    return { appDraft, manualDrafting };
  }, [template]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <p className="mt-2 text-sm text-slate-500">
            {workflowCounts.appDraft} app draft, {workflowCounts.manualDrafting} manual drafting
          </p>
        </div>
        <div className="grid min-w-[16rem] grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Questions</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{counts.questions}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sections</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{counts.sections}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Attachments</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{counts.attachments}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Budget</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{counts.hasBudget ? 'Yes' : 'No'}</div>
          </div>
        </div>
      </div>

      {counts.total === 0 ? (
        <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{emptyMessage}</div>
      ) : (
        <div className="mt-6 space-y-6">
          {template?.sections && template.sections.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Sections</h3>
              <div className="mt-3 space-y-3">
                {template.sections.map((item, index) => (
                  <TemplatePreviewItem key={`section-${item.key}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          )}

          {template?.questions && template.questions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Questions</h3>
              <div className="mt-3 space-y-3">
                {template.questions.map((item, index) => (
                  <TemplatePreviewItem key={`question-${item.key}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          )}

          {template?.attachments && template.attachments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Attachments</h3>
              <div className="mt-3 space-y-3">
                {template.attachments.map((item, index) => (
                  <TemplatePreviewItem key={`attachment-${item.key}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          )}

          {template?.evaluationCriteria && template.evaluationCriteria.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Evaluation Criteria</h3>
              <div className="mt-3 space-y-3">
                {template.evaluationCriteria.map((item, index) => (
                  <TemplatePreviewItem key={`criterion-${item.key}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          )}

          {template?.submissionRules.items && template.submissionRules.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Submission Rules</h3>
              <div className="mt-3 space-y-3">
                {template.submissionRules.items.map((item, index) => (
                  <TemplatePreviewItem key={`rule-${item.key}-${index}`} item={item} index={index} />
                ))}
              </div>
            </div>
          )}

          {template?.budget && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">Budget Structure</h3>
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {template.budget.required ? 'required' : 'optional'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {template.budget.yearWise ? 'year-wise' : 'single budget'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {template.budget.supportLevel}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${workflowTone(template.budget.workflowMode)}`}>
                    {workflowLabel(template.budget.workflowMode)}
                  </span>
                  {workflowDetail(template.budget.workflowMode) && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                      {workflowDetail(template.budget.workflowMode)}
                    </span>
                  )}
                </div>
                {template.budget.justificationNotes && (
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {template.budget.justificationNotes}
                  </div>
                )}
                {template.budget.categories.length > 0 && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {template.budget.categories.map((category, index) => (
                      <div key={`${category.key}-${index}`} className="rounded-xl bg-slate-50 p-3">
                        <div className="text-sm font-semibold text-slate-900">{category.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{category.key}</div>
                        {category.cap && <div className="mt-2 text-xs text-slate-600">Cap: {category.cap}</div>}
                        {category.notes && <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{category.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BlockEditor({
  title,
  items,
  itemType,
  onChange,
}: {
  title: string;
  items: FundingTemplateItem[];
  itemType: FundingTemplateItemType;
  onChange: (items: FundingTemplateItem[]) => void;
}) {
  function update(index: number, patch: Partial<FundingTemplateItem>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) {
      return;
    }
    const next = [...items];
    const [current] = next.splice(index, 1);
    next.splice(nextIndex, 0, current);
    onChange(next);
  }

  function remove(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">Use raw JSON below for source anchors, schema payloads, and advanced item metadata.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...items, createItem(itemType)])}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Add
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {items.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No items yet.</div>}
        {items.map((item, index) => (
          <div key={`${item.key}-${index}`} className="rounded-2xl border border-slate-200 p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <input value={item.key} onChange={(event) => update(index, { key: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Key" />
              <input value={item.label} onChange={(event) => update(index, { label: event.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Label" />
              <select value={item.type} onChange={(event) => update(index, { type: event.target.value as FundingTemplateItemType })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={item.workflowMode} onChange={(event) => update(index, { workflowMode: event.target.value as GrantWorkflowMode })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {WORKFLOW_MODES.map((mode) => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
              <select value={item.supportLevel} onChange={(event) => update(index, { supportLevel: event.target.value as FundingTemplateSupportLevel })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {SUPPORT_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
              <input type="number" value={item.wordLimit ?? ''} onChange={(event) => update(index, { wordLimit: event.target.value ? Number(event.target.value) : null })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Word limit" />
              <input type="number" value={item.charLimit ?? ''} onChange={(event) => update(index, { charLimit: event.target.value ? Number(event.target.value) : null })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Char limit" />
              <input type="number" min="0" max="1" step="0.05" value={item.confidence} onChange={(event) => update(index, { confidence: Number(event.target.value || 0) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Confidence" />
              <input value={(item.options || []).join(', ')} onChange={(event) => update(index, { options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Comma-separated options" />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <textarea value={item.guidance || ''} onChange={(event) => update(index, { guidance: event.target.value || null })} rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Guidance" />
              <textarea value={item.visibleWhen || ''} onChange={(event) => update(index, { visibleWhen: event.target.value || null })} rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Visible when" />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <textarea
                value={item.guidanceText || ''}
                onChange={(event) => update(index, { guidanceText: event.target.value || null })}
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Expanded guidance text"
              />
              <textarea
                value={item.reviewerGoal || ''}
                onChange={(event) => update(index, { reviewerGoal: event.target.value || null })}
                rows={3}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Reviewer goal"
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <input
                value={(item.requiredFacts || []).join(', ')}
                onChange={(event) => update(index, { requiredFacts: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Required facts"
              />
              <input
                value={(item.forbiddenMoves || []).join(', ')}
                onChange={(event) => update(index, { forbiddenMoves: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Forbidden moves"
              />
              <select
                value={item.draftingVsSubmission || 'drafting'}
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
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={item.required} onChange={(event) => update(index, { required: event.target.checked })} /> Required</label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={item.repeatable} onChange={(event) => update(index, { repeatable: event.target.checked })} /> Repeatable</label>
              <button type="button" onClick={() => move(index, -1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Up</button>
              <button type="button" onClick={() => move(index, 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Down</button>
              <button type="button" onClick={() => remove(index)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function FundingTemplatePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { id } = router.query;
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<GrantTemplateDocument | null>(null);
  const [rawJson, setRawJson] = useState(JSON.stringify(createEmptyGrantTemplate(), null, 2));
  const [changeNotes, setChangeNotes] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editorSource, setEditorSource] = useState<'template' | 'run'>('template');
  const [loading, setLoading] = useState(true);
  const [busyState, setBusyState] = useState<'idle' | 'create' | 'save' | 'approve' | 'asset' | 'extract' | 'apply'>('idle');

  const userRoles = user?.roles || [];
  const platformPermissions = user?.platformPermissions || [];
  const isFundingOperator =
    userRoles.includes('SUPER_ADMIN') ||
    userRoles.includes('SUPER_ADMIN_VIEWER') ||
    platformPermissions.includes('platform.support.read') ||
    platformPermissions.includes('funding.operations.write') ||
    platformPermissions.includes('funding.publisher.write');

  const selectedRun = useMemo(() => bundle?.runs.find((run) => run.id === selectedRunId) || null, [bundle, selectedRunId]);
  const latestExtractionRun = useMemo(() => getPreferredRun(bundle), [bundle]);
  const storedTemplatePreview = useMemo(
    () => (bundle?.template ? normalizeGrantTemplate(bundle.template.grant_template_json) : null),
    [bundle]
  );
  const selectedRunPreview = useMemo(
    () => (selectedRun?.normalized_template_json ? normalizeGrantTemplate(selectedRun.normalized_template_json) : null),
    [selectedRun]
  );
  const currentTemplateCounts = useMemo(() => getTemplateCounts(bundle?.template?.grant_template_json || null), [bundle]);
  const latestExtractionCounts = useMemo(
    () => getTemplateCounts(latestExtractionRun?.normalized_template_json || null),
    [latestExtractionRun]
  );
  const latestRunHasContent = latestExtractionCounts.total > 0;
  const currentTemplateIsEmpty = currentTemplateCounts.total === 0;
  const latestRunNeedsApply = latestExtractionRun?.status === 'needs_review';

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (user && isFundingOperator && id) {
      void loadBundle();
    }
  }, [user, id, isFundingOperator]);

  useEffect(() => {
    if (!bundle) {
      return;
    }
    const persistedTemplate = bundle.template ? normalizeGrantTemplate(bundle.template.grant_template_json) : null;
    const persistedCounts = getTemplateCounts(persistedTemplate);
    const fallbackRun = getPreferredRun(bundle);
    const nextTemplate =
      persistedCounts.total > 0
        ? persistedTemplate
        : fallbackRun?.normalized_template_json
          ? normalizeGrantTemplate(fallbackRun.normalized_template_json)
          : persistedTemplate;

    setDraftTemplate(nextTemplate);
    setRawJson(JSON.stringify(nextTemplate || createEmptyGrantTemplate(), null, 2));
    setSelectedAssetIds((current) => {
      const available = bundle.assets.map((asset) => asset.id);
      if (current.length === 0) {
        return available;
      }
      const preserved = current.filter((assetId) => available.includes(assetId));
      return preserved.length > 0 ? preserved : available;
    });
    setEditorSource(persistedCounts.total > 0 ? 'template' : fallbackRun?.normalized_template_json ? 'run' : 'template');
    setSelectedRunId((current) => {
      if (current && bundle.runs.some((run) => run.id === current)) {
        return current;
      }

      const nextDefaultRun =
        bundle.runs.find((run) => (run.status === 'needs_review' || run.status === 'applied') && run.normalized_template_json) ||
        bundle.runs[0] ||
        null;

      return nextDefaultRun?.id || null;
    });
  }, [bundle]);

  async function loadBundle(showSpinner = true) {
    if (!id) {
      return;
    }
    if (showSpinner) {
      setLoading(true);
    }
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/template`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load template workspace');
      }
      setBundle(data);
      setSelectedRunId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load template workspace');
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  function replaceTemplate(nextTemplate: GrantTemplateDocument) {
    const normalized = normalizeGrantTemplate(nextTemplate);
    setDraftTemplate(normalized);
    setRawJson(JSON.stringify(normalized, null, 2));
  }

  function updateBlock(block: keyof GrantTemplateDocument, value: any) {
    replaceTemplate({
      ...(draftTemplate || createEmptyGrantTemplate()),
      [block]: value,
    });
  }

  async function postJson(url: string, body?: Record<string, unknown>, method = 'POST') {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Request failed');
    }
    return data;
  }

  async function handleCreateTemplate() {
    if (!id) return;
    setBusyState('create');
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template`);
      setBundle(data);
      toast.success('Blank template created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create template');
    } finally {
      setBusyState('idle');
    }
  }

  async function handleSaveTemplate() {
    if (!id || !draftTemplate) return;
    setBusyState('save');
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template`, { grant_template_json: draftTemplate, changeNotes: changeNotes || undefined }, 'PUT');
      setBundle(data);
      setChangeNotes('');
      toast.success('Template saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setBusyState('idle');
    }
  }

  async function handleApproveTemplate() {
    if (!id || !bundle?.template) return;
    setBusyState('approve');
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template/approve`);
      setBundle(data);
      toast.success('Template approved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve template');
    } finally {
      setBusyState('idle');
    }
  }

  function applyRawJson() {
    try {
      replaceTemplate(JSON.parse(rawJson));
      toast.success('Loaded raw JSON into the editor');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }

  async function addAsset(body: Record<string, unknown>) {
    if (!id) return;
    setBusyState('asset');
    try {
      await postJson(`/api/admin/funding/calls/${id}/template/assets`, body);
      await loadBundle(false);
      toast.success('Template asset added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add template asset');
    } finally {
      setBusyState('idle');
    }
  }

  async function uploadAsset(files: File[] | FileList | null) {
    if (!id || !files || files.length === 0) return;
    setBusyState('asset');
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`/api/admin/funding/calls/${id}/template/assets`, { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || `Failed to upload ${file.name}`);
        }
      }
      await loadBundle(false);
      toast.success(`Uploaded ${Array.from(files).length} template asset${Array.from(files).length === 1 ? '' : 's'} in order`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload template assets');
    } finally {
      setBusyState('idle');
    }
  }

  async function syncIntakeAsset(selectOnly = true) {
    if (!id || !bundle?.fundingCall.intake_job_id) {
      throw new Error('This call does not have a saved intake source');
    }

    setBusyState('asset');
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template/assets/intake`);
      await loadBundle(false);
      if (data.asset?.id && selectOnly) {
        setSelectedAssetIds([data.asset.id]);
      }
      toast.success(selectOnly ? 'Saved intake source selected for template extraction' : 'Saved intake source synced as a template asset');
      return data.asset?.id as string | undefined;
    } finally {
      setBusyState('idle');
    }
  }

  async function deleteAsset(assetId: string) {
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/funding/calls/${id}/template/assets/${assetId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to delete template asset');
      await loadBundle(false);
      toast.success('Asset deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete template asset');
    }
  }

  async function extractTemplate() {
    if (!id) {
      return;
    }
    setBusyState('extract');
    try {
      let assetIds = selectedAssetIds;

      if (assetIds.length === 0 && bundle?.fundingCall.intake_job_id) {
        const intakeAssetId = await postJson(`/api/admin/funding/calls/${id}/template/assets/intake`)
          .then((data) => data.asset?.id as string | undefined);
        if (intakeAssetId) {
          assetIds = [intakeAssetId];
          setSelectedAssetIds([intakeAssetId]);
          await loadBundle(false);
        }
      }

      if (assetIds.length === 0) {
        throw new Error('Select at least one template source, or sync the existing intake source first');
      }

      const data = await postJson(`/api/admin/funding/calls/${id}/template/extract`, { assetIds });
      await loadBundle(false);
      setSelectedRunId(data.run?.id || null);
      toast.success('Extraction completed. Review the preview below and use the latest extraction button to make it the current template.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to extract template');
    } finally {
      setBusyState('idle');
    }
  }

  async function applyRun(runId: string) {
    if (!id) return;
    setBusyState('apply');
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template/runs/${runId}/apply`, { mode: 'replace' });
      setBundle(data);
      if (data?.template?.grant_template_json) {
        const nextTemplate = normalizeGrantTemplate(data.template.grant_template_json);
        setDraftTemplate(nextTemplate);
        setRawJson(JSON.stringify(nextTemplate, null, 2));
        setEditorSource('template');
      }
      setSelectedRunId(runId);
      toast.success('Latest extraction is now the current template.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply extraction run');
    } finally {
      setBusyState('idle');
    }
  }

  async function revertRevision(revisionNo: number) {
    if (!id) return;
    if (!window.confirm(`Revert to revision ${revisionNo}? This will create a new forward revision.`)) return;
    try {
      const data = await postJson(`/api/admin/funding/calls/${id}/template/revert`, { revisionNo });
      setBundle(data);
      toast.success(`Reverted to revision ${revisionNo}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revert template');
    }
  }

  if (isLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading template workspace...</div>;
  }

  if (!isFundingOperator || !bundle) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-600">Template workspace not available.</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Head><title>Funding Template Authoring</title></Head>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <FundingWorkspaceTabs
          current="template"
          callHref={bundle.fundingCall.intake_job_id ? `/admin/funding/intake/${bundle.fundingCall.intake_job_id}` : `/admin/funding/catalog/${bundle.fundingCall.id}`}
          guidelinesHref={`/admin/funding/catalog/${bundle.fundingCall.id}/guidelines`}
          templateHref={`/admin/funding/catalog/${bundle.fundingCall.id}/template`}
          guidelineStatus={bundle.fundingCall.guideline_status || null}
          templateStatus={bundle.fundingCall.template_status}
        />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">Funding Template Authoring</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{bundle.fundingCall.scheme_title}</h1>
            <p className="mt-3 text-sm text-slate-600">{bundle.fundingCall.agency_name} · Call status: {bundle.fundingCall.status} · Template status: {bundle.fundingCall.template_status.replace('_', ' ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/funding/catalog/${bundle.fundingCall.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Back to Catalog Record</Link>
            {bundle.fundingCall.intake_job_id && <Link href={`/admin/funding/intake/${bundle.fundingCall.intake_job_id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Open Intake Job</Link>}
            {!bundle.template && <button type="button" onClick={handleCreateTemplate} disabled={busyState !== 'idle'} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busyState === 'create' ? 'Creating...' : 'Create Blank Template'}</button>}
          </div>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.35fr),minmax(0,0.65fr)]">
          <div className="space-y-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Template Workspace</h2>
                  <p className="mt-1 text-sm text-slate-600">Manual saves append revisions. Extraction merges by key and records conflicts instead of overwriting authored content.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSaveTemplate} disabled={busyState !== 'idle' || !draftTemplate} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{busyState === 'save' ? 'Saving...' : 'Save Template'}</button>
                  <button type="button" onClick={handleApproveTemplate} disabled={busyState !== 'idle' || !bundle.template} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busyState === 'approve' ? 'Approving...' : 'Approve Template'}</button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Revision</div><div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.template?.current_revision_no || 0}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Template Status</div><div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.template?.status || 'none'}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Conflicts</div><div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.template?.compatibility_json?.conflicts?.length || 0}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Warnings</div><div className="mt-2 text-2xl font-semibold text-slate-900">{bundle.template?.compatibility_json?.warnings?.length || 0}</div></div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Current Questions</div><div className="mt-2 text-2xl font-semibold text-slate-900">{currentTemplateCounts.questions}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Current Sections</div><div className="mt-2 text-2xl font-semibold text-slate-900">{currentTemplateCounts.sections}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Current Attachments</div><div className="mt-2 text-2xl font-semibold text-slate-900">{currentTemplateCounts.attachments}</div></div>
                <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">Budget Block</div><div className="mt-2 text-2xl font-semibold text-slate-900">{currentTemplateCounts.hasBudget ? 'Yes' : 'No'}</div></div>
              </div>
              {latestExtractionRun && latestRunHasContent && currentTemplateIsEmpty && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {latestRunNeedsApply
                    ? 'The latest extraction preview is ready, but it is not the active template yet. Use `Use Latest Extraction as Current Template` to promote it.'
                    : 'The current active template was loaded from the latest extraction run.'}
                </div>
              )}
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                Editor source: <span className="font-semibold text-slate-900">{editorSource === 'template' ? 'current active template' : 'latest extraction preview'}</span>
              </div>
              <input value={changeNotes} onChange={(event) => setChangeNotes(event.target.value)} className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Optional note for the next manual edit revision" />
            </section>

            <TemplatePreviewCard
              title="Current Active Template"
              subtitle="This is the template currently attached to the funding call and used by downstream grant workflows."
              template={storedTemplatePreview}
              emptyMessage="The stored template is currently empty. If extraction found content, use the extraction panel to preview it and then save or apply it."
            />

            {draftTemplate && (
              <>
                <BlockEditor title="Sections" items={draftTemplate.sections} itemType="section" onChange={(items) => updateBlock('sections', items)} />
                <BlockEditor title="Questions" items={draftTemplate.questions} itemType="field" onChange={(items) => updateBlock('questions', items)} />
                <BlockEditor title="Attachments" items={draftTemplate.attachments} itemType="attachment" onChange={(items) => updateBlock('attachments', items)} />
                <BlockEditor title="Evaluation Criteria" items={draftTemplate.evaluationCriteria} itemType="rubric" onChange={(items) => updateBlock('evaluationCriteria', items)} />
                <BlockEditor title="Submission Rules" items={draftTemplate.submissionRules.items} itemType="rule" onChange={(items) => updateBlock('submissionRules', { ...draftTemplate.submissionRules, items })} />

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">Advanced Raw JSON</h2>
                      <p className="mt-1 text-sm text-slate-600">Budget schema, source anchors, item schema payloads, and merge conflict cleanup are edited here.</p>
                    </div>
                    <button type="button" onClick={applyRawJson} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Load Raw JSON Into Editor</button>
                  </div>
                  <textarea value={rawJson} onChange={(event) => setRawJson(event.target.value)} rows={24} className="mt-6 w-full rounded-2xl border border-slate-300 bg-slate-950 px-4 py-4 font-mono text-xs leading-6 text-slate-100" />
                </section>
              </>
            )}
          </div>

          <div className="space-y-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Assets and Extraction</h2>
              <p className="mt-1 text-sm text-slate-600">
                Reuse the existing intake source automatically, or add separate URL, text, PDF, or snapshot-image assets for the same call.
              </p>
              {busyState === 'extract' && (
                <div className="mt-5">
                  <ExtractionWaitingNotice
                    title="Template extraction is running"
                    description="The model is reading the selected ordered assets, reconstructing field order, and preparing the combined template draft."
                  />
                </div>
              )}
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void syncIntakeAsset(true)}
                    disabled={busyState !== 'idle' || !bundle.fundingCall.intake_job_id}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 disabled:opacity-50"
                  >
                    Use Existing Intake Source
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAssetIds(bundle.assets.map((asset) => asset.id))}
                    disabled={busyState !== 'idle' || bundle.assets.length === 0}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 disabled:opacity-50"
                  >
                    Select All Sources
                  </button>
                </div>
                <div className="flex gap-2">
                  <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Template URL" />
                  <button type="button" onClick={() => addAsset({ sourceType: 'url', sourceUrl })} disabled={busyState !== 'idle'} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Add URL</button>
                </div>
                <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={5} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Paste template text" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => addAsset({ sourceType: 'text', sourceText })} disabled={busyState !== 'idle'} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Add Text</button>
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple onChange={(event) => { void uploadAsset(event.target.files); event.target.value = ''; }} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
                </div>
                <div className="text-xs text-slate-500">Snapshot images and PDFs keep upload order. The extraction run uses that order to reconstruct the final template.</div>
              </div>

              <div className="mt-6 space-y-3">
                {bundle.assets.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No assets added yet.</div>}
                {bundle.assets.map((asset) => (
                  <div key={asset.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <label className="inline-flex items-start gap-3">
                        <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((value) => value !== asset.id))} className="mt-1" />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900">{asset.source_type.toUpperCase()}</div>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                              Seq {asset.sequence_no}
                            </span>
                            {readAssetMetadata(asset.source_metadata_json).auto_managed === true && (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-800">
                                intake source
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{new Date(asset.created_at).toLocaleString()}</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{(asset.source_url || asset.normalized_text || asset.ocr_text || asset.raw_text || asset.storage_path || 'No preview').slice(0, 220)}</div>
                        </div>
                      </label>
                      <button type="button" onClick={() => deleteAsset(asset.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-700">Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" onClick={extractTemplate} disabled={busyState !== 'idle'} className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busyState === 'extract' ? 'Running Extraction...' : selectedAssetIds.length > 0 ? `Run Extraction on ${selectedAssetIds.length} Asset${selectedAssetIds.length === 1 ? '' : 's'}` : 'Run Extraction from Existing or Selected Sources'}</button>

              {latestExtractionRun && latestRunHasContent && (
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-emerald-950">Latest Extraction Ready</h3>
                      <p className="mt-1 text-sm text-emerald-900">
                        Status: {latestExtractionRun.status.replace('_', ' ')}
                        {latestExtractionRun.extractor_model ? ` • Model: ${latestExtractionRun.extractor_model}` : ''}
                      </p>
                      <p className="mt-2 text-xs text-emerald-800">
                        The preview below shows the extracted template. Use the primary action here to make it the current active template.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedRunId(latestExtractionRun.id)} className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-900">Open Preview</button>
                      {latestRunNeedsApply ? (
                        <button
                          type="button"
                          onClick={() => applyRun(latestExtractionRun.id)}
                          disabled={busyState !== 'idle'}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {busyState === 'apply' ? 'Applying...' : 'Use Latest Extraction as Current Template'}
                        </button>
                      ) : (
                        <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-emerald-900">
                          Already current
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl bg-white p-3"><div className="text-xs uppercase tracking-[0.18em] text-emerald-700">Questions</div><div className="mt-2 text-xl font-semibold text-emerald-950">{latestExtractionCounts.questions}</div></div>
                    <div className="rounded-xl bg-white p-3"><div className="text-xs uppercase tracking-[0.18em] text-emerald-700">Sections</div><div className="mt-2 text-xl font-semibold text-emerald-950">{latestExtractionCounts.sections}</div></div>
                    <div className="rounded-xl bg-white p-3"><div className="text-xs uppercase tracking-[0.18em] text-emerald-700">Attachments</div><div className="mt-2 text-xl font-semibold text-emerald-950">{latestExtractionCounts.attachments}</div></div>
                    <div className="rounded-xl bg-white p-3"><div className="text-xs uppercase tracking-[0.18em] text-emerald-700">Budget</div><div className="mt-2 text-xl font-semibold text-emerald-950">{latestExtractionCounts.hasBudget ? 'Yes' : 'No'}</div></div>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Runs and Revisions</h2>
              <div className="mt-5 space-y-3">
                {bundle.runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">{run.status.replace('_', ' ')}</div>
                    <div className="mt-1 text-xs text-slate-500">{new Date(run.created_at).toLocaleString()}</div>
                    {run.extractor_model && <div className="mt-2">Model: {run.extractor_model}</div>}
                    {run.warnings_json && run.warnings_json.length > 0 && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{run.warnings_json.join(' · ')}</div>}
                    {run.error_message && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{run.error_message}</div>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelectedRunId((current) => current === run.id ? null : run.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">{selectedRunId === run.id ? 'Hide Preview' : 'Preview'}</button>
                      {run.status === 'needs_review' && (
                        <button
                          type="button"
                          onClick={() => applyRun(run.id)}
                          disabled={busyState !== 'idle'}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {busyState === 'apply' ? 'Applying...' : 'Use This Extraction'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {bundle.runs.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No extraction runs yet.</div>}
              </div>

              {selectedRun && (
                <>
                  <TemplatePreviewCard
                    title={selectedRun.status === 'needs_review' ? 'Latest Extraction Preview' : 'Applied Extraction Preview'}
                    subtitle={
                      selectedRun.status === 'needs_review'
                        ? 'This preview is not active yet. Use the action above to make it the current template.'
                        : 'This extraction run has already been applied.'
                    }
                    template={selectedRunPreview}
                    emptyMessage="This extraction run does not contain any normalized template content."
                  />
                  <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">Show Raw Run JSON</summary>
                    <pre className="mt-4 max-h-[22rem] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {JSON.stringify(selectedRun.normalized_template_json, null, 2)}
                    </pre>
                  </details>
                </>
              )}

              <div className="mt-6 space-y-3">
                {bundle.revisions.map((revision) => (
                  <div key={revision.id} className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">Revision {revision.revision_no} · {revision.revision_type}</div>
                    <div className="mt-1 text-xs text-slate-500">{new Date(revision.created_at).toLocaleString()}</div>
                    {revision.diff_summary && <div className="mt-2">{revision.diff_summary}</div>}
                    {revision.change_notes && <div className="mt-1 text-slate-500">{revision.change_notes}</div>}
                    <button type="button" onClick={() => revertRevision(revision.revision_no)} className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Revert to This Revision</button>
                  </div>
                ))}
                {bundle.revisions.length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No revisions yet.</div>}
              </div>
            </section>

            {bundle.template?.compatibility_json && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Compatibility Summary</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {Object.entries(bundle.template.compatibility_json.supportCounts || {}).map(([level, count]) => (
                    <div key={level} className="rounded-xl bg-slate-50 p-4"><div className="text-xs uppercase tracking-[0.18em] text-slate-500">{level}</div><div className="mt-2 text-2xl font-semibold text-slate-900">{count}</div></div>
                  ))}
                </div>
                {bundle.template.compatibility_json.warnings?.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{bundle.template.compatibility_json.warnings.join(' · ')}</div>}
                <div className="mt-4 space-y-3">
                  {(bundle.template.compatibility_json.conflicts || []).map((conflict, index) => (
                    <div key={`${conflict.key}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <div className="font-semibold">{conflict.block} · {conflict.key}</div>
                      <div className="mt-1">{conflict.message}</div>
                    </div>
                  ))}
                  {(bundle.template.compatibility_json.conflicts || []).length === 0 && <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No merge conflicts are currently recorded.</div>}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
