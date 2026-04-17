import type {
  CaptureBasis,
  GrantPrepMarkerPayload,
  GrantPrepResponseEnvelope,
  GrantPrepSuggestedAnswer,
  SteeringLevel,
} from './types';

const MARKER_OPEN = '<grant_prep_marker>';
const MARKER_CLOSE = '</grant_prep_marker>';
const CAPTURE_BASIS_VALUES = new Set<CaptureBasis>([
  'from_pitch',
  'inferred_from_call',
  'generic_placeholder',
  'user_confirmed',
]);
const STEERING_LEVEL_VALUES = new Set<SteeringLevel>([
  'hard_block',
  'gentle_redirect',
  'awareness_nudge',
]);
const QUALITY_ASSESSMENT_VALUES = new Set<NonNullable<GrantPrepMarkerPayload['qualityAssessment']>>([
  'strong',
  'adequate',
  'weak',
]);

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return asTrimmedString(value) ?? undefined;
}

function asStringArray(value: unknown, limit = 8): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return source
    .map((item) => asTrimmedString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  const single = asObject(value);
  return single ? [single] : [];
}

function sanitizeCaptureBasis(value: unknown): CaptureBasis[] | undefined {
  const normalized = asStringArray(value, 4).filter((item): item is CaptureBasis => CAPTURE_BASIS_VALUES.has(item as CaptureBasis));
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeSuggestedAnswer(value: unknown, index: number): GrantPrepSuggestedAnswer | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return null;
    }

    return {
      label: String.fromCharCode(65 + index),
      text,
      rationale: null,
    };
  }

  const answer = asObject(value);
  if (!answer) {
    return null;
  }

  const text = asTrimmedString(answer.text);
  if (!text) {
    return null;
  }

  return {
    label: asTrimmedString(answer.label) || String.fromCharCode(65 + index),
    text,
    rationale: asOptionalString(answer.rationale) ?? null,
  };
}

function sanitizeMarkerPayload(value: unknown): GrantPrepMarkerPayload | null {
  const parsed = asObject(value);
  if (!parsed) {
    return null;
  }

  const version = asTrimmedString(parsed.version);
  const stageKey = asTrimmedString(parsed.stageKey);
  if (version !== 'brainstorm_marker_v1' || !stageKey) {
    return null;
  }

  type MarkerPoint = NonNullable<GrantPrepMarkerPayload['pointsCovered']>[number];
  type SteeringEvent = NonNullable<GrantPrepMarkerPayload['steeringEvents']>[number];

  const pointsCovered = asObjectArray(parsed.pointsCovered)
    .map((point): MarkerPoint | null => {
      const pointKey = asTrimmedString(point.pointKey);
      if (!pointKey) {
        return null;
      }

      const ruleCompliance = asObject(point.ruleCompliance);
      const status = asTrimmedString(ruleCompliance?.status);
      const normalizedStatus =
        status === 'ok' || status === 'warning' || status === 'needs_review'
          ? status
          : undefined;

      return {
        pointKey,
        keywords: asStringArray(point.keywords, 12),
        thrustLinkage: asStringArray(point.thrustLinkage, 6),
        captureBasis: sanitizeCaptureBasis(point.captureBasis),
        ruleCompliance:
          normalizedStatus || ruleCompliance?.reason !== undefined || ruleCompliance?.rescopeNeeded !== undefined
            ? {
                ...(normalizedStatus ? { status: normalizedStatus } : {}),
                ...(asOptionalString(ruleCompliance?.reason) !== undefined
                  ? { reason: asOptionalString(ruleCompliance?.reason) ?? null }
                  : {}),
                ...(typeof ruleCompliance?.rescopeNeeded === 'boolean'
                  ? { rescopeNeeded: ruleCompliance.rescopeNeeded }
                  : {}),
              }
            : undefined,
      };
    })
    .filter((point): point is MarkerPoint => Boolean(point));

  const suggestedFollowUps = asStringArray(parsed.suggestedFollowUps, 3);
  const suggestedAnswers = (Array.isArray(parsed.suggestedAnswers) ? parsed.suggestedAnswers : [parsed.suggestedAnswers])
    .map((answer, index) => sanitizeSuggestedAnswer(answer, index))
    .filter((answer): answer is GrantPrepSuggestedAnswer => Boolean(answer))
    .slice(0, 3);
  const steeringEvents = asObjectArray(parsed.steeringEvents)
    .map((event): SteeringEvent | null => {
      const level = asTrimmedString(event.level);
      const message = asTrimmedString(event.message);
      if (!level || !message || !STEERING_LEVEL_VALUES.has(level as SteeringLevel)) {
        return null;
      }

      return {
        level: level as SteeringLevel,
        message,
        pointKey: asOptionalString(event.pointKey) ?? null,
      };
    })
    .filter((event): event is SteeringEvent => Boolean(event));
  const qualityAssessment = asTrimmedString(parsed.qualityAssessment);
  const readinessDelta =
    typeof parsed.readinessDelta === 'number' && Number.isFinite(parsed.readinessDelta)
      ? parsed.readinessDelta
      : undefined;

  return {
    version: 'brainstorm_marker_v1',
    stageKey: stageKey as GrantPrepMarkerPayload['stageKey'],
    ...(readinessDelta !== undefined ? { readinessDelta } : {}),
    pointsCovered,
    currentPoint: asOptionalString(parsed.currentPoint) ?? null,
    suggestedFollowUps: suggestedFollowUps.length > 0 ? suggestedFollowUps : null,
    suggestedAnswers: suggestedAnswers.length > 0 ? suggestedAnswers : null,
    qualityAssessment:
      qualityAssessment && QUALITY_ASSESSMENT_VALUES.has(qualityAssessment as NonNullable<GrantPrepMarkerPayload['qualityAssessment']>)
        ? (qualityAssessment as NonNullable<GrantPrepMarkerPayload['qualityAssessment']>)
        : null,
    steeringEvents,
    compactUserFacingSummary: asOptionalString(parsed.compactUserFacingSummary) ?? null,
  };
}

