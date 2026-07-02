import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ChangeEvent, FocusEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HiArrowsPointingIn, HiArrowsPointingOut, HiExclamationTriangle, HiPaperAirplane, HiSparkles } from 'react-icons/hi2';
import type { PrepIdeationContext, PrepIdeationDecision, PrepMessage } from './types';
import {
  mergeGrantPrepSuggestedAnswersWithInline,
  removeGrantPrepApprovalBundlePrefix,
} from '@/lib/grantPrep/suggestedAnswers';
import {
  buildGrantPrepResearchAreaRecommendationMessage,
  buildGrantPrepPublicationRecommendationMessage,
  buildGrantPrepSavedPublicationRecommendationMessage,
  GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST,
  GRANT_PREP_IDEA_RECOMMENDATION_REQUEST,
  GRANT_PREP_MAX_IDEATION_PUBLICATIONS,
  GRANT_PREP_MORE_IDEAS_REQUEST,
  parseGrantPrepPublicationLines,
} from '@/lib/grantPrep/ideationRecommendations';

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type SuggestedAnswer = NonNullable<PrepMessage['suggested_answers']>[number];

type StageTransitionContext = {
  ideaSummary?: string | null;
  problemSummary?: string | null;
  problemReady?: boolean;
};

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
  stageTransitionContext?: StageTransitionContext;
  ideationContext?: PrepIdeationContext | null;
  ideationDecision?: PrepIdeationDecision | null;
  onFinalizeIdeation?: (messageId: string, option: SuggestedAnswer) => void | Promise<void>;
  onPreviewTypedIdea?: (ideaText: string) => Promise<{
    anchor: PrepIdeationDecision['anchor'];
    anchorHash: string;
    compilationSource: PrepIdeationDecision['compilationSource'];
  }>;
  onFinalizeTypedIdea?: (ideaText: string, preview: {
    anchor: PrepIdeationDecision['anchor'];
    anchorHash: string;
    compilationSource: PrepIdeationDecision['compilationSource'];
  }) => void | Promise<void>;
  finalizingIdeation?: boolean;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
};

