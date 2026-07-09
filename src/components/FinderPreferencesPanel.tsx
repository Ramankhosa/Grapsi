import React from 'react';
import { FaBookOpen, FaCheck, FaUserCircle } from 'react-icons/fa';

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
    <div className={`rounded-2xl border border-emerald-100 bg-emerald-50/70 ${compact ? 'px-4 py-3' : 'px-5 py-4'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">My Preferences</div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-emerald-950">
            Choose what personal context this search may use. Profile uses your research areas plus country, citizenship,
            career stage, institution type, and language. Publications use library items tagged <span className="font-semibold">my-publication</span>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: true, usePublicationContext: false })}
            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 transition-colors hover:border-emerald-300"
          >
            Eligibility
          </button>
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: false, usePublicationContext: true })}
            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 transition-colors hover:border-emerald-300"
          >
            Publications
          </button>
          <button
            type="button"
            onClick={() => onChange({ useEligibilityProfile: true, usePublicationContext: true })}
            className="rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-emerald-700"
          >
            Use Both
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white bg-white/80 px-4 py-3">
          <input
            type="checkbox"
            checked={preferences.useEligibilityProfile}
            onChange={(event) => update({ useEligibilityProfile: event.target.checked })}
            className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FaUserCircle className="text-emerald-600" />
              Use eligibility profile
              {preferences.useEligibilityProfile ? <FaCheck className="text-xs text-emerald-600" /> : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">
              Matches calls to your research areas and checks eligibility against your profile fields.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white bg-white/80 px-4 py-3">
          <input
            type="checkbox"
            checked={preferences.usePublicationContext}
            onChange={(event) => update({ usePublicationContext: event.target.checked })}
            className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FaBookOpen className="text-emerald-600" />
              Use my publications
              {preferences.usePublicationContext ? <FaCheck className="text-xs text-emerald-600" /> : null}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">
              Soft-ranks calls against your tagged publications without hiding valid calls.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
