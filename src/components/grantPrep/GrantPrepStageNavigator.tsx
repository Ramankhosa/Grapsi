import { useEffect, useMemo, useRef } from 'react';
import { HiCheck, HiExclamationCircle } from 'react-icons/hi2';
import type { PrepContext } from './types';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

type Props = {
  prepContext: PrepContext;
  onStageChange: (stageKey: string) => void;
  disabled?: boolean;
};

export default function GrantPrepStageNavigator({ prepContext, onStageChange, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const orderedStages = useMemo(
    () =>
      prepContext.enabledStageKeys
        .map((key) => prepContext.stageStates[key])
        .filter((stage) => stage && stage.pickable),
    [prepContext]
  );

  useEffect(() => {
    const el = pillRefs.current[prepContext.activeStageKey];
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [prepContext.activeStageKey]);

  return (
    <div className="mb-6">
      <div ref={containerRef} className="prep-scroll-fade flex items-start gap-0 overflow-x-auto pb-2">
        {orderedStages.map((stage, index) => {
          const isActive = prepContext.activeStageKey === stage.stageKey;
          const isCompleted = stage.readiness >= 0.65;
          const needsReview = stage.status === 'needs_review';
          const isLast = index === orderedStages.length - 1;

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
                    'relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all',
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
                    <span className="absolute inset-0 animate-pulse-slow rounded-full bg-prep-accent/20" />
                  ) : null}
                </div>
                {/* Stage name */}
                <span
                  className={clsx(
                    'max-w-[80px] truncate text-center text-[11px] font-medium leading-tight',
                    isActive ? 'text-prep-accent' : 'text-slate-500'
                  )}
                >
                  {stage.title}
                </span>
                {/* Readiness text */}
                <span className="text-[10px] text-prep-muted">{percent(stage.readiness)}</span>
              </button>
              {/* Connecting line */}
              {!isLast ? (
                <div
                  className={clsx(
                    'mt-[18px] h-0.5 w-8 flex-shrink-0',
                    isCompleted ? 'bg-emerald-300' : 'bg-slate-200'
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
