import type { FundingCallContext } from '../fundingContext';
import type { GuidelinePackDocument } from '../fundingGuidelines/types';
import { createEmptyGrantTemplate } from '../fundingTemplates/utils';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from './stageLibrary';
import { buildGrantPrepStageMapping, getNormalizedTemplate } from './templateMapper';
import type {
  GrantPrepMode,
  GrantPrepStageKey,
  GrantPrepStageMapping,
  GrantPrepStageSelectionSource,
} from './types';

export const GRANT_PREP_V2_STAGE_SELECTION_VERSION = 'v2' as const;
export const GRANT_PREP_INTERNAL_ALWAYS_ENABLED_STAGE_KEYS: GrantPrepStageKey[] = [
  'handoff_ready',
  'handoff_complete',
];

type SelectionMode = 'template' | 'fallback';

type SelectorFundingContext = Pick<FundingCallContext, 'focusAreas' | 'deliverables' | 'budgetLimits' | 'projectDuration'>;

type SelectorResult = {
  stageMapping: GrantPrepStageMapping;
  autoEnabledStageKeys: GrantPrepStageKey[];
  selectionMode: SelectionMode;
  selectionSources: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>>;
};

type PseudoTemplateMode = Exclude<GrantPrepMode, 'template_driven' | 'template_only'> | 'standard';

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function includesAnyText(haystack: string[], needles: string[]) {
  const normalizedText = haystack.join(' ').toLowerCase();
  return needles.some((needle) => normalizedText.includes(needle.toLowerCase()));
}

export function sortStageKeys(stageKeys: Iterable<GrantPrepStageKey>) {
  const set = new Set(stageKeys);
  return GRANT_PREP_STAGE_LIBRARY.filter((stage) => set.has(stage.key)).map((stage) => stage.key);
}

function makeTemplateItem(key: string, label: string, guidance: string) {
  return {
    key,
    label,
    type: 'section' as const,
    required: false,
    repeatable: false,
    supportLevel: 'full' as const,
    confidence: 1,
    sourceAnchors: [],
    guidance,
  };
}

function buildPseudoTemplate(mode: PseudoTemplateMode) {
  const template = createEmptyGrantTemplate();

  template.sections.push(
    makeTemplateItem(
      'problem_statement',
      'Problem statement',
      'Define the core problem challenge need gap urgency burden baseline evidence and why action matters now.'
    ),
    makeTemplateItem(
      'beneficiaries',
      'Beneficiaries',
      'Identify the beneficiary target group end user stakeholder community site region institution and who benefits directly.'
    ),
    makeTemplateItem(
      'methodology',
      'Methodology',
      'Describe the method approach intervention activity task work package pilot data validation implementation and execution plan.'
    ),
    makeTemplateItem(
      'outcomes',
      'Outcomes',
      'Describe the outcome short-term benefit long-term impact adoption expected result and measurable change.'
    )
  );

  if (mode !== 'standalone') {
    template.sections.push(
      makeTemplateItem(
        'call_fit',
        'Call fit',
        'Explain scheme fit alignment scope feasible phased applicant merit and the right match for the funding call.'
      ),
      makeTemplateItem(
        'workplan_deliverables',
        'Workplan and deliverables',
        'Describe the phase milestone timeline deliverable output report schedule roadmap and work package sequencing.'
      ),
      makeTemplateItem(
        'team_and_partnerships',
        'Team and partnerships',
        'Describe the team role expertise partner stakeholder collaboration consortium and who leads delivers and validates the work.'
      ),
      makeTemplateItem(
        'innovation_and_novelty',
        'Innovation and novelty',
        'Describe what is innovation novel advance compare advantage improvement and how the approach differs from current practice.'
      ),
      makeTemplateItem(
        'risk_mitigation_ethics',
        'Risk mitigation and ethics',
        'Identify risk constraint dependency mitigation fallback contingency and any ethics compliance approval considerations.'
      ),
      makeTemplateItem(
        'sustainability_continuation',
        'Sustainability and continuation',
        'Explain sustainability continuation maintenance after funding and the scale adoption replication path for broader impact.'
      ),
      makeTemplateItem(
        'reviewer_case',
        'Reviewer case',
        'Summarize the pitch positioning value why now fit merit summary and strongest case for funding.'
      )
    );

    template.budget = {
      required: true,
      yearWise: false,
      categories: [
        {
          key: 'core_budget',
          label: 'Core project budget',
          notes: 'Budget cost resource allowable justification cap and spending logic aligned to project activities.',
          sourceAnchors: [],
        },
      ],
      caps: null,
      justificationNotes:
        'Budget cost resource allowable justification cap value for money and spending logic aligned to the work plan.',
      supportLevel: 'full',
      confidence: 1,
      sourceAnchors: [],
    };
  }

  return template;
}

