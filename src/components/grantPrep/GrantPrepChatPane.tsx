import type { ChangeEvent, FocusEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HiExclamationTriangle, HiPaperAirplane, HiSparkles } from 'react-icons/hi2';
import type { PointLookup, PrepMessage } from './types';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function asStringArray(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

type Props = {
  messages: PrepMessage[];
  sending: boolean;
  sendCooldown?: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry?: (content: string) => void;
  sessionLocked: boolean;
  pointLookup: PointLookup;
  currentPointLabel?: string | null;
  activeStageTitle?: string;
  activeStageDescription?: string;
  pendingPoints?: Array<{ key: string; label: string; helpText?: string }>;
};

function SteeringBanner({ level, message }: { level: string; message: string }) {
  const tone =
    level === 'hard_block'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : level === 'gentle_redirect'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-blue-200 bg-blue-50 text-blue-800';

  return <div className={clsx('rounded-lg border px-3 py-2 text-xs', tone)}>{message}</div>;
}

/**
 * Strip inline answer options (A., B., C. lines) from message text when
 * the structured `suggested_answers` cards will be shown instead.
 * Only applied to the last assistant message to avoid duplicate display.
 */
function stripInlineOptions(text: string): string {
  // Match lines starting with **A.**, **B.**, A., B., A), B) etc.
  // Also matches a preceding "header" line like "Suggested answers:" or "Options:" if present.
  const optionBlockPattern = /\n*(?:(?:\*{0,2}(?:suggested|possible|choose|options?)[^:\n]*:\*{0,2}\s*\n))?(?:\s*\*{0,2}[A-C][.)]\*{0,2}\s.+(?:\n|$))+/gi;
  return text.replace(optionBlockPattern, '').trimEnd();
}

