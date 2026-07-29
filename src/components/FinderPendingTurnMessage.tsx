import React from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';

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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-cobalt-600 px-4 py-2.5 text-white">
          <div className="whitespace-pre-wrap text-sm leading-6">{message}</div>
          <div className="mt-1 text-right text-[11px] text-cobalt-100">{formatTime(createdAt)}</div>
        </div>
      </div>

      <div className="flex gap-3">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            pending ? 'bg-cobalt-50 text-cobalt-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {pending ? <Sparkles className="h-3.5 w-3.5 animate-pulse" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink">{pending ? 'Finder' : 'Message not sent'}</span>
            <span className="text-[11px] text-muted-soft">{formatTime(createdAt)}</span>
          </div>

          <div className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${pending ? 'text-muted' : 'text-amber-900'}`}>
            {pending
              ? 'Searching funding calls...'
              : error || 'The finder could not complete this request. You can retry it, edit the message, or dismiss the failed turn.'}
          </div>

          {!pending ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry ? (
                <button type="button" onClick={onRetry} className="cb-btn-primary cb-btn-sm">
                  Retry
                </button>
              ) : null}
              {onEdit ? (
                <button type="button" onClick={onEdit} className="cb-btn-secondary cb-btn-sm">
                  Edit
                </button>
              ) : null}
              {onDismiss ? (
                <button type="button" onClick={onDismiss} className="cb-btn-ghost cb-btn-sm">
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