function hasUsableTemplate(templateInput?: unknown | null) {
  const template = getNormalizedTemplate(templateInput);
  if (!template) {
    return false;
  }

  return (
    template.sections.length > 0 ||
    template.questions.length > 0 ||
    template.evaluationCriteria.length > 0 ||
    template.submissionRules.items.length > 0 ||
    Boolean(template.budget)
  );
}

function getTemplateEvidenceStageKeys(stageMapping: GrantPrepStageMapping) {
  return sortStageKeys(
    Object.values(stageMapping)
      .filter((entry) => entry.templatePointers.length > 0 || entry.secondaryPointers.length > 0)
      .map((entry) => entry.stageKey)
  );
}

function collectGuidelineTexts(
  guidelinePack: GuidelinePackDocument | null | undefined,
  blockKeys: Array<Exclude<keyof GuidelinePackDocument, 'sourceAnchors'>>
) {
  if (!guidelinePack) {
    return [];
  }

  return blockKeys.flatMap((blockKey) => {
    const block = guidelinePack[blockKey];
    return Array.isArray(block) ? block.map((item) => String(item?.text || '').trim()).filter(Boolean) : [];
  });
}

function collectCallFactTexts(fundingContext?: SelectorFundingContext | null) {
  if (!fundingContext) {
    return [];
  }

  return [
    ...((fundingContext.focusAreas || []).map((value) => String(value).trim()).filter(Boolean)),
    fundingContext.deliverables || '',
    fundingContext.budgetLimits || '',
    fundingContext.projectDuration || '',
  ].filter(Boolean);
}

function addSelection(
  target: Set<GrantPrepStageKey>,
  selectionSources: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>>,
  stageKey: GrantPrepStageKey,
  source: GrantPrepStageSelectionSource
) {
  if (!target.has(stageKey)) {
    target.add(stageKey);
  }

  if (!selectionSources[stageKey]) {
    selectionSources[stageKey] = source;
  }
}

export function resolveUpstreamStageDependencies(stageKeys: Iterable<GrantPrepStageKey>) {
  const resolved = new Set(stageKeys);
  const queue = Array.from(resolved);

  while (queue.length > 0) {
    const current = queue.shift() as GrantPrepStageKey;
    for (const dependency of GRANT_PREP_STAGE_BY_KEY[current].dependencies) {
      if (!resolved.has(dependency)) {
        resolved.add(dependency);
        queue.push(dependency);
      }
    }
  }

  return sortStageKeys(resolved);
}

export function getEnabledDependentStageKeys(stageKey: GrantPrepStageKey, enabledStageKeys: GrantPrepStageKey[]) {
  const enabled = new Set(enabledStageKeys);
  return GRANT_PREP_STAGE_LIBRARY.filter(
    (stage) => stage.key !== stageKey && stage.pickable && enabled.has(stage.key) && stage.dependencies.includes(stageKey)
  ).map((stage) => stage.key);
}

export function buildFinalEnabledStageKeys(input: {
  autoEnabledStageKeys: GrantPrepStageKey[];
  manualEnabledStageKeys: GrantPrepStageKey[];
  manualDisabledStageKeys: GrantPrepStageKey[];
}) {
  const enabled = new Set<GrantPrepStageKey>([
    ...input.autoEnabledStageKeys,
    ...input.manualEnabledStageKeys,
  ]);

  for (const stageKey of input.manualDisabledStageKeys) {
    enabled.delete(stageKey);
  }

  GRANT_PREP_INTERNAL_ALWAYS_ENABLED_STAGE_KEYS.forEach((stageKey) => enabled.add(stageKey));
  return sortStageKeys(enabled);
}

export function buildSelectionSources(input: {
  autoEnabledStageKeys: GrantPrepStageKey[];
  manualEnabledStageKeys: GrantPrepStageKey[];
  baseSources: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>>;
}) {
  const sources: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>> = {
    ...input.baseSources,
  };

  input.autoEnabledStageKeys.forEach((stageKey) => {
    if (!sources[stageKey]) {
      sources[stageKey] = 'dependency';
    }
  });

  input.manualEnabledStageKeys.forEach((stageKey) => {
    sources[stageKey] = 'manual';
  });

  return sources;
}