function MessageBubble({ message, pointLookup, isLast = false }: { message: PrepMessage; pointLookup: PointLookup; isLast?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rawContent = message.content || '';

  // Strip inline options from the last assistant message when cards will render below
  const hasStructuredOptions = isLast && message.role !== 'user' && Array.isArray(message.suggested_answers) && message.suggested_answers.length > 0;
  const content = hasStructuredOptions ? stripInlineOptions(rawContent) : rawContent;

  const shouldCollapse = content.length > 320;
  const displayText = shouldCollapse && !expanded ? `${content.slice(0, 320).trimEnd()}...` : content;
  const capturedPoints = Array.isArray(message.captured_content_json) ? message.captured_content_json : [];
  const steeringEvents = Array.isArray(message.steering_events_json) ? message.steering_events_json : [];

  return (
    <div className={clsx('flex gap-2.5', message.role === 'user' ? 'justify-end' : 'justify-start')}>
      {message.role !== 'user' ? (
        <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <HiSparkles className="h-3.5 w-3.5 text-prep-accent" />
        </div>
      ) : null}
      <div
        className={clsx(
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
          message.role === 'user'
            ? 'bg-prep-chatUser text-white shadow-sm'
            : 'border border-slate-100 bg-prep-chatAssistant text-slate-800 shadow-prep-card'
        )}
      >
        <div className="prose prose-sm max-w-none text-inherit prose-p:my-1 prose-headings:text-inherit prose-strong:text-inherit prose-code:text-inherit">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
        </div>
        {shouldCollapse ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className={clsx(
              'mt-2 text-xs font-semibold',
              message.role === 'user' ? 'text-white/70' : 'text-prep-accent'
            )}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}

        {message.role !== 'user' && capturedPoints.length > 0 ? (
          <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
            <div className="mb-2 font-semibold">Captured this turn</div>
            <div className="space-y-2">
              {capturedPoints.map((capture) => {
                const pointLabel = pointLookup[capture.pointKey]?.label || capture.pointKey;
                return (
                  <div key={`${message.id}_${capture.pointKey}`}>
                    <div className="font-medium">{pointLabel}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asStringArray(capture.keywords).map((keyword) => (
                        <span
                          key={`${capture.pointKey}_${keyword}`}
                          className="rounded-md bg-white px-2 py-1 text-[11px] ring-1 ring-emerald-100"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {message.role !== 'user' && steeringEvents.length > 0 ? (
          <div className="mt-3 space-y-2">
            {steeringEvents.map((event, index) => (
              <SteeringBanner
                key={`${message.id}_${event.pointKey || 'stage'}_${index}`}
                level={event.level}
                message={event.message}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function GrantPrepChatPane({
  messages,
  sending,
  sendCooldown,
  input,
  onInputChange,
  onSend,
  onRetry,
  sessionLocked,
  pointLookup,
  currentPointLabel,
  activeStageTitle,
  activeStageDescription,
  pendingPoints,
}: Props) {
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // EC-2: auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(event.target.value.slice(0, 4000));
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
  };

  // EC-8: consistent height value
  const resetTextAreaHeight = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (!event.target.value) {
      event.target.style.height = '44px';
    }
  };

  const handleSend = () => {
    if (!sending && !sendCooldown && !sessionLocked && input.trim()) {
      onSend();
      if (chatInputRef.current) chatInputRef.current.style.height = '44px';
    }
  };

  const isInputDisabled = sessionLocked || !!sendCooldown;
  const canSend = !sending && !sendCooldown && !!input.trim() && !sessionLocked;
  const hasOrphanMessage =
    messages.length > 0 && messages[messages.length - 1].role === 'user' && !sending;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200/80 bg-white shadow-prep-card">
      {/* Messages area */}
      <div className="prep-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
              <HiSparkles className="h-7 w-7 text-prep-accent" />
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900">
                {activeStageTitle ? `Let\u2019s work on ${activeStageTitle}` : "Let\u2019s prepare your grant"}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {activeStageDescription || "Answer a few questions for each stage. I\u2019ll capture the key points as we go."}
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {pendingPoints && pendingPoints.length > 0 ? (
                pendingPoints.slice(0, 3).map((point) => (
                  <button
                    key={point.key}
                    type="button"
                    onClick={() => onInputChange(point.helpText || `Tell me about ${point.label.toLowerCase()}`)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-prep-card transition-shadow hover:shadow-prep-card-hover"
                  >
                    {point.label}
                  </button>
                ))
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onInputChange('Here is what my project is about...')}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-prep-card transition-shadow hover:shadow-prep-card-hover"
                  >
                    Describe my project
                  </button>
                  <button
                    type="button"
                    onClick={() => onInputChange('The main problem we address is...')}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-prep-card transition-shadow hover:shadow-prep-card-hover"
                  >
                    State the problem
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={message.id}>
              <MessageBubble message={message} pointLookup={pointLookup} isLast={index === messages.length - 1} />

              {/* B9: Answer Option Cards — only on last assistant message */}
              {message.role !== 'user' &&
                index === messages.length - 1 &&
                Array.isArray(message.suggested_answers) &&
                message.suggested_answers.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2 pl-9">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Suggested answers &mdash; tap to use, or write your own
                  </div>
                  {message.suggested_answers.map((option, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onInputChange(option.text)}
                      disabled={sessionLocked}
                      className="group relative rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 shadow-prep-card transition-all hover:border-emerald-300 hover:shadow-prep-card-hover disabled:opacity-50"
                    >
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                        {option.label}
                      </span>
                      {option.text}
                      {option.rationale ? (
                        <span className="mt-1 block text-[11px] italic text-slate-400">
                          {option.rationale}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* B3: Follow-Up Suggestion Chips — only on last assistant message */}
              {message.role !== 'user' &&
                index === messages.length - 1 &&
                Array.isArray(message.suggested_follow_ups) &&
                message.suggested_follow_ups.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2 pl-9">
                  {message.suggested_follow_ups.slice(0, 3).map((suggestion, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onInputChange(suggestion)}
                      disabled={sessionLocked}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-prep-card transition-shadow hover:shadow-prep-card-hover disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}

        {/* EC-1: orphan message indicator */}
        {hasOrphanMessage ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <HiExclamationTriangle className="h-4 w-4 flex-shrink-0" />
              <span>Response failed.</span>
              {onRetry ? (
                <button
                  type="button"
                  onClick={() => onRetry(messages[messages.length - 1].content)}
                  className="font-semibold text-amber-900 underline decoration-amber-300 hover:decoration-amber-500"
                >
                  Tap to retry
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Sending indicator */}
        {sending ? (
          <div className="flex justify-start gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <HiSparkles className="h-3.5 w-3.5 text-prep-accent" />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-prep-card">
              <div className="flex space-x-1.5">
                {[0, 0.15, 0.3].map((delay, index) => (
                  <div
                    key={index}
                    className="h-2 w-2 animate-pulse rounded-full bg-slate-400"
                    style={{ animationDelay: `${delay}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-100 bg-white px-4 py-3">
        {sessionLocked ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-500">This session is locked.</span>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-prep-inputBg px-3 py-2 focus-within:border-prep-accent focus-within:ring-2 focus-within:ring-emerald-100">
              <textarea
                ref={chatInputRef}
                value={input}
                onChange={handleTextAreaChange}
                onBlur={resetTextAreaHeight}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                disabled={isInputDisabled}
                className="flex-1 resize-none bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed"
                style={{ minHeight: '44px', maxHeight: '200px' }}
                placeholder={currentPointLabel ? `Tell me about ${currentPointLabel.toLowerCase()}...` : 'Type your response...'}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className={clsx(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
                  canSend
                    ? 'bg-prep-accent text-white hover:bg-prep-accentDark'
                    : 'bg-slate-100 text-slate-400'
                )}
              >
                <HiPaperAirplane className="h-4 w-4" />
              </button>
            </div>
            {input.length > 3500 ? (
              <div className="mt-1 text-right text-xs text-slate-400">{input.length}/4000</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
