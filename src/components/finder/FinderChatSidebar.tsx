import React from 'react';

import FinderFilterModeToggle from './FinderFilterModeToggle';
import FinderSidebarFilters from './FinderSidebarFilters';
import FinderSidebarProfile from './FinderSidebarProfile';
import type { FinderPreferenceValues } from '../FinderPreferencesPanel';
import type { RecommendationFilterMode } from '../../lib/recommendations/chatTypes';
import type { RecommendationSearchFilters } from '../../lib/recommendations/types';
import type { ResearcherFinderContext } from '../../lib/researcherProfile/types';

export interface FinderChatSidebarProps {
  filterMode: RecommendationFilterMode;
  onFilterModeChange: (mode: RecommendationFilterMode) => void;
  filters: Required<RecommendationSearchFilters> | null;
  onRemoveArrayValue: (key: keyof RecommendationSearchFilters, value: string) => void;
  onClearScalar: (key: keyof RecommendationSearchFilters) => void;
  onOpenFilterEditor: () => void;
  onClearAllFilters: () => void;
  onUndoFilters?: () => void;
  finderContext: ResearcherFinderContext | null;
  preferences: FinderPreferenceValues;
  onPreferencesChange: (preferences: FinderPreferenceValues) => void;
  onSearchResearchArea: (label: string, queryText: string) => void;
  disabled?: boolean;
}

/**
 * The persistent left rail of the AI tab: filter mode, the manual filter panel
 * (single source of truth for the search space), and profile-driven shortcuts.
 */
export default function FinderChatSidebar({
  filterMode,
  onFilterModeChange,
  filters,
  onRemoveArrayValue,
  onClearScalar,
  onOpenFilterEditor,
  onClearAllFilters,
  onUndoFilters,
  finderContext,
  preferences,
  onPreferencesChange,
  onSearchResearchArea,
  disabled = false,
}: FinderChatSidebarProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Filter Mode</div>
        <div className="mt-2">
          <FinderFilterModeToggle mode={filterMode} onChange={onFilterModeChange} disabled={disabled} />
        </div>
      </div>

      {filters ? (
        <FinderSidebarFilters
          filters={filters}
          onRemoveArrayValue={onRemoveArrayValue}
          onClearScalar={onClearScalar}
          onOpenFilterEditor={onOpenFilterEditor}
          onClearAllFilters={onClearAllFilters}
          onUndo={onUndoFilters}
          disabled={disabled}
        />
      ) : null}

      <FinderSidebarProfile
        finderContext={finderContext}
        preferences={preferences}
        onPreferencesChange={onPreferencesChange}
        onSearchResearchArea={onSearchResearchArea}
        disabled={disabled}
      />
    </div>
  );
}
