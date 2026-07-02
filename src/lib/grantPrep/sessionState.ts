import crypto from 'crypto';
import {
  GRANT_PREP_STAGE_BY_KEY,
  GRANT_PREP_STAGE_LIBRARY,
  getDefaultEnabledStageKeys,
  getFirstEnabledPickableStageKey,
  getNextEnabledPickableStageKey,
  sortGrantPrepStageKeys,
} from './stageLibrary';
import {
  GRANT_PREP_STAGE_ALIAS_TO_CANONICAL,
  getCanonicalGrantPrepStageKey,
  isHiddenGrantPrepStageKey,
} from './stageModel';
import type {
  GrantPrepMappedPoint,
  GrantPrepIdeaAnchorV1,
  GrantPrepMarkerPayload,
  GrantPrepMode,
  GrantPrepPointConversationRole,
  GrantPrepPointCapture,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageMapping,
  GrantPrepStageSelectionLevel,
  GrantPrepStageSelectionSource,
  GrantPrepStageStates,
  GrantPrepSteeringEvent,
  PointPriority,
} from './types';
import { normalizeGrantPrepIdeationDecision } from './ideaAnchor';
import {
  markGrantPrepStageMemoryStale,
  normalizeGrantPrepStageMemory,
} from './stageMemory';

function nowIso() {
  return new Date().toISOString();
}

function clampConfidence(value: unknown, fallback = 0.7) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(0, Math.min(1, numeric))
}

const CAPTURE_BASIS_VALUES = new Set<GrantPrepPointCapture['captureBasis'][number]>([
  'from_pitch',
  'inferred_from_call',
  'generic_placeholder',
  'user_confirmed',
]);

const POINT_CONVERSATION_ROLE_VALUES = new Set<GrantPrepPointConversationRole>([
  'user_required',
  'can_infer_and_confirm',
  'ai_draftable',
  'context_only',
]);

export function normalizeGrantPrepPointConversationRole(
  value: unknown,
  fallback: GrantPrepPointConversationRole = 'user_required'
): GrantPrepPointConversationRole {
  return POINT_CONVERSATION_ROLE_VALUES.has(value as GrantPrepPointConversationRole)
    ? (value as GrantPrepPointConversationRole)
    : fallback;
}

function inferPointConversationRole(point: {
  priority?: PointPriority;
  sourceTemplatePointer?: string | null;
  conversationRole?: unknown;
}) {
  if (POINT_CONVERSATION_ROLE_VALUES.has(point.conversationRole as GrantPrepPointConversationRole)) {
    return point.conversationRole as GrantPrepPointConversationRole;
  }

  if (point.priority === 'P3') {
    return 'ai_draftable';
  }

  return point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required';
}

export function isGrantPrepUserFacingPoint(point: {
  priority?: PointPriority;
  sourceTemplatePointer?: string | null;
  conversationRole?: unknown;
}) {
  const role = inferPointConversationRole(point);
  return role === 'user_required' || role === 'can_infer_and_confirm';
}

function normalizeStageKeySet(stageKeys?: GrantPrepStageKey[]) {
  const source = stageKeys && stageKeys.length > 0 ? stageKeys : getDefaultEnabledStageKeys();
  return new Set(source.map(getCanonicalGrantPrepStageKey));
}

function makeDefaultMappedPoint(point: {
  key: string;
  label: string;
  priority: PointPriority;
  sourceTemplatePointer?: string | null;
  conversationRole?: unknown;
  helpText?: string;
}): GrantPrepMappedPoint {
  return {
    key: point.key,
    label: point.label,
    priority: point.priority,
    sourceTemplatePointer: point.sourceTemplatePointer || null,
    origin: 'default',
    conversationRole: normalizeGrantPrepPointConversationRole(
      point.conversationRole,
      point.priority === 'P3' ? 'ai_draftable' : point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required'
    ),
    helpText: point.helpText || '',
  };
}

function getStageMappedPointDefinitions(
  stageKey: GrantPrepStageKey,
  stageMapping?: GrantPrepStageMapping
): GrantPrepMappedPoint[] {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey];
  const definitions: GrantPrepMappedPoint[] = stage.defaultPoints.map((point) =>
    makeDefaultMappedPoint({
      ...point,
      helpText: point.helpText,
    })
  );
  const seen = new Set(definitions.map((point) => point.key));

  for (const point of stageMapping?.[stageKey]?.discussionPoints || []) {
    if (seen.has(point.key)) {
      continue;
    }
    seen.add(point.key);
    definitions.push(makeDefaultMappedPoint(point));
  }

  return definitions;
}

