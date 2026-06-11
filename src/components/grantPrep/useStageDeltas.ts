'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GrantPrepStageKey, GrantPrepStageStates } from '@/lib/grantPrep/types';
import type { PrepContext } from './types';

const READINESS_EPSILON = 0.001;

export type GrantPrepStageDelta = {
  stageKey: GrantPrepStageKey;
  readinessDelta: number;
  readinessDeltaPercent: number;
  newlyCoveredPointCount: number;
  hasPositiveDelta: boolean;
  shouldAnimate: boolean;
  transitionKey: string;
};

export type GrantPrepStageDeltaMap = Partial<Record<GrantPrepStageKey, GrantPrepStageDelta>>;

function clampReadiness(value: unknown) {
  return Math.max(0, Math.min(1, typeof value === 'number' && Number.isFinite(value) ? value : 0));
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function pointHasCapturedInformation(point: GrantPrepStageStates[GrantPrepStageKey]['points'][number]) {
  if (!point.capture) return false;

  return (
    normalizeStringArray(point.capture.keywords).length > 0 ||
    normalizeStringArray(point.capture.factBullets).length > 0 ||
    normalizeStringArray(point.capture.ruleNotes).length > 0 ||
    normalizeStringArray(point.capture.thrustLinkage).length > 0
  );
}

function collectCoveredPointKeys(stage: GrantPrepStageStates[GrantPrepStageKey] | undefined) {
  const covered = new Set<string>();

  stage?.points.forEach((point) => {
    if (point.status === 'covered' || pointHasCapturedInformation(point)) {
      covered.add(point.key);
    }
  });

  return covered;
}

export function computeStageDeltas(
  previousStageStates: Partial<GrantPrepStageStates> | null | undefined,
  nextStageStates: Partial<GrantPrepStageStates> | null | undefined,
  options: { shouldAnimate?: boolean } = {}
): GrantPrepStageDeltaMap {
  const deltas: GrantPrepStageDeltaMap = {};

  Object.values(nextStageStates || {}).forEach((nextStage) => {
    if (!nextStage) return;

    const previousStage = previousStageStates?.[nextStage.stageKey];
    const nextReadiness = clampReadiness(nextStage.readiness);
    const previousReadiness = previousStage ? clampReadiness(previousStage.readiness) : nextReadiness;
    const readinessDelta = nextReadiness - previousReadiness;
    const nextCoveredKeys = collectCoveredPointKeys(nextStage);
    const previousCoveredKeys = previousStage ? collectCoveredPointKeys(previousStage) : nextCoveredKeys;
    const newlyCoveredPointCount = [...nextCoveredKeys].filter((key) => !previousCoveredKeys.has(key)).length;
    const hasPositiveDelta = readinessDelta > READINESS_EPSILON || newlyCoveredPointCount > 0;
    const coveredSignature = [...nextCoveredKeys].sort().join('|');

    deltas[nextStage.stageKey] = {
      stageKey: nextStage.stageKey,
      readinessDelta,
      readinessDeltaPercent: Math.round(readinessDelta * 100),
      newlyCoveredPointCount,
      hasPositiveDelta,
      shouldAnimate: Boolean(options.shouldAnimate && hasPositiveDelta),
      transitionKey: [
        nextStage.stageKey,
        nextStage.lastUpdatedAt || 'no-update',
        Math.round(nextReadiness * 1000),
        newlyCoveredPointCount,
        coveredSignature,
      ].join(':'),
    };
  });

  return deltas;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener?.('change', updatePreference);

    return () => {
      mediaQuery.removeEventListener?.('change', updatePreference);
    };
  }, []);

  return prefersReducedMotion;
}

export function useStageDeltas(prepContext: PrepContext) {
  const previousStageStatesRef = useRef<GrantPrepStageStates | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const deltas = useMemo(() => {
    const previousStageStates = previousStageStatesRef.current;

    return computeStageDeltas(previousStageStates, prepContext.stageStates, {
      shouldAnimate: Boolean(previousStageStates && !prefersReducedMotion),
    });
  }, [prepContext.stageStates, prefersReducedMotion]);

  useEffect(() => {
    previousStageStatesRef.current = prepContext.stageStates;
  }, [prepContext.stageStates]);

  return {
    deltas,
    prefersReducedMotion,
  };
}
