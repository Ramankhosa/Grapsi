import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import type { PrepHandoffPreview } from './types';

type Props = {
  isOpen: boolean;
  preview: PrepHandoffPreview | null;
  overrideReason: string;
  onOverrideReasonChange: (value: string) => void;
  onClose: () => void;
  onLaunch: () => void;
  launching: boolean;
};

export default function GrantPrepHandoffModal({
  isOpen,
  preview,
  overrideReason,
  onOverrideReasonChange,
  onClose,
  onLaunch,
  launching,
}: Props) {
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
                  Review blockers before freezing the Grant Prep snapshot and launching the local Grapsi grant workspace.
                </div>

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
                      <textarea
                        value={overrideReason}
                        onChange={(event) => onOverrideReasonChange(event.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-prep-accent focus:ring-2 focus:ring-emerald-100"
                        placeholder="Override reason for launching despite blockers."
                      />
                    </>
                  )}
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
                    disabled={launching || (Boolean(preview?.blockers.length) && !overrideReason.trim())}
                    className="rounded-xl bg-prep-accent px-4 py-2 text-sm font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {launching ? 'Launching...' : 'Confirm and Launch'}
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