function coerceStringArray(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function uniq(values: unknown) {
  return Array.from(new Set(coerceStringArray(values)));
}

function canonicalKeyword(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([:/-])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ');
}

function uniqKeywords(values: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of coerceStringArray(values)) {
    const normalized = canonicalKeyword(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractNumericCandidates(text: string) {
  return Array.from(
    text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(crore|cr|lakh|lac|million|mn|m|billion|bn|b)?/gi)
  ).map((match) => ({
    value: Number(String(match[1] || '').replace(/,/g, '')),
    unit: String(match[2] || '').toLowerCase(),
  }))
}

function normalizeBudgetValueToLakhs(value: number, unit: string) {
  if (!Number.isFinite(value)) return null
  if (unit === 'crore' || unit === 'cr') return value * 100
  if (unit === 'million' || unit === 'mn' || unit === 'm') return value * 10
  if (unit === 'billion' || unit === 'bn' || unit === 'b') return value * 10000
  return value
}

function extractBudgetUpperBound(text?: string | null): number | null {
  const normalized = String(text || '')
  if (!normalized.trim()) return null
  const candidates = extractNumericCandidates(normalized)
    .map((candidate) => normalizeBudgetValueToLakhs(candidate.value, candidate.unit))
    .filter((value): value is number => Number.isFinite(value))
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

function extractDurationUpperBoundInMonths(text?: string | null): number | null {
  const normalized = String(text || '')
  if (!normalized.trim()) return null
  const monthMatches = Array.from(normalized.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(month|months|mo)\b/gi))
    .map((match) => Number(String(match[1] || '').replace(/,/g, '')))
  const yearMatches = Array.from(normalized.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(year|years|yr)\b/gi))
    .map((match) => Number(String(match[1] || '').replace(/,/g, '')) * 12)
  const all = [...monthMatches, ...yearMatches].filter((value) => Number.isFinite(value))
  if (all.length === 0) return null
  return Math.max(...all)
}

function buildCaptureText(capture: GrantPrepPointCapture) {
  return [
    ...(capture.keywords || []),
    ...(capture.factBullets || []),
    ...(capture.ruleNotes || []),
    ...(capture.thrustLinkage || []),
    capture.ruleCompliance.reason || '',
  ].join(' ')
}

export function normalizeGrantPrepStringArray(values: unknown) {
  return uniq(values);
}

export function normalizeGrantPrepKeywords(values: unknown) {
  return uniqKeywords(values);
}

export function normalizeGrantPrepCaptureBasis(
  values: unknown,
  fallback: GrantPrepPointCapture['captureBasis'] = ['user_confirmed']
) {
  const normalized = uniq(values).filter(
    (value): value is GrantPrepPointCapture['captureBasis'][number] =>
      CAPTURE_BASIS_VALUES.has(value as GrantPrepPointCapture['captureBasis'][number])
  );

  return normalized.length > 0 ? normalized : fallback;
}

export function determineGrantPrepMode(options: {
  hasFundingCall: boolean;
  hasApprovedTemplate: boolean;
  hasApprovedGuidelines: boolean;
}): GrantPrepMode {
  if (options.hasApprovedTemplate && options.hasApprovedGuidelines) {
    return 'template_driven';
  }
  if (options.hasApprovedTemplate) {
    return 'template_only';
  }
  if (options.hasApprovedGuidelines && options.hasFundingCall) {
    return 'guided_fallback';
  }
  if (options.hasFundingCall) {
    return 'lightweight';
  }
  return 'standalone';
}

export function buildInitialStageStates(
  stageMapping: GrantPrepStageMapping,
  enabledStageKeys?: GrantPrepStageKey[],
  selectionSources?: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>>,
  selectionLevels?: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionLevel>>
): GrantPrepStageStates {
  const enabled = normalizeStageKeySet(enabledStageKeys);

  return GRANT_PREP_STAGE_LIBRARY.reduce((acc, stage) => {
    const isEnabled = enabled.has(stage.key);
    acc[stage.key] = {
      stageKey: stage.key,
      title: stage.title,
      enabled: isEnabled,
      pickable: stage.pickable,
      selectionSource: isEnabled ? selectionSources?.[stage.key] || null : null,
      selectionLevel:
        selectionLevels?.[stage.key] ||
        (stage.pickable ? (isEnabled ? 'recommended' : 'optional') : 'required'),
      readiness: 0,
      status: isEnabled ? 'not_started' : 'disabled',
      steeringEvents: [],
      points: getStageMappedPointDefinitions(stage.key, stageMapping).map((point) => ({
        key: point.key,
        label: point.label,
        priority: point.priority,
        conversationRole: normalizeGrantPrepPointConversationRole(
          point.conversationRole,
          point.priority === 'P3' ? 'ai_draftable' : point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required'
        ),
        status: 'pending',
        sourceTemplatePointer: point.sourceTemplatePointer,
        capture: null,
      })),
      lastUpdatedAt: null,
      memory: null,
      decision: null,
    };
    return acc;
  }, {} as GrantPrepStageStates);
}

export function computeStageReadiness(stageState: GrantPrepStageStates[GrantPrepStageKey]) {
  const relevantPoints = stageState.points.filter((point) => point.priority !== 'P3' && isGrantPrepUserFacingPoint(point));
  const denominator = relevantPoints.length;
  if (denominator === 0) {
    return 1;
  }

  const score = relevantPoints.reduce((total, point) => {
    if (point.status === 'covered') {
      return total + (point.priority === 'P1' ? 1 : point.priority === 'P2' ? 0.7 : 0.35);
    }
    if (point.status === 'needs_review') {
      return total + 0.2;
    }
    if (point.status === 'skipped' && point.priority === 'P3') {
      return total + 0.2;
    }
    return total;
  }, 0);

  return Math.max(0, Math.min(1, score / denominator));
}

export function computeOverallReadiness(stageStates: GrantPrepStageStates) {
  const activeStages = Object.values(stageStates).filter((stage) => stage.enabled && stage.pickable);
  if (activeStages.length === 0) {
    return 0;
  }

  const total = activeStages.reduce((sum, stage) => sum + stage.readiness, 0);
  return Math.max(0, Math.min(1, total / activeStages.length));
}

export function collectGlobalKeywords(stageStates: GrantPrepStageStates) {
  const keywords = Object.values(stageStates).flatMap((stage) =>
    stage.points.flatMap((point) => normalizeGrantPrepKeywords(point.capture?.keywords))
  );
  return uniqKeywords(keywords);
}

function buildSteeringEvent(message: string, level: GrantPrepSteeringEvent['level'], pointKey: string | null): GrantPrepSteeringEvent {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    pointKey,
    createdAt: nowIso(),
  };
}

