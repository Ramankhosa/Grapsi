import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from './stageLibrary';
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
  lookahead: GrantPrepPlannedPoint[];
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

function getCandidateLookaheadStages(session: GrantPrepSessionContext, stageKey: GrantPrepStageKey) {
  const currentIndex = GRANT_PREP_STAGE_LIBRARY.findIndex((stage) => stage.key === stageKey);
  const stagesAfterCurrent = GRANT_PREP_STAGE_LIBRARY.slice(Math.max(0, currentIndex + 1));

  return stagesAfterCurrent
    .map((stage) => session.stageStates[stage.key])
    .filter(
      (stage): stage is GrantPrepStageState =>
        Boolean(stage?.pickable) &&
        stage.selectionLevel !== 'excluded' &&
        (stage.enabled || stage.selectionLevel === 'optional')
    )
    .slice(0, 4);
}

export function buildGrantPrepConversationBundle(input: {
  session: GrantPrepSessionContext;
  stageKey: GrantPrepStageKey;
}): GrantPrepConversationBundle {
  const stageState = input.session.stageStates[input.stageKey];
  const currentPending = pendingPoints(stageState);
  const primary = currentPending[0] ? toPlannedPoint(input.session, stageState, currentPending[0]) : null;
  const related = currentPending.slice(1, 4).map((point) => toPlannedPoint(input.session, stageState, point));

  const lookahead = getCandidateLookaheadStages(input.session, input.stageKey)
    .flatMap((stage) => pendingPoints(stage).slice(0, 2).map((point) => toPlannedPoint(input.session, stage, point)))
    .slice(0, 4);

  return { primary, related, lookahead };
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
    bundle.lookahead.length > 0
      ? `Lookahead targets eligible for cross-stage capture:\n${bundle.lookahead.map(formatPoint).join('\n')}`
      : 'Lookahead targets eligible for cross-stage capture: none',
    '',
    'Use the primary, related, and lookahead points to propose one approval bundle of hard facts.',
    'The user should be able to approve or lightly edit several facts in one message.',
    'Use lookahead points only when the user answer or selected option clearly supports them.',
    'Do not invent hard facts for lookahead points; mark uncertain facts as inferred or needs_review.',
  ].join('\n');
}

export function getGrantPrepCrossStageAllowedPointKeys(bundle: GrantPrepConversationBundle) {
  return bundle.lookahead.map((point) => `${point.stageKey}.${point.pointKey}`);
}

export function getGrantPrepStageLevelLabel(stageKey: GrantPrepStageKey) {
  return GRANT_PREP_STAGE_BY_KEY[stageKey]?.title || stageKey;
}
