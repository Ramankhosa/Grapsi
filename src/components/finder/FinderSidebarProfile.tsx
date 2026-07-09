import React from 'react';
import Link from 'next/link';
import { FaGraduationCap, FaSearch, FaUserCircle } from 'react-icons/fa';

import FinderPreferencesPanel, { type FinderPreferenceValues } from '../FinderPreferencesPanel';
import type { ResearcherFinderContext } from '../../lib/researcherProfile/types';

interface FinderSidebarProfileProps {
  finderContext: ResearcherFinderContext | null;
  preferences: FinderPreferenceValues;
  onPreferencesChange: (preferences: FinderPreferenceValues) => void;
  onSearchResearchArea: (label: string, queryText: string) => void;
  disabled?: boolean;
}

function savedAreaQueryText(area: ResearcherFinderContext['researchAreas'][number]) {
  if (area.normalizedText?.trim()) return area.normalizedText;
  const taxonomyPath = [area.taxonomy?.level1Name, area.taxonomy?.level2Name].filter(Boolean).join(' / ');
  return [taxonomyPath, area.researchArea].filter(Boolean).join(' | ');
}

/**
 * Profile context in the sidebar: who the researcher is, their saved research areas as
 * one-click searches, and the eligibility/publication matching opt-ins.
 */
export default function FinderSidebarProfile({
  finderContext,
  preferences,
  onPreferencesChange,
  onSearchResearchArea,
  disabled = false,
}: FinderSidebarProfileProps) {
  const profile = finderContext?.profile;
  const savedAreas = finderContext?.researchAreas || [];
  const profileAreas = profile?.researchAreas || [];
  const identityBits = [profile?.careerStage, profile?.institutionName, profile?.countryOfResidence].filter(Boolean);

  return (
    <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <FaUserCircle className="text-emerald-600" />
          Your Research Profile
        </div>
        <Link
          href="/profile/research-fit"
          className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700 hover:text-emerald-900"
        >
          Edit
        </Link>
      </div>

      {profile ? (
        <div className="mt-3">
          {profile.displayName ? (
            <div className="text-sm font-semibold text-slate-900">{profile.displayName}</div>
          ) : null}
          {identityBits.length > 0 ? (
            <div className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
              <FaGraduationCap className="mt-0.5 shrink-0 text-slate-400" />
              <span>{identityBits.join(' · ')}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Complete your <Link href="/profile/researcher" className="font-semibold text-emerald-700">research profile</Link> to
          personalize matching and get one-click searches for your topics.
        </p>
      )}

      {savedAreas.length > 0 || profileAreas.length > 0 ? (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Search My Research Areas
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {savedAreas.slice(0, 4).map((area) => (
              <button
                key={area.id}
                type="button"
                onClick={() => onSearchResearchArea(area.label || area.researchArea, savedAreaQueryText(area))}
                disabled={disabled}
                title={`Search funding for ${area.label || area.researchArea}`}
                className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaSearch className="shrink-0 text-[9px] text-emerald-500" />
                <span className="truncate">{area.label || area.researchArea}</span>
              </button>
            ))}
            {savedAreas.length === 0 &&
              profileAreas.slice(0, 4).map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => onSearchResearchArea(area, area)}
                  disabled={disabled}
                  className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FaSearch className="shrink-0 text-[9px] text-emerald-500" />
                  <span className="truncate">{area}</span>
                </button>
              ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <FinderPreferencesPanel preferences={preferences} onChange={onPreferencesChange} compact />
      </div>
    </div>
  );
}