function normalizeCapture(
  current: GrantPrepPointCapture | null,
  next: NonNullable<GrantPrepMarkerPayload['pointsCovered']>[number]
): GrantPrepPointCapture {
  const thrustLinkage = normalizeGrantPrepStringArray(next.thrustLinkage ?? current?.thrustLinkage ?? []);
  const keywords = normalizeGrantPrepKeywords(next.keywords ?? current?.keywords ?? []);
  const factBullets = normalizeGrantPrepStringArray(next.factBullets ?? current?.factBullets ?? []);
  const ruleNotes = normalizeGrantPrepStringArray(next.ruleNotes ?? current?.ruleNotes ?? []);
  const captureBasis = normalizeGrantPrepCaptureBasis(next.captureBasis ?? current?.captureBasis ?? ['user_confirmed']);

  return {
    keywords,
    thrustLinkage,
    factBullets,
    ruleNotes,
    confidence: clampConfidence(next.confidence ?? current?.confidence, current?.confidence ?? 0.7),
    captureBasis,
    sourceTemplatePointer: current?.sourceTemplatePointer || null,
    ruleCompliance: {
      status: next.ruleCompliance?.status || current?.ruleCompliance?.status || 'ok',
      reason: next.ruleCompliance?.reason ?? current?.ruleCompliance?.reason ?? null,
      rescopeNeeded: next.ruleCompliance?.rescopeNeeded ?? current?.ruleCompliance?.rescopeNeeded ?? false,
    },
    updatedAt: nowIso(),
  };
}

export function requiresGrantPrepThrustLinkage(options: {
  selectedThrustAreaRuleKeys: string[];
  availableFocusAreas: string[];
}) {
  return options.selectedThrustAreaRuleKeys.length > 0 || options.availableFocusAreas.length > 0;
}

export function isExpertGrantPrepMode(engagementMode: GrantPrepSessionContext['engagementMode']) {
  return engagementMode === 'expert';
}

export function getGrantPrepPointStatus(input: {
  stageKey: GrantPrepStageKey;
  pointKey?: string;
  capture: GrantPrepPointCapture;
  requiresThrustLinkage: boolean;
  engagementMode: GrantPrepSessionContext['engagementMode'];
  pointPriority?: PointPriority;
  qualityAssessment?: GrantPrepMarkerPayload['qualityAssessment'];
  budgetLimits?: string | null;
  projectDuration?: string | null;
}) {
  if (input.capture.keywords.length === 0 && (input.capture.factBullets || []).length === 0) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'gentle_redirect' as const,
      steeringMessage: 'A discussion point was left without usable facts or keywords.',
    };
  }

  if (isExpertGrantPrepMode(input.engagementMode) && input.capture.captureBasis.includes('generic_placeholder')) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'gentle_redirect' as const,
      steeringMessage: 'This point contains placeholder content that needs to be made more specific and competitive.',
    };
  }

  if (
    input.requiresThrustLinkage &&
    (
      input.stageKey === 'thrust_alignment' ||
      (input.stageKey === 'fit_and_scope' && input.pointKey === 'priority_match')
    ) &&
    input.capture.thrustLinkage.length === 0
  ) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'hard_block' as const,
      steeringMessage: 'Priority alignment needs an explicit thrust or priority linkage.',
    };
  }

  const captureText = buildCaptureText(input.capture)
  const projectDurationUpperBound = extractDurationUpperBoundInMonths(input.projectDuration)
  const capturedDuration = extractDurationUpperBoundInMonths(captureText)
  if (
    (
      input.stageKey === 'workplan' ||
      (input.stageKey === 'methodology' && (input.pointKey === 'phases' || input.pointKey === 'deliverables'))
    )
    && projectDurationUpperBound
    && capturedDuration
    && capturedDuration > projectDurationUpperBound
  ) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'hard_block' as const,
      steeringMessage: `Captured workplan exceeds the funding-call duration limit of ${projectDurationUpperBound} months.`,
    };
  }

  const budgetUpperBound = extractBudgetUpperBound(input.budgetLimits)
  const capturedBudget = extractBudgetUpperBound(captureText)
  if (
    input.stageKey === 'budget_strategy'
    && budgetUpperBound
    && capturedBudget
    && capturedBudget > budgetUpperBound
  ) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'hard_block' as const,
      steeringMessage: 'Captured budget strategy appears to exceed the call budget ceiling.',
    };
  }

  if (/\b(out of scope|ineligible|forbidden|not allowed)\b/i.test(captureText)) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'hard_block' as const,
      steeringMessage: 'Captured content appears to conflict with scope or eligibility rules.',
    };
  }

  if (input.capture.ruleCompliance.rescopeNeeded) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'hard_block' as const,
      steeringMessage: input.capture.ruleCompliance.reason || 'This point needs review before handoff.',
    };
  }

  if (
    isExpertGrantPrepMode(input.engagementMode) &&
    input.qualityAssessment === 'weak' &&
    input.pointPriority !== 'P3'
  ) {
    return {
      status: 'needs_review' as const,
      steeringLevel: 'gentle_redirect' as const,
      steeringMessage: 'Expert mode keeps weak priority captures in review until the answer is concrete enough for downstream drafting.',
    };
  }

  return {
    status: input.capture.ruleCompliance.status === 'needs_review' ? ('needs_review' as const) : ('covered' as const),
    steeringLevel: null,
    steeringMessage: null,
  };
}

