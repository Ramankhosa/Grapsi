import React from 'react';
import { BookOpen, UserRound } from 'lucide-react';

export interface FinderPreferenceValues {
  useEligibilityProfile: boolean;
  usePublicationContext: boolean;
}

interface FinderPreferencesPanelProps {
  preferences: FinderPreferenceValues;
  onChange: (preferences: FinderPreferenceValues) => void;
  compact?: boolean;
}

export default function FinderPreferencesPanel({
  preferences,
  onChange,
  compact = false,
}: FinderPreferencesPanelProps) {
  function update(patch: Partial<FinderPreferenceValues>) {
    onChange({ ...preferences, ...patch });
  }

  return (
    <div className={compact ? '' : 'cb-card p-4'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">My Preferences</div>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted">
            Choose what personal context this search may use. Profile uses your research areas plus country, citizenship,
            career stage, institution type, and language. Publications use library items tagged{' '}
            <span className="font-medium text-ink-soft">my-publication</span>.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: true, usePublicationContext: false })}
            className="cb-chip"
          >
            Eligibility
          </button>
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: false, usePublicationContext: true })}
            className="cb-chip"
          >
            Publications
          </button>
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: true, usePublicationContext: true })}
            className="cb-chip cb-chip-active"
          >
            Both
          </button>
        </div>
      </div>

      <div className={`mt-3 grid gap-2 ${compact ? '' : 'md:grid-cols-2'}`}>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-ground px-3 py-2.5">
          <input
            type="checkbox"
            checked={preferences.useEligibilityProfile}
            onChange={(event) => update({ useEligibilityProfile: event.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <UserRound className="h-3.5 w-3.5 text-muted" />
              Use eligibility profile
            </span>
            <span className="mt-0.5 block text-[12px] leading-5 text-muted">
              Matches calls to your research areas and checks eligibility against your profile fields.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-hairline bg-ground px-3 py-2.5">
          <input
            type="checkbox"
            checked={preferences.usePublicationContext}
            onChange={(event) => update({ usePublicationContext: event.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-hairline text-cobalt-600 focus:ring-cobalt-500"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <BookOpen className="h-3.5 w-3.5 text-muted" />
              Use my publications
            </span>
            <span className="mt-0.5 block text-[12px] leading-5 text-muted">
              Soft-ranks calls against your tagged publications without hiding valid calls.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
