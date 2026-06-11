import { GRANT_PREP_STAGE_BY_KEY } from './stageLibrary';
import { VISIBLE_GRANT_PREP_STAGE_KEYS } from './stageModel';
import { isGrantPrepUserFacingPoint } from './sessionState';
import type {
  GrantPrepMappedPoint,
  GrantPrepPointConversationRole,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageState,
} from './types';

export type GrantPrepPlannedPoint = {
  stageKey: GrantPrepStageKey;
  stageTitle: string;
  pointKey: string;
  label: string;
  priority: string;
  conversationRole: GrantPrepPointConversationRole;
  helpText?: string;
};

export type GrantPrepConversationBundle = {
  primary: GrantPrepPlannedPoint | null;
  related: GrantPrepPlannedPoint[];
  paired: GrantPrepPlannedPoint[];
  lookahead: GrantPrepPlannedPoint[];
};

type RelatedStagePair = {
  stageKey: GrantPrepStageKey;
  note: string;
  requiresUserSignal?: RegExp;
};

export const GRANT_PREP_RELATED_STAGE_PAIRS: Partial<Record<GrantPrepStageKey, RelatedStagePair[]>> = {
  problem_definition: [
    {
      stageKey: 'root_cause',
      note: 'If the user confirms the problem framing, also confirm the driver or current failure behind it.',
    },
  ],
  root_cause: [
    {
      stageKey: 'problem_definition',
      note: 'If the driver changes the problem framing, update the problem facts conservatively.',
    },
  ],
  outcomes: [
    {
      stageKey: 'evaluation',
      note: 'If the user confirms outcomes, also confirm the metric or verification method reviewers will expect.',
    },
  ],
  evaluation: [
    {
      stageKey: 'outcomes',
      note: 'If the user confirms metrics, also capture the outcome those measures prove.',
    },
  ],
  budget_strategy: [
    {
      stageKey: 'innovation',
      note: 'Only pair budget with sustainability or scale when the user already mentions continuity, future funding, adoption, scale, or budget limits.',
      requiresUserSignal: /\b(sustainab\w*|continu\w*|future fund\w*|post[-\s]?grant|after funding|adopt\w*|scale\w*|replicat\w*|budget limit\w*|funding limit\w*|cap|ceiling)\b/i,
    },
  ],
  innovation: [
    {
      stageKey: 'budget_strategy',
      note: 'Only pair innovation/sustainability with budget when the user already mentions continuity, future funding, adoption, scale, or budget limits.',
      requiresUserSignal: /\b(sustainab\w*|continu\w*|future fund\w*|post[-\s]?grant|after funding|adopt\w*|scale\w*|replicat\w*|budget limit\w*|funding limit\w*|cap|ceiling)\b/i,
    },
  ],
};

function getMappedPoint(
  session: GrantPrepSessionContext,
  stageKey: GrantPrepStageKey,
  pointKey: string
): GrantPrepMappedPoint | undefined {
  return session.stageMapping[stageKey]?.discussionPoints.find((point) => point.key === pointKey);
}

function toPlannedPoint(
  session: GrantPrepSessionContext,
  stageState: GrantPrepStageState,
  point: GrantPrepStageState['points'][number]
): GrantPrepPlannedPoint {
  const mappedPoint = getMappedPoint(session, stageState.stageKey, point.key);
  return {
    stageKey: stageState.stageKey,
    stageTitle: stageState.title,
    pointKey: point.key,
    label: point.label,
    priority: point.priority,
    conversationRole: mappedPoint?.conversationRole || point.conversationRole || 'user_required',
    helpText: mappedPoint?.helpText,
  };
}

function pendingPoints(stageState: GrantPrepStageState) {
  return stageState.points
    .filter((point) => (point.status === 'pending' || point.status === 'needs_review') && isGrantPrepUserFacingPoint(point))
    .sort((a, b) => {
      const priorityScore = { P1: 0, P2: 1, P3: 2 } as Record<string, number>;
      const roleScore = { user_required: 0, can_infer_and_confirm: 1, ai_draftable: 2, context_only: 3 } as Record<string, number>;
      const leftRole = roleScore[a.conversationRole || 'user_required'] ?? 3;
      const rightRole = roleScore[b.conversationRole || 'user_required'] ?? 3;
      return leftRole - rightRole || (priorityScore[a.priority] ?? 3) - (priorityScore[b.priority] ?? 3);
    });
}

function isEnabledPickableStage(stageState: GrantPrepStageState | undefined): stageState is GrantPrepStageState {
  return Boolean(
    stageState?.pickable &&
    stageState.enabled &&
    stageState.selectionLevel !== 'excluded'
  );
}

