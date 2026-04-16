import { guidelinePackSchema } from './schemas';
import type {
  FundingGuidelineBlockKey,
  FundingGuidelineRuleItem,
  FundingGuidelineSourceAnchor,
  FundingGuidelineSummary,
  GuidelinePackDocument,
} from './types';
import { FUNDING_GUIDELINE_BLOCK_KEYS } from './types';

function clampConfidence(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function dedupeAnchors(anchors: Array<Partial<FundingGuidelineSourceAnchor>>): FundingGuidelineSourceAnchor[] {
  const seen = new Set<string>();
  const next: FundingGuidelineSourceAnchor[] = [];

  for (const anchor of anchors) {
    const normalized: FundingGuidelineSourceAnchor = {
      sourceType: anchor.sourceType || 'manual',
      fieldKey: anchor.fieldKey ?? null,
      url: anchor.url ?? null,
      quote: anchor.quote ?? null,
      note: anchor.note ?? null,
      confidence:
        anchor.confidence === undefined || anchor.confidence === null
          ? null
          : clampConfidence(anchor.confidence, 1),
    };

    const key = stableStringify(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(normalized);
  }

  return next;
}

function normalizeRule(item: any): FundingGuidelineRuleItem {
  return {
    key: String(item.key || '').trim(),
    text: String(item.text || '').trim(),
    importance: item.importance || 'medium',
    rationale: item.rationale || null,
    confidence: clampConfidence(item.confidence, 1),
    sourceAnchors: dedupeAnchors(Array.isArray(item.sourceAnchors) ? item.sourceAnchors : []),
  };
}

export function createEmptyGuidelinePack(): GuidelinePackDocument {
  return {
    priorities: [],
    mustAddress: [],
    avoid: [],
    evaluationCriteria: [],
    budgetRules: [],
    durationRules: [],
    formatRules: [],
    submissionRules: [],
    deliverableRules: [],
    reviewerSignals: [],
    sourceAnchors: [],
  };
}

export function normalizeGuidelinePack(input?: unknown): GuidelinePackDocument {
  const parsed = guidelinePackSchema.parse(input || createEmptyGuidelinePack());
  const next = createEmptyGuidelinePack();

  for (const block of FUNDING_GUIDELINE_BLOCK_KEYS) {
    next[block] = parsed[block].map((item: any) => normalizeRule(item));
  }

  next.sourceAnchors = dedupeAnchors(parsed.sourceAnchors || []);
  return next;
}

export function buildGuidelineSummary(pack: GuidelinePackDocument): FundingGuidelineSummary {
  const blockCounts = {} as Record<FundingGuidelineBlockKey, number>;
  let totalRules = 0;

  for (const block of FUNDING_GUIDELINE_BLOCK_KEYS) {
    blockCounts[block] = pack[block].length;
    totalRules += pack[block].length;
  }

  return {
    blockCounts,
    totalRules,
    updatedAt: new Date().toISOString(),
  };
}

function blockDiff(previousItems: FundingGuidelineRuleItem[], nextItems: FundingGuidelineRuleItem[]) {
  const previousMap = new Map(previousItems.map((item) => [item.key, item]));
  const nextMap = new Map(nextItems.map((item) => [item.key, item]));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [key, nextItem] of Array.from(nextMap.entries())) {
    const previousItem = previousMap.get(key);
    if (!previousItem) {
      added += 1;
      continue;
    }

    if (stableStringify(previousItem) !== stableStringify(nextItem)) {
      changed += 1;
    }
  }

  for (const key of Array.from(previousMap.keys())) {
    if (!nextMap.has(key)) {
      removed += 1;
    }
  }

  return { added, removed, changed };
}

export function generateGuidelineDiffSummary(previousPack: GuidelinePackDocument | null, nextPack: GuidelinePackDocument) {
  if (!previousPack) {
    const summary = buildGuidelineSummary(nextPack);
    return `Created guideline pack with ${summary.totalRules} rules`;
  }

  const segments: string[] = [];

  for (const block of FUNDING_GUIDELINE_BLOCK_KEYS) {
    const diff = blockDiff(previousPack[block], nextPack[block]);
    if (diff.added || diff.changed || diff.removed) {
      segments.push(`${block}: +${diff.added} / ~${diff.changed} / -${diff.removed}`);
    }
  }

  return segments.length > 0 ? segments.join(' | ') : 'No guideline content changes';
}

export function formatGuidelineRulesForPrompt(rules: FundingGuidelineRuleItem[]) {
  return rules.map((rule) => `- ${rule.text}`).join('\n');
}
