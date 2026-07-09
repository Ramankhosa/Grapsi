import React from 'react';
import { FaFileAlt } from 'react-icons/fa';

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
    return { label: 'Rolling', className: 'bg-slate-950 text-white' };
  }

  if (!result.closeDate) {
    return { label: 'Open', className: 'bg-slate-100 text-slate-700' };
  }

  const closeDate = new Date(result.closeDate);
  if (Number.isNaN(closeDate.getTime())) {
    return { label: 'Open', className: 'bg-slate-100 text-slate-700' };
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfCloseDate = new Date(closeDate.getFullYear(), closeDate.getMonth(), closeDate.getDate());
  const daysUntilClose = Math.ceil((startOfCloseDate.getTime() - startOfToday.getTime()) / 86400000);

  if (daysUntilClose < 0) {
    return { label: 'Closed', className: 'bg-rose-100 text-rose-900' };
  }
  if (daysUntilClose === 0) {
    return { label: 'Closes today', className: 'bg-amber-100 text-amber-900' };
  }
  if (daysUntilClose <= 30) {
    return {
      label: `Closes in ${daysUntilClose} day${daysUntilClose === 1 ? '' : 's'}`,
      className: 'bg-amber-100 text-amber-900',
    };
  }

  return { label: closeDate.toLocaleDateString(), className: 'bg-slate-100 text-slate-700' };
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
    <div className="group rounded-[20px] border border-emerald-200 bg-emerald-50/90 px-4 py-4 text-left transition-shadow hover:shadow-[0_12px_32px_rgba(16,185,129,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              {result.agencyName}
            </span>
            {hasDocumentEvidence ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600"
                title="This call's guidelines document is available — ask about eligibility, budget rules, or required documents in chat."
              >
                <FaFileAlt className="text-[9px]" />
                Docs
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {ordinal}. {result.schemeTitle}
          </div>
        </div>
        <div className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${deadlineStatus.className}`}>
          {deadlineStatus.label}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2" title={`Match strength ${matchPercent}%`}>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white">
          <div
            className={`h-full rounded-full ${matchPercent >= 60 ? 'bg-emerald-500' : matchPercent >= 35 ? 'bg-amber-400' : 'bg-slate-300'}`}
            style={{ width: `${Math.max(matchPercent, 6)}%` }}
          />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{matchPercent}% match</span>
      </div>

      {!compact ? <div className="mt-3 text-sm leading-6 text-slate-700">{description}</div> : null}

      {!compact && eligibilityCopy ? (
        <div className="mt-3 rounded-[18px] border border-white/70 bg-white/75 px-3 py-3 text-sm leading-6 text-slate-700">
          <span className="font-semibold text-slate-900">Eligibility:</span> {eligibilityCopy}
        </div>
      ) : null}

      {!compact && result.profileMatch?.reasons.length ? (
        <div className="mt-3 rounded-[18px] border border-violet-100 bg-violet-50 px-3 py-3 text-sm leading-6 text-violet-950">
          <span className="font-semibold">Preference match:</span> {result.profileMatch.reasons.slice(0, 3).join(' | ')}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {amount ? (
          <span className="rounded-full border border-white bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
            Amount: {amount}
          </span>
        ) : null}
        {result.fundingKinds.slice(0, 2).map((kind) => (
          <span key={kind} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
            {kind}
          </span>
        ))}
        {result.eligibleCountries.slice(0, 1).map((country) => (
          <span key={country} className="rounded-full border border-white bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-900">
            {country}
          </span>
        ))}
        {!result.eligibleCountries.length && result.hostCountries.slice(0, 1).map((country) => (
          <span key={country} className="rounded-full border border-white bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-900">
            Host: {country}
          </span>
        ))}
      </div>

      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {onBeginWriting ? (
            <button
              type="button"
              onClick={() => onBeginWriting({ resultId: result.id })}
              className="rounded-full border border-emerald-600 bg-emerald-600 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700"
            >
              Write Grant
            </button>
          ) : null}
          {onExplainResult ? (
            <button
              type="button"
              onClick={onExplainResult}
              className="rounded-full border border-emerald-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800 transition-colors hover:bg-emerald-100"
            >
              Explain In Chat
            </button>
          ) : null}
          {onAskAboutCall ? (
            <button
              type="button"
              onClick={onAskAboutCall}
              className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
              title="Ask about eligibility, required documents, budget rules, or deadlines from the call's own documents"
            >
              Ask About This Call
            </button>
          ) : null}
          <a
            href={getCallDetailsHref?.(result.id) || `/finder/calls/${encodeURIComponent(result.id)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
          >
            Show Details
          </a>
          {result.officialUrls[0] ? (
            <a
              href={result.officialUrls[0]}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
            >
              Open Source
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
