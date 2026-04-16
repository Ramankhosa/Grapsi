// @ts-nocheck
import { grantTemplateSchema } from './schemas';
import type {
  FundingTemplateCompatibilitySummary,
  FundingTemplateItem,
  FundingTemplateMergeConflict,
  FundingTemplateSourceAnchor,
  FundingTemplateSupportLevel,
  GrantTemplateDocument,
} from './types';

const ARRAY_BLOCKS = ['questions', 'sections', 'attachments', 'evaluationCriteria'] as const;

function clampConfidence(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function dedupeAnchors(anchors: Array<Partial<FundingTemplateSourceAnchor>>): FundingTemplateSourceAnchor[] {
  const seen = new Set<string>();
  const next: FundingTemplateSourceAnchor[] = [];

  for (const anchor of anchors) {
    const normalized: FundingTemplateSourceAnchor = {
      asset_id: String(anchor.asset_id),
      page: anchor.page ?? null,
      section: anchor.section ?? null,
      urlFragment: anchor.urlFragment ?? null,
      quote: anchor.quote ?? null,
      note: anchor.note ?? null,
      confidence: anchor.confidence === undefined || anchor.confidence === null
        ? null
        : clampConfidence(anchor.confidence, 1),
    };

    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(normalized);
  }

  return next;
}

function normalizeItem(item: any): FundingTemplateItem {
  return {
    ...item,
    key: String(item.key || '').trim(),
    label: String(item.label || '').trim(),
    required: Boolean(item.required),
    repeatable: Boolean(item.repeatable),
    visibleWhen: item.visibleWhen || null,
    wordLimit: item.wordLimit ?? null,
    charLimit: item.charLimit ?? null,
    options: Array.isArray(item.options)
      ? item.options.map((option) => String(option).trim()).filter(Boolean)
      : [],
    schema: item.schema ?? null,
    guidance: item.guidance || null,
    supportLevel: item.supportLevel,
    confidence: clampConfidence(item.confidence, 1),
    sourceAnchors: dedupeAnchors(Array.isArray(item.sourceAnchors) ? item.sourceAnchors : []),
  };
}

function normalizeConflict(conflict: any): FundingTemplateMergeConflict {
  return {
    ...conflict,
    key: String(conflict.key || '').trim(),
    runId: conflict.runId || null,
    createdAt: conflict.createdAt || new Date().toISOString(),
    message: String(conflict.message || '').trim() || 'Conflict detected during extraction merge',
  };
}

export function createEmptyGrantTemplate(): GrantTemplateDocument {
  return {
    questions: [],
    sections: [],
    budget: null,
    attachments: [],
    evaluationCriteria: [],
    submissionRules: {
      notes: null,
      items: [],
      sourceAnchors: [],
    },
    sourceAnchors: [],
    mergeConflicts: [],
  };
}

export function normalizeGrantTemplate(input?: unknown): GrantTemplateDocument {
  const parsed = grantTemplateSchema.parse(input || createEmptyGrantTemplate());

  return {
    questions: parsed.questions.map((item: any) => normalizeItem(item)),
    sections: parsed.sections.map((item: any) => normalizeItem(item)),
    budget: parsed.budget
      ? {
          required: Boolean(parsed.budget.required),
          yearWise: Boolean(parsed.budget.yearWise),
          categories: parsed.budget.categories.map((category: any) => ({
            key: String(category.key || '').trim(),
            label: String(category.label || '').trim(),
            cap: category.cap || null,
            notes: category.notes || null,
            sourceAnchors: dedupeAnchors(category.sourceAnchors || []),
          })),
          caps: parsed.budget.caps || null,
          justificationNotes: parsed.budget.justificationNotes || null,
          supportLevel: parsed.budget.supportLevel,
          confidence: clampConfidence(parsed.budget.confidence, 1),
          sourceAnchors: dedupeAnchors(parsed.budget.sourceAnchors || []),
        }
      : null,
    attachments: parsed.attachments.map((item: any) => normalizeItem(item)),
    evaluationCriteria: parsed.evaluationCriteria.map((item: any) => normalizeItem(item)),
    submissionRules: {
      notes: parsed.submissionRules.notes || null,
      items: parsed.submissionRules.items.map((item: any) => normalizeItem(item)),
      sourceAnchors: dedupeAnchors(parsed.submissionRules.sourceAnchors || []),
    },
    sourceAnchors: dedupeAnchors(parsed.sourceAnchors || []),
    mergeConflicts: (parsed.mergeConflicts || []).map((conflict: any) => normalizeConflict(conflict)),
  };
}

function getSupportCounts(): Record<FundingTemplateSupportLevel, number> {
  return {
    full: 0,
    partial: 0,
    manual: 0,
    unsupported: 0,
  };
}

export function buildCompatibilitySummary(
  template: GrantTemplateDocument,
  warnings: string[] = [],
  options?: { lastRunId?: string | null }
): FundingTemplateCompatibilitySummary {
  const supportCounts = getSupportCounts();
  const blockCounts: Record<string, number> = {
    questions: template.questions.length,
    sections: template.sections.length,
    attachments: template.attachments.length,
    evaluationCriteria: template.evaluationCriteria.length,
    submissionRules: template.submissionRules.items.length,
    budget: template.budget ? 1 : 0,
  };

  for (const block of ARRAY_BLOCKS) {
    for (const item of template[block]) {
      supportCounts[item.supportLevel] += 1;
    }
  }

  for (const item of template.submissionRules.items) {
    supportCounts[item.supportLevel] += 1;
  }

  if (template.budget) {
    supportCounts[template.budget.supportLevel] += 1;
  }

  return {
    supportCounts,
    blockCounts,
    conflicts: template.mergeConflicts,
    warnings,
    updatedAt: new Date().toISOString(),
    lastRunId: options?.lastRunId || null,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeIdentityText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildPrimaryIdentity(item: FundingTemplateItem): string {
  return normalizeIdentityText(item.key);
}

function buildFallbackIdentity(item: FundingTemplateItem): string {
  return `${normalizeIdentityText(item.type)}::${normalizeIdentityText(item.label)}`;
}

function getAssetSequence(
  assetId: string,
  assetSequenceById?: Record<string, number>
): number {
  const sequence = assetSequenceById?.[assetId];
  return Number.isFinite(sequence) ? Number(sequence) : Number.MAX_SAFE_INTEGER;
}

function compareAnchors(
  left: FundingTemplateSourceAnchor,
  right: FundingTemplateSourceAnchor,
  assetSequenceById?: Record<string, number>
) {
  const leftSequence = getAssetSequence(left.asset_id, assetSequenceById);
  const rightSequence = getAssetSequence(right.asset_id, assetSequenceById);
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  const leftPage = typeof left.page === 'number' ? left.page : Number.MAX_SAFE_INTEGER;
  const rightPage = typeof right.page === 'number' ? right.page : Number.MAX_SAFE_INTEGER;
  if (leftPage !== rightPage) {
    return leftPage - rightPage;
  }

  return stableStringify(left).localeCompare(stableStringify(right));
}

function sortAnchors(
  anchors: FundingTemplateSourceAnchor[],
  assetSequenceById?: Record<string, number>
) {
  return [...anchors].sort((left, right) => compareAnchors(left, right, assetSequenceById));
}

function getItemSortMeta(
  item: FundingTemplateItem,
  assetSequenceById: Record<string, number> | undefined,
  originalIndex: number
) {
  const anchors = sortAnchors(item.sourceAnchors || [], assetSequenceById);
  const firstAnchor = anchors[0];
  return {
    sequence: firstAnchor ? getAssetSequence(firstAnchor.asset_id, assetSequenceById) : Number.MAX_SAFE_INTEGER,
    page: firstAnchor && typeof firstAnchor.page === 'number' ? firstAnchor.page : Number.MAX_SAFE_INTEGER,
    originalIndex,
  };
}

function compareItemSortMeta(
  left: ReturnType<typeof getItemSortMeta>,
  right: ReturnType<typeof getItemSortMeta>
) {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  if (left.page !== right.page) {
    return left.page - right.page;
  }

  return left.originalIndex - right.originalIndex;
}

function toConflictComparableItem(item: FundingTemplateItem) {
  return {
    label: item.label,
    type: item.type,
    required: item.required,
    repeatable: item.repeatable,
    visibleWhen: item.visibleWhen || null,
    wordLimit: item.wordLimit ?? null,
    charLimit: item.charLimit ?? null,
    options: item.options || [],
    schema: item.schema ?? null,
    guidance: item.guidance || null,
    supportLevel: item.supportLevel,
  };
}

function hasMaterialDifference(left: FundingTemplateItem, right: FundingTemplateItem) {
  return stableStringify(toConflictComparableItem(left)) !== stableStringify(toConflictComparableItem(right));
}

function mergeDuplicateItem(kept: FundingTemplateItem, duplicate: FundingTemplateItem): FundingTemplateItem {
  return {
    ...kept,
    sourceAnchors: dedupeAnchors([...(kept.sourceAnchors || []), ...(duplicate.sourceAnchors || [])]),
    confidence: Math.max(kept.confidence, duplicate.confidence),
  };
}

function collapseOrderedItems(
  items: FundingTemplateItem[],
  block: FundingTemplateMergeConflict['block'],
  options?: { assetSequenceById?: Record<string, number>; runId?: string | null }
): { items: FundingTemplateItem[]; conflicts: FundingTemplateMergeConflict[] } {
  const candidates = items
    .map((item, index) => ({
      item: normalizeItem(item),
      index,
    }))
    .sort((left, right) =>
      compareItemSortMeta(
        getItemSortMeta(left.item, options?.assetSequenceById, left.index),
        getItemSortMeta(right.item, options?.assetSequenceById, right.index)
      )
    );

  const primaryIndex = new Map<string, number>();
  const fallbackIndex = new Map<string, number>();
  const kept: FundingTemplateItem[] = [];
  const conflicts: FundingTemplateMergeConflict[] = [];

  for (const candidate of candidates) {
    const primaryIdentity = buildPrimaryIdentity(candidate.item);
    const fallbackIdentity = buildFallbackIdentity(candidate.item);
    const existingIndex = primaryIndex.get(primaryIdentity) ?? fallbackIndex.get(fallbackIdentity);

    if (existingIndex === undefined) {
      const normalized = {
        ...candidate.item,
        sourceAnchors: sortAnchors(candidate.item.sourceAnchors || [], options?.assetSequenceById),
      };
      kept.push(normalized);
      primaryIndex.set(primaryIdentity, kept.length - 1);
      fallbackIndex.set(fallbackIdentity, kept.length - 1);
      continue;
    }

    const existing = kept[existingIndex];
    kept[existingIndex] = mergeDuplicateItem(existing, candidate.item);

    if (hasMaterialDifference(existing, candidate.item)) {
      conflicts.push({
        block,
        key: existing.key || candidate.item.key || fallbackIdentity,
        existingItem: existing as any,
        incomingItem: candidate.item as any,
        runId: options?.runId || null,
        createdAt: new Date().toISOString(),
        message: `Duplicate ${block} item "${candidate.item.label}" disagrees with the first-seen version and was not repeated.`,
      });
    }
  }

  return {
    items: kept.map((item, index) => ({
      ...item,
      sourceAnchors: sortAnchors(item.sourceAnchors || [], options?.assetSequenceById),
    })).sort((left, right) =>
      compareItemSortMeta(
        getItemSortMeta(left, options?.assetSequenceById, kept.findIndex((item) => item.key === left.key && item.label === left.label)),
        getItemSortMeta(right, options?.assetSequenceById, kept.findIndex((item) => item.key === right.key && item.label === right.label))
      )
    ),
    conflicts,
  };
}

function collapseBudgetCategories(
  categories: Array<{
    key: string;
    label: string;
    cap?: string | null;
    notes?: string | null;
    sourceAnchors: FundingTemplateSourceAnchor[];
  }>,
  options?: { assetSequenceById?: Record<string, number>; runId?: string | null }
) {
  const conflicts: FundingTemplateMergeConflict[] = [];
  const primaryIndex = new Map<string, number>();
  const fallbackIndex = new Map<string, number>();
  const kept: typeof categories = [];

  const candidates = categories
    .map((category, index) => ({
      category: {
        ...category,
        key: String(category.key || '').trim(),
        label: String(category.label || '').trim(),
        cap: category.cap || null,
        notes: category.notes || null,
        sourceAnchors: dedupeAnchors(category.sourceAnchors || []),
      },
      index,
    }))
    .sort((left, right) => {
      const leftAnchor = sortAnchors(left.category.sourceAnchors || [], options?.assetSequenceById)[0];
      const rightAnchor = sortAnchors(right.category.sourceAnchors || [], options?.assetSequenceById)[0];
      const leftSequence = leftAnchor ? getAssetSequence(leftAnchor.asset_id, options?.assetSequenceById) : Number.MAX_SAFE_INTEGER;
      const rightSequence = rightAnchor ? getAssetSequence(rightAnchor.asset_id, options?.assetSequenceById) : Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      const leftPage = leftAnchor && typeof leftAnchor.page === 'number' ? leftAnchor.page : Number.MAX_SAFE_INTEGER;
      const rightPage = rightAnchor && typeof rightAnchor.page === 'number' ? rightAnchor.page : Number.MAX_SAFE_INTEGER;
      if (leftPage !== rightPage) {
        return leftPage - rightPage;
      }
      return left.index - right.index;
    });

  for (const candidate of candidates) {
    const primaryIdentity = normalizeIdentityText(candidate.category.key);
    const fallbackIdentity = `budget::${normalizeIdentityText(candidate.category.label)}`;
    const existingIndex = primaryIndex.get(primaryIdentity) ?? fallbackIndex.get(fallbackIdentity);

    if (existingIndex === undefined) {
      kept.push({
        ...candidate.category,
        sourceAnchors: sortAnchors(candidate.category.sourceAnchors || [], options?.assetSequenceById),
      });
      primaryIndex.set(primaryIdentity, kept.length - 1);
      fallbackIndex.set(fallbackIdentity, kept.length - 1);
      continue;
    }

    const existing = kept[existingIndex];
    kept[existingIndex] = {
      ...existing,
      sourceAnchors: dedupeAnchors([...(existing.sourceAnchors || []), ...(candidate.category.sourceAnchors || [])]),
    };

    if (
      stableStringify({
        label: existing.label,
        cap: existing.cap || null,
        notes: existing.notes || null,
      }) !== stableStringify({
        label: candidate.category.label,
        cap: candidate.category.cap || null,
        notes: candidate.category.notes || null,
      })
    ) {
      conflicts.push({
        block: 'budget',
        key: existing.key || candidate.category.key || fallbackIdentity,
        existingItem: existing as any,
        incomingItem: candidate.category as any,
        runId: options?.runId || null,
        createdAt: new Date().toISOString(),
        message: `Duplicate budget category "${candidate.category.label}" disagrees with the first-seen version and was not repeated.`,
      });
    }
  }

  return { categories: kept, conflicts };
}

function itemsByKey(items: FundingTemplateItem[]): Map<string, FundingTemplateItem> {
  return new Map(items.map((item) => [item.key, item]));
}

function summarizeBlockDiff(
  label: string,
  previousItems: FundingTemplateItem[],
  nextItems: FundingTemplateItem[]
): string | null {
  const previousMap = itemsByKey(previousItems);
  const nextMap = itemsByKey(nextItems);

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const key of Array.from(nextMap.keys())) {
    if (!previousMap.has(key)) {
      added += 1;
      continue;
    }

    if (stableStringify(previousMap.get(key)) !== stableStringify(nextMap.get(key))) {
      changed += 1;
    }
  }

  for (const key of Array.from(previousMap.keys())) {
    if (!nextMap.has(key)) {
      removed += 1;
    }
  }

  if (!added && !removed && !changed) {
    return null;
  }

  return `${label}: +${added} / ~${changed} / -${removed}`;
}

export function generateDiffSummary(previousTemplate: GrantTemplateDocument | null, nextTemplate: GrantTemplateDocument): string {
  if (!previousTemplate) {
    return `Created template with ${nextTemplate.sections.length} sections and ${nextTemplate.questions.length} questions`;
  }

  const segments = [
    summarizeBlockDiff('Questions', previousTemplate.questions, nextTemplate.questions),
    summarizeBlockDiff('Sections', previousTemplate.sections, nextTemplate.sections),
    summarizeBlockDiff('Attachments', previousTemplate.attachments, nextTemplate.attachments),
    summarizeBlockDiff('Evaluation', previousTemplate.evaluationCriteria, nextTemplate.evaluationCriteria),
    summarizeBlockDiff('Submission rules', previousTemplate.submissionRules.items, nextTemplate.submissionRules.items),
  ].filter(Boolean) as string[];

  if (stableStringify(previousTemplate.budget) !== stableStringify(nextTemplate.budget)) {
    segments.push('Budget updated');
  }

  if (stableStringify(previousTemplate.mergeConflicts) !== stableStringify(nextTemplate.mergeConflicts)) {
    segments.push(`Conflicts: ${nextTemplate.mergeConflicts.length}`);
  }

  return segments.length > 0 ? segments.join(' | ') : 'No template content changes';
}

export function buildAssetSequenceMap(
  assets: Array<{ id: string; sequence_no?: number | null }>
): Record<string, number> {
  return assets.reduce<Record<string, number>>((map, asset, index) => {
    map[asset.id] = Number.isFinite(asset.sequence_no) ? Number(asset.sequence_no) : index + 1;
    return map;
  }, {});
}

export function sortAndDeduplicateGrantTemplate(
  input: GrantTemplateDocument,
  options?: { assetSequenceById?: Record<string, number>; runId?: string | null }
): GrantTemplateDocument {
  const template = normalizeGrantTemplate(input);
  const questions = collapseOrderedItems(template.questions, 'questions', options);
  const sections = collapseOrderedItems(template.sections, 'sections', options);
  const attachments = collapseOrderedItems(template.attachments, 'attachments', options);
  const evaluationCriteria = collapseOrderedItems(template.evaluationCriteria, 'evaluationCriteria', options);
  const submissionRules = collapseOrderedItems(template.submissionRules.items, 'submissionRules', options);
  const budgetResult = template.budget
    ? collapseBudgetCategories(template.budget.categories, options)
    : { categories: [], conflicts: [] };

  const budget = template.budget
    ? {
        ...template.budget,
        categories: budgetResult.categories,
        sourceAnchors: sortAnchors(template.budget.sourceAnchors || [], options?.assetSequenceById),
      }
    : null;

  return {
    ...template,
    questions: questions.items,
    sections: sections.items,
    attachments: attachments.items,
    evaluationCriteria: evaluationCriteria.items,
    submissionRules: {
      ...template.submissionRules,
      items: submissionRules.items,
      sourceAnchors: sortAnchors(template.submissionRules.sourceAnchors || [], options?.assetSequenceById),
    },
    budget,
    sourceAnchors: sortAnchors(template.sourceAnchors || [], options?.assetSequenceById),
    mergeConflicts: dedupeConflicts([
      ...template.mergeConflicts,
      ...questions.conflicts,
      ...sections.conflicts,
      ...attachments.conflicts,
      ...evaluationCriteria.conflicts,
      ...submissionRules.conflicts,
      ...budgetResult.conflicts,
    ]),
  };
}

function mergeArrayBlock(
  currentItems: FundingTemplateItem[],
  incomingItems: FundingTemplateItem[],
  block: FundingTemplateMergeConflict['block'],
  runId: string
): { items: FundingTemplateItem[]; conflicts: FundingTemplateMergeConflict[] } {
  const items = currentItems.map((item) => normalizeItem(item));
  const primaryIndex = new Map<string, number>();
  const fallbackIndex = new Map<string, number>();
  const conflicts: FundingTemplateMergeConflict[] = [];

  items.forEach((item, index) => {
    primaryIndex.set(buildPrimaryIdentity(item), index);
    fallbackIndex.set(buildFallbackIdentity(item), index);
  });

  for (const incoming of incomingItems) {
    const normalizedIncoming = normalizeItem(incoming);
    const existingIndex = primaryIndex.get(buildPrimaryIdentity(normalizedIncoming))
      ?? fallbackIndex.get(buildFallbackIdentity(normalizedIncoming));
    const existing = existingIndex === undefined ? null : items[existingIndex];

    if (!existing) {
      items.push(normalizedIncoming);
      primaryIndex.set(buildPrimaryIdentity(normalizedIncoming), items.length - 1);
      fallbackIndex.set(buildFallbackIdentity(normalizedIncoming), items.length - 1);
      continue;
    }

    if (!hasMaterialDifference(existing, normalizedIncoming)) {
      items[existingIndex!] = mergeDuplicateItem(existing, normalizedIncoming);
      continue;
    }

    conflicts.push({
      block,
      key: existing.key || normalizedIncoming.key,
      existingItem: existing as any,
      incomingItem: normalizedIncoming as any,
      runId,
      createdAt: new Date().toISOString(),
      message: `Incoming ${block} item "${normalizedIncoming.label}" conflicts with the existing first-seen version.`,
    });
    items[existingIndex!] = mergeDuplicateItem(existing, normalizedIncoming);
  }

  return { items, conflicts };
}

export function mergeGrantTemplates(
  currentTemplate: GrantTemplateDocument,
  incomingTemplate: GrantTemplateDocument,
  runId: string,
  options?: { assetSequenceById?: Record<string, number> }
): { mergedTemplate: GrantTemplateDocument; conflicts: FundingTemplateMergeConflict[] } {
  const merged = normalizeGrantTemplate(currentTemplate);
  const newConflicts: FundingTemplateMergeConflict[] = [];

  for (const block of ARRAY_BLOCKS) {
    const result = mergeArrayBlock(merged[block], incomingTemplate[block], block, runId);
    merged[block] = result.items as any;
    newConflicts.push(...result.conflicts);
  }

  const submissionResult = mergeArrayBlock(
    merged.submissionRules.items,
    incomingTemplate.submissionRules.items,
    'submissionRules',
    runId
  );
  merged.submissionRules.items = submissionResult.items;
  merged.submissionRules.sourceAnchors = dedupeAnchors([
    ...merged.submissionRules.sourceAnchors,
    ...incomingTemplate.submissionRules.sourceAnchors,
  ]);
  if (!merged.submissionRules.notes && incomingTemplate.submissionRules.notes) {
    merged.submissionRules.notes = incomingTemplate.submissionRules.notes;
  }
  newConflicts.push(...submissionResult.conflicts);

  if (!merged.budget && incomingTemplate.budget) {
    merged.budget = incomingTemplate.budget;
  } else if (merged.budget && incomingTemplate.budget) {
    if (stableStringify(merged.budget) !== stableStringify(incomingTemplate.budget)) {
      newConflicts.push({
        block: 'budget',
        key: 'budget',
        existingItem: merged.budget as any,
        incomingItem: incomingTemplate.budget as any,
        runId,
        createdAt: new Date().toISOString(),
        message: 'Incoming budget block conflicts with the existing budget configuration',
      });
    } else {
      merged.budget = {
        ...merged.budget,
        sourceAnchors: dedupeAnchors([
          ...merged.budget.sourceAnchors,
          ...incomingTemplate.budget.sourceAnchors,
        ]),
        confidence: Math.max(merged.budget.confidence, incomingTemplate.budget.confidence),
      };
    }
  }

  merged.sourceAnchors = dedupeAnchors([
    ...merged.sourceAnchors,
    ...incomingTemplate.sourceAnchors,
  ]);

  merged.mergeConflicts = dedupeConflicts([
    ...merged.mergeConflicts,
    ...newConflicts,
  ]);

  return {
    mergedTemplate: sortAndDeduplicateGrantTemplate(merged, {
      assetSequenceById: options?.assetSequenceById,
      runId,
    }),
    conflicts: newConflicts,
  };
}

export function dedupeConflicts(conflicts: FundingTemplateMergeConflict[]): FundingTemplateMergeConflict[] {
  const seen = new Set<string>();
  const next: FundingTemplateMergeConflict[] = [];

  for (const conflict of conflicts) {
    const normalized = normalizeConflict(conflict);
    const key = stableStringify({
      block: normalized.block,
      key: normalized.key,
      existingItem: normalized.existingItem,
      incomingItem: normalized.incomingItem,
      runId: normalized.runId,
    });

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    next.push(normalized);
  }

  return next;
}

export function parseJsonText<T>(raw: string, fallback: T): T {
  if (!raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