export function buildGrantPrepSelectorResult(input: {
  mode: GrantPrepMode;
  templateJson?: unknown | null;
  guidelinePack?: GuidelinePackDocument | null;
  selectedThrustAreaRuleKeys?: string[];
  fundingContext?: SelectorFundingContext | null;
}): SelectorResult {
  const hasTemplate = input.mode === 'template_driven' || input.mode === 'template_only';
  const useRealTemplate = hasTemplate && hasUsableTemplate(input.templateJson);
  const selectionMode: SelectionMode = useRealTemplate ? 'template' : 'fallback';
  const pseudoTemplateMode: PseudoTemplateMode =
    input.mode === 'standalone'
      ? 'standalone'
      : input.mode === 'lightweight'
        ? 'lightweight'
        : input.mode === 'guided_fallback'
          ? 'guided_fallback'
          : 'standard';
  const templateForMapping = useRealTemplate ? input.templateJson : buildPseudoTemplate(pseudoTemplateMode);
  const stageMapping = buildGrantPrepStageMapping(templateForMapping);
  const autoEnabled = new Set<GrantPrepStageKey>(getTemplateEvidenceStageKeys(stageMapping));
  const baseSource: GrantPrepStageSelectionSource = useRealTemplate ? 'template' : 'fallback';
  const selectionSources: Partial<Record<GrantPrepStageKey, GrantPrepStageSelectionSource>> = {};

  autoEnabled.forEach((stageKey) => {
    selectionSources[stageKey] = baseSource;
  });

  const focusAreas = input.fundingContext?.focusAreas || [];
  const hasGuidelines = input.mode !== 'lightweight' && input.mode !== 'standalone' && Boolean(input.guidelinePack);
  const callFactTexts = collectCallFactTexts(input.fundingContext);

  if (
    (input.selectedThrustAreaRuleKeys || []).length > 0 ||
    focusAreas.length > 0 ||
    collectGuidelineTexts(input.guidelinePack, ['priorities']).length > 0
  ) {
    addSelection(autoEnabled, selectionSources, 'thrust_alignment', hasGuidelines ? 'guideline' : 'fallback');
  }

  if (hasGuidelines) {
    const teamTexts = collectGuidelineTexts(input.guidelinePack, ['mustAddress', 'evaluationCriteria']);
    if (
      includesAnyText(teamTexts, [
        'partner',
        'collaboration',
        'consortium',
        'lead institution',
        'technical partner',
        'principal investigator',
        'co-investigator',
        'co investigator',
        'team',
      ])
    ) {
      addSelection(autoEnabled, selectionSources, 'team_and_partnerships', 'guideline');
    }

    if (collectGuidelineTexts(input.guidelinePack, ['evaluationCriteria', 'deliverableRules']).length > 0) {
      addSelection(autoEnabled, selectionSources, 'evaluation', 'guideline');
    }

    const riskTexts = collectGuidelineTexts(input.guidelinePack, ['avoid', 'mustAddress', 'reviewerSignals']);
    if (
      collectGuidelineTexts(input.guidelinePack, ['avoid']).length > 0 ||
      includesAnyText(riskTexts, ['risk', 'ethics', 'compliance', 'approval', 'consent', 'security'])
    ) {
      addSelection(autoEnabled, selectionSources, 'risk_and_ethics', 'guideline');
    }

    const innovationTexts = collectGuidelineTexts(input.guidelinePack, ['evaluationCriteria', 'reviewerSignals']);
    if (includesAnyText(innovationTexts, ['innovation', 'novel', 'advance', 'original'])) {
      addSelection(autoEnabled, selectionSources, 'innovation', 'guideline');
    }

    const sustainabilityTexts = collectGuidelineTexts(input.guidelinePack, [
      'reviewerSignals',
      'mustAddress',
      'deliverableRules',
    ]);
    if (
      includesAnyText(sustainabilityTexts, [
        'sustainability',
        'continuation',
        'self-sustainability',
        'self sustainability',
        'adoption',
        'scale',
        'replication',
      ])
    ) {
      addSelection(autoEnabled, selectionSources, 'sustainability_and_scale', 'guideline');
    }
  } else if (input.mode === 'lightweight' && focusAreas.length > 0) {
    addSelection(autoEnabled, selectionSources, 'thrust_alignment', 'fallback');
  }

  if (input.mode === 'lightweight') {
    if (includesAnyText(callFactTexts, ['deliverable', 'milestone', 'timeline'])) {
      addSelection(autoEnabled, selectionSources, 'workplan', 'fallback');
    }
    if (includesAnyText(callFactTexts, ['budget', 'cost', 'funding'])) {
      addSelection(autoEnabled, selectionSources, 'budget_strategy', 'fallback');
    }
  }

  const withDependencies = resolveUpstreamStageDependencies(autoEnabled);
  withDependencies.forEach((stageKey) => {
    if (!selectionSources[stageKey]) {
      selectionSources[stageKey] = 'dependency';
    }
  });

  return {
    stageMapping,
    autoEnabledStageKeys: withDependencies,
    selectionMode,
    selectionSources,
  };
}