export function addGrantPrepSteeringEvent(
  stageState: GrantPrepStageStates[GrantPrepStageKey],
  message: string,
  level: GrantPrepSteeringEvent['level'],
  pointKey: string | null
) {
  stageState.steeringEvents.push(buildSteeringEvent(message, level, pointKey));
}

export function deriveStageStatus(stageState: GrantPrepStageStates[GrantPrepStageKey]) {
  if (!stageState.enabled) {
    return 'disabled' as const;
  }

  if (stageState.points.some((point) => point.status === 'needs_review' && isGrantPrepUserFacingPoint(point))) {
    return 'needs_review' as const;
  }

  if (stageState.readiness >= 0.65) {
    return 'completed' as const;
  }

  if (stageState.points.some((point) => point.status === 'covered')) {
    return 'in_progress' as const;
  }

  return 'not_started' as const;
}

export function recomputeStageState(stageState: GrantPrepStageStates[GrantPrepStageKey]) {
  stageState.readiness = computeStageReadiness(stageState);
  stageState.lastUpdatedAt = nowIso();
  stageState.status = deriveStageStatus(stageState);
  return stageState;
}

export function canAutoAdvanceGrantPrepStage(
  stageState: GrantPrepStageStates[GrantPrepStageKey],
  engagementMode: GrantPrepSessionContext['engagementMode']
) {
  if (stageState.stageKey === 'ideation') {
    return false;
  }

  return stageState.readiness >= 0.65 && (!isExpertGrantPrepMode(engagementMode) || stageState.status !== 'needs_review');
}

export function seedGrantPrepStagePointsFromIdeaAnchor(input: {
  stageStates: GrantPrepStageStates;
  anchor: GrantPrepIdeaAnchorV1;
  selectedPriorityAreas: string[];
}) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(input.stageStates));
  const fitFacts = [...input.anchor.funderFit, ...input.selectedPriorityAreas]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const seeds: Array<{
    stageKey: GrantPrepStageKey;
    pointKey: string;
    facts: string[];
    thrustLinkage?: string[];
  }> = [
    {
      stageKey: 'problem_definition',
      pointKey: 'problem_core',
      facts: [input.anchor.problemOrOpportunity].filter(Boolean),
    },
    {
      stageKey: 'beneficiaries',
      pointKey: 'direct_beneficiaries',
      facts: [input.anchor.targetBeneficiariesOrSetting || ''].filter(Boolean),
    },
    {
      stageKey: 'fit_and_scope',
      pointKey: 'call_fit',
      facts: fitFacts,
    },
    {
      stageKey: 'fit_and_scope',
      pointKey: 'priority_match',
      facts: fitFacts,
      thrustLinkage: input.selectedPriorityAreas,
    },
    {
      stageKey: 'methodology',
      pointKey: 'approach',
      facts: [input.anchor.coreApproach].filter(Boolean),
    },
  ];
  const touched = new Set<GrantPrepStageKey>();

  for (const seed of seeds) {
    if (seed.facts.length === 0) continue;
    const stage = nextStates[seed.stageKey];
    const point = stage?.points.find((item) => item.key === seed.pointKey);
    if (
      !stage?.pickable
      || !point
      || point.status === 'covered'
      || point.capture?.captureBasis.includes('user_confirmed')
    ) continue;

    point.capture = {
      keywords: input.anchor.keywords.slice(0, 12),
      thrustLinkage: seed.thrustLinkage || [],
      factBullets: seed.facts.slice(0, 4),
      ruleNotes: ['Prefilled from the finalized idea anchor; user confirmation is still required.'],
      confidence: 0.8,
      captureBasis: ['from_pitch'],
      sourceTemplatePointer: point.sourceTemplatePointer,
      ruleCompliance: {
        status: 'needs_review',
        reason: 'Confirm this idea-anchor prefill before treating it as covered.',
        rescopeNeeded: false,
      },
      updatedAt: nowIso(),
    };
    point.status = 'needs_review';
    touched.add(seed.stageKey);
  }

  for (const stageKey of touched) recomputeStageState(nextStates[stageKey]);
  return nextStates;
}

export function isGrantPrepSessionReady(
  stageStates: GrantPrepStageStates,
  engagementMode: GrantPrepSessionContext['engagementMode']
) {
  return Object.values(stageStates).every(
    (stage) =>
      !stage.enabled ||
      !stage.pickable ||
      stage.selectionLevel === 'optional' ||
      (stage.readiness >= 0.65 && (!isExpertGrantPrepMode(engagementMode) || stage.status !== 'needs_review'))
  );
}

