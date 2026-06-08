import React, { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HiArrowsPointingIn, HiArrowsPointingOut, HiExclamationTriangle, HiPaperAirplane, HiSparkles } from 'react-icons/hi2';
import type { PrepMessage } from './types';
import {
  mergeGrantPrepSuggestedAnswersWithInline,
  removeGrantPrepApprovalBundlePrefix,
} from '@/lib/grantPrep/suggestedAnswers';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type SuggestedAnswer = NonNullable<PrepMessage['suggested_answers']>[number];

type Props = {
  messages: PrepMessage[];
  sending: boolean;
  sendCooldown?: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (contentOverride?: string, selectedSuggestedAnswer?: SuggestedAnswer) => void;
  onRetry?: (content: string) => void;
  sessionLocked: boolean;
  currentPointLabel?: string | null;
  activeStageKey?: string;
  activeStageTitle?: string;
  activeStageDescription?: string;
  pendingPoints?: Array<{ key: string; label: string; helpText?: string }>;
  onLockIdeation?: () => void | Promise<void>;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
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

function buildOptionCombinations(options: SuggestedAnswer[]) {
  const usableOptions = options
    .filter((option) => option?.label && option?.text)
    .slice(0, 3);
  const combinations: Array<{ label: string; text: string }> = [];

  for (let i = 0; i < usableOptions.length; i += 1) {
    for (let j = i + 1; j < usableOptions.length; j += 1) {
      const selected = [usableOptions[i], usableOptions[j]];
      combinations.push({
        label: `${selected[0].label} + ${selected[1].label}`,
        text: `Combined options ${selected[0].label} and ${selected[1].label}:\n\n${selected
          .map((option) => `${option.label}. ${option.text}`)
          .join('\n\n')}`,
      });
    }
  }

  if (usableOptions.length > 2) {
    combinations.push({
      label: 'All options',
      text: `Combined options ${usableOptions.map((option) => option.label).join(', ')}:\n\n${usableOptions
        .map((option) => `${option.label}. ${option.text}`)
        .join('\n\n')}`,
    });
  }

  return combinations;
}

/**
 * Strip inline answer options (A., B., C. lines) from message text when
 * the structured `suggested_answers` cards will be shown instead.
 * Only applied to the last assistant message to avoid duplicate display.
 */
function stripInlineOptions(text: string): string {
  const firstOption = text.search(/(^|[\s\r\n])(?:[-*]\s*)?\*{0,2}(?:(?:option|direction)\s+)?[A-C](?:[.):]|\s*[-\u2013\u2014])\*{0,2}\s+/i);
  if (firstOption === -1) {
    return text.trimEnd();
  }

  const headerStart = text
    .slice(0, firstOption)
    .search(/\n\s*\*{0,2}(?:suggested|possible|choose|options?)[^:\n]*:\*{0,2}\s*$/i);
  const cutAt = headerStart >= 0 ? headerStart : firstOption;
  return text.slice(0, cutAt).trimEnd();
}

