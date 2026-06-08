import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import type { PrepHandoffPreview } from './types';
import {
  getGrantWorkflowBadgeLabel,
  getGrantWorkflowManualDetail,
} from '@/lib/grants/workflowMode';

type Props = {
  isOpen: boolean;
  preview: PrepHandoffPreview | null;
  onClose: () => void;
  onLaunch: () => void;
  launching: boolean;
};

function percent(value: number | null | undefined) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

export default function GrantPrepHandoffModal({
  isOpen,
  preview,
  onClose,
  onLaunch,
  launching,
}: Props) {
  const previewSections = preview?.sectionPreview || [];
  const appDraftCount = previewSections.filter((section) => section.workflowMode === 'app_draft').length;
  const manualDraftCount = previewSections.length - appDraftCount;
  const generationReady = preview?.generationReady !== false;
  const overallReadiness = preview?.overallReadiness ?? null;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-2 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-2 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl rounded-2xl border border-slate-200/80 bg-white p-6 shadow-prep-float">
                <Dialog.Title className="text-lg font-semibold text-slate-900">Launch Preview</Dialog.Title>
                <div className="mt-2 text-sm text-slate-600">
                  Review the warning before freezing the Grant Prep snapshot and opening the local Grapsi grant workspace.
                </div>
                {previewSections.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Section Ownership
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      {appDraftCount} App Draft, {manualDraftCount} Manual Drafting
                    </div>
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                      {previewSections.map((section) => (
                        <div
                          key={section.sectionKey}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <span className="font-medium text-slate-900">{section.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            section.workflowMode === 'app_draft'
                              ? 'bg-emerald-100 text-emerald-800'
                              : section.workflowMode === 'app_support'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-amber-100 text-amber-900'
                          }`}>
                            {getGrantWorkflowBadgeLabel(section.workflowMode)}
                          </span>
                          {section.workflowMode !== 'app_draft' ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {getGrantWorkflowManualDetail(section.workflowMode)}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {section.sectionType}
                          </span>
                          {section.required ? (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                              Required
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 space-y-3">
                  {!preview || preview.blockers.length === 0 ? (
                    <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      No blockers remain. The snapshot is ready to launch.
                    </div>
                  ) : (
                    <>
                      {preview.blockers.map((blocker) => (
                        <div
                          key={`${blocker.stageKey}_${blocker.pointKey}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          {blocker.message}
                        </div>
                      ))}
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        You can continue without completing these Grant Prep points. The workspace will open for review and exploration, and incomplete context will be recorded in the handoff snapshot.
                      </div>
                    </>
                  )}
                  {!generationReady ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Grant Prep is {percent(overallReadiness)} complete. You can visit the blueprint and downstream stages, but generation actions will stay disabled until Grant Prep reaches {percent(preview?.generationReadinessThreshold ?? 0.5)} completion.
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={onLaunch}
                    disabled={launching}
                    className="rounded-xl bg-prep-accent px-4 py-2 text-sm font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {launching ? 'Launching...' : preview?.blockers.length ? 'Confirm warning and launch' : 'Confirm and Launch'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
