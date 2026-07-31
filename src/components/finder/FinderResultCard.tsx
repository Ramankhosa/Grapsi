import React from 'react';
import { FileText, MapPin } from 'lucide-react';

import type { RecommendationRawResultItem } from '../../lib/recommendations/types';

interface FinderResultCardProps {
  result: RecommendationRawResultItem;
  ordinal: number;
  onBeginWriting?: (payload: { resultId: string }) => void;
  onExplainResult?: () => void;
  onAskAboutCall?: () => void;
  getCallDetailsHref?: (resultId: string) => string;
  /**
   * Streaming variant: render the exact same layout, but with the chat-action
   * buttons disabled placeholders. Keeping the geometry identical means the card
   * doesn't grow or reflow when the stream finalizes into a saved message.
   */
  pendingActions?: boolean;
}

function formatAmountValue(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatAmountRange(result: RecommendationRawResultItem) {
  if (result.amountMin === null && result.amountMax === null) {
    return null;
  }

  const currency = result.currency ? `${result.currency} ` : '';
  if (result.amountMin !== null && result.amountMax !== null) {
    return `${currency}${formatAmountValue(result.amountMin)} - ${formatAmountValue(result.amountMax)}`.trim();
  }

  return `${currency}${formatAmountValue(result.amountMin ?? result.amountMax ?? 0)}`.trim();
}

export function formatDeadlineStatus(result: RecommendationRawResultItem) {
  if (result.isRolling) {
    return { label: 'Rolling', className: 'bg-inset text-ink-soft' };
  }

  if (!result.closeDate) {
    return { label: 'Open', className: 'bg-inset text-muted' };
  }

  const closeDate = new Date(result.closeDate);
  if (Number.isNaN(closeDate.getTime())) {
    return { label: 'Open', className: 'bg-inset text-muted' };
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfCloseDate = new Date(closeDate.getFullYear(), closeDate.getMonth(), closeDate.getDate());
  const daysUntilClose = Math.ceil((startOfCloseDate.getTime() - startOfToday.getTime()) / 86400000);

  if (daysUntilClose < 0) {
    return { label: 'Closed', className: 'bg-red-50 text-red-700' };
  }
  if (daysUntilClose === 0) {
    return { label: 'Closes today', className: 'bg-amber-50 text-amber-800' };
  }
  if (daysUntilClose <= 30) {
    return {
      label: `Closes in ${daysUntilClose} day${daysUntilClose === 1 ? '' : 's'}`,
      className: 'bg-amber-50 text-amber-800',
    };
  }

  return { label: closeDate.toLocaleDateString(), className: 'bg-inset text-muted' };
}

export default function FinderResultCard({
  result,
  ordinal,
  onBeginWriting,
  onExplainResult,
  onAskAboutCall,
  getCallDetailsHref,
  pendingActions = false,
}: FinderResultCardProps) {
  const amount = formatAmountRange(result);
  const deadlineStatus = formatDeadlineStatus(result);
  const description =
    result.shortDescription ||
    result.matchReasons.slice(0, 2).join(' · ') ||
    result.eligibilitySummary ||
    result.eligibilityText;
  const eligibilityCopy = result.eligibilitySummary || result.eligibilityText || null;
  const countryLabel = result.eligibleCountries[0] || null;
  const hostCountryLabel = !countryLabel ? result.hostCountries[0] || null : null;
  // The country already sits in the fact row, so drop eligibility lines that only
  // restate it ("Eligible countries: India") or duplicate the description fallback.
  const showEligibility = Boolean(
    eligibilityCopy &&
      eligibilityCopy !== description &&
      !/^eligible\s+countr(?:y|ies)\s*:/i.test(eligibilityCopy.trim())
  );
  const matchPercent = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
  const hasDocumentEvidence = Boolean(result.evidence && result.evidence.chunks.length > 0);
  const profileReasons = result.profileMatch?.reasons.slice(0, 3) || [];
  const detailsHref = getCallDetailsHref?.(result.id) || `/finder/calls/${encodeURIComponent(result.id)}`;

  return (
    <div className="cb-card p-3 transition hover:border-cobalt-300 sm:p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* min-w-0 is required on the truncating span itself: as a flex item its
              default min-width:auto resolves to the un-wrapped text width, which
              would push the whole card wider than its column on narrow screens. */}
          <span className="min-w-0 truncate text-[11.5px] text-muted">{result.agencyName}</span>
          {hasDocumentEvidence ? (
            <span
              className="cb-badge shrink-0"
              title="This call's guidelines document is available — ask about eligibility, budget rules, or required documents in chat."
            >
              <FileText className="h-3 w-3" />
              Docs
            </span>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${deadlineStatus.className}`}>
          {deadlineStatus.label}
        </span>
      </div>

      <div className="mt-1 line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink">
        {ordinal}. {result.schemeTitle}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5" title={`Match strength ${matchPercent}%`}>
          <span className="block h-1 w-14 overflow-hidden rounded-full bg-hairline">
            <span
              className={`block h-full rounded-full ${matchPercent >= 60 ? 'bg-cobalt-600' : matchPercent >= 35 ? 'bg-cobalt-300' : 'bg-muted-soft'}`}
              style={{ width: `${Math.max(matchPercent, 6)}%` }}
            />
          </span>
          <span className="text-[11px] font-medium text-muted">{matchPercent}% match</span>
        </span>
        {amount ? <span className="cb-badge">{amount}</span> : null}
        {result.fundingKinds.slice(0, 2).map((kind) => (
          <span key={kind} className="cb-badge">{kind}</span>
        ))}
        {countryLabel ? (
          <span className="cb-badge" title="Eligible country">
            <MapPin className="h-2.5 w-2.5" />
            {countryLabel}
          </span>
        ) : null}
        {hostCountryLabel ? (
          <span className="cb-badge" title="Host country">
            <MapPin className="h-2.5 w-2.5" />
            Host: {hostCountryLabel}
          </span>
        ) : null}
      </div>

      {description ? <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-muted">{description}</p> : null}

      {showEligibility && eligibilityCopy ? (
        <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-muted" title={eligibilityCopy}>
          <span className="font-medium text-ink-soft">Eligibility:</span> {eligibilityCopy}
        </p>
      ) : null}

      {profileReasons.length ? (
        <p
          className="mt-1.5 line-clamp-1 rounded-md bg-cobalt-50 px-2 py-1 text-[12px] leading-5 text-cobalt-800"
          title={profileReasons.join(' · ')}
        >
          <span className="font-medium">Preference match:</span> {profileReasons.join(' · ')}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {onBeginWriting || pendingActions ? (
          <button
            type="button"
            disabled={pendingActions}
            onClick={onBeginWriting ? () => onBeginWriting({ resultId: result.id }) : undefined}
            className="cb-btn-primary cb-btn-xs"
          >
            Write grant
          </button>
        ) : null}
        {onExplainResult || pendingActions ? (
          <button
            type="button"
            disabled={pendingActions}
            onClick={onExplainResult}
            className="cb-btn-secondary cb-btn-xs"
            title="Explain this match in chat"
          >
            Explain
          </button>
        ) : null}
        {onAskAboutCall || pendingActions ? (
          <button
            type="button"
            disabled={pendingActions}
            onClick={onAskAboutCall}
            className="cb-btn-secondary cb-btn-xs"
            title="Ask about eligibility, required documents, budget rules, or deadlines from the call's own documents"
          >
            Ask about call
          </button>
        ) : null}
        <span className="ml-auto flex items-center gap-0.5">
          <a href={detailsHref} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-xs">
            Details
          </a>
          {result.officialUrls[0] ? (
            <a href={result.officialUrls[0]} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-xs">
              Source
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}
