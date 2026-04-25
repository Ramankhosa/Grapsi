import { normalizeGrantTemplate } from '../fundingTemplates/utils';
import type { FundingTemplateItem, GrantTemplateDocument } from '../fundingTemplates/types';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from './stageLibrary';
import type { GrantPrepStageKey, GrantPrepStageMapping, GrantPrepStageMappingEntry } from './types';
import {
  getPrepStageKeysForTemplateIntent,
  normalizeGrantTemplateIntent,
  normalizeGrantTemplateIntentConfidence,
  normalizeGrantTemplateIntentList,
  shouldTrustTemplateIntent,
} from '@/lib/grants/templateIntent';
import { resolveGrantTemplateSectionType } from '@/lib/grants/templateSectionType';
import type { CompiledGrantTemplateSectionType, GrantTemplateIntent, GrantWorkflowMode } from '@/types/grant';

type TemplateBlock = 'sections' | 'questions' | 'evaluationCriteria' | 'submissionRules' | 'budget';

type TemplateLikeItem = {
  key: string;
  label: string;
  guidance?: string | null;
  block: TemplateBlock;
  workflowMode?: GrantWorkflowMode;
  sectionType?: CompiledGrantTemplateSectionType | null;
  templateIntent?: GrantTemplateIntent | null;
  templateIntentAlternates?: GrantTemplateIntent[];
  templateIntentConfidence?: number | null;
};

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function getTemplateItems(templateInput: unknown): TemplateLikeItem[] {
  const template = normalizeGrantTemplate(templateInput);
  const items: TemplateLikeItem[] = [];

  const pushItems = (block: TemplateBlock, entries: FundingTemplateItem[]) => {
    for (const item of entries) {
      if ((block === 'sections' || block === 'questions') && item.workflowMode !== 'app_draft') {
        continue;
      }
      items.push({
        key: item.key,
        label: item.label,
        guidance: [
          item.guidanceText || item.guidance,
          item.reviewerGoal ? `Reviewer goal: ${item.reviewerGoal}` : '',
          Array.isArray(item.requiredFacts) && item.requiredFacts.length > 0
            ? `Required facts: ${item.requiredFacts.join('; ')}`
            : '',
          Array.isArray(item.forbiddenMoves) && item.forbiddenMoves.length > 0
            ? `Forbidden moves: ${item.forbiddenMoves.join('; ')}`
            : '',
        ].filter(Boolean).join(' | '),
        block,
        workflowMode: item.workflowMode,
        sectionType: resolveGrantTemplateSectionType(item),
        templateIntent: normalizeGrantTemplateIntent(item.templateIntent),
        templateIntentAlternates: normalizeGrantTemplateIntentList(item.templateIntentAlternates, 2),
        templateIntentConfidence: normalizeGrantTemplateIntentConfidence(item.templateIntentConfidence),
      });
    }
  };

  pushItems('sections', template.sections);
  pushItems('questions', template.questions);
  pushItems('evaluationCriteria', template.evaluationCriteria);
  pushItems('submissionRules', template.submissionRules.items);

  if (template.budget) {
    items.push({
      key: 'budget_overview',
      label: 'Budget overview',
      guidance: template.budget.justificationNotes || 'Budget categories and justification requirements',
      block: 'budget',
      sectionType: 'budget_rows',
      templateIntent: 'budget',
      templateIntentAlternates: [],
      templateIntentConfidence: 1,
    });
    for (const category of template.budget.categories) {
      items.push({
        key: `budget_${category.key}`,
        label: category.label,
        guidance: category.notes,
        block: 'budget',
        sectionType: 'budget_rows',
        templateIntent: 'budget',
        templateIntentAlternates: [],
        templateIntentConfidence: 1,
      });
    }
  }

  return items;
}

function keywordMatchesHaystack(keyword: string, haystackTokens: string[]): boolean {
  const parts = tokenize(keyword);
  if (parts.length === 0) return false;
  if (parts.length === 1) return haystackTokens.includes(parts[0]);
  return parts.every((part) => haystackTokens.includes(part));
}

