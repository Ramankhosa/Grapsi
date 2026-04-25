import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Menu, Transition } from '@headlessui/react';
import { HiChevronDown, HiChevronUp, HiEllipsisVertical, HiExclamationCircle } from 'react-icons/hi2';
import { toast } from 'react-hot-toast';
import { GRANT_PREP_STAGE_BY_KEY } from '../../lib/grantPrep/stageLibrary';
import type { FundingGuidelineRuleItem, GuidelinePackDocument } from '../../lib/fundingGuidelines/types';
import type {
  PointAction,
  PrepContext,
  PrepDraftingContext,
  PrepFundingContext,
  PrepRuleGroup,
} from './types';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function asStringArray(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

const priorityLabels: Record<string, string> = {
  P1: 'Required',
  P2: 'Recommended',
  P3: 'Optional',
};

const priorityTone: Record<string, string> = {
  P1: 'bg-rose-50 text-rose-700 border border-rose-200',
  P2: 'bg-amber-50 text-amber-700 border border-amber-200',
  P3: 'bg-slate-50 text-slate-500 border border-slate-200',
};

const pointRoleLabels: Record<string, string> = {
  user_required: 'User fact',
  can_infer_and_confirm: 'Approve bundle',
  ai_draftable: 'AI draftable',
  context_only: 'Context only',
};

const pointRoleTone: Record<string, string> = {
  user_required: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  can_infer_and_confirm: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  ai_draftable: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  context_only: 'bg-slate-50 text-slate-500 border border-slate-200',
};

function pointConversationRole(point: { conversationRole?: string; sourceTemplatePointer?: string | null; priority?: string }) {
  if (point.conversationRole && pointRoleLabels[point.conversationRole]) {
    return point.conversationRole;
  }
  if (point.priority === 'P3') return 'ai_draftable';
  return point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required';
}

function isUserFacingPoint(point: { conversationRole?: string; sourceTemplatePointer?: string | null; priority?: string }) {
  const role = pointConversationRole(point);
  return role === 'user_required' || role === 'can_infer_and_confirm';
}

const blockLabels: Record<string, string> = {
  priorities: 'Priorities',
  mustAddress: 'Must Address',
  avoid: 'Avoid',
  evaluationCriteria: 'Evaluation Criteria',
  budgetRules: 'Budget Rules',
  durationRules: 'Duration Rules',
  deliverableRules: 'Deliverables',
  reviewerSignals: 'Reviewer Signals',
};

function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-prep-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          {badge}
        </div>
        {open ? (
          <HiChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <HiChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open ? <div className="border-t border-slate-100 px-4 py-3">{children}</div> : null}
    </div>
  );
}

type Props = {
  prepContext: PrepContext;
  fundingContext: PrepFundingContext | null;
  draftingContext: PrepDraftingContext | null;
  overallReadiness: number;
  focusedPointKey: string | null;
  sessionLocked: boolean;
  onFocusedPointHandled: () => void;
  onStageChange: (stageKey: string) => void;
  onJumpToKeyword: (keyword: string) => void;
  onPointAction: (action: PointAction) => Promise<void>;
  onOpenPreview: () => void;
};