type PendingPoint = { key: string; label: string; helpText?: string };
type IdeationResearchArea = NonNullable<PrepIdeationContext>['savedResearchAreas'][number];
type IdeationPublication = NonNullable<PrepIdeationContext>['publications'][number];

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
        label: `${selected[0].label}+${selected[1].label}`,
        text: `${selected
          .map((option) => `${option.label}. ${option.text}`)
          .join('\n\n')}`,
      });
    }
  }

  if (usableOptions.length > 2) {
    combinations.push({
      label: 'All Three',
      text: `${usableOptions
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

function buildStageAnswerPrompt(activeStageTitle: string | undefined, points: PendingPoint[]) {
  const title = activeStageTitle || 'this stage';
  return [
    `For ${title}, here are the details I can provide:`,
    '',
    ...points.map((point) => {
      const helpText = point.helpText ? ` (${point.helpText})` : '';
      return `- ${point.label}${helpText}: `;
    }),
  ].join('\n');
}

function buildAiSuggestionPrompt(activeStageTitle: string | undefined, points: PendingPoint[]) {
  const title = activeStageTitle || 'this stage';
  const pointList = points.map((point) => point.label).join(', ');
  return [
    `Suggest the most suitable answers for ${title} using the selected direction, problem, funding call, and prior prep context.`,
    pointList ? `Focus on: ${pointList}.` : '',
    'If you infer anything, mark it as an assumption and give me editable options to confirm.',
  ]
    .filter(Boolean)
    .join(' ');
}

function truncateCardText(value: string | null | undefined, maxLength = 170) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function getResearchAreaTitle(area: IdeationResearchArea) {
  return area.label || area.researchArea || 'Research area';
}

function getPublicationMeta(publication: IdeationPublication) {
  return [publication.year ? String(publication.year) : null, publication.venue, publication.doi ? `DOI ${publication.doi}` : null]
    .filter(Boolean)
    .join(' | ');
}

function StageTransitionStarterCard({
  activeStageKey,
  activeStageTitle,
  pendingPoints,
  stageTransitionContext,
  onAnswerInTextBox,
  onSend,
  disabled,
}: {
  activeStageKey?: string;
  activeStageTitle?: string;
  pendingPoints?: PendingPoint[];
  stageTransitionContext?: StageTransitionContext;
  onAnswerInTextBox: (value: string) => void;
  onSend: (contentOverride?: string) => void;
  disabled?: boolean;
}) {
  const isProblemDefinition = activeStageKey === 'problem_definition';
  const pointsNeedingInput = (pendingPoints || []).slice(0, 5);
  if (pointsNeedingInput.length === 0) {
    return null;
  }

  const heading = isProblemDefinition
    ? 'Now let\'s work on the problem specifics'
    : `Next, connect this to ${activeStageTitle || 'the next stage'}`;
  const body = isProblemDefinition
    ? 'Now that the grant direction is clear, answer the items below in one message so the problem is ready for reviewers.'
    : `The direction and problem are set. Answer the items below for ${activeStageTitle || 'this stage'} in one message, or let AI suggest draft answers from the existing context.`;

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 shadow-prep-card">
      <div className="text-sm font-semibold text-emerald-950">{heading}</div>
      <div className="mt-1 text-sm leading-5 text-emerald-900">{body}</div>
      {stageTransitionContext?.ideaSummary ? (
        <div className="mt-2 rounded-lg bg-white/75 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-100">
          <span className="font-semibold">Direction:</span> {stageTransitionContext.ideaSummary}
        </div>
      ) : null}
      {!isProblemDefinition && stageTransitionContext?.problemSummary ? (
        <div className="mt-2 rounded-lg bg-white/75 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-100">
          <span className="font-semibold">Problem:</span> {stageTransitionContext.problemSummary}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-emerald-100 bg-white/80 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">What to answer next</div>
        <ul className="mt-1.5 space-y-1.5 text-xs leading-5 text-emerald-950">
          {pointsNeedingInput.map((point) => (
            <li key={point.key}>
              <span className="font-semibold">{point.label}:</span>{' '}
              {point.helpText || `Provide the specific details reviewers need for ${point.label.toLowerCase()}.`}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswerInTextBox(buildStageAnswerPrompt(activeStageTitle, pointsNeedingInput))}
          disabled={disabled}
          className="rounded-lg bg-prep-accent px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Answer these in text box
        </button>
        <button
          type="button"
          onClick={() => onSend(buildAiSuggestionPrompt(activeStageTitle, pointsNeedingInput))}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <HiSparkles className="h-3.5 w-3.5" />
          Let AI suggest answers
        </button>
      </div>
    </div>
  );
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

function IdeationStartCard({
  sending,
  sendCooldown,
  sessionLocked,
  ideationContext,
  onInputChange,
  onSend,
}: {
  sending: boolean;
  sendCooldown?: boolean;
  sessionLocked: boolean;
  ideationContext?: PrepIdeationContext | null;
  onInputChange: (value: string) => void;
  onSend: (contentOverride?: string) => void;
}) {
  const [publicationInput, setPublicationInput] = useState('');
  const [manualOpen, setManualOpen] = useState(!ideationContext?.hasUsableContext);
  const [error, setError] = useState<string | null>(null);
  const hasContext = ideationContext?.hasUsableContext;
  const disabled = sending || !!sendCooldown || sessionLocked;
  const savedResearchAreas = (ideationContext?.savedResearchAreas || []).slice(0, 5);
  const savedPublications = (ideationContext?.publications || []).slice(0, GRANT_PREP_MAX_IDEATION_PUBLICATIONS);
  const hasResearchFitItems = savedResearchAreas.length > 0 || savedPublications.length > 0;
  const profileSignalCount = [
    ideationContext?.profile?.researchSummary,
    ideationContext?.profile?.researchAreas?.length ? 'areas' : null,
    ideationContext?.profile?.keywords?.length ? 'keywords' : null,
  ].filter(Boolean).length;
  const contextSummary = [
    savedResearchAreas.length ? `${savedResearchAreas.length} research area${savedResearchAreas.length === 1 ? '' : 's'}` : null,
    savedPublications.length ? `${savedPublications.length}/${GRANT_PREP_MAX_IDEATION_PUBLICATIONS} key publication${savedPublications.length === 1 ? '' : 's'}` : null,
    profileSignalCount ? 'profile summary' : null,
  ].filter(Boolean).join(' | ');
  const pastedPublicationCount = parseGrantPrepPublicationLines(publicationInput).length;

  useEffect(() => {
    if (hasContext) {
      setManualOpen(false);
    }
  }, [hasContext]);

  const handleRecommendFromContext = () => {
    if (disabled) return;
    onSend(GRANT_PREP_IDEA_RECOMMENDATION_REQUEST);
  };

  const handleRecommendFromCallOnly = () => {
    if (disabled) return;
    onSend(GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST);
  };

  const handleRecommendFromResearchArea = (area: IdeationResearchArea) => {
    if (disabled) return;
    onSend(buildGrantPrepResearchAreaRecommendationMessage(area));
  };

  const handleRecommendFromSavedPublication = (publication: IdeationPublication) => {
    if (disabled) return;
    onSend(buildGrantPrepSavedPublicationRecommendationMessage(publication));
  };

  const handleRecommendFromPublications = () => {
    if (disabled) return;
    const publications = parseGrantPrepPublicationLines(publicationInput);
    if (publications.length === 0) {
      setError('Paste at least one publication title or short citation.');
      return;
    }
    if (publications.length > GRANT_PREP_MAX_IDEATION_PUBLICATIONS) {
      setError(`Use no more than ${GRANT_PREP_MAX_IDEATION_PUBLICATIONS} publications for this recommendation.`);
      return;
    }
    setError(null);
    onSend(buildGrantPrepPublicationRecommendationMessage(publications));
  };

  return (
    <div className="flex flex-1 items-start justify-center px-3 py-5">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-prep-card">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-prep-accent">
              <HiSparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-slate-950">Start Grant Prep</div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Choose what the chatbot should use first. It will suggest three grant directions, then you can edit or pick one.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          {hasContext ? (
            <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-emerald-950">Use all Research Fit context</div>
                  <div className="mt-1 text-xs leading-5 text-emerald-900">
                    {contextSummary || 'Saved profile context'} will ground the first recommendations.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRecommendFromContext}
                  disabled={disabled}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-prep-accent px-3 py-2 text-sm font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <HiSparkles className="h-4 w-4" />
                  Use Research Fit
                </button>
              </div>
            </section>
          ) : null}

          {savedResearchAreas.length > 0 ? (
            <section className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Research areas</h3>
                  <p className="text-xs text-slate-500">{savedResearchAreas.length} saved for matching</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {savedResearchAreas.map((area, index) => (
                  <div key={`${getResearchAreaTitle(area)}_${index}`} className="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-slate-900">{getResearchAreaTitle(area)}</div>
                        {area.taxonomyPath ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {area.taxonomyPath}
                          </span>
                        ) : null}
                      </div>
                      {area.researchArea ? (
                        <p className="mt-1 text-sm leading-5 text-slate-600">{truncateCardText(area.researchArea)}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRecommendFromResearchArea(area)}
                      disabled={disabled}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      <HiPaperAirplane className="h-3.5 w-3.5" />
                      Use area
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {savedPublications.length > 0 ? (
            <section className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Key publications</h3>
                  <p className="text-xs text-slate-500">{savedPublications.length}/{GRANT_PREP_MAX_IDEATION_PUBLICATIONS} selected in Research Fit</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {savedPublications.map((publication, index) => {
                  const meta = getPublicationMeta(publication);
                  return (
                    <div key={`${publication.title}_${index}`} className="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{publication.title}</div>
                        {meta ? <div className="mt-0.5 text-xs text-slate-500">{meta}</div> : null}
                        {publication.abstractSnippet ? (
                          <p className="mt-1 text-sm leading-5 text-slate-600">{truncateCardText(publication.abstractSnippet)}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRecommendFromSavedPublication(publication)}
                        disabled={disabled}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        <HiPaperAirplane className="h-3.5 w-3.5" />
                        Use publication
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!hasResearchFitItems ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
              <div className="text-sm font-semibold text-slate-900">No saved research areas or key publications yet</div>
              <div className="mt-1 text-sm text-slate-600">
                Add them when you want Grant Prep to start from your own focused topics or papers.
              </div>
              <Link
                href="/profile/research-fit"
                className="mt-2 inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Research Fit
              </Link>
            </div>
          ) : null}

          <section className="rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setManualOpen((current) => !current)}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-950">Manual start</span>
                <span className="mt-0.5 block text-xs text-slate-500">Use this when Research Fit is not ready or you want to paste papers for this call only.</span>
              </span>
              <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
                {manualOpen ? 'Hide' : 'Show'}
              </span>
            </button>
            {manualOpen ? (
              <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                <label htmlFor="grant-prep-publications" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Paste publication titles
                </label>
                <p className="mt-1 text-sm text-slate-600">
                  Optional. Use up to five titles or short citations if you want this chat grounded in papers that are not saved in Research Fit.
                </p>
                <textarea
                  id="grant-prep-publications"
                  value={publicationInput}
                  onChange={(event) => {
                    setPublicationInput(event.target.value.slice(0, 3000));
                    setError(null);
                  }}
                  disabled={disabled}
                  rows={4}
                  placeholder={[
                    '1. AI-assisted diabetic retinopathy screening in rural clinics',
                    '2. Community health worker-led diabetes adherence intervention',
                    '3. Mobile reminders and glycemic control in low-resource settings',
                  ].join('\n')}
                  className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-prep-accent focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className={error ? 'text-xs text-rose-600' : 'text-xs text-slate-400'}>
                    {error || `${pastedPublicationCount}/${GRANT_PREP_MAX_IDEATION_PUBLICATIONS} pasted publications`}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleRecommendFromPublications}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-prep-accent px-3 py-2 text-xs font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <HiSparkles className="h-3.5 w-3.5" />
                      Use pasted papers
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={handleRecommendFromCallOnly}
              disabled={disabled}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Start from funding call only
            </button>
            <button
              type="button"
              onClick={() => onInputChange('I have finalized the idea already: ')}
              disabled={disabled}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              I already know the idea
            </button>
          </div>
        </div>
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
  stageTransitionContext,
  ideationContext,
  ideationDecision,
  onFinalizeIdeation,
  onPreviewTypedIdea,
  onFinalizeTypedIdea,
  finalizingIdeation = false,
  onToggleFullscreen,
  isFullscreen = false,
}: Props) {
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [expandedPromptInput, setExpandedPromptInput] = useState(false);
  const [pendingIdeaChoice, setPendingIdeaChoice] = useState<{ messageId: string; option: SuggestedAnswer } | null>(null);
  const [pendingTypedIdea, setPendingTypedIdea] = useState<{
    ideaText: string;
    anchor: PrepIdeationDecision['anchor'];
    anchorHash: string;
    compilationSource: PrepIdeationDecision['compilationSource'];
  } | null>(null);
  const [revisingFixedIdea, setRevisingFixedIdea] = useState(false);
  const autoSuggestedStageRef = useRef<string | null>(null);

  // EC-2: auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(event.target.value.slice(0, 4000));
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, expandedPromptInput ? 360 : 200)}px`;
  };

  // EC-8: consistent height value
  const resetTextAreaHeight = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (!event.target.value) {
      setExpandedPromptInput(false);
      event.target.style.height = '44px';
    }
  };

  const handleSend = () => {
    if (!sending && !sendCooldown && !sessionLocked && input.trim()) {
      onSend();
      setExpandedPromptInput(false);
      if (chatInputRef.current) chatInputRef.current.style.height = '44px';
    }
  };

  const handleStageAnswerPrompt = (value: string) => {
    setExpandedPromptInput(true);
    onInputChange(value);
    const resizeInput = () => {
      const inputEl = chatInputRef.current;
      if (!inputEl) return;
      inputEl.focus();
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 360)}px`;
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(resizeInput);
    } else {
      resizeInput();
    }
  };

  useEffect(() => {
    if (!input.trim()) {
      setExpandedPromptInput(false);
    }
  }, [input]);

  const isInputDisabled = sessionLocked || !!sendCooldown;
  const canSend = !sending && !sendCooldown && !!input.trim() && !sessionLocked;
  const isIdeationStage = activeStageKey === 'ideation';
  const hasFixedIdea = isIdeationStage && ideationDecision?.status === 'fixed';
  const ideationStageMessages = messages.filter(
    (message) => message.stage_key === 'ideation' || (isIdeationStage && !message.stage_key)
  );
  const hasIdeationStageMessages = ideationStageMessages.length > 0;
  const hasIdeationUserMessages = ideationStageMessages.some((message) => message.role === 'user');
  const hasIdeationSuggestedAnswers = ideationStageMessages.some(
    (message) =>
      message.role !== 'user' &&
      Array.isArray(message.suggested_answers) &&
      message.suggested_answers.length > 0
  );
  const hasActiveStageMessages = activeStageKey
    ? messages.some((message) => message.stage_key === activeStageKey)
    : messages.length > 0;
  const hasProblemDefinitionMessages = messages.some((message) => message.stage_key === 'problem_definition');
  const showIdeationStartCard = isIdeationStage && !hasIdeationUserMessages && !hasIdeationSuggestedAnswers;
  const showStageTransitionStarter =
    !isIdeationStage &&
    !!activeStageKey &&
    !hasActiveStageMessages &&
    !!pendingPoints &&
    pendingPoints.length > 0 &&
    (activeStageKey === 'problem_definition'
      ? (hasIdeationStageMessages || ideationDecision?.status === 'fixed')
      : Boolean(stageTransitionContext?.problemReady && hasProblemDefinitionMessages));
  useEffect(() => {
    if (
      showStageTransitionStarter
      && activeStageKey
      && autoSuggestedStageRef.current !== activeStageKey
      && !sessionLocked
      && !sending
      && !sendCooldown
    ) {
      autoSuggestedStageRef.current = activeStageKey;
      onSend(buildAiSuggestionPrompt(activeStageTitle, (pendingPoints || []).slice(0, 5)));
    }
  }, [
    activeStageKey,
    activeStageTitle,
    onSend,
    pendingPoints,
    sendCooldown,
    sending,
    sessionLocked,
    showStageTransitionStarter,
  ]);
  const hasOrphanMessage =
    messages.length > 0 && messages[messages.length - 1].role === 'user' && !sending;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200/80 bg-white shadow-prep-card">
      {/* Messages area */}
      <div className="prep-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {showIdeationStartCard ? (
          <IdeationStartCard
            sending={sending}
            sendCooldown={sendCooldown}
            sessionLocked={sessionLocked}
            ideationContext={ideationContext}
            onInputChange={onInputChange}
            onSend={onSend}
          />
        ) : messages.length === 0 ? (
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
            const isCurrentStageMessage = !message.stage_key || message.stage_key === activeStageKey;
            const structuredAnswers = mergeGrantPrepSuggestedAnswersWithInline(
              Array.isArray(message.suggested_answers) ? message.suggested_answers : [],
              message.content || ''
            );
            const hasAnyStructuredAnswers = isLastAssistant && structuredAnswers.length > 0;
            const hasStructuredAnswers = hasAnyStructuredAnswers && isCurrentStageMessage;
            const optionCombinations = hasStructuredAnswers
              ? buildOptionCombinations(structuredAnswers)
              : [];

            return (
            <div key={message.id}>
              <MessageBubble
                message={message}
                isLast={index === messages.length - 1}
                structuredAnswerCount={hasAnyStructuredAnswers ? structuredAnswers.length : 0}
              />

              {/* B9: Answer Option Cards — only on last assistant message */}
              {hasStructuredAnswers ? (
                <div className="mt-3 flex flex-col gap-2 pl-9">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {isIdeationStage
                      ? 'Idea directions - choose what to do next'
                      : 'Approval bundles - approve as-is, edit, or write your own'}
                  </div>
                  {isIdeationStage ? (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
                      <strong>Explore further</strong> keeps improving an idea. <strong>Choose &amp; continue</strong> saves it as the reference for every later stage. None feel right? Ask for three different ideas.
                    </div>
                  ) : null}
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
                          {Array.isArray(option.covers) ? option.covers.map((cover) => (
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
                          {isIdeationStage ? 'Edit idea' : 'Edit bundle'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSend(option.text, option)}
                          disabled={sessionLocked || sending || !!sendCooldown || finalizingIdeation}
                          className={clsx(
                            'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:bg-slate-300',
                            isIdeationStage
                              ? 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
                              : 'bg-prep-accent text-white hover:bg-prep-accentDark'
                          )}
                        >
                          {isIdeationStage ? 'Explore further' : 'Approve and send'}
                        </button>
                        {isIdeationStage && onFinalizeIdeation ? (
                          <button
                            type="button"
                            onClick={() => setPendingIdeaChoice({ messageId: message.id, option })}
                            disabled={sessionLocked || sending || !!sendCooldown || finalizingIdeation}
                            className="rounded-lg bg-prep-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-prep-accentDark disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            Choose this idea &amp; continue
                          </button>
                        ) : null}
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
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-prep-card transition hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {combination.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {isIdeationStage ? (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => onSend(GRANT_PREP_MORE_IDEAS_REQUEST)}
                        disabled={sessionLocked || sending || !!sendCooldown}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-prep-card transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Show 3 different ideas
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* B3: Follow-Up Suggestion Chips — only on last assistant message */}
              {isLastAssistant &&
                isCurrentStageMessage &&
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

        {showStageTransitionStarter ? (
          <StageTransitionStarterCard
            activeStageKey={activeStageKey}
            activeStageTitle={activeStageTitle}
            pendingPoints={pendingPoints}
            stageTransitionContext={stageTransitionContext}
            onAnswerInTextBox={handleStageAnswerPrompt}
            onSend={onSend}
            disabled={sessionLocked || sending || !!sendCooldown}
          />
        ) : null}

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
            {hasFixedIdea && !revisingFixedIdea ? (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Chosen idea</div>
                <div className="mt-1 text-sm font-semibold text-emerald-950">{ideationDecision?.anchor.title}</div>
                <div className="mt-1 text-xs leading-5 text-emerald-900">{ideationDecision?.anchor.oneSentenceSummary}</div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-emerald-800">This reference guides every later Grant Prep stage.</span>
                  <button type="button" onClick={() => setRevisingFixedIdea(true)} className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                    Change chosen idea
                  </button>
                </div>
              </div>
            ) : null}
            {hasFixedIdea && revisingFixedIdea ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="text-xs text-amber-900">The current idea remains active until you confirm a replacement. Later answers may need review.</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onSend(GRANT_PREP_MORE_IDEAS_REQUEST)} disabled={sending || !!sendCooldown} className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-300">Suggest 3 different ideas</button>
                  <button type="button" onClick={() => setRevisingFixedIdea(false)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800">Keep current idea</button>
                </div>
              </div>
            ) : null}
            {!hasFixedIdea || revisingFixedIdea ? (
            <>
            <div className="flex items-end gap-2">
              <div
                className={clsx(
                  'flex flex-1 gap-2 rounded-xl border border-slate-200 bg-prep-inputBg px-3 py-2 focus-within:border-prep-accent focus-within:ring-2 focus-within:ring-emerald-100',
                  expandedPromptInput ? 'items-start' : 'items-end'
                )}
              >
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
                  style={{
                    minHeight: expandedPromptInput ? '150px' : '44px',
                    maxHeight: expandedPromptInput ? '360px' : '200px',
                  }}
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
            {isIdeationStage && onFinalizeTypedIdea ? (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    const ideaText = input.replace(/^I have finalized the idea already:\s*/i, '').trim();
                    if (ideaText.length < 8 || !onPreviewTypedIdea) return;
                    try {
                      const preview = await onPreviewTypedIdea(ideaText);
                      setPendingTypedIdea({ ideaText, ...preview });
                    } catch {
                      // The page-level handler reports the API error.
                    }
                  }}
                  disabled={
                    finalizingIdeation
                    || input.replace(/^I have finalized the idea already:\s*/i, '').trim().length < 8
                  }
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Finalize my idea
                </button>
              </div>
            ) : null}
            </>
            ) : null}
            {input.length > 3500 ? (
              <div className="mt-1 text-right text-xs text-slate-400">{input.length}/4000</div>
            ) : null}
          </>
        )}
      </div>

      {pendingIdeaChoice ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-idea-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="confirm-idea-title" className="text-lg font-semibold text-slate-950">Use this as your grant idea?</h2>
            <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{pendingIdeaChoice.option.text}</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">We will create a short working summary and use it to keep every later stage focused. You can change it later, but completed work may need review.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingIdeaChoice(null)} disabled={finalizingIdeation} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Keep exploring</button>
              <button
                type="button"
                disabled={finalizingIdeation}
                onClick={async () => {
                  const choice = pendingIdeaChoice;
                  await onFinalizeIdeation?.(choice.messageId, choice.option);
                  setPendingIdeaChoice(null);
                  setRevisingFixedIdea(false);
                }}
                className="rounded-lg bg-prep-accent px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                {finalizingIdeation ? 'Creating idea summary...' : 'Choose idea & continue'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingTypedIdea ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-typed-idea-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="confirm-typed-idea-title" className="text-lg font-semibold text-slate-950">Finalize this grant idea?</h2>
            <div className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{pendingTypedIdea.anchor.title}</div>
                <div className="mt-1 font-medium text-slate-900">{pendingTypedIdea.anchor.oneSentenceSummary}</div>
              </div>
              {pendingTypedIdea.anchor.problemOrOpportunity ? <div><span className="font-semibold">Problem:</span> {pendingTypedIdea.anchor.problemOrOpportunity}</div> : null}
              {pendingTypedIdea.anchor.coreApproach ? <div><span className="font-semibold">Approach:</span> {pendingTypedIdea.anchor.coreApproach}</div> : null}
              {pendingTypedIdea.anchor.targetBeneficiariesOrSetting ? <div><span className="font-semibold">Target/setting:</span> {pendingTypedIdea.anchor.targetBeneficiariesOrSetting}</div> : null}
              {pendingTypedIdea.anchor.funderFit.length > 0 ? <div><span className="font-semibold">Funder fit:</span> {pendingTypedIdea.anchor.funderFit.join(' | ')}</div> : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Confirm this compiled anchor. Later stages will be prefilled from it but still require review.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingTypedIdea(null)} disabled={finalizingIdeation} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Keep editing</button>
              <button
                type="button"
                disabled={finalizingIdeation}
                onClick={async () => {
                  await onFinalizeTypedIdea?.(pendingTypedIdea.ideaText, {
                    anchor: pendingTypedIdea.anchor,
                    anchorHash: pendingTypedIdea.anchorHash,
                    compilationSource: pendingTypedIdea.compilationSource,
                  });
                  setPendingTypedIdea(null);
                  setRevisingFixedIdea(false);
                }}
                className="rounded-lg bg-prep-accent px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                {finalizingIdeation ? 'Creating idea summary...' : 'Finalize idea & continue'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
