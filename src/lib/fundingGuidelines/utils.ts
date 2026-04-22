import { guidelinePackSchema } from './schemas';
import type {
  FundingGuidelineBlockKey,
  FundingGuidelineRuleImportance,
  FundingGuidelineRuleItem,
  FundingGuidelineSourceAnchor,
  FundingGuidelineSummary,
  GuidelinePackDocument,
} from './types';
import { FUNDING_GUIDELINE_BLOCK_KEYS } from './types';
import type {
  GrantDraftingSubmissionMode,
  GrantEnforcementLevel,
  GrantRuleClass,
} from '@/types/grant'

const HARD_RULE_PATTERN = /\b(must|shall|required|mandatory|cannot|may not|do not|should not|at least|at most|within|before submission|not exceed|deadline|max(?:imum)?|minimum)\b/i
const SUBMISSION_RULE_PATTERN = /\b(portal|upload|attachment|annexure|signature|submit|submission|deadline|certificate|proof|letter of intent|loi|application form|enclosure|appendix)\b/i
const FORMAT_RULE_PATTERN = /\b(word|character|page|font|spacing|format|length|template|section heading|margin|appendix)\b/i
const BUDGET_RULE_PATTERN = /\b(budget|cost|co-?fund|overhead|salary|equipment|travel|matching|contribution|amount|cap)\b/i
const DURATION_RULE_PATTERN = /\b(duration|timeline|month|months|year|years|schedule|milestone)\b/i

const SECTION_APPLIES_TO_HINTS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'summary', pattern: /\b(summary|abstract|overview|synopsis|executive)\b/i },
  { key: 'problem_need', pattern: /\b(problem|need|gap|burden|challenge|urgency|rationale|baseline)\b/i },
  { key: 'objectives', pattern: /\b(objective|goal|aim|target)\b/i },
  { key: 'methodology', pattern: /\b(method|methodology|approach|technical|implementation|protocol|validation plan|data collection)\b/i },
  { key: 'workplan', pattern: /\b(work ?plan|timeline|milestone|deliverable|phase|schedule|task|work package)\b/i },
  { key: 'innovation', pattern: /\b(innovation|novel|novelty|differentiation|unique|advance)\b/i },
  { key: 'evaluation', pattern: /\b(evaluation|metric|indicator|monitor|assessment|validation)\b/i },
  { key: 'impact_outcomes', pattern: /\b(outcome|impact|benefit|result|adoption|beneficiar)\b/i },
  { key: 'alignment', pattern: /\b(priority|priorities|alignment|mission|theme|thrust|fit|relevance)\b/i },
  { key: 'sustainability', pattern: /\b(sustainab|scale|continuity|replication|institutionalization|commercialization)\b/i },
  { key: 'risk', pattern: /\b(risk|ethic|mitigation|contingency|safeguard|compliance)\b/i },
]

const DRAFTING_STAGE_HINTS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'problem_definition', pattern: /\b(problem|need|gap|challenge|burden|urgency)\b/i },
  { key: 'root_cause', pattern: /\b(root cause|driver|underlying|constraint|systemic)\b/i },
  { key: 'beneficiaries', pattern: /\b(beneficiar|target group|user|community|population|institution)\b/i },
  { key: 'fit_and_scope', pattern: /\b(scope|eligib|fit|relevance|realistic|feasible|right-sized)\b/i },
  { key: 'thrust_alignment', pattern: /\b(priority|theme|thrust|alignment|mission)\b/i },
  { key: 'methodology', pattern: /\b(method|approach|technical|implementation|data|protocol)\b/i },
  { key: 'workplan', pattern: /\b(work ?plan|timeline|phase|milestone|deliverable|schedule)\b/i },
  { key: 'team_and_partnerships', pattern: /\b(team|partner|consortium|collaborat|expertise|capacity)\b/i },
  { key: 'innovation', pattern: /\b(innovation|novel|differentiation|unique|advance)\b/i },
  { key: 'evaluation', pattern: /\b(evaluation|metric|indicator|monitor|assessment|validation)\b/i },
  { key: 'outcomes', pattern: /\b(outcome|impact|result|benefit|adoption)\b/i },
  { key: 'risk_and_ethics', pattern: /\b(risk|ethic|mitigation|contingency|safeguard)\b/i },
  { key: 'budget_strategy', pattern: /\b(budget|cost|finance|co-?fund|overhead|salary|equipment|travel|amount)\b/i },
  { key: 'sustainability_and_scale', pattern: /\b(sustainab|scale|continuity|replication|institutionalization)\b/i },
  { key: 'final_pitch', pattern: /\b(summary|pitch|overview|value proposition|why now)\b/i },
]

function normalizeStringArray(value: unknown, limit = 12): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of source) {
    const normalized = String(item || '').trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= limit) break;
  }
  return next;
}

function normalizeRuleClass(value: unknown): GrantRuleClass | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'priority'
    || normalized === 'must_address'
    || normalized === 'avoid'
    || normalized === 'evaluation'
    || normalized === 'budget'
    || normalized === 'duration'
    || normalized === 'format'
    || normalized === 'submission'
    || normalized === 'deliverable'
    || normalized === 'reviewer_signal'
    || normalized === 'template_guidance'
    || normalized === 'template_required_fact'
    || normalized === 'template_forbidden_move'
    || normalized === 'prep_evidence'
    || normalized === 'other'
    ? normalized as GrantRuleClass
    : null
}

function normalizeEnforcementLevel(value: unknown): GrantEnforcementLevel | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'hard' || normalized === 'soft' || normalized === 'info'
    ? normalized as GrantEnforcementLevel
    : null
}