function extractMarkerBlock(raw: string) {
  const start = raw.lastIndexOf(MARKER_OPEN);
  const end = raw.lastIndexOf(MARKER_CLOSE);

  if (start === -1 || end === -1 || end <= start) {
    return {
      assistantMessage: raw.trim(),
      markerText: null,
    };
  }

  return {
    assistantMessage: raw.slice(0, start).trim(),
    markerText: raw.slice(start + MARKER_OPEN.length, end).trim(),
  };
}

function safeParseMarker(markerText: string): GrantPrepMarkerPayload | null {
  try {
    return sanitizeMarkerPayload(JSON.parse(markerText));
  } catch {
    return null;
  }
}

export function getMarkerTags() {
  return { open: MARKER_OPEN, close: MARKER_CLOSE };
}

export function sanitizeGrantPrepMarkerPayload(value: unknown) {
  return sanitizeMarkerPayload(value);
}

export function parseGrantPrepResponse(raw: string): GrantPrepResponseEnvelope {
  const { assistantMessage, markerText } = extractMarkerBlock(raw);

  if (!markerText) {
    return {
      assistantMessage,
      markerStatus: 'invalid',
      marker: null,
      warning: 'The assistant response did not include a commit marker. The reply is shown, but no stage state was updated.',
    };
  }

  const marker = safeParseMarker(markerText);
  if (!marker) {
    return {
      assistantMessage,
      markerStatus: 'invalid',
      marker: null,
      warning: 'The assistant response marker could not be parsed. The reply is shown, but no stage state was updated.',
    };
  }

  return {
    assistantMessage,
    markerStatus: 'valid',
    marker,
    warning: null,
  };
}

export async function tryRepairGrantPrepResponse(
  raw: string,
  repairFn: (prompt: string) => Promise<string>,
  options?: {
    stageKey?: string;
    userMessage?: string;
    allowedPointKeys?: string[];
  }
): Promise<GrantPrepResponseEnvelope> {
  const firstPass = parseGrantPrepResponse(raw);
  if (firstPass.markerStatus !== 'invalid') {
    return firstPass;
  }

  const prompt = [
    'Repair or reconstruct the Grant Prep marker for the assistant turn below.',
    'If the marker is missing, infer a conservative marker from the assistant prose and latest user message.',
    'Use the provided stage key exactly.',
    `Use only these allowed point keys: ${(options?.allowedPointKeys || []).join(', ') || 'none'}`,
    'Do not invent detailed facts that are not supported by the prose or user message.',
    'If a point cannot be safely inferred, leave pointsCovered empty.',
    'Return the original assistant prose unchanged, followed by a valid marker only.',
    `Use the exact wrapper tags ${MARKER_OPEN} and ${MARKER_CLOSE}.`,
    'Marker version must be brainstorm_marker_v1.',
    `Stage key: ${options?.stageKey || 'unknown'}`,
    `Latest user message: ${options?.userMessage || 'not provided'}`,
    'Do not add any extra explanation.',
    '',
    raw,
  ].join('\n');

  const repairedRaw = await repairFn(prompt);
  const repaired = parseGrantPrepResponse(repairedRaw);
  if (repaired.marker) {
    return {
      ...repaired,
      markerStatus: 'repaired',
      warning: 'The assistant marker was repaired automatically before committing state.',
    };
  }

  return firstPass;
}
