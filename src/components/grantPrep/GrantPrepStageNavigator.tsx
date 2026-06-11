import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HiCheck, HiExclamationCircle } from 'react-icons/hi2';
import { getGrantPrepStageTitle, sortGrantPrepStageKeys } from '@/lib/grantPrep/stageLibrary';
import { isVisibleGrantPrepStageKey } from '@/lib/grantPrep/stageModel';
import type { PrepContext } from './types';
import { useStageDeltas, type GrantPrepStageDelta } from './useStageDeltas';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function clampReadiness(value: number) {
  return Math.max(0, Math.min(1, value));
}

function springProgress(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return 1 - (1 + 6 * t) * Math.exp(-6 * t);
}

function deltaChipText(delta: GrantPrepStageDelta, compact = false) {
  if (delta.newlyCoveredPointCount > 0) {
    return compact
      ? `+${delta.newlyCoveredPointCount}`
      : `+${delta.newlyCoveredPointCount} fact${delta.newlyCoveredPointCount === 1 ? '' : 's'}`;
  }

  return `+${Math.max(1, delta.readinessDeltaPercent)}%`;
}

function animationDelayStyle(delayMs: number): React.CSSProperties {
  return { animationDelay: `${delayMs}ms` };
}

function transitionDelayStyle(delayMs: number): React.CSSProperties {
  return { transitionDelay: `${delayMs}ms` };
}

function StageAnimationStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      @keyframes grantPrepStageDeltaPulse {
        0% {
          opacity: 0.55;
          transform: scale(0.92);
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.28);
        }
        70% {
          opacity: 0.18;
          transform: scale(1.34);
          box-shadow: 0 0 0 9px rgba(16, 185, 129, 0);
        }
        100% {
          opacity: 0;
          transform: scale(1.42);
          box-shadow: 0 0 0 11px rgba(16, 185, 129, 0);
        }
      }

      @keyframes grantPrepStageDeltaChip {
        0% {
          opacity: 0;
          transform: translate3d(0, 4px, 0) scale(0.94);
        }
        18% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        72% {
          opacity: 1;
          transform: translate3d(0, -8px, 0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate3d(0, -14px, 0) scale(0.98);
        }
      }

      .grant-prep-stage-delta-pulse {
        animation: grantPrepStageDeltaPulse 900ms ease-out both;
      }

      .grant-prep-stage-delta-chip {
        animation: grantPrepStageDeltaChip 1250ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }

      @media (prefers-reduced-motion: reduce) {
        .grant-prep-stage-delta-pulse,
        .grant-prep-stage-delta-chip {
          animation: none;
          opacity: 0;
        }
      }
    `,
      }}
    />
  );
}

function StageDeltaEffects({
  delta,
  isActive,
  compact,
  staggerIndex,
}: {
  delta?: GrantPrepStageDelta;
  isActive: boolean;
  compact?: boolean;
  staggerIndex: number;
}) {
  if (!delta?.shouldAnimate) return null;

  const delayMs = staggerIndex * 150;

  return (
    <>
      {!isActive ? (
        <span
          key={`pulse-${delta.transitionKey}`}
          aria-hidden="true"
          className="grant-prep-stage-delta-pulse pointer-events-none absolute -inset-1 rounded-full border border-emerald-400/70 motion-reduce:hidden"
          style={animationDelayStyle(delayMs)}
        />
      ) : null}
      <span
        key={`chip-${delta.transitionKey}`}
        aria-hidden="true"
        className={clsx(
          'grant-prep-stage-delta-chip pointer-events-none absolute z-20 whitespace-nowrap rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 font-bold text-emerald-700 shadow-sm motion-reduce:hidden',
          compact
            ? 'left-full top-1/2 ml-1 -translate-y-1/2 text-[9px]'
            : 'left-full top-0 ml-1 text-[10px]'
        )}
        style={animationDelayStyle(delayMs + 60)}
      >
        {deltaChipText(delta, compact)}
      </span>
    </>
  );
}

function ReadinessPercent({
  value,
  animate,
}: {
  value: number;
  animate: boolean;
}) {
  const targetValue = clampReadiness(value);
  const [displayValue, setDisplayValue] = useState(targetValue);
  const displayValueRef = useRef(targetValue);
  const renderedValue = animate ? displayValue : targetValue;

  useEffect(() => {
    if (
      !animate ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function' ||
      typeof window.cancelAnimationFrame !== 'function'
    ) {
      displayValueRef.current = targetValue;
      setDisplayValue(targetValue);
      return;
    }

    const startValue = displayValueRef.current;
    const delta = targetValue - startValue;

    if (Math.abs(delta) < 0.001) {
      displayValueRef.current = targetValue;
      setDisplayValue(targetValue);
      return;
    }

    const startTime = performance.now();
    const durationMs = 720;
    let frameId: number | null = null;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const nextValue = startValue + delta * springProgress(progress);

      displayValueRef.current = progress >= 1 ? targetValue : nextValue;
      setDisplayValue(displayValueRef.current);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [animate, targetValue]);

  return <>{percent(renderedValue)}</>;
}

type Props = {
  prepContext: PrepContext;
  onStageChange: (stageKey: string) => void;
  disabled?: boolean;
  variant?: 'horizontal' | 'rail';
  expandOnHover?: boolean;
  className?: string;
};

export default function GrantPrepStageNavigator({
  prepContext,
  onStageChange,
  disabled,
  variant = 'horizontal',
  expandOnHover = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { deltas: stageDeltas, prefersReducedMotion } = useStageDeltas(prepContext);

  const orderedStages = useMemo(
    () => {
      const enabledVisibleStageKeysFromState = Object.values(prepContext.stageStates)
        .filter((stage) => stage.enabled && stage.pickable && isVisibleGrantPrepStageKey(stage.stageKey))
        .map((stage) => stage.stageKey);

      return sortGrantPrepStageKeys([...prepContext.enabledStageKeys, ...enabledVisibleStageKeysFromState])
        .map((key) => prepContext.stageStates[key])
        .filter((stage) => stage && stage.enabled && stage.pickable && isVisibleGrantPrepStageKey(stage.stageKey));
    },
    [prepContext]
  );

  useEffect(() => {
    const el = pillRefs.current[prepContext.activeStageKey];
    if (el) {
      el.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [prepContext.activeStageKey, prefersReducedMotion, variant]);

  const positiveDeltaOrder = useMemo(() => {
    const order: Record<string, number> = {};
    let nextIndex = 0;

    orderedStages.forEach((stage) => {
      if (stageDeltas[stage.stageKey]?.shouldAnimate) {
        order[stage.stageKey] = nextIndex;
        nextIndex += 1;
      }
    });

    return order;
  }, [orderedStages, stageDeltas]);

  if (variant === 'rail') {
    return (
      <>
        <StageAnimationStyles />
        <aside
          className={clsx(
            'prep-scrollbar group/stageRail flex h-full flex-shrink-0 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white px-1.5 py-2 shadow-prep-card transition-[width] duration-200 ease-out motion-reduce:transition-none',
            expandOnHover ? 'w-16 hover:w-72 focus-within:w-72' : 'w-16',
            className
          )}
          aria-label="Stage completion"
        >
          <div className="mb-1 w-full text-center text-[9px] font-bold uppercase tracking-wide text-slate-400">
            <span className={clsx(expandOnHover && 'group-hover/stageRail:hidden group-focus-within/stageRail:hidden')}>
              Stages
            </span>
            {expandOnHover ? (
              <span className="hidden text-left group-hover/stageRail:block group-focus-within/stageRail:block">
                Stage sequence
              </span>
            ) : null}
          </div>
          <div className="flex w-full flex-col items-center">
            {orderedStages.map((stage, index) => {
            const isActive = prepContext.activeStageKey === stage.stageKey;
            const isCompleted = stage.readiness >= 0.65;
            const needsReview = stage.status === 'needs_review';
            const isLast = index === orderedStages.length - 1;
            const delta = stageDeltas[stage.stageKey];
            const staggerIndex = positiveDeltaOrder[stage.stageKey] || 0;
            const readinessChanged = Math.abs(delta?.readinessDelta || 0) > 0.001 && !prefersReducedMotion;
            const connectorDelayMs = delta?.shouldAnimate ? staggerIndex * 150 + 120 : 0;
            const statusLabel = isActive
              ? 'Active'
              : needsReview
                ? 'Needs review'
                : isCompleted
                  ? 'Complete'
                  : 'Not started';
            const displayTitle = getGrantPrepStageTitle(stage.stageKey);
            const stageTitle = `${displayTitle} - ${percent(stage.readiness)} ready${needsReview ? ' - needs review' : ''}`;

            return (
              <div key={stage.stageKey} className="flex w-full flex-col items-center">
                <button
                  ref={(el) => {
                    pillRefs.current[stage.stageKey] = el;
                  }}
                  type="button"
                  title={stageTitle}
                  aria-label={stageTitle}
                  onClick={() => !disabled && onStageChange(stage.stageKey)}
                  disabled={disabled}
                  className={clsx(
                    'group flex w-full min-w-0 rounded-lg px-1 py-1.5 transition motion-reduce:transition-none',
                    expandOnHover
                      ? 'items-center justify-center gap-0 group-hover/stageRail:justify-start group-hover/stageRail:gap-2 group-focus-within/stageRail:justify-start group-focus-within/stageRail:gap-2'
                      : 'flex-col items-center gap-1',
                    isActive ? 'bg-emerald-50' : 'hover:bg-slate-50',
                    disabled && 'cursor-not-allowed opacity-70'
                  )}
                >
                  <span
                    className={clsx(
                      'relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-all motion-reduce:transition-none',
                      isActive
                        ? 'border-prep-accent bg-prep-accent text-white shadow-md'
                        : isCompleted
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : needsReview
                            ? 'border-rose-300 bg-rose-50 text-rose-700'
                            : 'border-slate-200 bg-white text-slate-400 group-hover:border-slate-300'
                    )}
                  >
                    {isCompleted && !isActive ? (
                      <HiCheck className="h-4 w-4" />
                    ) : needsReview && !isActive ? (
                      <HiExclamationCircle className="h-4 w-4" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                    {isActive ? (
                      <span className="absolute inset-0 animate-pulse-slow rounded-full bg-prep-accent/20 motion-reduce:hidden" />
                    ) : null}
                    <StageDeltaEffects
                      delta={delta}
                      isActive={isActive}
                      compact
                      staggerIndex={staggerIndex}
                    />
                  </span>
                  {expandOnHover ? (
                    <span className="hidden min-w-0 flex-1 text-left opacity-0 transition-opacity group-hover/stageRail:block group-hover/stageRail:opacity-100 group-focus-within/stageRail:block group-focus-within/stageRail:opacity-100 motion-reduce:transition-none">
                      <span
                        className={clsx(
                          'block whitespace-normal break-words text-[11px] font-semibold leading-4',
                          isActive ? 'text-prep-accent' : needsReview ? 'text-rose-700' : 'text-slate-700'
                        )}
                      >
                        {index + 1}. {displayTitle}
                      </span>
                      <span className="block whitespace-normal break-words text-[10px] leading-3 text-slate-500">
                        {statusLabel} -{' '}
                        <ReadinessPercent value={stage.readiness} animate={readinessChanged} /> ready
                      </span>
                    </span>
                  ) : null}
                  <span
                    className={clsx(
                      'text-[10px] font-semibold',
                      expandOnHover && 'group-hover/stageRail:hidden group-focus-within/stageRail:hidden',
                      isActive ? 'text-prep-accent' : 'text-slate-500'
                    )}
                  >
                    <ReadinessPercent value={stage.readiness} animate={readinessChanged} />
                  </span>
                </button>
                {!isLast ? (
                  <div
                    aria-hidden="true"
                    className={clsx(
                      'relative h-3 w-0.5 overflow-hidden rounded-full bg-slate-200',
                      expandOnHover && 'group-hover/stageRail:self-start group-hover/stageRail:ml-[19px] group-focus-within/stageRail:self-start group-focus-within/stageRail:ml-[19px]'
                    )}
                  >
                    <span
                      className="absolute inset-0 origin-top rounded-full bg-emerald-300 transition-transform duration-700 ease-out motion-reduce:transition-none"
                      style={{
                        transform: `scaleY(${isCompleted ? 1 : 0})`,
                        ...transitionDelayStyle(connectorDelayMs),
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
            })}
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <StageAnimationStyles />
      <div className={clsx('mb-4', className)}>
        <div ref={containerRef} className="prep-scroll-fade flex items-start gap-0 overflow-x-auto pb-2">
          {orderedStages.map((stage, index) => {
          const isActive = prepContext.activeStageKey === stage.stageKey;
          const isCompleted = stage.readiness >= 0.65;
          const needsReview = stage.status === 'needs_review';
          const isLast = index === orderedStages.length - 1;
          const displayTitle = getGrantPrepStageTitle(stage.stageKey);
          const delta = stageDeltas[stage.stageKey];
          const staggerIndex = positiveDeltaOrder[stage.stageKey] || 0;
          const readinessChanged = Math.abs(delta?.readinessDelta || 0) > 0.001 && !prefersReducedMotion;
          const connectorDelayMs = delta?.shouldAnimate ? staggerIndex * 150 + 120 : 0;

          return (
            <div key={stage.stageKey} className="flex items-start">
              <button
                ref={(el) => {
                  pillRefs.current[stage.stageKey] = el;
                }}
                type="button"
                onClick={() => !disabled && onStageChange(stage.stageKey)}
                disabled={disabled}
                className={clsx(
                  'group flex flex-col items-center gap-1.5 px-2 pt-1',
                  disabled && 'cursor-not-allowed opacity-70'
                )}
              >
                {/* Circle indicator */}
                <div
                  className={clsx(
                    'relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all motion-reduce:transition-none',
                    isActive
                      ? 'border-prep-accent bg-prep-accent text-white shadow-md'
                      : isCompleted
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : needsReview
                          ? 'border-rose-300 bg-rose-50 text-rose-700'
                          : 'border-slate-200 bg-white text-slate-400 group-hover:border-slate-300'
                  )}
                >
                  {isCompleted && !isActive ? (
                    <HiCheck className="h-4 w-4" />
                  ) : needsReview && !isActive ? (
                    <HiExclamationCircle className="h-4 w-4" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                  {isActive ? (
                    <span className="absolute inset-0 animate-pulse-slow rounded-full bg-prep-accent/20 motion-reduce:hidden" />
                  ) : null}
                  <StageDeltaEffects
                    delta={delta}
                    isActive={isActive}
                    staggerIndex={staggerIndex}
                  />
                </div>
                {/* Stage name */}
                <span
                  className={clsx(
                    'max-w-[80px] truncate text-center text-[11px] font-medium leading-tight',
                    isActive ? 'text-prep-accent' : 'text-slate-500'
                  )}
                >
                  {displayTitle}
                </span>
                {/* Readiness text */}
                <span className="text-[10px] text-prep-muted">
                  <ReadinessPercent value={stage.readiness} animate={readinessChanged} />
                </span>
              </button>
              {/* Connecting line */}
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className="relative mt-[18px] h-0.5 w-8 flex-shrink-0 overflow-hidden rounded-full bg-slate-200"
                >
                  <span
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-emerald-300 transition-transform duration-700 ease-out motion-reduce:transition-none"
                    style={{
                      transform: `scaleX(${isCompleted ? 1 : 0})`,
                      ...transitionDelayStyle(connectorDelayMs),
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
          })}
        </div>
      </div>
    </>
  );
}
