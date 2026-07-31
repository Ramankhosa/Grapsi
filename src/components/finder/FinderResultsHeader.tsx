import React from 'react';
import { Check } from 'lucide-react';

interface FinderResultsHeaderProps {
  /** Number of result cards rendered below this line. */
  shown: number;
  /** Extra matches beyond the inline cards — known only while streaming. */
  extra?: number;
}

/**
 * The one-line summary that sits directly above a turn's result cards.
 *
 * Both the streaming turn and the saved turn render this, at the same height and
 * the same position, so finalizing a stream never moves the cards. Keep it to a
 * single line in every state — a two-line variant would reintroduce the jump.
 */
export default function FinderResultsHeader({ shown, extra = 0 }: FinderResultsHeaderProps) {
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[12px]">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cobalt-50 text-cobalt-700">
        <Check className="h-2.5 w-2.5" />
      </span>
      <span className="truncate text-muted-soft">
        Top {shown} match{shown === 1 ? '' : 'es'}
        {extra > 0 ? ` · ${extra} more available` : ''}
      </span>
    </div>
  );
}
