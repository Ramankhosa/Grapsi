import type { TenantContext } from '../metering';
import { generateGrantPrepText } from './llm';
import type { GrantPrepStageKey, GrantPrepStageState } from './types';
import { recomputeStageState } from './sessionState';

type TidyPassResponse = {
  points: Array<{
    pointKey: string;
    keywords: string[];
  }>;
};

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

function normalizeKeyword(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([:/-])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ');
}

function uniqKeywords(values: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of asStringArray(values)) {
    const normalized = normalizeKeyword(value);
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

function tryParseTidyResponse(raw: string) {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonCandidate = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  try {
    const parsed = JSON.parse(jsonCandidate) as TidyPassResponse;
    return Array.isArray(parsed?.points) ? parsed : null;
  } catch {
    return null;
  }
}

function applyDeterministicCleanup(stageState: GrantPrepStageState) {
  const nextStage = JSON.parse(JSON.stringify(stageState)) as GrantPrepStageState;

  nextStage.points = nextStage.points.map((point) => {
    if (!point.capture) {
      return point;
    }

    return {
      ...point,
      capture: {
        ...point.capture,
        keywords: uniqKeywords(point.capture.keywords || []),
      },
    };
  });

  return recomputeStageState(nextStage);
}

export async function runGrantPrepStageTidyPass(input: {
  stageKey: GrantPrepStageKey;
  stageState: GrantPrepStageState;
  tenantContext: TenantContext | null;
}) {
  const cleanedStage = applyDeterministicCleanup(input.stageState);
  const capturedPoints = cleanedStage.points.filter((point) => asStringArray(point.capture?.keywords).length > 0);

  if (capturedPoints.length === 0) {
    return cleanedStage;
  }

  const prompt = [
    'Return only one JSON object.',
    'You are cleaning grant brainstorming keywords after a stage is completed.',
    'Do not invent new facts, new concepts, or new point keys.',
    'You may only remove duplicates, merge obvious synonyms, and normalize casing/spacing.',
    `Stage key: ${input.stageKey}`,
    'Schema:',
    '{ "points": [{ "pointKey": "...", "keywords": ["..."] }] }',
    'Current captured points:',
    ...capturedPoints.map((point) =>
      `- pointKey=${point.key} | label=${point.label} | keywords=${asStringArray(point.capture?.keywords).join(', ')}`
    ),
  ].join('\n');

  try {
    const raw = await generateGrantPrepText({
      prompt,
      tenantContext: input.tenantContext,
      action: 'tidy_pass',
      parameters: { temperature: 0.1 },
      metadata: { stageKey: input.stageKey },
    });
    const parsed = tryParseTidyResponse(raw);
    if (!parsed) {
      return cleanedStage;
    }

    const nextStage = JSON.parse(JSON.stringify(cleanedStage)) as GrantPrepStageState;
    for (const pointUpdate of parsed.points) {
      const point = nextStage.points.find((item) => item.key === pointUpdate.pointKey);
      if (!point?.capture) {
        continue;
      }

      const nextKeywords = uniqKeywords(pointUpdate.keywords || []);
      if (nextKeywords.length === 0) {
        continue;
      }

      point.capture.keywords = nextKeywords;
    }

    return recomputeStageState(nextStage);
  } catch {
    return cleanedStage;
  }
}
