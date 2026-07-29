import React from 'react';
import { FileText } from 'lucide-react';

import type { RecommendationRawResultItem } from '../../lib/recommendations/types';

interface FinderResultCardProps {
  result: RecommendationRawResultItem;
  ordinal: number;
  onBeginWriting?: (payload: { resultId: string }) => void;
  onExplainResult?: () => void;
  onAskAboutCall?: () => void;
  getCallDetailsHref?: (resultId: string) => string;
  compact?: boolean;
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
  compact = false,
}: FinderResultCardProps) {
  const amount = formatAmountRange(result);
  const deadlineStatus = formatDeadlineStatus(result);
  const eligibilityCopy = result.eligibilitySummary || result.eligibilityText || null;
  const description =
    result.shortDescription ||
    result.matchReasons.slice(0, 2).join(' | ') ||
    result.eligibilitySummary ||
    result.eligibilityText;
  const matchPercent = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
  const hasDocumentEvidence = Boolean(result.evidence && result.evidence.chunks.length > 0);

  return (
    <div className="cb-card p-4 transition hover:border-cobalt-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[12px] text-muted">{result.agencyName}</span>
            {hasDocumentEvidence ? (
              <span
                className="cb-badge"
                title="This call's guidelines document is available — ask about eligibility, budget rules, or required documents in chat."
              >
                <FileText className="h-3 w-3" />
                Docs
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold leading-snug text-ink">
            {ordinal}. {result.schemeTitle}
          </div>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${deadlineStatus.className}`}>
          {deadlineStatus.label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2" title={`Match strength ${matchPercent}%`}>
        <div className="h-1 w-20 overflow-hidden rounded-full bg-hairline">
          <div
            className={`h-full rounded-full ${matchPercent >= 60 ? 'bg-cobalt-600' : matchPercent >= 35 ? 'bg-cobalt-300' : 'bg-muted-soft'}`}
            style={{ width: `${Math.max(matchPercent, 6)}%` }}
          />
        </div>
        <span className="text-[11px] text-muted">{matchPercent}% match</span>
      </div>

      {!compact ? <p className="mt-2.5 text-[13px] leading-6 text-muted">{description}</p> : null}

      {!compact && eligibilityCopy ? (
        <p className="mt-2.5 rounded-lg bg-inset px-3 py-2.5 text-[13px] leading-6 text-muted">
          <span className="font-medium text-ink-soft">Eligibility:</span> {eligibilityCopy}
        </p>
      ) : null}

      {!compact && result.profileMatch?.reasons.length ? (
        <p className="mt-2.5 rounded-lg bg-cobalt-50 px-3 py-2.5 text-[13px] leading-6 text-cobalt-800">
          <span className="font-medium">Preference match:</span> {result.profileMatch.reasons.slice(0, 3).join(' · ')}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {amount ? <span className="cb-badge">Amount: {amount}</span> : null}
        {result.fundingKinds.slice(0, 2).map((kind) => (
          <span key={kind} className="cb-badge">{kind}</span>
        ))}
        {result.eligibleCountries.slice(0, 1).map((country) => (
          <span key={country} className="cb-badge">{country}</span>
        ))}
        {!result.eligibleCountries.length && result.hostCountries.slice(0, 1).map((country) => (
          <span key={country} className="cb-badge">Host: {country}</span>
        ))}
      </div>

      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
          {onBeginWriting ? (
            <button type="button" onClick={() => onBeginWriting({ resultId: result.id })} className="cb-btn-primary cb-btn-sm">
              Write grant
            </button>
          ) : null}
          {onExplainResult ? (
            <button type="button" onClick={onExplainResult} className="cb-btn-secondary cb-btn-sm">
              Explain in chat
            </button>
          ) : null}
          {onAskAboutCall ? (
            <button
              type="button"
              onClick={onAskAboutCall}
              className="cb-btn-secondary cb-btn-sm"
              title="Ask about eligibility, required documents, budget rules, or deadlines from the call's own documents"
            >
              Ask about this call
            </button>
          ) : null}
          <a
            href={getCallDetailsHref?.(result.id) || `/finder/calls/${encodeURIComponent(result.id)}`}
            target="_blank"
            rel="noreferrer"
            className="cb-btn-ghost cb-btn-sm"
          >
            Details
          </a>
          {result.officialUrls[0] ? (
            <a href={result.officialUrls[0]} target="_blank" rel="noreferrer" className="cb-btn-ghost cb-btn-sm">
              Source
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
