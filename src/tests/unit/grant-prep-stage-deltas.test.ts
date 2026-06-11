import { describe, expect, it } from 'vitest';

import { computeStageDeltas } from '@/components/grantPrep/useStageDeltas';

function capture(fact = 'Captured fact') {
  return {
    keywords: [fact],
    thrustLinkage: [],
    factBullets: [fact],
    ruleNotes: [],
    confidence: 0.9,
    ruleCompliance: {
      status: 'ok',
      reason: null,
      rescopeNeeded: false,
    },
    captureBasis: ['user_confirmed'],
    sourceTemplatePointer: null,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

function point(key: string, status = 'pending', pointCapture: ReturnType<typeof capture> | null = null) {
  return {
    key,
    label: key,
    priority: 'P1',
    status,
    sourceTemplatePointer: null,
    capture: pointCapture,
  };
}

function stage(stageKey: string, readiness: number, points: Array<ReturnType<typeof point>>, lastUpdatedAt = '2026-06-11T00:00:00.000Z') {
  return {
    stageKey,
    title: stageKey,
    enabled: true,
    pickable: true,
    readiness,
    status: readiness >= 0.65 ? 'completed' : readiness > 0 ? 'in_progress' : 'not_started',
    steeringEvents: [],
    points,
    lastUpdatedAt,
  };
}

describe('grant prep stage deltas', () => {
  it('does not report positive deltas on initial observation', () => {
    const deltas = computeStageDeltas(null, {
      ideation: stage('ideation', 0.45, [point('angle', 'covered', capture('Angle'))]),
    } as any, { shouldAnimate: true });

    expect(deltas.ideation?.readinessDelta).toBe(0);
    expect(deltas.ideation?.newlyCoveredPointCount).toBe(0);
    expect(deltas.ideation?.hasPositiveDelta).toBe(false);
    expect(deltas.ideation?.shouldAnimate).toBe(false);
  });

  it('counts newly captured points across any changed stage', () => {
    const previous = {
      ideation: stage('ideation', 0.2, [
        point('angle'),
        point('audience', 'covered', capture('Audience')),
      ]),
      methodology: stage('methodology', 0.1, [point('approach')]),
    } as any;

    const next = {
      ideation: stage('ideation', 0.32, [
        point('angle', 'covered', capture('Angle')),
        point('audience', 'covered', capture('Audience')),
      ]),
      methodology: stage('methodology', 0.22, [
        point('approach', 'needs_review', capture('Approach')),
      ]),
    } as any;

    const deltas = computeStageDeltas(previous, next, { shouldAnimate: true });

    expect(deltas.ideation?.readinessDeltaPercent).toBe(12);
    expect(deltas.ideation?.newlyCoveredPointCount).toBe(1);
    expect(deltas.ideation?.shouldAnimate).toBe(true);

    expect(deltas.methodology?.readinessDeltaPercent).toBe(12);
    expect(deltas.methodology?.newlyCoveredPointCount).toBe(1);
    expect(deltas.methodology?.shouldAnimate).toBe(true);
  });

  it('does not trigger a positive new-information animation for regressions', () => {
    const previous = {
      outcomes: stage('outcomes', 0.7, [point('metrics', 'covered', capture('Metrics'))]),
    } as any;

    const next = {
      outcomes: stage('outcomes', 0.4, [point('metrics', 'covered', capture('Metrics'))]),
    } as any;

    const deltas = computeStageDeltas(previous, next, { shouldAnimate: true });

    expect(deltas.outcomes?.readinessDeltaPercent).toBe(-30);
    expect(deltas.outcomes?.newlyCoveredPointCount).toBe(0);
    expect(deltas.outcomes?.hasPositiveDelta).toBe(false);
    expect(deltas.outcomes?.shouldAnimate).toBe(false);
  });
});
