import React, { useState } from 'react';
import { FaChevronDown, FaChevronRight, FaCog } from 'react-icons/fa';

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
 * The persistent left rail of the AI tab: filter mode, the manual filter panel
 * (single source of truth for the search space), profile-driven shortcuts, and a
 * collapsible Settings section holding the personal-context matching opt-ins.
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
        onSearchResearchArea={onSearchResearchArea}
        disabled={disabled}
      />

      <div className="rounded-[24px] border border-white/70 bg-white/85 shadow-sm">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          className="flex w-full items-center justify-between gap-2 rounded-[24px] p-4 text-left transition-colors hover:bg-slate-50/70"
        >
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <FaCog className="text-emerald-600" />
            Settings
          </span>
          <span className="flex items-center gap-2">
            {activePreferenceCount > 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-800">
                {activePreferenceCount} active
              </span>
            ) : null}
            {settingsOpen ? (
              <FaChevronDown className="text-xs text-slate-400" />
            ) : (
              <FaChevronRight className="text-xs text-slate-400" />
            )}
          </span>
        </button>
        {settingsOpen ? (
          <div className="border-t border-slate-100 p-4 pt-3">
            <FinderPreferencesPanel preferences={preferences} onChange={onPreferencesChange} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
