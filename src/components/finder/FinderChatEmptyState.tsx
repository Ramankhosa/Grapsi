import React from 'react';
import { Sparkles } from 'lucide-react';

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
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-ink">
        {displayName ? `Hi ${displayName} — what should we fund next?` : 'What should we fund next?'}
      </h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-6 text-muted">
        {primaryArea
          ? `Describe what you need in plain English — I can search calls for ${primaryArea}, answer questions about any call's documents, or talk through application strategy.`
          : 'Describe what you need in plain English — I can search the funding catalog, answer questions about a call’s documents, or talk through application strategy.'}
      </p>

      <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {starterPrompts.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onSendMessage(starter)}
            disabled={disabled}
            className="cb-card px-3.5 py-3 text-left text-[13px] leading-5 text-ink-soft transition hover:border-cobalt-300 hover:bg-cobalt-50 hover:text-cobalt-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {starter}
          </button>
        ))}
      </div>

      <p className="mt-5 text-[12px] text-muted-soft">
        Tip: after a search, try “what documents are required for result 1?”
      </p>
    </div>
  );
}
