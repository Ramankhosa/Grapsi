import React from 'react';
import { FaExclamationTriangle, FaRobot, FaUserCircle } from 'react-icons/fa';

interface FinderPendingTurnMessageProps {
  createdAt: string;
  message: string;
  status: 'pending' | 'failed';
  error?: string | null;
  onRetry?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FinderPendingTurnMessage({
  createdAt,
  message,
  status,
  error,
  onRetry,
  onEdit,
  onDismiss,
}: FinderPendingTurnMessageProps) {
  const pending = status === 'pending';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-end gap-4">
        <div className="max-w-[92%] rounded-[26px] border border-slate-950 bg-[linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#052e2b_100%)] px-5 py-4 text-white shadow-[0_18px_42px_rgba(15,23,42,0.26)]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">You</div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-100/70">{formatTime(createdAt)}</div>
          </div>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white">{message}</div>
        </div>
        <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <FaUserCircle />
        </div>
      </div>

      <div className="flex items-start gap-4">
        <div
          className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            pending ? 'bg-emerald-500 text-slate-950' : 'bg-amber-200 text-amber-900'
          }`}
        >
          {pending ? <FaRobot /> : <FaExclamationTriangle />}
        </div>

        <div
          className={`max-w-[92%] rounded-[26px] border px-5 py-4 shadow-sm ${
            pending ? 'border-white/60 bg-white/92 text-slate-900' : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div
              className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                pending ? 'text-emerald-700' : 'text-amber-800'
              }`}
            >
              {pending ? 'GrantGenie Finder' : 'Message Not Sent'}
            </div>
            <div className={`text-[11px] uppercase tracking-[0.16em] ${pending ? 'text-slate-400' : 'text-amber-700/70'}`}>
              {formatTime(createdAt)}
            </div>
          </div>

          <div className={`mt-3 whitespace-pre-wrap text-sm leading-7 ${pending ? 'text-slate-700' : 'text-amber-950'}`}>
            {pending
              ? 'Searching funding calls...'
              : error || 'The finder could not complete this request. You can retry it, edit the message, or dismiss the failed turn.'}
          </div>

          {!pending ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-full bg-amber-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-950 transition-colors hover:bg-amber-400"
                >
                  Retry
                </button>
              ) : null}
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="rounded-full border border-amber-300 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 transition-colors hover:bg-amber-100"
                >
                  Edit
                </button>
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-full border border-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 transition-colors hover:bg-amber-100"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