function getPairedStages(
  session: GrantPrepSessionContext,
  stageKey: GrantPrepStageKey,
  latestUserMessage?: string
) {
  const pairs = GRANT_PREP_RELATED_STAGE_PAIRS[stageKey] || [];
  return pairs
    .filter((pair) => !pair.requiresUserSignal || pair.requiresUserSignal.test(latestUserMessage || ''))
    .map((pair) => session.stageStates[pair.stageKey])
    .filter(isEnabledPickableStage);
}

function getCandidateLookaheadStages(
  session: GrantPrepSessionContext,
  stageKey: GrantPrepStageKey,
  excludedStageKeys: Set<GrantPrepStageKey>
) {
  const currentIndex = VISIBLE_GRANT_PREP_STAGE_KEYS.findIndex((key) => key === stageKey);
  const stagesAfterCurrent = VISIBLE_GRANT_PREP_STAGE_KEYS
    .slice(currentIndex >= 0 ? currentIndex + 1 : 0)
    .map((key) => GRANT_PREP_STAGE_BY_KEY[key]);

  return stagesAfterCurrent
    .map((stage) => session.stageStates[stage.key])
    .filter((stage): stage is GrantPrepStageState => isEnabledPickableStage(stage) && !excludedStageKeys.has(stage.stageKey))
    .slice(0, 4);
}

export function buildGrantPrepConversationBundle(input: {
  session: GrantPrepSessionContext;
  stageKey: GrantPrepStageKey;
  latestUserMessage?: string;
}): GrantPrepConversationBundle {
  const stageState = input.session.stageStates[input.stageKey];
  const currentPending = pendingPoints(stageState);
  const primary = currentPending[0] ? toPlannedPoint(input.session, stageState, currentPending[0]) : null;
  const related = currentPending.slice(1, 4).map((point) => toPlannedPoint(input.session, stageState, point));
  const paired = getPairedStages(input.session, input.stageKey, input.latestUserMessage)
    .flatMap((stage) => pendingPoints(stage).slice(0, 2).map((point) => toPlannedPoint(input.session, stage, point)))
    .slice(0, 4);
  const pairedStageKeys = new Set(paired.map((point) => point.stageKey));

  const lookahead = getCandidateLookaheadStages(input.session, input.stageKey, pairedStageKeys)
    .flatMap((stage) => pendingPoints(stage).slice(0, 2).map((point) => toPlannedPoint(input.session, stage, point)))
    .slice(0, 4);

  return { primary, related, paired, lookahead };
}

export function formatGrantPrepConversationBundle(bundle: GrantPrepConversationBundle) {
  const formatPoint = (point: GrantPrepPlannedPoint) =>
    `- stageKey=${point.stageKey} | stage=${point.stageTitle} | pointKey=${point.pointKey} | label=${point.label} | priority=${point.priority} | role=${point.conversationRole}${point.helpText ? ` | help=${point.helpText}` : ''}`;

  return [
    'Conversation bundle for this turn:',
    bundle.primary ? `Primary target:\n${formatPoint(bundle.primary)}` : 'Primary target: none',
    bundle.related.length > 0
      ? `Related current-stage targets:\n${bundle.related.map(formatPoint).join('\n')}`
      : 'Related current-stage targets: none',
    bundle.paired.length > 0
      ? `Related stage opportunity: if the user confirms an option, it may also advance these paired points:\n${bundle.paired.map(formatPoint).join('\n')}`
      : 'Related stage opportunity: none',
    bundle.lookahead.length > 0
      ? `Lookahead targets eligible for cross-stage capture:\n${bundle.lookahead.map(formatPoint).join('\n')}`
      : 'Lookahead targets eligible for cross-stage capture: none',
    '',
    'Coverage objective for this turn:',
    'Ask one bundled question and write options that advance the primary target plus as many related current-stage or paired-stage targets as safely possible.',
    'Default target: 3-5 concrete reviewer-useful facts across 2-4 point keys per option.',
    'The user should be able to approve or lightly edit several facts in one message.',
    'Use paired-stage and lookahead points only when the user answer or selected option clearly supports them.',
    'Do not invent hard facts for cross-stage points; mark uncertain facts as inferred or needs_review.',
  ].join('\n');
}

export function getGrantPrepCrossStageAllowedPointKeys(bundle: GrantPrepConversationBundle) {
  return [...bundle.paired, ...bundle.lookahead].map((point) => `${point.stageKey}.${point.pointKey}`);
}

export function getGrantPrepStageLevelLabel(stageKey: GrantPrepStageKey) {
  return GRANT_PREP_STAGE_BY_KEY[stageKey]?.title || stageKey;
}