export function applyMarkerToStageStates(
  stageStates: GrantPrepStageStates,
  stageKey: GrantPrepStageKey,
  marker: GrantPrepMarkerPayload,
  options: {
    engagementMode: GrantPrepSessionContext['engagementMode'];
    selectedThrustAreaRuleKeys: string[];
    availableFocusAreas: string[];
    budgetLimits?: string | null;
    projectDuration?: string | null;
  }
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const stageState = nextStates[stageKey];
  const requiresThrustLinkage = requiresGrantPrepThrustLinkage(options);
  let weakPriorityCaptureFlagged = false;

  if (Array.isArray(marker.pointsCovered)) {
    for (const pointUpdate of marker.pointsCovered) {
      const point = stageState.points.find((item) => item.key === pointUpdate.pointKey);
      if (!point) {
        continue;
      }

      const capture = normalizeCapture(point.capture, pointUpdate);
      point.capture = capture;

      const statusResult = getGrantPrepPointStatus({
        stageKey,
        pointKey: point.key,
        capture,
        requiresThrustLinkage,
        engagementMode: options.engagementMode,
        pointPriority: point.priority,
        qualityAssessment: marker.qualityAssessment || null,
        budgetLimits: options.budgetLimits,
        projectDuration: options.projectDuration,
      });
      point.status = statusResult.status;
      if (
        isExpertGrantPrepMode(options.engagementMode) &&
        marker.qualityAssessment === 'weak' &&
        point.priority !== 'P3'
      ) {
        weakPriorityCaptureFlagged = true;
      }
      if (statusResult.steeringMessage && statusResult.steeringLevel) {
        addGrantPrepSteeringEvent(stageState, statusResult.steeringMessage, statusResult.steeringLevel, point.key);
      }
    }
  }

  if (Array.isArray(marker.steeringEvents)) {
    marker.steeringEvents.forEach((event) => {
      addGrantPrepSteeringEvent(stageState, event.message, event.level, event.pointKey || null);
    });
  }

  if (weakPriorityCaptureFlagged) {
    addGrantPrepSteeringEvent(
      stageState,
      'Expert mode kept newly updated priority points in review because this stage is still weak against the reviewer rubric.',
      'gentle_redirect',
      null
    );
  }

  recomputeStageState(stageState);

  return nextStates;
}

function captureHasTraceableContent(capture: GrantPrepPointCapture) {
  return [
    ...(capture.keywords || []),
    ...(capture.factBullets || []),
    ...(capture.ruleNotes || []),
  ].some((value) => String(value || '').trim().length > 0);
}

function crossStageCaptureCanReceiveFullCredit(capture: GrantPrepPointCapture) {
  return (
    (capture.confidence || 0) >= 0.85 &&
    capture.ruleCompliance.status === 'ok' &&
    !capture.captureBasis.includes('generic_placeholder') &&
    captureHasTraceableContent(capture)
  );
}

export function applyCrossStageMarkerToStageStates(
  stageStates: GrantPrepStageStates,
  marker: GrantPrepMarkerPayload,
  options: {
    engagementMode: GrantPrepSessionContext['engagementMode'];
    selectedThrustAreaRuleKeys: string[];
    availableFocusAreas: string[];
    budgetLimits?: string | null;
    projectDuration?: string | null;
    allowedCrossStagePointKeys?: string[];
  }
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const requiresThrustLinkage = requiresGrantPrepThrustLinkage(options);
  const updates = Array.isArray(marker.crossStagePointsCovered) ? marker.crossStagePointsCovered : [];
  const allowedCrossStagePointKeys = options.allowedCrossStagePointKeys
    ? new Set(options.allowedCrossStagePointKeys)
    : null;

  for (const pointUpdate of updates) {
    const targetStageKey = pointUpdate.stageKey
      ? getCanonicalGrantPrepStageKey(pointUpdate.stageKey)
      : undefined;
    const markerStageKey = getCanonicalGrantPrepStageKey(marker.stageKey);
    if (!targetStageKey || targetStageKey === markerStageKey) {
      continue;
    }
    if (allowedCrossStagePointKeys && !allowedCrossStagePointKeys.has(`${targetStageKey}.${pointUpdate.pointKey}`)) {
      continue;
    }

    const stageState = nextStates[targetStageKey];
    if (!stageState?.pickable || stageState.selectionLevel === 'excluded') {
      continue;
    }

    const point = stageState.points.find((item) => item.key === pointUpdate.pointKey);
    if (!point) {
      continue;
    }

    const capture = normalizeCapture(point.capture, pointUpdate);
    point.capture = capture;

    const statusResult = getGrantPrepPointStatus({
      stageKey: targetStageKey,
      pointKey: point.key,
      capture,
      requiresThrustLinkage,
      engagementMode: options.engagementMode,
      pointPriority: point.priority,
      budgetLimits: options.budgetLimits,
      projectDuration: options.projectDuration,
    });

    point.status = crossStageCaptureCanReceiveFullCredit(capture)
      ? statusResult.status
      : 'needs_review';

    if (point.status === 'needs_review') {
      addGrantPrepSteeringEvent(
        stageState,
        'This point was inferred from a related conversation turn and should be reviewed before handoff.',
        'awareness_nudge',
        point.key
      );
    } else if (statusResult.steeringMessage && statusResult.steeringLevel) {
      addGrantPrepSteeringEvent(stageState, statusResult.steeringMessage, statusResult.steeringLevel, point.key);
    }

    if (!stageState.enabled && stageState.selectionLevel === 'optional') {
      stageState.selectionLevel = 'recommended';
      stageState.enabled = true;
      stageState.selectionSource = stageState.selectionSource || 'manual';
    }

    recomputeStageState(stageState);
  }

  return nextStates;
}

