import { describe, expect, it } from 'vitest';

import { getNextEnabledPickableStageKey } from '@/lib/grantPrep/stageLibrary';
import {
  VISIBLE_GRANT_PREP_STAGE_KEYS,
  expandGrantPrepStageAliases,
  getCanonicalGrantPrepStageKey,
} from '@/lib/grantPrep/stageModel';
import { sortStageKeys } from '@/lib/grantPrep/selection';
import { inflateGrantPrepSessionContext } from '@/lib/grantPrep/server';
import {
  buildGrantPrepSessionContext,
  buildInitialStageStates,
  getNextPickableStageKey,
} from '@/lib/grantPrep/sessionState';
import { buildGrantPrepStageMapping } from '@/lib/grantPrep/templateMapper';
import type { GrantPrepStageKey, GrantPrepStageStates } from '@/lib/grantPrep/types';

function reorderStageStates(stageStates: GrantPrepStageStates, order: GrantPrepStageKey[]) {
  return order.reduce((acc, stageKey) => {
    acc[stageKey] = stageStates[stageKey];
    return acc;
  }, {} as GrantPrepStageStates);
}

function makePersistedSessionForInflation(
  activeStageKey: GrantPrepStageKey,
  messages: unknown[]
) {
  const stageMapping = buildGrantPrepStageMapping(null);
  const stageStates = buildInitialStageStates(stageMapping);

  return {
    mode: 'template_driven',
    engagement_mode: 'expert',
    stage_selection_version: 'v3',
    auto_enabled_stage_keys: [],
    manual_enabled_stage_keys: [],
    manual_disabled_stage_keys: [],
    active_stage_key: activeStageKey,
    selected_thrust_area_rule_keys: [],
    enabled_stage_keys: ['ideation', 'outcomes'],
    disabled_stage_keys: [],
    stage_mapping_json: stageMapping,
    stage_states_json: stageStates,
    global_keywords_json: [],
    messages,
  } as any;
}

describe('grant prep stage sequence', () => {
  it('sorts stage keys into the predefined prep path', () => {
    expect(sortStageKeys(['evaluation', 'ideation', 'outcomes', 'workplan', 'problem_definition'])).toEqual([
      'ideation',
      'problem_definition',
      'methodology',
      'outcomes',
      'evaluation',
    ]);
  });

  it('places outcomes before evaluation in the visible prep sequence', () => {
    const stageKeys = VISIBLE_GRANT_PREP_STAGE_KEYS;

    expect(stageKeys.indexOf('outcomes')).toBeLessThan(stageKeys.indexOf('evaluation'));
  });

  it('maps legacy merged stages to canonical visible stages', () => {
    expect(getCanonicalGrantPrepStageKey('thrust_alignment')).toBe('fit_and_scope');
    expect(getCanonicalGrantPrepStageKey('workplan')).toBe('methodology');
    expect(getCanonicalGrantPrepStageKey('sustainability_and_scale')).toBe('innovation');
    expect(expandGrantPrepStageAliases(['methodology'])).toEqual(expect.arrayContaining(['methodology', 'workplan']));
  });

  it('excludes hidden legacy stages from the visible prep sequence', () => {
    expect(VISIBLE_GRANT_PREP_STAGE_KEYS).not.toEqual(expect.arrayContaining([
      'thrust_alignment',
      'workplan',
      'sustainability_and_scale',
      'final_pitch',
    ]));
  });

  it('routes close-function template intents to merged canonical stages', () => {
    const stageMapping = buildGrantPrepStageMapping({
      sections: [
        {
          key: 'priority_alignment',
          label: 'Priority Alignment',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'alignment',
          templateIntentConfidence: 0.98,
        },
        {
          key: 'implementation_plan',
          label: 'Workplan and Timeline',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'workplan',
          templateIntentConfidence: 0.98,
        },
        {
          key: 'sustainability_plan',
          label: 'Sustainability and Scale',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'sustainability',
          templateIntentConfidence: 0.98,
        },
        {
          key: 'summary',
          label: 'Proposal Summary',
          type: 'section',
          workflowMode: 'app_draft',
          templateIntent: 'summary',
          templateIntentConfidence: 0.98,
        },
      ],
    });

    expect(stageMapping.fit_and_scope.templatePointers).toContain('sections.priority_alignment');
    expect(stageMapping.methodology.templatePointers).toContain('sections.implementation_plan');
    expect(stageMapping.innovation.templatePointers).toContain('sections.sustainability_plan');
    expect(stageMapping.final_pitch.templatePointers).toEqual([]);
  });

  it('skips disabled template stages when resolving the next active stage', () => {
    const stageMapping = buildGrantPrepStageMapping(null);
    const stageStates = buildInitialStageStates(stageMapping, ['ideation', 'outcomes', 'final_pitch']);

    expect(getNextEnabledPickableStageKey(stageStates, 'ideation')).toBe('outcomes');
    expect(getNextPickableStageKey(stageStates, 'ideation')).toBe('outcomes');
  });

  it('normalizes context stage-key arrays even when stage state insertion order is scrambled', () => {
    const stageMapping = buildGrantPrepStageMapping(null);
    const baseStageStates = buildInitialStageStates(stageMapping);
    const scrambledStageStates = reorderStageStates(baseStageStates, [
      'evaluation',
      'ideation',
      'outcomes',
      'workplan',
      'problem_definition',
      'root_cause',
      'beneficiaries',
      'fit_and_scope',
      'thrust_alignment',
      'methodology',
      'team_and_partnerships',
      'innovation',
      'risk_and_ethics',
      'budget_strategy',
      'sustainability_and_scale',
      'final_pitch',
      'handoff_ready',
      'handoff_complete',
    ]);

    const context = buildGrantPrepSessionContext({
      mode: 'template_driven',
      engagementMode: 'expert',
      stageMapping,
      stageStates: scrambledStageStates,
    });

    expect(context.enabledStageKeys.slice(0, 5)).toEqual([
      'ideation',
      'problem_definition',
      'root_cause',
      'beneficiaries',
      'fit_and_scope',
    ]);
    expect(context.enabledStageKeys).not.toEqual(expect.arrayContaining([
      'thrust_alignment',
      'workplan',
      'sustainability_and_scale',
      'final_pitch',
    ]));
    expect(context.enabledStageKeys.indexOf('outcomes')).toBeLessThan(context.enabledStageKeys.indexOf('evaluation'));
    expect(context.activeStageKey).toBe('ideation');
  });

  it('loads empty persisted prep sessions at ideation even if active stage drifted later', () => {
    const context = inflateGrantPrepSessionContext(makePersistedSessionForInflation('outcomes', []));

    expect(context.activeStageKey).toBe('ideation');
  });

  it('preserves the persisted active stage after prep messages exist', () => {
    const context = inflateGrantPrepSessionContext(
      makePersistedSessionForInflation('outcomes', [{ id: 'message-1' }])
    );

    expect(context.activeStageKey).toBe('outcomes');
  });
});
