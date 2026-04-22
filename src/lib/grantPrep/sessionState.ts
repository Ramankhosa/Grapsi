import crypto from 'crypto';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY, getDefaultEnabledStageKeys } from './stageLibrary';
import type {
  GrantPrepMarkerPayload,
  GrantPrepMode,
  GrantPrepPointCapture,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageMapping,
  GrantPrepStageSelectionSource,
  GrantPrepStageStates,
  GrantPrepSteeringEvent,
} from './types';

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
  selectionSources?: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>>
): GrantPrepStageStates {
  const enabled = enabledStageKeys && enabledStageKeys.length > 0
    ? new Set(enabledStageKeys)
    : new Set(getDefaultEnabledStageKeys());

  return GRANT_PREP_STAGE_LIBRARY.reduce((acc, stage) => {
    const isEnabled = enabled.has(stage.key);
    acc[stage.key] = {
      stageKey: stage.key,
      title: stage.title,
      enabled: isEnabled,
      pickable: stage.pickable,
      selectionSource: isEnabled ? selectionSources?.[stage.key] || null : null,
      readiness: 0,
      status: isEnabled ? 'not_started' : 'disabled',
      steeringEvents: [],
      points: stageMapping[stage.key].discussionPoints.map((point) => ({
        key: point.key,
        label: point.label,
        priority: point.priority,
        status: 'pending',
        sourceTemplatePointer: point.sourceTemplatePointer,
        capture: null,
      })),
      lastUpdatedAt: null,
    };
    return acc;
  }, {} as GrantPrepStageStates);
}

export function computeStageReadiness(stageState: GrantPrepStageStates[GrantPrepStageKey]) {
  const relevantPoints = stageState.points.filter((point) => point.priority !== 'P3');
  const denominator = relevantPoints.length > 0 ? relevantPoints.length : stageState.points.length;
  if (denominator === 0) {
    return 1;
  }

  const score = stageState.points.reduce((total, point) => {
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

export function getGrantPrepPointStatus(input: {
  stageKey: GrantPrepStageKey;
  capture: GrantPrepPointCapture;
  requiresThrustLinkage: boolean;
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

  if (input.requiresThrustLinkage && input.stageKey === 'thrust_alignment' && input.capture.thrustLinkage.length === 0) {
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
    input.stageKey === 'workplan'
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

  if (stageState.points.some((point) => point.status === 'needs_review')) {
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

export function applyMarkerToStageStates(
  stageStates: GrantPrepStageStates,
  stageKey: GrantPrepStageKey,
  marker: GrantPrepMarkerPayload,
  options: {
    selectedThrustAreaRuleKeys: string[];
    availableFocusAreas: string[];
    budgetLimits?: string | null;
    projectDuration?: string | null;
  }
) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates));
  const stageState = nextStates[stageKey];
  const requiresThrustLinkage = requiresGrantPrepThrustLinkage(options);

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
        capture,
        requiresThrustLinkage,
        budgetLimits: options.budgetLimits,
        projectDuration: options.projectDuration,
      });
      point.status = statusResult.status;
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

  recomputeStageState(stageState);

  return nextStates;
}

export function normalizeGrantPrepStageStates(stageStates: GrantPrepStageStates) {
  const nextStates: GrantPrepStageStates = JSON.parse(JSON.stringify(stageStates || {}));

  Object.values(nextStates).forEach((stageState) => {
    if (!Array.isArray(stageState?.points)) {
      stageState.points = [];
      return;
    }

    stageState.points = stageState.points.map((point) => {
      if (!point.capture) {
        return point;
      }

      const ruleComplianceStatus = point.capture.ruleCompliance?.status;
      return {
        ...point,
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
  const enabledStageKeys = Object.values(input.stageStates)
    .filter((stage) => stage.enabled)
    .map((stage) => stage.stageKey);
  const disabledStageKeys = Object.values(input.stageStates)
    .filter((stage) => !stage.enabled)
    .map((stage) => stage.stageKey);
  const activeStageKey = (enabledStageKeys.find((stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey].pickable) ||
    'problem_definition') as GrantPrepStageKey;

  return {
    mode: input.mode,
    engagementMode: input.engagementMode,
    stageSelectionVersion: input.stageSelectionVersion || 'v1',
    activeStageKey,
    selectedThrustAreaRuleKeys: input.selectedThrustAreaRuleKeys || [],
    autoEnabledStageKeys: input.autoEnabledStageKeys || [],
    manualEnabledStageKeys: input.manualEnabledStageKeys || [],
    manualDisabledStageKeys: input.manualDisabledStageKeys || [],
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
  const currentIndex = GRANT_PREP_STAGE_LIBRARY.findIndex((stage) => stage.key === currentStageKey);
  for (let index = currentIndex + 1; index < GRANT_PREP_STAGE_LIBRARY.length; index += 1) {
    const stage = GRANT_PREP_STAGE_LIBRARY[index];
    if (stage.pickable && stageStates[stage.key].enabled) {
      return stage.key;
    }
  }
  return currentStageKey;
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
  return stageState.points.some((point) => normalizeGrantPrepKeywords(point.capture?.keywords).length > 0);
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
      if (normalizeGrantPrepKeywords(point.capture?.keywords).length === 0) {
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
    if (stageState.status !== 'disabled' && stageState.status === 'completed') {
      stageState.status = 'needs_review';
    }
  }

  return nextStates;
}
