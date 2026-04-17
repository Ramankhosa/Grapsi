import type { GuidelinePackDocument, FundingGuidelineRuleItem } from '../fundingGuidelines/types';
import { GRANT_PREP_STAGE_BY_KEY } from './stageLibrary';
import type { GrantPrepStageKey } from './types';

export interface RoutedGuidelineContext {
  warning: string | null;
  blocks: Record<string, FundingGuidelineRuleItem[]>;
}

export function getGuidelineContextForStage(
  stageKey: GrantPrepStageKey,
  guidelinePack: GuidelinePackDocument | null | undefined
): RoutedGuidelineContext {
  const stage = GRANT_PREP_STAGE_BY_KEY[stageKey];
  if (!guidelinePack) {
    return {
      warning: 'Approved guidelines are not attached yet. Grant Prep will continue using call facts and template signals.',
      blocks: {},
    };
  }

  const blocks = stage.guidelineBlocks.reduce((acc, key) => {
    const items = (guidelinePack as any)?.[key];
    acc[key] = Array.isArray(items) ? items : [];
    return acc;
  }, {} as Record<string, FundingGuidelineRuleItem[]>);

  return {
    warning: null,
    blocks,
  };
}
