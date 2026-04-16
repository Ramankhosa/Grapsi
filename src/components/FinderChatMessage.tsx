import { FaRobot, FaUserCircle } from 'react-icons/fa';
import type { RecommendationConversationMessageRecord, RecommendationConversationRunRecord } from '../lib/recommendations/chatTypes';

interface FinderChatMessageProps {
  message: RecommendationConversationMessageRecord;
  runs: RecommendationConversationRunRecord[];
  onExplainResult?: (payload: { runId: string; resultId: string; ordinal: number }) => void;
  onBeginWriting?: (payload: { resultId: string }) => void;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FinderChatMessage({
  message,
  runs,
  onExplainResult,
  onBeginWriting,
}: FinderChatMessageProps) {
  const citedRun = message.citations ? runs.find((run) => run.id === message.citations?.runId) : null;
  const citedResults = message.citations
    ? citedRun?.results.filter((result) => message.citations?.resultIds.includes(result.id)) || []
    : [];
  const assistant = message.role === 'assistant';
  const bubbleClass = assistant
    ? 'border-white/60 bg-white/92 text-slate-900'
    : 'border-slate-950 bg-[linear-gradient(135deg,_#0f172a_0%,_#111827_55%,_#052e2b_100%)] text-white shadow-[0_18px_42px_rgba(15,23,42,0.26)]';
  const labelClass = assistant ? 'text-emerald-700' : 'text-emerald-100';
  const timeClass = assistant ? 'text-slate-400' : 'text-emerald-100/70';
  const bodyClass = assistant ? 'text-slate-700' : 'text-white';

  return (
    <div className={`flex gap-4 ${assistant ? 'items-start' : 'items-start flex-row-reverse'}`}>
      <div className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${assistant ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-white'}`}>
        {assistant ? <FaRobot /> : <FaUserCircle />}
      </div>

      <div className={`max-w-[92%] rounded-[26px] border px-5 py-4 shadow-sm ${bubbleClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${labelClass}`}>
            {assistant ? 'GrantGenie Finder' : 'You'}
          </div>
          <div className={`text-[11px] uppercase tracking-[0.16em] ${timeClass}`}>
            {formatTime(message.createdAt)}
          </div>
        </div>

        <div className={`mt-3 whitespace-pre-wrap text-sm leading-7 ${bodyClass}`}>
          {message.content}
        </div>

        {citedResults.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {citedResults.map((result, index) => (
              <div
                key={result.id}
                className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-left"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">{result.agencyName}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{index + 1}. {result.schemeTitle}</div>
                  </div>
                  <div className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                    {result.isRolling ? 'Rolling' : result.closeDate ? new Date(result.closeDate).toLocaleDateString() : 'Open'}
                  </div>
                </div>

                <div className="mt-3 text-sm leading-6 text-slate-700">
                  {result.shortDescription || result.matchReasons.slice(0, 2).join(' | ') || result.eligibilitySummary}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
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
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {onBeginWriting ? (
                    <button
                      type="button"
                      onClick={() => onBeginWriting({ resultId: result.id })}
                      className="rounded-full border border-emerald-600 bg-emerald-600 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:border-emerald-700 hover:bg-emerald-700"
                    >
                      Begin Writing
                    </button>
                  ) : null}
                  {onExplainResult ? (
                    <button
                      type="button"
                      onClick={() =>
                        onExplainResult({
                          runId: citedRun?.id || message.citations?.runId || '',
                          resultId: result.id,
                          ordinal: (citedRun?.results.findIndex((item) => item.id === result.id) ?? index) + 1,
                        })
                      }
                      className="rounded-full border border-emerald-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800 transition-colors hover:bg-emerald-100"
                    >
                      Explain In Chat
                    </button>
                  ) : null}
                  <a
                    href={`/finder/calls/${result.id}`}
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
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
