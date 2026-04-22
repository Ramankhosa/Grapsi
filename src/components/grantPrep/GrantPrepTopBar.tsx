import Link from 'next/link';
import { Menu, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import {
  HiArrowPath,
  HiCheck,
  HiChevronLeft,
  HiEllipsisVertical,
  HiXMark,
} from 'react-icons/hi2';
import type { GrantPrepLayoutMode, PrepContext, PrepEngagementMode, PrepSession } from './types';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

type Props = {
  session: PrepSession;
  prepContext: PrepContext;
  overallReadiness: number;
  sessionLocked: boolean;
  layoutMode: GrantPrepLayoutMode;
  isContextOpen: boolean;
  actioning: null | 'refresh' | 'restart' | 'archive';
  warning?: string | null;
  handoffError?: string | null;
  pendingReviewCount: number;
  activeStageTitle: string;
  stageEditorDisabled: boolean;
  onRefreshMapping: () => void;
  onRestartPrep: () => void;
  onArchivePrep: () => void;
  onOpenStageEditor: () => void;
  onEngagementModeChange: (mode: PrepEngagementMode) => void;
  onToggleContext: () => void;
};

const engagementModes: Array<{ key: PrepEngagementMode; label: string; description: string }> = [
  { key: 'expert', label: 'Expert', description: 'Reviewer-rigorous discussion with stricter progression.' },
  { key: 'express', label: 'Express', description: 'Faster capture from a short pitch or pasted draft.' },
];

export default function GrantPrepTopBar({
  session,
  prepContext,
  overallReadiness,
  sessionLocked,
  layoutMode,
  isContextOpen,
  actioning,
  warning,
  handoffError,
  pendingReviewCount,
  activeStageTitle,
  stageEditorDisabled,
  onRefreshMapping,
  onRestartPrep,
  onArchivePrep,
  onOpenStageEditor,
  onEngagementModeChange,
  onToggleContext,
}: Props) {
  const showContextToggle = layoutMode !== 'desktop';

  return (
    <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
        {/* Left: breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/projects/${session.project.id}/grants`}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Back to project"
          >
            <HiChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900" title={session.project.project_title}>
              {session.project.project_title}
            </div>
            <div className="text-xs text-prep-muted">
              Grant Prep {'\u00b7'} {activeStageTitle} {'\u00b7'}{' '}
              {pendingReviewCount > 0 ? `${pendingReviewCount} to review` : 'No reviews pending'}
            </div>
          </div>
        </div>

        {/* Right: pills + readiness + actions */}
        <div className="flex items-center gap-3">
          {/* Engagement mode pills (hidden on mobile) */}
          <div className="hidden items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 sm:flex">
            {engagementModes.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => onEngagementModeChange(mode.key)}
                disabled={sessionLocked}
                title={mode.description}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  prepContext.engagementMode === mode.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                  sessionLocked && 'cursor-not-allowed opacity-60'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Readiness ring */}
          <div className="flex items-center gap-2" title={`${percent(overallReadiness)} overall readiness`}>
            <svg className="h-8 w-8" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke={overallReadiness >= 0.65 ? '#059669' : overallReadiness >= 0.3 ? '#f59e0b' : '#94a3b8'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${overallReadiness * 94.25} 94.25`}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{percent(overallReadiness)}</span>
          </div>

          {/* Refresh button */}
          {!sessionLocked ? (
            <button
              type="button"
              onClick={onRefreshMapping}
              disabled={actioning !== null}
              title="Re-sync with your latest proposal content"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <HiArrowPath className={clsx('h-4 w-4', actioning === 'refresh' && 'animate-spin')} />
            </button>
          ) : null}

          {/* Context toggle (tablet/mobile) */}
          {showContextToggle ? (
            <button
              type="button"
              onClick={onToggleContext}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              title={isContextOpen ? 'Hide context panel' : 'Show context panel'}
            >
              {isContextOpen ? <HiXMark className="h-4 w-4" /> : <span className="text-xs font-semibold">+</span>}
            </button>
          ) : null}

          {/* Open local grant workspace */}
          {session.papsi_launch_url ? (
            <a
              href={session.papsi_launch_url}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Grant Workspace
            </a>
          ) : null}

          {/* Three-dot menu */}
          <Menu as="div" className="relative">
            <Menu.Button className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50">
              <HiEllipsisVertical className="h-5 w-5" />
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-in"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <Menu.Items className="absolute right-0 z-20 mt-2 w-64 origin-top-right rounded-xl border border-slate-200 bg-white p-2 shadow-prep-float focus:outline-none">
                {/* Engagement modes in menu on mobile only */}
                {layoutMode === 'mobile' ? (
                  <>
                    <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Engagement mode
                    </div>
                    {engagementModes.map((mode) => (
                      <Menu.Item key={mode.key}>
                        {({ active }) => (
                          <button
                            type="button"
                            onClick={() => onEngagementModeChange(mode.key)}
                            disabled={sessionLocked}
                            className={clsx(
                              'mb-1 flex w-full items-start justify-between rounded-lg px-3 py-2 text-left',
                              active ? 'bg-slate-50' : 'bg-white',
                              sessionLocked && 'cursor-not-allowed opacity-60'
                            )}
                          >
                            <div>
                              <div className="text-sm font-medium text-slate-900">{mode.label}</div>
                              <div className="text-xs text-slate-500">{mode.description}</div>
                            </div>
                            {prepContext.engagementMode === mode.key ? (
                              <HiCheck className="mt-0.5 h-4 w-4 text-emerald-700" />
                            ) : null}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                    <div className="my-2 border-t border-slate-200" />
                  </>
                ) : null}

                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={onOpenStageEditor}
                      disabled={stageEditorDisabled}
                      className={clsx(
                        'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700',
                        active ? 'bg-slate-50' : 'bg-white',
                        stageEditorDisabled && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
                      Edit stages
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={onRestartPrep}
                      disabled={actioning !== null}
                      className={clsx(
                        'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700',
                        active ? 'bg-slate-50' : 'bg-white',
                        actioning !== null && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <HiArrowPath className="h-4 w-4" />
                      {actioning === 'restart' ? 'Restarting...' : 'Restart Prep'}
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={onArchivePrep}
                      disabled={actioning !== null}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700',
                        active ? 'bg-slate-50' : 'bg-white',
                        actioning !== null && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <HiXMark className="h-4 w-4" />
                      {actioning === 'archive' ? 'Archiving...' : 'Archive and Exit'}
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </div>

      {/* Warning/error banners */}
      {warning ? (
        <div className="border-t border-amber-100 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 sm:px-6 lg:px-8">
          {warning}
        </div>
      ) : null}
      {handoffError ? (
        <div className="border-t border-rose-100 bg-rose-50/80 px-4 py-2 text-sm text-rose-800 sm:px-6 lg:px-8">
          Last launch issue: {handoffError}
        </div>
      ) : null}
    </div>
  );
}
