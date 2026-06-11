import type { TenantContext } from '../metering';
import { generateGrantPrepText } from './llm';
import type { GrantPrepStageKey, GrantPrepStageMemory, GrantPrepStageState } from './types';
import { recomputeStageState } from './sessionState';
import {
  buildDeterministicGrantPrepStageMemory,
  normalizeGrantPrepStageMemory,
} from './stageMemory';

type TidyPassResponse = {
  points: Array<{
    pointKey: string;
    keywords?: string[];
    factBullets?: string[];
  }>;
  memory?: Partial<GrantPrepStageMemory>;
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

function normalizeFactBullet(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1');

  if (!normalized) {
    return '';
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function uniqFactBullets(values: unknown, limit = 3) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of asStringArray(values)) {
    const normalized = normalizeFactBullet(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function buildKeywordBackfillSentence(point: GrantPrepStageState['points'][number], keywords: string[]) {
  if (keywords.length === 0) {
    return '';
  }

  return `${point.label} includes ${keywords.slice(0, 5).join(', ')}.`;
}

function buildDeterministicFactBullets(point: GrantPrepStageState['points'][number], keywords: string[]) {
  const existingFacts = uniqFactBullets(point.capture?.factBullets || []);
  if (existingFacts.length > 0) {
    return existingFacts;
  }

  const keywordSentence = buildKeywordBackfillSentence(point, keywords);
  if (keywordSentence) {
    return uniqFactBullets([keywordSentence]);
  }

  const ruleNotes = uniqFactBullets(point.capture?.ruleNotes || [], 1);
  if (ruleNotes.length > 0) {
    return uniqFactBullets([`${point.label} needs review: ${ruleNotes[0]}`]);
  }

  return [];
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

    const nextKeywords = uniqKeywords(point.capture.keywords || []);

    return {
      ...point,
      capture: {
        ...point.capture,
        keywords: nextKeywords,
        factBullets: buildDeterministicFactBullets(point, nextKeywords),
      },
    };
  });

  const recomputed = recomputeStageState(nextStage);
  recomputed.memory = buildDeterministicGrantPrepStageMemory(recomputed);
  return recomputed;
}

export async function runGrantPrepStageTidyPass(input: {
  stageKey: GrantPrepStageKey;
  stageState: GrantPrepStageState;
  tenantContext: TenantContext | null;
}) {
  const cleanedStage = applyDeterministicCleanup(input.stageState);
  const capturedPoints = cleanedStage.points.filter((point) =>
    asStringArray(point.capture?.keywords).length > 0 ||
    asStringArray(point.capture?.factBullets).length > 0 ||
    asStringArray(point.capture?.ruleNotes).length > 0 ||
    asStringArray(point.capture?.thrustLinkage).length > 0
  );

  if (capturedPoints.length === 0) {
    return cleanedStage;
  }

  const prompt = [
    'Return only one JSON object.',
    'You are cleaning grant brainstorming captures and creating compact stage memory after a grant prep stage changes.',
    'Do not invent new facts, new concepts, or new point keys.',
    'You may only remove duplicates, merge obvious synonyms, normalize casing/spacing, and rewrite existing captured wording into point-specific factual sentences.',
    'For each captured point, return 1-3 short complete factBullets that are atomic, declarative, and specific to that point label.',
    'If several points share the same selected-answer text, split or rewrite it so each point keeps only the clause relevant to its point label.',
    'Do not copy the same multi-topic option blob onto every point.',
    'Keep keywords as compact tags only; they cannot replace factBullets.',
    'Stage memory must use short complete sentences. It must preserve user-confirmed facts and reviewer risks.',
    `Stage key: ${input.stageKey}`,
    'Schema:',
    '{ "points": [{ "pointKey": "...", "keywords": ["tag"], "factBullets": ["short complete point-specific sentence"] }], "memory": { "confirmedFacts": ["short sentence"], "openGaps": ["short sentence"], "reviewerRisks": ["short sentence"], "keywords": ["tag"] } }',
    'Current captured points:',
    ...capturedPoints.map((point) =>
      [
        `- pointKey=${point.key}`,
        `label=${point.label}`,
        `status=${point.status}`,
        `keywords=${asStringArray(point.capture?.keywords).join(', ') || 'none'}`,
        `facts=${asStringArray(point.capture?.factBullets).join(' ; ') || 'none'}`,
        `ruleNotes=${asStringArray(point.capture?.ruleNotes).join(' ; ') || 'none'}`,
      ].join(' | ')
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

      const nextKeywords = uniqKeywords(pointUpdate.keywords || point.capture.keywords || []);
      const nextFactBullets = uniqFactBullets(pointUpdate.factBullets || []);

      if (nextKeywords.length > 0) {
        point.capture.keywords = nextKeywords;
      }

      if (nextFactBullets.length > 0) {
        point.capture.factBullets = nextFactBullets;
      }
    }

    const recomputed = recomputeStageState(nextStage);
    recomputed.memory = normalizeGrantPrepStageMemory({
      ...(parsed.memory || {}),
      updatedAt: new Date().toISOString(),
      source: 'tidy_llm',
      staleReason: null,
    }) || buildDeterministicGrantPrepStageMemory(recomputed);
    return recomputed;
  } catch {
    return cleanedStage;
  }
}