export function reassessGrantPrepStageStates(
  stageStates: GrantPrepStageStates,
  options: {
    engagementMode: GrantPrepSessionContext['engagementMode'];
    selectedThrustAreaRuleKeys: string[];
    availableFocusAreas: string[];
    budgetLimits?: string | null;
    projectDuration?: string | null;
  }
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const requiresThrustLinkage = requiresGrantPrepThrustLinkage(options);

  Object.values(nextStates).forEach((stageState) => {
    if (!stageState.enabled) {
      stageState.status = 'disabled';
      return;
    }

    if (!stageState.pickable) {
      return;
    }

    stageState.points = stageState.points.map((point) => {
      if (point.status === 'skipped') {
        return point;
      }

      if (!point.capture) {
        return {
          ...point,
          status: 'pending',
        };
      }

      const statusResult = getGrantPrepPointStatus({
        stageKey: stageState.stageKey,
        pointKey: point.key,
        capture: point.capture,
        requiresThrustLinkage,
        engagementMode: options.engagementMode,
        pointPriority: point.priority,
        budgetLimits: options.budgetLimits,
        projectDuration: options.projectDuration,
      });

      return {
        ...point,
        status: statusResult.status,
      };
    });

    recomputeStageState(stageState);
  });

  return nextStates;
}

export function pointHasCapturedContent(point: GrantPrepStageStates[GrantPrepStageKey]['points'][number]) {
  return Boolean(
    point.capture &&
    (
      normalizeGrantPrepKeywords(point.capture.keywords).length > 0 ||
      normalizeGrantPrepStringArray(point.capture.factBullets).length > 0 ||
      normalizeGrantPrepStringArray(point.capture.ruleNotes).length > 0 ||
      normalizeGrantPrepStringArray(point.capture.thrustLinkage).length > 0
    )
  );
}

function appendMissingStagePoints(
  stageState: GrantPrepStageStates[GrantPrepStageKey],
  stageMapping?: GrantPrepStageMapping
) {
  const definitions = getStageMappedPointDefinitions(stageState.stageKey, stageMapping);
  const existingKeys = new Set(stageState.points.map((point) => point.key));
  const missingPoints = definitions
    .filter((point) => !existingKeys.has(point.key))
    .map((point) => ({
      key: point.key,
      label: point.label,
      priority: point.priority,
      conversationRole: normalizeGrantPrepPointConversationRole(
        point.conversationRole,
        point.priority === 'P3' ? 'ai_draftable' : point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required'
      ),
      status: 'pending' as const,
      sourceTemplatePointer: point.sourceTemplatePointer,
      capture: null,
    }));

  stageState.points.push(...missingPoints);
}

function mergeLegacyStageCapturesIntoCanonical(
  stageStates: GrantPrepStageStates,
  stageMapping?: GrantPrepStageMapping
) {
  for (const [legacyStageKey, canonicalStageKey] of Object.entries(GRANT_PREP_STAGE_ALIAS_TO_CANONICAL)) {
    const legacyState = stageStates[legacyStageKey as GrantPrepStageKey];
    const canonicalState = stageStates[canonicalStageKey as GrantPrepStageKey];
    if (!legacyState || !canonicalState) {
      continue;
    }

    appendMissingStagePoints(canonicalState, stageMapping);
    const canonicalPoints = new Map(canonicalState.points.map((point) => [point.key, point]));
    let copiedCapture = false;

    for (const legacyPoint of legacyState.points) {
      if (!pointHasCapturedContent(legacyPoint)) {
        continue;
      }

      const canonicalPoint = canonicalPoints.get(legacyPoint.key);
      if (!canonicalPoint) {
        canonicalState.points.push({
          ...legacyPoint,
          conversationRole: inferPointConversationRole(legacyPoint),
        });
        copiedCapture = true;
        continue;
      }

      if (!canonicalPoint.capture) {
        canonicalPoint.status = legacyPoint.status;
        canonicalPoint.sourceTemplatePointer = canonicalPoint.sourceTemplatePointer || legacyPoint.sourceTemplatePointer;
        canonicalPoint.capture = legacyPoint.capture
          ? {
              ...legacyPoint.capture,
              sourceTemplatePointer:
                canonicalPoint.sourceTemplatePointer ||
                legacyPoint.capture.sourceTemplatePointer ||
                legacyPoint.sourceTemplatePointer ||
                null,
            }
          : null;
        copiedCapture = true;
      }
    }

    if (copiedCapture) {
      canonicalState.enabled = canonicalState.selectionLevel !== 'excluded';
      canonicalState.selectionLevel =
        canonicalState.selectionLevel === 'required' ? 'required' : 'recommended';
      canonicalState.selectionSource = canonicalState.selectionSource || legacyState.selectionSource || 'fallback';
      recomputeStageState(canonicalState);
    }
  }
}

