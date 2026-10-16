import type { RecommendationEligibilityVerdict } from '../../lib/recommendations/types';

/**
 * How a call's stated country eligibility reads against the viewer's profile.
 * Only shown when there is a verdict: the call states its eligibility and the
 * viewer's profile has a country.
 */
export const ELIGIBILITY_BADGE: Record<RecommendationEligibilityVerdict, { label: string; className: string; title: string }> = {
  ELIGIBLE: {
    label: 'Eligible',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    title: "Your profile's country meets this call's stated eligibility.",
  },
  NEEDS_CHECK: {
    label: 'Check eligibility',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    title: "The call's eligibility could not be confirmed from your profile. Check the funder's rules.",
  },
  INELIGIBLE: {
    label: 'Not eligible for your profile',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
    title: "This call's stated eligibility excludes your profile's country.",
  },
};