export default function GrantPrepContextPanel({
  prepContext,
  fundingContext,
  draftingContext,
  overallReadiness,
  focusedPointKey,
  sessionLocked,
  onFocusedPointHandled,
  onStageChange,
  onJumpToKeyword,
  onPointAction,
  onOpenPreview,
}: Props) {
  const [expandedPointKey, setExpandedPointKey] = useState<string | null>(null);
  const [editingPointKey, setEditingPointKey] = useState<string | null>(null);
  const [editingKeywords, setEditingKeywords] = useState('');
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [busyPointKey, setBusyPointKey] = useState<string | null>(null);
  const pointRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeStage = prepContext.stageStates[prepContext.activeStageKey];
  const activeStageMapping = prepContext.stageMapping[prepContext.activeStageKey];
  const discussionPointLookup = useMemo(
    () =>
      activeStageMapping.discussionPoints.reduce(
        (acc, point) => {
          acc[point.key] = point;
          return acc;
        },
        {} as Record<string, (typeof activeStageMapping.discussionPoints)[number]>
      ),
    [activeStageMapping]
  );

  useEffect(() => {
    if (focusedPointKey && pointRefs.current[focusedPointKey]) {
      pointRefs.current[focusedPointKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusedPointHandled();
    }
  }, [focusedPointKey, onFocusedPointHandled]);

  const thrustChips = useMemo(() => {
    const currentStageThrusts = activeStage.points.flatMap(
      (point) => asStringArray(point.capture?.thrustLinkage)
    );
    const values =
      currentStageThrusts.length > 0
        ? currentStageThrusts
        : prepContext.selectedThrustAreaRuleKeys;
    return Array.from(new Set(values)).slice(0, 8);
  }, [activeStage.points, prepContext.selectedThrustAreaRuleKeys]);

  const keywordFrequency = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(prepContext.stageStates).forEach((stage) => {
      stage.points.forEach((point) => {
        asStringArray(point.capture?.keywords).forEach((keyword) => {
          counts.set(keyword, (counts.get(keyword) || 0) + 1);
        });
      });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [prepContext.stageStates]);

  const visibleKeywords = showAllKeywords ? keywordFrequency : keywordFrequency.slice(0, 12);

  const blockerSummary = useMemo(() => {
    const pendingP1: Array<{ stage: string; label: string }> = [];
    const pendingP2: Array<{ stage: string; label: string }> = [];
    const reviewStages: string[] = [];
    const ruleViolations: string[] = [];

    Object.values(prepContext.stageStates).forEach((stage) => {
      if (!stage.enabled || !stage.pickable) return;
      if (stage.status === 'needs_review') reviewStages.push(stage.title);
      stage.points.forEach((point) => {
        if (point.priority === 'P1' && point.status !== 'covered')
          pendingP1.push({ stage: stage.title, label: point.label });
        if (point.priority === 'P2' && point.status !== 'covered')
          pendingP2.push({ stage: stage.title, label: point.label });
        if (point.capture?.ruleCompliance?.rescopeNeeded && point.capture.ruleCompliance.reason)
          ruleViolations.push(point.capture.ruleCompliance.reason);
      });
    });

    return {
      pendingP1,
      pendingP2,
      reviewStages: Array.from(new Set(reviewStages)),
      ruleViolations: Array.from(new Set(ruleViolations)),
    };
  }, [prepContext.stageStates]);

  const totalBlockerCount =
    blockerSummary.pendingP1.length +
    blockerSummary.pendingP2.length +
    blockerSummary.reviewStages.length +
    blockerSummary.ruleViolations.length;

  const ctaTone =
    overallReadiness < 0.3
      ? 'disabled'
      : overallReadiness < 0.65
        ? 'muted'
        : overallReadiness < 0.85
          ? 'enabled'
          : 'emphasized';

  const guidelinePack =
    draftingContext?.approvedGuidelineRevision?.guideline_pack_json || null;
  const ruleGroups = useMemo(
    () => buildRuleGroups(guidelinePack, prepContext.activeStageKey),
    [guidelinePack, prepContext.activeStageKey]
  );

  const handlePointAction = async (action: PointAction) => {
    setBusyPointKey(action.pointKey);
    try {
      await onPointAction(action);
      if (action.action === 'replace_keywords') setEditingPointKey(null);
    } finally {
      setBusyPointKey(null);
    }
  };

  const userFacingPoints = activeStage.points.filter(isUserFacingPoint);
  const currentStageTotal = userFacingPoints.length;
  const currentStageCovered = userFacingPoints.filter(
    (point) => point.status === 'covered'
  ).length;
  const aiSupportCount = activeStage.points.length - userFacingPoints.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Scrollable sections */}
      <div className="prep-scrollbar flex-1 space-y-3 overflow-y-auto pb-3">
      {/* Section 1: Stage Progress */}
      <CollapsibleSection
        title="Stage Progress"
        badge={
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {percent(activeStage.readiness)}
          </span>
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">{activeStage.title}</div>
            <div className="mt-1 text-sm text-slate-600">
              {currentStageCovered}/{currentStageTotal} user facts approved
            </div>
            {aiSupportCount > 0 ? (
              <div className="mt-1 text-xs text-slate-500">
                {aiSupportCount} AI/context drafting support{aiSupportCount === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
          {activeStage.steeringEvents.length > 0 ? (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
              {activeStage.steeringEvents.length} steering event
              {activeStage.steeringEvents.length === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Readiness</span>
            <span>{percent(activeStage.readiness)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <motion.div
              className={clsx(
                'h-full rounded-full',
                activeStage.readiness >= 0.65
                  ? 'bg-emerald-600'
                  : activeStage.readiness >= 0.3
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
              )}
              animate={{ width: `${Math.max(6, activeStage.readiness * 100)}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 20 }}
            />
          </div>
        </div>
        {thrustChips.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {thrustChips.map((chip) => (
              <span
                key={chip}
                className="rounded-md bg-prep-chipStrong px-2 py-1 text-xs font-medium text-teal-900"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : fundingContext?.focusAreas?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {fundingContext.focusAreas.slice(0, 6).map((chip) => (
              <span
                key={chip}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </CollapsibleSection>

      {/* Section 2: Discussion Points */}
      <CollapsibleSection
        title="Discussion Points"
        badge={
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {currentStageCovered}/{currentStageTotal}
          </span>
        }
      >
        <div className="space-y-3">
          {activeStage.points.map((point) => {
            const mappingPoint = discussionPointLookup[point.key];
            const isExpanded = expandedPointKey === point.key;
            const isEditing = editingPointKey === point.key;
            const isHighlighted = focusedPointKey === point.key;
            const isBusy = busyPointKey === point.key;
            const hasRuleReason = Boolean(point.capture?.ruleCompliance?.reason);
            const pointKeywords = asStringArray(point.capture?.keywords);
            const pointThrustLinkage = asStringArray(point.capture?.thrustLinkage);
            const role = pointConversationRole(point);

            return (
              <div
                key={point.key}
                ref={(element) => {
                  pointRefs.current[point.key] = element;
                }}
                className={clsx(
                  'rounded-lg border px-3 py-3 transition-shadow hover:shadow-prep-card-hover',
                  point.status === 'needs_review'
                    ? 'border-rose-200 bg-rose-50'
                    : 'border-slate-200 bg-slate-50',
                  isHighlighted && 'ring-2 ring-emerald-200'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{point.label}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', priorityTone[point.priority] || 'bg-slate-50 text-slate-500')}>
                        {priorityLabels[point.priority] || point.priority}
                      </span>
                      <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', pointRoleTone[role])}>
                        {pointRoleLabels[role]}
                      </span>
                      {point.sourceTemplatePointer
                        ? <span>{point.sourceTemplatePointer}</span>
                        : <span>default prompt</span>}
                    </div>
                  </div>
                  <span
                    className={clsx(
                      'rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide',
                      point.status === 'covered'
                        ? 'bg-emerald-100 text-emerald-800'
                        : point.status === 'needs_review'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-200 text-slate-700'
                    )}
                  >
                    {point.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {pointKeywords.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pointKeywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-md bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : null}

                {pointThrustLinkage.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pointThrustLinkage.map((thrust) => (
                      <span
                        key={thrust}
                        className="rounded-md bg-prep-chipStrong px-2 py-1 text-xs font-medium text-teal-900"
                      >
                        {thrust}
                      </span>
                    ))}
                  </div>
                ) : null}

                {hasRuleReason ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs text-rose-800">
                    {point.capture?.ruleCompliance?.reason}
                  </div>
                ) : null}

                {isExpanded ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">Why this matters</div>
                    <div className="mt-1">
                      {mappingPoint?.helpText ||
                        'This point helps frame the current stage clearly for the final launch.'}
                    </div>
                    {mappingPoint?.sourceTemplatePointer ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Source: {mappingPoint.sourceTemplatePointer}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isEditing ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Edit keywords
                    </div>
                    <input
                      value={editingKeywords}
                      onChange={(event) => setEditingKeywords(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-prep-accent focus:ring-2 focus:ring-emerald-100"
                      placeholder="Comma-separated keywords"
                    />
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPointKey(null);
                          setEditingKeywords('');
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          // EC-10: validate keywords not empty
                          const trimmedKeywords = editingKeywords
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean);
                          if (trimmedKeywords.length === 0) {
                            toast.error('Please enter at least one keyword.');
                            return;
                          }
                          handlePointAction({
                            stageKey: activeStage.stageKey,
                            pointKey: point.key,
                            action: 'replace_keywords',
                            keywords: trimmedKeywords,
                          });
                        }}
                        className="rounded-lg bg-prep-accent px-3 py-2 text-xs font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {isBusy ? 'Saving...' : 'Save keywords'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Actions: visible text link + dropdown menu */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPointKey((c) => (c === point.key ? null : point.key))
                    }
                    className="text-xs font-medium text-prep-accent hover:text-prep-accentDark"
                  >
                    {isExpanded ? 'Hide details' : 'Why this matters'}
                  </button>

                  {point.capture || point.priority === 'P3' ? (
                    <Menu as="div" className="relative">
                      <Menu.Button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <HiEllipsisVertical className="h-4 w-4" />
                      </Menu.Button>
                      <Transition
                        as={Fragment}
                        enter="transition duration-100 ease-out"
                        enterFrom="opacity-0 scale-95"
                        enterTo="opacity-100 scale-100"
                        leave="transition duration-75 ease-in"
                        leaveFrom="opacity-100 scale-100"
                        leaveTo="opacity-0 scale-95"
                      >
                        <Menu.Items className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                          {point.capture ? (
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePointAction({
                                      stageKey: activeStage.stageKey,
                                      pointKey: point.key,
                                      action: 'reopen',
                                    })
                                  }
                                  disabled={isBusy || sessionLocked}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-xs',
                                    active ? 'bg-slate-50' : '',
                                    (isBusy || sessionLocked) &&
                                      'cursor-not-allowed opacity-60'
                                  )}
                                >
                                  {isBusy ? 'Working...' : 'Reopen'}
                                </button>
                              )}
                            </Menu.Item>
                          ) : null}
                          {point.capture ? (
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPointKey(point.key);
                                    setEditingKeywords(
                                      pointKeywords.join(', ')
                                    );
                                  }}
                                  disabled={sessionLocked}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-xs',
                                    active ? 'bg-slate-50' : '',
                                    sessionLocked && 'cursor-not-allowed opacity-60'
                                  )}
                                >
                                  Edit keywords
                                </button>
                              )}
                            </Menu.Item>
                          ) : null}
                          {point.priority === 'P3' && point.status !== 'skipped' ? (
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePointAction({
                                      stageKey: activeStage.stageKey,
                                      pointKey: point.key,
                                      action: 'skip',
                                    })
                                  }
                                  disabled={isBusy || sessionLocked}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-xs',
                                    active ? 'bg-slate-50' : '',
                                    (isBusy || sessionLocked) &&
                                      'cursor-not-allowed opacity-60'
                                  )}
                                >
                                  Skip
                                </button>
                              )}
                            </Menu.Item>
                          ) : null}
                          {point.priority === 'P3' && point.status === 'skipped' ? (
                            <Menu.Item>
                              {({ active }) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handlePointAction({
                                      stageKey: activeStage.stageKey,
                                      pointKey: point.key,
                                      action: 'unskip',
                                    })
                                  }
                                  disabled={isBusy || sessionLocked}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-xs',
                                    active ? 'bg-slate-50' : '',
                                    (isBusy || sessionLocked) &&
                                      'cursor-not-allowed opacity-60'
                                  )}
                                >
                                  Unskip
                                </button>
                              )}
                            </Menu.Item>
                          ) : null}
                        </Menu.Items>
                      </Transition>
                    </Menu>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* Section 3: Keywords */}
      <CollapsibleSection
        title="Keywords"
        defaultOpen={false}
        badge={
          keywordFrequency.length > 0 ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {keywordFrequency.length}
            </span>
          ) : undefined
        }
      >
        <div className="flex items-center justify-between">
          {keywordFrequency.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAllKeywords((current) => !current)}
              className="text-xs font-medium text-prep-accent hover:text-prep-accentDark"
            >
              {showAllKeywords ? 'Show top' : 'Show all'}
            </button>
          ) : (
            <div />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {visibleKeywords.length > 0 ? (
            visibleKeywords.map(([keyword, count]) => (
              <button
                key={keyword}
                type="button"
                onClick={() => onJumpToKeyword(keyword)}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                title={count >= 3 ? `Connected across ${count} stages/points` : undefined}
              >
                {keyword} {count >= 3 ? `(${count})` : ''}
              </button>
            ))
          ) : (
            <div className="text-sm text-slate-500">No keywords captured yet.</div>
          )}
        </div>
      </CollapsibleSection>

      {/* Section 4: Call Rules */}
      {ruleGroups.length > 0 ? (
        <CollapsibleSection title="Funding Call Rules" defaultOpen={false}>
          <div className="text-xs text-slate-500">
            Revision{' '}
            {draftingContext?.approvedGuidelineRevision?.revision_no || 'approved'}{' '}
            {fundingContext?.agencyName ? `- ${fundingContext.agencyName}` : ''}
          </div>
          <div className="mt-3 space-y-3">
            {ruleGroups.map((group) => (
              <div key={group.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.label}
                </div>
                {group.primary.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {group.primary.slice(0, 3).map((rule) => (
                      <RuleItem key={rule.key} rule={rule} tone="primary" />
                    ))}
                  </div>
                ) : null}
                {group.secondary.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {group.secondary.slice(0, 3).map((rule) => (
                      <RuleItem key={rule.key} rule={rule} tone="secondary" />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      </div>
      {/* End scrollable sections */}

      {/* Section 5: Launch readiness - fixed footer, not scrollable */}
      <div className="mt-3 flex-shrink-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-prep-float">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Launch Readiness</div>
          {totalBlockerCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              {totalBlockerCount} blocker{totalBlockerCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              Ready
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenPreview}
          disabled={sessionLocked || overallReadiness < 0.3}
          className={clsx(
            'mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all',
            ctaTone === 'disabled'
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : ctaTone === 'muted'
                ? 'bg-slate-800 text-white hover:bg-slate-700'
                : ctaTone === 'enabled'
                  ? 'bg-prep-accent text-white hover:bg-prep-accentDark shadow-md'
                  : 'bg-prep-accent text-white hover:bg-prep-accentDark shadow-lg ring-2 ring-emerald-200 ring-offset-2',
            (sessionLocked || overallReadiness < 0.3) && 'cursor-not-allowed'
          )}
        >
          {sessionLocked ? 'Session is locked' : 'Open Launch Preview'}
        </button>
        <div className="mt-2 text-xs text-slate-500">
          {sessionLocked
            ? 'Open the local grant workspace, or restart prep to create a new revision.'
            : ctaTone === 'disabled'
              ? 'Keep working through the core stages before launch.'
              : ctaTone === 'muted'
                ? 'You can preview now, but some coverage is still thin.'
                : ctaTone === 'enabled'
                  ? 'The prep snapshot is close to launch-ready.'
                  : 'This session is in strong shape for launch.'}
        </div>
      </div>
    </div>
  );
}


function RuleItem({
  rule,
  tone,
}: {
  rule: FundingGuidelineRuleItem;
  tone: 'primary' | 'secondary';
}) {
  const tooltip = [
    rule.rationale,
    rule.sourceAnchors?.[0]?.quote,
    rule.sourceAnchors?.[0]?.note,
  ]
    .filter(Boolean)
    .join(' | ');
  return (
    <div
      className={clsx(
        'rounded-lg border px-3 py-2 text-xs',
        tone === 'primary'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-white text-slate-700'
      )}
      title={tooltip || undefined}
    >
      {rule.text}
    </div>
  );
}

function buildRuleGroups(
  guidelinePack: GuidelinePackDocument | null,
  stageKey: string
): PrepRuleGroup[] {
  if (
    !guidelinePack ||
    !GRANT_PREP_STAGE_BY_KEY[stageKey as keyof typeof GRANT_PREP_STAGE_BY_KEY]
  ) {
    return [];
  }

  const blocks =
    GRANT_PREP_STAGE_BY_KEY[stageKey as keyof typeof GRANT_PREP_STAGE_BY_KEY].guidelineBlocks;
  return blocks
    .map((blockKey) => {
      const items =
        (guidelinePack as unknown as Record<string, FundingGuidelineRuleItem[]>)[blockKey] || [];
      const primary = items.filter((item) => item.importance === 'high');
      const secondary = items.filter((item) => item.importance !== 'high');
      return { key: blockKey, label: blockLabels[blockKey] || blockKey, primary, secondary };
    })
    .filter((group) => group.primary.length > 0 || group.secondary.length > 0);
}
