import React from 'react';
import { FaLightbulb, FaSearch } from 'react-icons/fa';

import type { ResearcherFinderContext } from '../../lib/researcherProfile/types';

interface FinderChatEmptyStateProps {
  finderContext: ResearcherFinderContext | null;
  starterPrompts: string[];
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

/**
 * Personalized empty state: greet the researcher by name/topic when the profile is known,
 * and surface tappable starters that show off both search and conversational abilities.
 */
export default function FinderChatEmptyState({
  finderContext,
  starterPrompts,
  onSendMessage,
  disabled = false,
}: FinderChatEmptyStateProps) {
  const displayName = finderContext?.profile.displayName?.trim().split(/\s+/)[0] || '';
  const primaryArea =
    finderContext?.researchAreas?.[0]?.label?.trim() ||
    finderContext?.profile.researchAreas?.[0]?.trim() ||
    '';

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-500 text-xl text-white shadow-[0_14px_34px_rgba(16,185,129,0.35)]">
        <FaSearch />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-slate-950">
        {displayName ? `Hi ${displayName} — what should we fund next?` : 'What should we fund next?'}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
        {primaryArea
          ? `Describe what you need in plain English — I can search calls for ${primaryArea}, answer questions about any call's documents, or talk through application strategy.`
          : 'Describe what you need in plain English — I can search the funding catalog, answer questions about a call’s documents, or talk through application strategy.'}
      </p>

      <div className="mt-6 grid w-full max-w-2xl gap-3 md:grid-cols-2">
        {starterPrompts.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onSendMessage(starter)}
            disabled={disabled}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:text-emerald-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
          >
            {starter}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
        <FaLightbulb className="text-amber-400" />
        Tip: after a search, try “what documents are required for result 1?”
      </div>
    </div>
  );
}
