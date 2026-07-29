import React from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import type { ResearcherFinderContext } from '../../lib/researcherProfile/types';

interface FinderSidebarProfileProps {
  finderContext: ResearcherFinderContext | null;
  onSearchResearchArea: (label: string, queryText: string) => void;
  disabled?: boolean;
}

function savedAreaQueryText(area: ResearcherFinderContext['researchAreas'][number]) {
  if (area.normalizedText?.trim()) return area.normalizedText;
  const taxonomyPath = [area.taxonomy?.level1Name, area.taxonomy?.level2Name].filter(Boolean).join(' / ');
  return [taxonomyPath, area.researchArea].filter(Boolean).join(' | ');
}

/**
 * Profile context in the rail: who the researcher is and their saved research areas
 * as one-click searches. Matching opt-ins live in the collapsible settings section.
 */
export default function FinderSidebarProfile({
  finderContext,
  onSearchResearchArea,
  disabled = false,
}: FinderSidebarProfileProps) {
  const profile = finderContext?.profile;
  const savedAreas = finderContext?.researchAreas || [];
  const profileAreas = profile?.researchAreas || [];
  const identityBits = [profile?.careerStage, profile?.institutionName, profile?.countryOfResidence].filter(Boolean);

  return (
    <div className="cb-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="cb-eyebrow">Your research profile</span>
        <Link href="/profile/research-fit" className="text-[12px] font-medium text-cobalt-700 hover:text-cobalt-800">
          Edit
        </Link>
      </div>

      {profile ? (
        <div className="mt-2.5">
          {profile.displayName ? <div className="text-[13px] font-medium text-ink">{profile.displayName}</div> : null}
          {identityBits.length > 0 ? (
            <div className="mt-0.5 text-[12px] leading-5 text-muted">{identityBits.join(' · ')}</div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2.5 text-[12px] leading-5 text-muted">
          Complete your{' '}
          <Link href="/profile/researcher" className="font-medium text-cobalt-700 hover:text-cobalt-800">
            research profile
          </Link>{' '}
          to personalize matching and get one-click searches for your topics.
        </p>
      )}

      {savedAreas.length > 0 || profileAreas.length > 0 ? (
        <div className="mt-3.5">
          <div className="text-[11px] text-muted-soft">Search my research areas</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {savedAreas.slice(0, 4).map((area) => (
              <button
                key={area.id}
                type="button"
                onClick={() => onSearchResearchArea(area.label || area.researchArea, savedAreaQueryText(area))}
                disabled={disabled}
                title={`Search funding for ${area.label || area.researchArea}`}
                className="cb-chip max-w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Search className="h-3 w-3 shrink-0" />
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
                  className="cb-chip max-w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Search className="h-3 w-3 shrink-0" />
                  <span className="truncate">{area}</span>
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
