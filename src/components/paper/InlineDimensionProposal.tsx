'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import MarkdownRenderer from '@/components/paper/MarkdownRenderer';

interface DimensionCitationValidation {
  disallowedKeys: string[];
  unknownKeys: string[];
  missingRequiredKeys: string[];
}

type DimensionRole = 'introduction' | 'body' | 'conclusion' | 'intro_conclusion';

interface DimensionPass1Memory {
  keyPoints: string[];
  termsIntroduced: string[];
  mainClaims: string[];
  forwardReferences: string[];
  sectionIntent?: string;
  openingStrategy?: string;
  closingStrategy?: string;
  sectionOutline?: string[];
}

interface DimensionPass1SourceReview {
  source: 'pass1_section_draft';
  contentFingerprint: string;
  wordCount: number;
  preview: string;
  generatedAt?: string;
  reused: boolean;
  memory?: DimensionPass1Memory | null;
}

interface DimensionProposalReviewTrace {
  pass1Fingerprint: string;
  pass1WordCount: number;
  role: DimensionRole;
  bridgeHint: string;
  requiredCitationKeys: string[];
  previousDimensionLabel?: string | null;
  nextDimensionLabel?: string | null;
  acceptedBlockCount: number;
  acceptedContextHash: string;
  acceptedSummary: string;
  acceptedContextPreview: string;
  pass1DimensionSummary?: string;
  targetEvidenceSummary?: string;
}

interface InlineDimensionProposalProps {
  dimensionLabel: string;
  proposalText: string;
  isStreaming: boolean;
  streamCursor: number;
  isLoading?: boolean;
  isAccepting?: boolean;
  isRewriting?: boolean;
  isEditing?: boolean;
  showRewriteInput?: boolean;
  feedback?: string;
  validation?: DimensionCitationValidation | null;
  reviewTrace?: DimensionProposalReviewTrace | null;
  pass1Source?: DimensionPass1SourceReview | null;
  onAccept: () => void;
  onAcceptBypass?: () => void;
  onToggleRewrite: () => void;
  onToggleEdit: () => void;
  onProposalChange: (value: string) => void;
  onFeedbackChange: (value: string) => void;
  onRewrite: () => void;
  onFixCitations?: (badKeys: string[]) => void;
  onSkipAnimation?: () => void;
}

function hasWarnings(validation?: DimensionCitationValidation | null): boolean {
  if (!validation) return false;
  return validation.disallowedKeys.length > 0
    || validation.unknownKeys.length > 0
    || validation.missingRequiredKeys.length > 0;
}

function formatRoleLabel(role?: DimensionRole | null): string {
  switch (role) {
    case 'introduction':
      return 'Introduction';
    case 'conclusion':
      return 'Conclusion';
    case 'intro_conclusion':
      return 'Intro + Conclusion';
    default:
      return 'Body';
  }
}

