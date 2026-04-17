import { useEffect, useMemo, useState } from 'react';
import { HiExclamationTriangle, HiXMark } from 'react-icons/hi2';
import { GRANT_PREP_STAGE_BY_KEY, GRANT_PREP_STAGE_LIBRARY } from '../../lib/grantPrep/stageLibrary';
import type { GrantPrepStageKey, GrantPrepStageSelectionSource } from '../../lib/grantPrep/types';
import type { PrepContext } from './types';

type Props = {
  open: boolean;
  prepContext: PrepContext;
  busyStageKey: GrantPrepStageKey | null;
  disabled: boolean;
  onClose: () => void;
  onEnableStage: (stageKey: GrantPrepStageKey) => void | Promise<void>;
  onDisableStage: (stageKey: GrantPrepStageKey) => void | Promise<void>;
};

const CATEGORY_LABELS: Record<string, string> = {
  framing: 'Framing',
  alignment: 'Alignment',
  design: 'Design',
  delivery: 'Delivery',
};

const SOURCE_META: Record<GrantPrepStageSelectionSource, { label: string; tone: string; description: string }> = {
  template: {
    label: 'Template',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    description: 'Enabled directly from approved template evidence.',
  },
  fallback: {
    label: 'Fallback',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
    description: 'Enabled from the standard fallback structure for this mode.',
  },
  guideline: {
    label: 'Guideline',
    tone: 'border-violet-200 bg-violet-50 text-violet-800',
    description: 'Enabled from guideline or call-specific signals.',
  },
  dependency: {
    label: 'Dependency',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    description: 'Enabled because another selected stage depends on it.',
  },
  manual: {
    label: 'Manual',
    tone: 'border-slate-300 bg-slate-100 text-slate-800',
    description: 'Manually added to this session.',
  },
};

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function getEnabledDependentStageKeys(stageKey: GrantPrepStageKey, enabledStageKeys: GrantPrepStageKey[]) {
  const enabled = new Set(enabledStageKeys);
  return GRANT_PREP_STAGE_LIBRARY.filter(
    (stage) => stage.key !== stageKey && stage.pickable && enabled.has(stage.key) && stage.dependencies.includes(stageKey)
  ).map((stage) => stage.key);
}

function getStageHelper(prepContext: PrepContext, stageKey: GrantPrepStageKey) {
  const stageState = prepContext.stageStates[stageKey];
  if (stageState.enabled && stageState.selectionSource) {
    return SOURCE_META[stageState.selectionSource];
  }

  if (prepContext.manualDisabledStageKeys.includes(stageKey)) {
    return {
      label: 'Disabled',
      tone: 'border-rose-200 bg-rose-50 text-rose-700',
      description: 'Manually disabled for this session.',
    };
  }

  return {
    label: 'Not selected',
    tone: 'border-slate-200 bg-slate-50 text-slate-600',
    description: 'Not selected from current template or fallback evidence.',
  };
}

export default function GrantPrepStageEditorModal({
  open,
  prepContext,
  busyStageKey,
  disabled,
  onClose,
  onEnableStage,
  onDisableStage,
}: Props) {
  const [confirmDisableStageKey, setConfirmDisableStageKey] = useState<GrantPrepStageKey | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmDisableStageKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (confirmDisableStageKey && !prepContext.stageStates[confirmDisableStageKey]?.enabled) {
      setConfirmDisableStageKey(null);
    }
  }, [confirmDisableStageKey, prepContext.stageStates]);

  const groupedStages = useMemo(
    () =>
      Object.entries(CATEGORY_LABELS).map(([category, label]) => ({
        category,
        label,
        stages: GRANT_PREP_STAGE_LIBRARY.filter((stage) => stage.pickable && stage.category === category),
      })),
    []
  );

  const enabledPickableCount = useMemo(
    () => groupedStages.flatMap((group) => group.stages).filter((stage) => prepContext.stageStates[stage.key].enabled).length,
    [groupedStages, prepContext.stageStates]
  );

  const confirmDependents = confirmDisableStageKey
    ? getEnabledDependentStageKeys(confirmDisableStageKey, prepContext.enabledStageKeys)
    : [];
  const controlsDisabled = disabled || Boolean(busyStageKey);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-lg font-semibold text-slate-900">Edit stages</div>
            <div className="mt-1 text-sm text-slate-600">
              {enabledPickableCount} of {groupedStages.flatMap((group) => group.stages).length} pickable stages are active.
            </div>
            {prepContext.stageSelectionVersion === 'v1' ? (
              <div className="mt-2 text-xs font-medium text-amber-700">
                Saving a change will upgrade this session to v2 stage selection.
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close stage editor"
          >
            <HiXMark className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {groupedStages.map((group) => (
              <section key={group.category} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {group.label}
                </div>
                <div className="space-y-3">
                  {group.stages.map((stage) => {
                    const stageState = prepContext.stageStates[stage.key];
                    const helper = getStageHelper(prepContext, stage.key);
                    const dependentTitles = getEnabledDependentStageKeys(stage.key, prepContext.enabledStageKeys).map(
                      (stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey].title
                    );
                    const dependencyTitles = stage.dependencies.map((stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey].title);
                    const isBusy = busyStageKey === stage.key;

                    return (
                      <div key={stage.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900">{stage.title}</div>
                              <span
                                className={clsx(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                  stageState.enabled
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-500'
                                )}
                              >
                                {stageState.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                              <span
                                className={clsx(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                                  helper.tone
                                )}
                              >
                                {helper.label}
                              </span>
                            </div>
                            <div className="mt-1 text-sm text-slate-600">{stage.description}</div>
                            <div className="mt-2 text-xs text-slate-500">{helper.description}</div>
                            {dependencyTitles.length > 0 ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Depends on: {dependencyTitles.join(', ')}
                              </div>
                            ) : null}
                            {dependentTitles.length > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">
                                Downstream stages still enabled: {dependentTitles.join(', ')}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (stageState.enabled) {
                                if (dependentTitles.length > 0) {
                                  setConfirmDisableStageKey(stage.key);
                                  return;
                                }
                                void onDisableStage(stage.key);
                                return;
                              }

                              setConfirmDisableStageKey(null);
                              void onEnableStage(stage.key);
                            }}
                            disabled={controlsDisabled}
                            className={clsx(
                              'shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                              stageState.enabled
                                ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                            )}
                          >
                            {isBusy ? 'Saving...' : stageState.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {confirmDisableStageKey ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <HiExclamationTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-amber-900">
                    Disable {GRANT_PREP_STAGE_BY_KEY[confirmDisableStageKey].title}?
                  </div>
                  <div className="mt-1 text-sm text-amber-800">
                    These enabled downstream stages depend on it: {confirmDependents.map((stageKey) => GRANT_PREP_STAGE_BY_KEY[stageKey].title).join(', ')}.
                    They will stay enabled, but may need review after you disable this stage.
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDisableStageKey(null)}
                  disabled={controlsDisabled}
                  className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const stageKey = confirmDisableStageKey;
                    setConfirmDisableStageKey(null);
                    if (stageKey) {
                      void onDisableStage(stageKey);
                    }
                  }}
                  disabled={controlsDisabled}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Disable stage
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