function normalizeDraftingSubmissionMode(value: unknown): GrantDraftingSubmissionMode | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'drafting' || normalized === 'submission' || normalized === 'both'
    ? normalized as GrantDraftingSubmissionMode
    : null
}

function inferRuleClass(block: FundingGuidelineBlockKey, text: string): GrantRuleClass {
  if (SUBMISSION_RULE_PATTERN.test(text) || block === 'submissionRules') return 'submission'
  if (FORMAT_RULE_PATTERN.test(text) || block === 'formatRules') return 'format'
  if (BUDGET_RULE_PATTERN.test(text) || block === 'budgetRules') return 'budget'
  if (DURATION_RULE_PATTERN.test(text) || block === 'durationRules') return 'duration'

  switch (block) {
    case 'priorities':
      return 'priority'
    case 'mustAddress':
      return 'must_address'
    case 'avoid':
      return 'avoid'
    case 'evaluationCriteria':
      return 'evaluation'
    case 'deliverableRules':
      return 'deliverable'
    case 'reviewerSignals':
      return 'reviewer_signal'
    default:
      return 'other'
  }
}

function inferDraftingVsSubmission(
  block: FundingGuidelineBlockKey,
  text: string
): GrantDraftingSubmissionMode {
  if (block === 'submissionRules' || SUBMISSION_RULE_PATTERN.test(text)) return 'submission'
  if (block === 'budgetRules' || block === 'durationRules' || block === 'formatRules') return 'both'
  return 'drafting'
}

function inferEnforcementLevel(
  block: FundingGuidelineBlockKey,
  text: string,
  importance: FundingGuidelineRuleImportance
): GrantEnforcementLevel {
  if (block === 'submissionRules') return 'hard'
  if (block === 'budgetRules' || block === 'durationRules' || block === 'formatRules') return 'hard'
  if (HARD_RULE_PATTERN.test(text) && importance !== 'low') return 'hard'
  if (block === 'reviewerSignals' || block === 'priorities') return 'soft'
  if (importance === 'low') return 'info'
  return 'soft'
}

function inferAppliesTo(block: FundingGuidelineBlockKey, text: string): string[] {
  const inferred = SECTION_APPLIES_TO_HINTS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.key)

  if (inferred.length > 0) return normalizeStringArray(inferred)

  if (block === 'budgetRules' || block === 'deliverableRules' || block === 'durationRules') {
    return ['workplan']
  }
  if (block === 'submissionRules' || block === 'formatRules') {
    return ['all']
  }
  return ['all']
}

function inferDraftingStages(block: FundingGuidelineBlockKey, text: string): string[] {
  const inferred = DRAFTING_STAGE_HINTS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.key)

  if (inferred.length > 0) return normalizeStringArray(inferred)

  if (block === 'budgetRules') return ['budget_strategy']
  if (block === 'durationRules' || block === 'deliverableRules') return ['workplan']
  if (block === 'evaluationCriteria') return ['evaluation']
  if (block === 'priorities' || block === 'reviewerSignals') return ['thrust_alignment']
  return []
}

function inferDetectorHints(block: FundingGuidelineBlockKey, text: string): string[] {
  const hints: string[] = []
  if (FORMAT_RULE_PATTERN.test(text) || block === 'formatRules') {
    hints.push('word_limit', 'character_limit', 'format_rule')
  }
  if (BUDGET_RULE_PATTERN.test(text) || block === 'budgetRules') {
    hints.push('budget_limit')
  }
  if (DURATION_RULE_PATTERN.test(text) || block === 'durationRules') {
    hints.push('duration_limit')
  }
  if (SUBMISSION_RULE_PATTERN.test(text) || block === 'submissionRules') {
    hints.push('submission_checklist')
  }
  if (/\b(priority|theme|thrust|alignment)\b/i.test(text)) {
    hints.push('priority_alignment')
  }
  if (/\b(deliverable|milestone|timeline|phase)\b/i.test(text)) {
    hints.push('deliverable_presence')
  }
  if (/\b(metric|indicator|measure|evaluation|validation)\b/i.test(text)) {
    hints.push('evaluation_metric')
  }
  return normalizeStringArray(hints)
}

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

function normalizeRule(item: any, block: FundingGuidelineBlockKey): FundingGuidelineRuleItem {
  const text = String(item.text || '').trim()
  const importance = item.importance || 'medium'
  return {
    key: String(item.key || '').trim(),
    text,
    importance,
    ruleClass: normalizeRuleClass(item.ruleClass) || inferRuleClass(block, text),
    enforcementLevel:
      normalizeEnforcementLevel(item.enforcementLevel)
      || inferEnforcementLevel(block, text, importance),
    appliesTo: normalizeStringArray(item.appliesTo, 8).length > 0
      ? normalizeStringArray(item.appliesTo, 8)
      : inferAppliesTo(block, text),
    draftingStage: normalizeStringArray(item.draftingStage, 8).length > 0
      ? normalizeStringArray(item.draftingStage, 8)
      : inferDraftingStages(block, text),
    draftingVsSubmission:
      normalizeDraftingSubmissionMode(item.draftingVsSubmission)
      || inferDraftingVsSubmission(block, text),
    detectorHints: normalizeStringArray(item.detectorHints, 8).length > 0
      ? normalizeStringArray(item.detectorHints, 8)
      : inferDetectorHints(block, text),
    sourceBlock: block,
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
    next[block] = parsed[block].map((item: any) => normalizeRule(item, block));
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
