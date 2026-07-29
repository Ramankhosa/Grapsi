import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react';

import FinderFilterModeToggle from './FinderFilterModeToggle';
import FinderSidebarFilters from './FinderSidebarFilters';
import FinderSidebarProfile from './FinderSidebarProfile';
import FinderPreferencesPanel, { type FinderPreferenceValues } from '../FinderPreferencesPanel';
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
 * The search-context rail: filter mode, the manual filter panel (single source of
 * truth for the search space), profile-driven shortcuts, and a collapsible settings
 * section holding the personal-context matching opt-ins.
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activePreferenceCount = [preferences.useEligibilityProfile, preferences.usePublicationContext].filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="cb-card p-3.5">
        <div className="cb-eyebrow">Filter mode</div>
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
        onSearchResearchArea={onSearchResearchArea}
        disabled={disabled}
      />

      <div className="cb-card">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          className="flex w-full items-center justify-between gap-2 rounded-xl p-3.5 text-left transition hover:bg-inset"
        >
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <Settings2 className="h-4 w-4 text-muted" />
            Matching settings
          </span>
          <span className="flex items-center gap-2">
            {activePreferenceCount > 0 ? <span className="cb-badge-cobalt">{activePreferenceCount} on</span> : null}
            {settingsOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-soft" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-soft" />
            )}
          </span>
        </button>
        {settingsOpen ? (
          <div className="border-t border-hairline p-3.5">
            <FinderPreferencesPanel preferences={preferences} onChange={onPreferencesChange} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