export function normalizeGrantPrepStageStates(
  stageStates: GrantPrepStageStates,
  stageMapping?: GrantPrepStageMapping
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates || {}));

  GRANT_PREP_STAGE_LIBRARY.forEach((stage) => {
    if (nextStates[stage.key]) {
      return;
    }

    const isEnabled = stage.key === 'ideation' ? true : stage.defaultEnabled;
    nextStates[stage.key] = {
      stageKey: stage.key,
      title: stage.title,
      enabled: isEnabled,
      pickable: stage.pickable,
      selectionSource: isEnabled ? 'fallback' : null,
      selectionLevel: stage.key === 'ideation'
        ? 'required'
        : stage.pickable
          ? (isEnabled ? 'recommended' : 'optional')
          : 'required',
      readiness: 0,
      status: isEnabled ? 'not_started' : 'disabled',
      steeringEvents: [],
      points: getStageMappedPointDefinitions(stage.key, stageMapping).map((point) => ({
        key: point.key,
        label: point.label,
        priority: point.priority,
        conversationRole: normalizeGrantPrepPointConversationRole(
          'conversationRole' in point ? point.conversationRole : undefined,
          point.priority === 'P3' ? 'ai_draftable' : point.sourceTemplatePointer ? 'can_infer_and_confirm' : 'user_required'
        ),
        status: 'pending',
        sourceTemplatePointer: point.sourceTemplatePointer,
        capture: null,
      })),
      lastUpdatedAt: null,
      memory: null,
      decision: null,
    };
  });

  Object.values(nextStates).forEach((stageState) => {
    const stageDefinition = GRANT_PREP_STAGE_BY_KEY[stageState.stageKey];
    if (stageDefinition) {
      stageState.title = stageDefinition.title;
      stageState.pickable = stageDefinition.pickable;
    }

    if (
      stageState.selectionLevel !== 'required' &&
      stageState.selectionLevel !== 'recommended' &&
      stageState.selectionLevel !== 'optional' &&
      stageState.selectionLevel !== 'excluded'
    ) {
      stageState.selectionLevel = stageState.pickable
        ? (stageState.enabled ? 'recommended' : 'optional')
        : 'required';
    }

    if (!Array.isArray(stageState?.points)) {
      stageState.points = [];
    }
    appendMissingStagePoints(stageState, stageMapping);
    stageState.memory = normalizeGrantPrepStageMemory(stageState.memory);
    stageState.decision = stageState.stageKey === 'ideation'
      ? normalizeGrantPrepIdeationDecision(stageState.decision)
      : null;

    stageState.points = stageState.points.map((point) => {
      const conversationRole = inferPointConversationRole(point);
      if (!point.capture) {
        return {
          ...point,
          conversationRole,
        };
      }

      const ruleComplianceStatus = point.capture.ruleCompliance?.status;
      return {
        ...point,
        conversationRole,
        capture: {
          ...point.capture,
          keywords: normalizeGrantPrepKeywords(point.capture.keywords),
          thrustLinkage: normalizeGrantPrepStringArray(point.capture.thrustLinkage),
          factBullets: normalizeGrantPrepStringArray(point.capture.factBullets),
          ruleNotes: normalizeGrantPrepStringArray(point.capture.ruleNotes),
          confidence: clampConfidence(point.capture.confidence, 0.7),
          captureBasis: normalizeGrantPrepCaptureBasis(point.capture.captureBasis),
          sourceTemplatePointer: point.capture.sourceTemplatePointer || point.sourceTemplatePointer || null,
          ruleCompliance: {
            status:
              ruleComplianceStatus === 'warning' || ruleComplianceStatus === 'needs_review'
                ? ruleComplianceStatus
                : 'ok',
            reason:
              typeof point.capture.ruleCompliance?.reason === 'string'
                ? point.capture.ruleCompliance.reason
                : null,
            rescopeNeeded: Boolean(point.capture.ruleCompliance?.rescopeNeeded),
          },
          updatedAt: typeof point.capture.updatedAt === 'string' ? point.capture.updatedAt : nowIso(),
        },
      };
    });

    if (isHiddenGrantPrepStageKey(stageState.stageKey)) {
      stageState.enabled = false;
      stageState.pickable = false;
      stageState.selectionSource = null;
      stageState.selectionLevel = 'excluded';
      stageState.status = 'disabled';
    } else {
      recomputeStageState(stageState);
    }
  });

  mergeLegacyStageCapturesIntoCanonical(nextStates, stageMapping);

  return nextStates;
}

export function applyGrantPrepPointRolesFromMapping(
  stageStates: GrantPrepStageStates,
  stageMapping: GrantPrepStageMapping
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates || {}));

  Object.values(nextStates).forEach((stageState) => {
    const mappedPoints = new Map(
      (stageMapping[stageState.stageKey]?.discussionPoints || []).map((point) => [point.key, point])
    );

    stageState.points = (stageState.points || []).map((point) => {
      const mappedPoint = mappedPoints.get(point.key);
      const conversationRole = mappedPoint
        ? normalizeGrantPrepPointConversationRole(
            mappedPoint.conversationRole,
            mappedPoint.priority === 'P3'
              ? 'ai_draftable'
              : mappedPoint.sourceTemplatePointer
                ? 'can_infer_and_confirm'
                : 'user_required'
          )
        : inferPointConversationRole(point);

      return {
        ...point,
        conversationRole,
      };
    });

    recomputeStageState(stageState);
  });

  return nextStates;
}