function MessageBubble({
  message,
  isLast = false,
  structuredAnswerCount = 0,
}: {
  message: PrepMessage;
  isLast?: boolean;
  structuredAnswerCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rawContent = message.role === 'user'
    ? message.content || ''
    : removeGrantPrepApprovalBundlePrefix(message.content || '');

  // Strip inline options from the last assistant message when cards will render below
  const hasStructuredOptions = isLast && message.role !== 'user' && structuredAnswerCount > 0;
  const content = hasStructuredOptions ? stripInlineOptions(rawContent) : rawContent;

  const shouldCollapse = content.length > 320;
  const displayText = shouldCollapse && !expanded ? `${content.slice(0, 320).trimEnd()}...` : content;
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
  currentPointLabel,
  activeStageKey,
  activeStageTitle,
  activeStageDescription,
  pendingPoints,
  onLockIdeation,
  onToggleFullscreen,
  isFullscreen = false,
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
  const isIdeationStage = activeStageKey === 'ideation';
  const hasOrphanMessage =
    messages.length > 0 && messages[messages.length - 1].role === 'user' && !sending;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200/80 bg-white shadow-prep-card">
      {/* Messages area */}
      <div className="prep-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
              <HiSparkles className="h-7 w-7 text-prep-accent" />
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-900">
                {isIdeationStage
                  ? 'Shape the idea and angle'
                  : activeStageTitle
                    ? `Let\u2019s work on ${activeStageTitle}`
                    : "Let\u2019s prepare your grant"}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {isIdeationStage
                  ? 'Share the idea you are considering. I will help sharpen the angle before the prep stages.'
                  : activeStageDescription || "Answer a few questions for each stage. I\u2019ll capture the key points as we go."}
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
          messages.map((message, index) => {
            const isLastAssistant = message.role !== 'user' && index === messages.length - 1;
            const structuredAnswers = mergeGrantPrepSuggestedAnswersWithInline(
              Array.isArray(message.suggested_answers) ? message.suggested_answers : [],
              message.content || ''
            );
            const hasStructuredAnswers = isLastAssistant && structuredAnswers.length > 0;
            const optionCombinations = hasStructuredAnswers && !isIdeationStage
              ? buildOptionCombinations(structuredAnswers)
              : [];

            return (
            <div key={message.id}>
              <MessageBubble
                message={message}
                isLast={index === messages.length - 1}
                structuredAnswerCount={hasStructuredAnswers ? structuredAnswers.length : 0}
              />

              {/* B9: Answer Option Cards — only on last assistant message */}
              {hasStructuredAnswers ? (
                <div className="mt-3 flex flex-col gap-2 pl-9">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {isIdeationStage
                      ? 'Idea directions - explore one, edit it, or write your own'
                      : 'Approval bundles - approve as-is, edit, or write your own'}
                  </div>
                  {structuredAnswers.map((option, i) => (
                    <div
                      key={i}
                      className="group relative rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 shadow-prep-card transition-all hover:border-emerald-300 hover:shadow-prep-card-hover"
                    >
                      <button
                        type="button"
                        onClick={() => onInputChange(option.text)}
                        disabled={sessionLocked}
                        className="w-full whitespace-pre-line text-left leading-relaxed disabled:opacity-50"
                      >
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                          {option.label}
                        </span>
                        {option.text}
                      </button>
                      {option.coverageSummary || (Array.isArray(option.covers) && option.covers.length > 0) ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {option.coverageSummary ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              {option.coverageSummary}
                            </span>
                          ) : null}
                          {Array.isArray(option.covers) ? option.covers.slice(0, 4).map((cover) => (
                            <span
                              key={`${option.label}_${cover.stageKey}_${cover.pointKey}`}
                              className="rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-600 ring-1 ring-slate-200"
                            >
                              {cover.label}
                            </span>
                          )) : null}
                        </div>
                      ) : null}
                      {option.rationale ? (
                        <span className="mt-1 block text-[11px] italic text-slate-400">
                          {option.rationale}
                        </span>
                      ) : null}
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onInputChange(option.text)}
                          disabled={sessionLocked}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {isIdeationStage ? 'Edit direction' : 'Edit bundle'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSend(option.text, option)}
                          disabled={sessionLocked || sending || !!sendCooldown}
                          className="rounded-lg bg-prep-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isIdeationStage ? 'Explore this direction' : 'Approve and send'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {optionCombinations.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {optionCombinations.map((combination) => (
                        <button
                          key={combination.label}
                          type="button"
                          onClick={() => onInputChange(combination.text)}
                          disabled={sessionLocked}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-prep-card transition hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {combination.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* B3: Follow-Up Suggestion Chips — only on last assistant message */}
              {isLastAssistant &&
                !hasStructuredAnswers &&
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
            );
          })
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
            {isIdeationStage && onLockIdeation ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                <span className="text-xs font-medium text-emerald-900">
                  Ready to move from idea shaping into proposal prep?
                </span>
                <button
                  type="button"
                  onClick={() => onLockIdeation()}
                  disabled={sending || !!sendCooldown}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Lock it in & continue
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="flex flex-1 items-end gap-2 rounded-xl border border-slate-200 bg-prep-inputBg px-3 py-2 focus-within:border-prep-accent focus-within:ring-2 focus-within:ring-emerald-100">
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
              {onToggleFullscreen ? (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
                  title={isFullscreen ? 'Exit full screen chat' : 'Full screen chat'}
                >
                  {isFullscreen ? <HiArrowsPointingIn className="h-4 w-4" /> : <HiArrowsPointingOut className="h-4 w-4" />}
                </button>
              ) : null}
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
