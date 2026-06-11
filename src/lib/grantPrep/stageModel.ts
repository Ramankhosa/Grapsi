import type { GrantPrepStageKey } from './types';

export const VISIBLE_GRANT_PREP_STAGE_KEYS: GrantPrepStageKey[] = [
  'ideation',
  'problem_definition',
  'root_cause',
  'beneficiaries',
  'fit_and_scope',
  'methodology',
  'team_and_partnerships',
  'outcomes',
  'evaluation',
  'risk_and_ethics',
  'budget_strategy',
  'innovation',
];

export const TERMINAL_GRANT_PREP_STAGE_KEYS: GrantPrepStageKey[] = [
  'handoff_ready',
  'handoff_complete',
];

export const GRANT_PREP_STAGE_ALIAS_TO_CANONICAL: Partial<Record<GrantPrepStageKey, GrantPrepStageKey>> = {
  thrust_alignment: 'fit_and_scope',
  workplan: 'methodology',
  sustainability_and_scale: 'innovation',
};

export const HIDDEN_GRANT_PREP_STAGE_KEYS: GrantPrepStageKey[] = [
  'thrust_alignment',
  'workplan',
  'sustainability_and_scale',
  'final_pitch',
];

const STAGE_DISPLAY_TITLES: Partial<Record<GrantPrepStageKey, string>> = {
  fit_and_scope: 'Fit, Scope & Priority',
  methodology: 'Methodology & Workplan',
  innovation: 'Innovation, Sustainability & Scale',
  final_pitch: 'Proposal Synthesis',
};

const CANONICAL_TO_ALIASES = Object.entries(GRANT_PREP_STAGE_ALIAS_TO_CANONICAL).reduce(
  (acc, [alias, canonical]) => {
    acc[canonical].push(alias as GrantPrepStageKey);
    return acc;
  },
  {
    fit_and_scope: [] as GrantPrepStageKey[],
    methodology: [] as GrantPrepStageKey[],
    innovation: [] as GrantPrepStageKey[],
  } as Record<GrantPrepStageKey, GrantPrepStageKey[]>
);

CANONICAL_TO_ALIASES.ideation = ['final_pitch'];

export function getCanonicalGrantPrepStageKey(stageKey: GrantPrepStageKey | string): GrantPrepStageKey {
  return GRANT_PREP_STAGE_ALIAS_TO_CANONICAL[stageKey as GrantPrepStageKey] || (stageKey as GrantPrepStageKey);
}

export function isVisibleGrantPrepStageKey(stageKey: GrantPrepStageKey | string): boolean {
  return VISIBLE_GRANT_PREP_STAGE_KEYS.includes(stageKey as GrantPrepStageKey);
}

export function isHiddenGrantPrepStageKey(stageKey: GrantPrepStageKey | string): boolean {
  return HIDDEN_GRANT_PREP_STAGE_KEYS.includes(stageKey as GrantPrepStageKey);
}

export function isMergedLegacyGrantPrepStageKey(stageKey: GrantPrepStageKey | string): boolean {
  return Boolean(GRANT_PREP_STAGE_ALIAS_TO_CANONICAL[stageKey as GrantPrepStageKey]);
}

export function expandGrantPrepStageAliases(stageKeys: Iterable<GrantPrepStageKey | string>): GrantPrepStageKey[] {
  const expanded = new Set<GrantPrepStageKey>();

  for (const rawStageKey of stageKeys) {
    const stageKey = rawStageKey as GrantPrepStageKey;
    const canonical = getCanonicalGrantPrepStageKey(stageKey);
    expanded.add(canonical);
    expanded.add(stageKey);
    for (const alias of CANONICAL_TO_ALIASES[canonical] || []) {
      expanded.add(alias);
    }
  }

  return Array.from(expanded);
}

export function getGrantPrepStageDisplayTitle(stageKey: GrantPrepStageKey | string, fallback?: string): string {
  return STAGE_DISPLAY_TITLES[stageKey as GrantPrepStageKey] || fallback || stageKey;
}