export default function InlineDimensionProposal({
  dimensionLabel,
  proposalText,
  isStreaming,
  streamCursor,
  isLoading,
  isAccepting,
  isRewriting,
  isEditing,
  showRewriteInput,
  feedback,
  validation,
  reviewTrace,
  pass1Source,
  onAccept,
  onAcceptBypass,
  onToggleRewrite,
  onToggleEdit,
  onProposalChange,
  onFeedbackChange,
  onRewrite,
  onFixCitations,
  onSkipAnimation,
}: InlineDimensionProposalProps) {
  const streamedText = isStreaming
    ? proposalText.slice(0, Math.max(0, streamCursor))
    : proposalText;

  const contentText = streamedText || (isLoading ? 'Generating dimension content...' : 'No proposal yet.');
  const warningState = hasWarnings(validation);

  return (
    <div className="group/inline relative my-1.5 border-l-2 border-indigo-300/60 bg-indigo-50/30 pl-4 pr-2 pb-8 pt-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.3px] text-indigo-400/80">
          <span>{dimensionLabel || 'Dimension Draft'}</span>
          <span className="h-px flex-1 bg-indigo-100" />
        </div>

        {isStreaming ? (
          <div className="text-sm leading-6 text-slate-700">
            <span className="whitespace-pre-wrap">{contentText}</span>
            <span className="streaming-cursor" aria-hidden="true" />
            {onSkipAnimation && (
              <button
                type="button"
                onClick={onSkipAnimation}
                className="ml-2 text-[11px] font-medium text-slate-500 hover:text-slate-700"
              >
                Skip
              </button>
            )}
          </div>
        ) : isEditing ? (
          <textarea
            className="min-h-[110px] w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
            value={proposalText}
            onChange={(e) => onProposalChange(e.target.value)}
            placeholder="Edit proposal text inline..."
          />
        ) : (
          <MarkdownRenderer content={contentText} className="!my-0" />
        )}

        {warningState && validation && (() => {
          const allBadKeys = [
            ...validation.disallowedKeys,
            ...validation.unknownKeys
          ];
          return (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              {validation.disallowedKeys.length > 0 && (
                <div>Disallowed: {validation.disallowedKeys.slice(0, 4).join(', ')}</div>
              )}
              {validation.unknownKeys.length > 0 && (
                <div>Unknown: {validation.unknownKeys.slice(0, 4).join(', ')}</div>
              )}
              {validation.missingRequiredKeys.length > 0 && (
                <div>Missing required: {validation.missingRequiredKeys.slice(0, 4).join(', ')}</div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {onFixCitations && allBadKeys.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onFixCitations(allBadKeys)}
                    disabled={Boolean(isRewriting)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Fix citation deviation
                  </button>
                )}
                {onFixCitations && validation.missingRequiredKeys.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onFixCitations(validation.missingRequiredKeys)}
                    disabled={Boolean(isRewriting)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Add missing citations
                  </button>
                )}
                {onAcceptBypass && (
                  <button
                    type="button"
                    onClick={onAcceptBypass}
                    disabled={Boolean(isAccepting) || !proposalText.trim()}
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Accept anyway
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {(reviewTrace || pass1Source) && (
          <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
            <summary className="cursor-pointer font-medium text-slate-600">
              Review Inputs
            </summary>
            <div className="mt-2 space-y-2">
              {reviewTrace && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span><strong>Role:</strong> {formatRoleLabel(reviewTrace.role)}</span>
                    <span><strong>Accepted blocks:</strong> {reviewTrace.acceptedBlockCount}</span>
                    {reviewTrace.previousDimensionLabel && (
                      <span><strong>Previous:</strong> {reviewTrace.previousDimensionLabel}</span>
                    )}
                    {reviewTrace.nextDimensionLabel && (
                      <span><strong>Next:</strong> {reviewTrace.nextDimensionLabel}</span>
                    )}
                  </div>
                  {reviewTrace.requiredCitationKeys.length > 0 && (
                    <div>
                      <strong>Required citations:</strong> {reviewTrace.requiredCitationKeys.join(', ')}
                    </div>
                  )}
                  {reviewTrace.bridgeHint && (
                    <div>
                      <strong>Bridge hint:</strong> {reviewTrace.bridgeHint}
                    </div>
                  )}
                  {reviewTrace.pass1DimensionSummary && (
                    <div>
                      <strong>Pass 1 dimension summary:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] leading-5 text-slate-600">
                        {reviewTrace.pass1DimensionSummary}
                      </div>
                    </div>
                  )}
                  {reviewTrace.targetEvidenceSummary && (
                    <div>
                      <strong>Target evidence passed in:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] leading-5 text-slate-600">
                        {reviewTrace.targetEvidenceSummary}
                      </div>
                    </div>
                  )}
                  {reviewTrace.acceptedSummary && (
                    <div>
                      <strong>Accepted summary passed forward:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] leading-5 text-slate-600">
                        {reviewTrace.acceptedSummary}
                      </div>
                    </div>
                  )}
                  {reviewTrace.acceptedContextPreview && (
                    <div>
                      <strong>Accepted content preview passed forward:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] leading-5 text-slate-600">
                        {reviewTrace.acceptedContextPreview}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {pass1Source && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span><strong>Pass 1 words:</strong> {pass1Source.wordCount}</span>
                    <span><strong>Source fingerprint:</strong> {pass1Source.contentFingerprint.slice(0, 12)}</span>
                    <span><strong>Source mode:</strong> {pass1Source.reused ? 'reused' : 'generated now'}</span>
                  </div>
                  {pass1Source.memory && (
                    <div className="space-y-1">
                      {pass1Source.memory.sectionIntent && (
                        <div><strong>Pass 1 section intent:</strong> {pass1Source.memory.sectionIntent}</div>
                      )}
                      {pass1Source.memory.openingStrategy && (
                        <div><strong>Pass 1 opening strategy:</strong> {pass1Source.memory.openingStrategy}</div>
                      )}
                      {pass1Source.memory.closingStrategy && (
                        <div><strong>Pass 1 closing strategy:</strong> {pass1Source.memory.closingStrategy}</div>
                      )}
                      {pass1Source.memory.keyPoints.length > 0 && (
                        <div><strong>Pass 1 key points:</strong> {pass1Source.memory.keyPoints.join('; ')}</div>
                      )}
                      {pass1Source.memory.mainClaims.length > 0 && (
                        <div><strong>Pass 1 claims:</strong> {pass1Source.memory.mainClaims.join('; ')}</div>
                      )}
                      {pass1Source.memory.sectionOutline && pass1Source.memory.sectionOutline.length > 0 && (
                        <div><strong>Pass 1 outline:</strong> {pass1Source.memory.sectionOutline.join(' | ')}</div>
                      )}
                    </div>
                  )}
                  {pass1Source.preview && (
                    <div>
                      <strong>Pass 1 source preview passed to dimension flow:</strong>
                      <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] leading-5 text-slate-600">
                        {pass1Source.preview}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        )}

        {showRewriteInput && (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                placeholder="What should change?"
                value={feedback || ''}
                onChange={(e) => onFeedbackChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onRewrite();
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={onRewrite}
                disabled={Boolean(isRewriting)}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Go
              </button>
            </div>
          </div>
        )}

        <div className="inline-dimension-actions absolute bottom-2 right-3 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/inline:opacity-100 group-focus-within/inline:opacity-100">
          <button
            type="button"
            onClick={onAccept}
            disabled={Boolean(isAccepting) || !proposalText.trim()}
            title="Accept"
            className="inline-flex h-7 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 transition-all duration-150 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAccepting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Accepting
              </span>
            ) : (
              'Accept'
            )}
          </button>

          <button
            type="button"
            onClick={onToggleRewrite}
            disabled={Boolean(isRewriting)}
            title="Regenerate"
            className="inline-flex h-7 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 transition-all duration-150 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRewriting ? 'Regenerating' : 'Regenerate'}
          </button>

          <button
            type="button"
            onClick={onToggleEdit}
            title="Edit"
            className={`inline-flex h-7 items-center justify-center rounded-md border px-2 text-[11px] font-medium transition-all duration-150 ${
              isEditing
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {isEditing ? 'Editing' : 'Edit'}
          </button>
        </div>

        <style jsx>{`
          .streaming-cursor::after {
            content: '▎';
            animation: inlineCursorBlink 1s step-end infinite;
            color: #6366f1;
            font-weight: 300;
            margin-left: 1px;
          }

          @keyframes inlineCursorBlink {
            0%, 50% {
              opacity: 1;
            }
            51%, 100% {
              opacity: 0;
            }
          }
        `}</style>
    </div>
  );
}