export function buildGrantPrepSessionContext(input: {
  mode: GrantPrepMode;
  engagementMode: GrantPrepSessionContext['engagementMode'];
  stageMapping: GrantPrepStageMapping;
  stageStates: GrantPrepStageStates;
  stageSelectionVersion?: GrantPrepSessionContext['stageSelectionVersion'];
  autoEnabledStageKeys?: GrantPrepStageKey[];
  manualEnabledStageKeys?: GrantPrepStageKey[];
  manualDisabledStageKeys?: GrantPrepStageKey[];
  selectedThrustAreaRuleKeys?: string[];
  warning?: string | null;
}): GrantPrepSessionContext {
  const enabledStageKeys = sortGrantPrepStageKeys(
    Object.values(input.stageStates)
      .filter((stage) => stage.enabled)
      .map((stage) => stage.stageKey)
  );
  const disabledStageKeys = sortGrantPrepStageKeys(
    Object.values(input.stageStates)
      .filter((stage) => !stage.enabled)
      .map((stage) => stage.stageKey)
  );
  const activeStageKey = getFirstEnabledPickableStageKey(input.stageStates) || 'ideation';

  return {
    mode: input.mode,
    engagementMode: input.engagementMode,
    stageSelectionVersion: input.stageSelectionVersion || 'v1',
    activeStageKey,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    autoEnabledStageKeys: sortGrantPrepStageKeys((input.autoEnabledStageKeys || []).map(getCanonicalGrantPrepStageKey)),
    manualEnabledStageKeys: sortGrantPrepStageKeys((input.manualEnabledStageKeys || []).map(getCanonicalGrantPrepStageKey)),
    manualDisabledStageKeys: sortGrantPrepStageKeys((input.manualDisabledStageKeys || []).map(getCanonicalGrantPrepStageKey)),
    enabledStageKeys,
    disabledStageKeys,
    stageMapping: input.stageMapping,
    stageStates: input.stageStates,
    globalKeywords: collectGlobalKeywords(input.stageStates),
    warning: input.warning || null,
  };
}

export function getNextPickableStageKey(
  stageStates: GrantPrepStageStates,
  currentStageKey: GrantPrepStageKey
): GrantPrepStageKey {
  return getNextEnabledPickableStageKey(stageStates, currentStageKey) || currentStageKey;
}

export function markStageNeedsReview(
  stageStates: GrantPrepStageStates,
  stageKey: GrantPrepStageKey,
  message: string
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const stageState = nextStates[stageKey];
  stageState.status = 'needs_review';
  stageState.steeringEvents.push(buildSteeringEvent(message, 'gentle_redirect', null));
  stageState.memory = markGrantPrepStageMemoryStale(stageState.memory, message);
  return nextStates;
}

function getDependentStageKeys(stageKey: GrantPrepStageKey) {
  const dependents = new Set<GrantPrepStageKey>();
  const queue: GrantPrepStageKey[] = [stageKey];

  while (queue.length > 0) {
    const current = queue.shift() as GrantPrepStageKey;
    for (const stage of GRANT_PREP_STAGE_LIBRARY) {
      if (stage.dependencies.includes(current) && !dependents.has(stage.key)) {
        dependents.add(stage.key);
        queue.push(stage.key);
      }
    }
  }

  dependents.delete(stageKey);
  return Array.from(dependents);
}

export function stageHasCapturedContent(stageState: GrantPrepStageStates[GrantPrepStageKey]) {
  return stageState.points.some(pointHasCapturedContent);
}

export function hasStageContentChanged(
  previousStage: GrantPrepStageStates[GrantPrepStageKey],
  nextStage: GrantPrepStageStates[GrantPrepStageKey]
) {
  return JSON.stringify(previousStage.points) !== JSON.stringify(nextStage.points);
}

export function propagateDependentNeedsReview(
  stageStates: GrantPrepStageStates,
  changedStageKey: GrantPrepStageKey,
  message?: string
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const dependents = getDependentStageKeys(changedStageKey);
  const reviewMessage = message || 'An upstream stage changed. Review this stage before handoff.';

  for (const dependentKey of dependents) {
    const stageState = nextStates[dependentKey];
    if (!stageState.enabled || !stageState.pickable || !stageHasCapturedContent(stageState)) {
      continue;
    }

    let changed = false;
    stageState.points = stageState.points.map((point) => {
      if (!pointHasCapturedContent(point)) {
        return point;
      }

      if (point.status === 'covered') {
        changed = true;
        return {
          ...point,
          status: 'needs_review',
        };
      }

      return point;
    });

    if (changed || stageState.status !== 'needs_review') {
      stageState.steeringEvents.push(buildSteeringEvent(reviewMessage, 'gentle_redirect', null));
    }

    recomputeStageState(stageState);
    stageState.memory = markGrantPrepStageMemoryStale(stageState.memory, reviewMessage);
    if (stageState.status !== 'disabled' && stageState.status === 'completed') {
      stageState.status = 'needs_review';
    }
  }

  return nextStates;
}
