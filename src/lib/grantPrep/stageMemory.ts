import type {
  GrantPrepStageMemory,
  GrantPrepStageState,
} from './types';

const MEMORY_VERSION = 'stage_memory_v1' as const;

function nowIso() {
  return new Date().toISOString();
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

function uniq(values: unknown, limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of asStringArray(values)) {
    const normalized = value.replace(/\s+/g, ' ').trim();
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

function sentence(value: string, maxLength = 240) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const clipped = normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trim()}...`
    : normalized;
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

function sentenceList(values: unknown, limit: number) {
  return uniq(values, limit)
    .map((value) => sentence(value))
    .filter(Boolean);
}

function memoryHasContent(memory: GrantPrepStageMemory) {
  return (
    memory.confirmedFacts.length > 0 ||
    memory.openGaps.length > 0 ||
    memory.reviewerRisks.length > 0 ||
    memory.keywords.length > 0
  );
}

export function normalizeGrantPrepStageMemory(value: unknown): GrantPrepStageMemory | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = (value as { source?: unknown }).source === 'tidy_llm'
    ? 'tidy_llm'
    : 'deterministic';
  const memory: GrantPrepStageMemory = {
    version: MEMORY_VERSION,
    updatedAt: typeof (value as { updatedAt?: unknown }).updatedAt === 'string'
      ? (value as { updatedAt: string }).updatedAt
      : nowIso(),
    confirmedFacts: sentenceList((value as { confirmedFacts?: unknown }).confirmedFacts, 8),
    openGaps: sentenceList((value as { openGaps?: unknown }).openGaps, 6),
    reviewerRisks: sentenceList((value as { reviewerRisks?: unknown }).reviewerRisks, 6),
    keywords: uniq((value as { keywords?: unknown }).keywords, 16),
    source,
    staleReason: typeof (value as { staleReason?: unknown }).staleReason === 'string'
      ? sentence((value as { staleReason: string }).staleReason, 180)
      : null,
  };

  return memoryHasContent(memory) ? memory : null;
}

export function buildDeterministicGrantPrepStageMemory(
  stageState: GrantPrepStageState,
  source: GrantPrepStageMemory['source'] = 'deterministic'
): GrantPrepStageMemory | null {
  const confirmedFacts: string[] = [];
  const openGaps: string[] = [];
  const reviewerRisks: string[] = [];
  const keywords: string[] = [];

  for (const point of stageState.points || []) {
    const capture = point.capture;
    if (capture) {
      keywords.push(...asStringArray(capture.keywords));
      if (point.status === 'covered') {
        const facts = asStringArray(capture.factBullets);
        if (facts.length > 0) {
          confirmedFacts.push(...facts.map((fact) => `${point.label}: ${fact}`));
        } else {
          const pointKeywords = asStringArray(capture.keywords).slice(0, 4);
          if (pointKeywords.length > 0) {
            confirmedFacts.push(`${point.label}: ${pointKeywords.join(', ')}`);
          }
        }
      }

      reviewerRisks.push(...asStringArray(capture.ruleNotes));
      if (capture.ruleCompliance?.status === 'warning' || capture.ruleCompliance?.status === 'needs_review') {
        reviewerRisks.push(capture.ruleCompliance.reason || `${point.label} needs review before handoff`);
      }
    }

    if (point.status === 'pending') {
      openGaps.push(`${point.label} is still missing`);
    } else if (point.status === 'needs_review') {
      openGaps.push(`${point.label} needs review before handoff`);
    }
  }

  for (const event of (stageState.steeringEvents || []).slice(-4)) {
    if (event.level === 'hard_block' || event.level === 'gentle_redirect') {
      reviewerRisks.push(event.message);
    }
  }

  return normalizeGrantPrepStageMemory({
    version: MEMORY_VERSION,
    updatedAt: nowIso(),
    confirmedFacts,
    openGaps,
    reviewerRisks,
    keywords,
    source,
    staleReason: null,
  });
}

export function markGrantPrepStageMemoryStale(
  memory: GrantPrepStageMemory | null | undefined,
  reason: string
): GrantPrepStageMemory | null {
  if (!memory) {
    return null;
  }

  return normalizeGrantPrepStageMemory({
    ...memory,
    updatedAt: nowIso(),
    staleReason: reason,
  });
}

export function stageMemoryIsUsable(
  memory: GrantPrepStageMemory | null | undefined
): memory is GrantPrepStageMemory {
  return Boolean(memory && !memory.staleReason && memoryHasContent(memory));
}
