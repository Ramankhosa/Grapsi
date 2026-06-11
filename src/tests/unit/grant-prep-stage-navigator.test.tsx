import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GrantPrepStageNavigator from '@/components/grantPrep/GrantPrepStageNavigator';

function stage(overrides: Record<string, unknown>) {
  return {
    stageKey: 'ideation',
    title: 'Idea & Angle',
    enabled: true,
    pickable: true,
    readiness: 0,
    status: 'not_started',
    steeringEvents: [],
    points: [],
    lastUpdatedAt: null,
    ...overrides,
  };
}

describe('grant prep stage navigator', () => {
  it('renders compact rail readiness and stage status metadata', () => {
    const prepContext = {
      activeStageKey: 'outcomes',
      enabledStageKeys: ['outcomes', 'ideation', 'methodology', 'workplan'],
      stageStates: {
        ideation: stage({
          stageKey: 'ideation',
          title: 'Idea & Angle',
          readiness: 1,
          status: 'completed',
        }),
        outcomes: stage({
          stageKey: 'outcomes',
          title: 'Outcomes',
          readiness: 0.57,
          status: 'in_progress',
        }),
        methodology: stage({
          stageKey: 'methodology',
          title: 'Methodology & Workplan',
          readiness: 0.2,
          status: 'needs_review',
        }),
        workplan: stage({
          stageKey: 'workplan',
          title: 'Workplan',
          readiness: 0.8,
          status: 'completed',
        }),
      },
    } as any;

    const markup = renderToStaticMarkup(
      <GrantPrepStageNavigator
        prepContext={prepContext}
        onStageChange={() => undefined}
        variant="rail"
      />
    );

    expect(markup).toContain('aria-label="Stage completion"');
    expect(markup).toContain('Idea &amp; Angle - 100% ready');
    expect(markup).toContain('Outcomes - 57% ready');
    expect(markup).toContain('Methodology &amp; Workplan - 20% ready - needs review');
    expect(markup).not.toContain('Workplan - 80% ready');
    expect(markup).toContain('100%');
    expect(markup).toContain('57%');
    expect(markup).toContain('20%');
  });

  it('renders horizontal stages in the predefined sequence even when keys are scrambled', () => {
    const prepContext = {
      activeStageKey: 'ideation',
      enabledStageKeys: ['evaluation', 'outcomes', 'ideation', 'methodology'],
      stageStates: {
        ideation: stage({ stageKey: 'ideation', title: 'Idea & Angle' }),
        methodology: stage({ stageKey: 'methodology', title: 'Methodology & Workplan' }),
        outcomes: stage({ stageKey: 'outcomes', title: 'Outcomes' }),
        evaluation: stage({ stageKey: 'evaluation', title: 'Evaluation' }),
      },
    } as any;

    const markup = renderToStaticMarkup(
      <GrantPrepStageNavigator
        prepContext={prepContext}
        onStageChange={() => undefined}
      />
    );

    expect(markup.indexOf('Idea &amp; Angle')).toBeLessThan(markup.indexOf('Methodology &amp; Workplan'));
    expect(markup.indexOf('Methodology &amp; Workplan')).toBeLessThan(markup.indexOf('Outcomes'));
    expect(markup.indexOf('Outcomes')).toBeLessThan(markup.indexOf('Evaluation'));
  });

  it('renders hover-expand rail details in the predefined sequence', () => {
    const prepContext = {
      activeStageKey: 'ideation',
      enabledStageKeys: ['evaluation', 'outcomes', 'ideation', 'methodology'],
      stageStates: {
        ideation: stage({ stageKey: 'ideation', title: 'Idea & Angle', readiness: 0.57, status: 'in_progress' }),
        methodology: stage({ stageKey: 'methodology', title: 'Methodology & Workplan', readiness: 0.2, status: 'needs_review' }),
        outcomes: stage({ stageKey: 'outcomes', title: 'Outcomes', readiness: 0, status: 'not_started' }),
        evaluation: stage({ stageKey: 'evaluation', title: 'Evaluation', readiness: 0, status: 'not_started' }),
      },
    } as any;

    const markup = renderToStaticMarkup(
      <GrantPrepStageNavigator
        prepContext={prepContext}
        onStageChange={() => undefined}
        variant="rail"
        expandOnHover
      />
    );

    expect(markup).toContain('hover:w-72');
    expect(markup).toContain('Stage sequence');
    expect(markup.indexOf('1. Idea &amp; Angle')).toBeLessThan(markup.indexOf('2. Methodology &amp; Workplan'));
    expect(markup.indexOf('2. Methodology &amp; Workplan')).toBeLessThan(markup.indexOf('3. Outcomes'));
    expect(markup.indexOf('3. Outcomes')).toBeLessThan(markup.indexOf('4. Evaluation'));
    expect(markup).toContain('Needs review - 20% ready');
  });

  it('falls back to enabled visible stage states when enabled keys contain only legacy aliases', () => {
    const prepContext = {
      activeStageKey: 'methodology',
      enabledStageKeys: ['workplan', 'final_pitch'],
      stageStates: {
        methodology: stage({
          stageKey: 'methodology',
          title: 'Methodology & Workplan',
          enabled: true,
          readiness: 0.4,
          status: 'in_progress',
        }),
        workplan: stage({
          stageKey: 'workplan',
          title: 'Workplan',
          enabled: false,
          pickable: false,
          readiness: 0.8,
          status: 'disabled',
        }),
        final_pitch: stage({
          stageKey: 'final_pitch',
          title: 'Final Pitch',
          enabled: false,
          pickable: false,
          readiness: 1,
          status: 'disabled',
        }),
      },
    } as any;

    const markup = renderToStaticMarkup(
      <GrantPrepStageNavigator
        prepContext={prepContext}
        onStageChange={() => undefined}
        variant="rail"
      />
    );

    expect(markup).toContain('Methodology &amp; Workplan - 40% ready');
    expect(markup).not.toContain('Final Pitch');
  });
});