function scoreItemForStage(item: TemplateLikeItem, stageKey: GrantPrepStageKey) {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey];
  const haystack = tokenize(`${item.label} ${item.guidance || ''} ${item.key}`);
  let score = 0;

  for (const point of stage.defaultPoints) {
    for (const keyword of point.templateKeywords) {
      if (keywordMatchesHaystack(keyword, haystack)) {
        score += point.priority === 'P1' ? 3 : point.priority === 'P2' ? 2 : 1;
      }
    }
  }

  if (item.block === 'budget' && stageKey === 'budget_strategy') {
    score += 6;
  }
  if (item.block === 'evaluationCriteria' && (stageKey === 'evaluation' || stageKey === 'thrust_alignment')) {
    score += 4;
  }
  if (item.block === 'submissionRules' && (stageKey === 'workplan' || stageKey === 'fit_and_scope')) {
    score += 2;
  }

  return score;
}

function getMatchedStages(item: TemplateLikeItem): GrantPrepStageKey[] {
  const scored = GRANT_PREP_STAGE_LIBRARY
    .filter((stage) => stage.pickable)
    .map((stage) => ({ key: stage.key, score: scoreItemForStage(item, stage.key) }))
    .sort((a, b) => b.score - a.score);
  const trustedIntentMatches = shouldTrustTemplateIntent({
    intent: item.templateIntent,
    confidence: item.templateIntentConfidence,
    alternates: item.templateIntentAlternates,
    workflowMode: item.workflowMode,
    sectionType: item.sectionType,
  })
    ? getPrepStageKeysForTemplateIntent(item.templateIntent)
    : [];

  if (trustedIntentMatches.length > 0) {
    const matches = [...trustedIntentMatches];
    const heuristicPrimary = scored[0];
    if (
      heuristicPrimary
      && heuristicPrimary.score >= 4
      && !matches.includes(heuristicPrimary.key)
    ) {
      matches.push(heuristicPrimary.key);
    }
    return matches;
  }

  const primary = scored[0];
  if (!primary || primary.score <= 0) {
    if (item.block === 'budget') return ['budget_strategy'];
    if (item.block === 'evaluationCriteria') return ['evaluation'];
    return ['fit_and_scope'];
  }

  const matches = [primary.key];
  const secondary = scored[1];
  if (secondary && secondary.score > 0 && primary.score - secondary.score <= 1) {
    matches.push(secondary.key);
  }

  return matches;
}

function makeDefaultEntry(stageKey: GrantPrepStageKey): GrantPrepStageMappingEntry {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey];
  return {
    stageKey,
    stageTitle: stage.title,
    discussionPoints: stage.defaultPoints.map((point) => ({
      key: point.key,
      label: point.label,
      priority: point.priority,
      sourceTemplatePointer: null,
      origin: 'default' as const,
      conversationRole: point.priority === 'P3' ? 'ai_draftable' as const : 'user_required' as const,
      helpText: point.helpText,
    })),
    templatePointers: [],
    secondaryPointers: [],
  };
}

function addTemplateItemToStage(entry: GrantPrepStageMappingEntry, item: TemplateLikeItem, primary: boolean) {
  const pointer = `${item.block}.${item.key}`;
  const key = `${item.block}_${slug(item.key || item.label)}`;
  const existingPoint = entry.discussionPoints.find((point) => point.key === key);
  const conversationRole = primary ? 'can_infer_and_confirm' as const : 'context_only' as const;
  if (!existingPoint) {
    entry.discussionPoints.push({
      key,
      label: item.label,
      priority: item.block === 'evaluationCriteria' ? 'P1' : item.block === 'budget' ? 'P1' : 'P2',
      sourceTemplatePointer: pointer,
      origin: 'template',
      conversationRole,
      helpText: item.guidance || 'Mapped from the approved template',
    });
  } else if (primary && existingPoint.conversationRole === 'context_only') {
    existingPoint.conversationRole = conversationRole;
  }

  const bucket = primary ? entry.templatePointers : entry.secondaryPointers;
  if (!bucket.includes(pointer)) {
    bucket.push(pointer);
  }
}

export function buildGrantPrepStageMapping(templateInput?: unknown | null): GrantPrepStageMapping {
  const mapping = GRANT_PREP_STAGE_LIBRARY.reduce((acc, stage) => {
    acc[stage.key] = makeDefaultEntry(stage.key);
    return acc;
  }, {} as GrantPrepStageMapping);

  if (!templateInput) {
    return mapping;
  }

  const items = getTemplateItems(templateInput);
  for (const item of items) {
    const matchedStages = getMatchedStages(item);
    matchedStages.forEach((stageKey, index) => addTemplateItemToStage(mapping[stageKey], item, index === 0));
  }

  return mapping;
}

export function getNormalizedTemplate(templateInput?: unknown | null): GrantTemplateDocument | null {
  if (!templateInput) {
    return null;
  }

  return normalizeGrantTemplate(templateInput);
}
