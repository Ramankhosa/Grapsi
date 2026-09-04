/**
 * The mentor persona.
 *
 * Named rather than anonymous so guidance has a consistent voice across the
 * assistant, onboarding and alerts — but deliberately NOT a mascot. The buyers
 * here are Deans, HoDs and Professors; a cartoon character reads as
 * student-facing edtech and undercuts the credibility the live sessions with
 * retired agency scientists are built on.
 *
 * "Mira" is the first known variable star — an astronomy reference academics
 * enjoy — and reads as a name in Indian, Latin, Slavic, Germanic and Japanese
 * contexts alike, which matters because this ships beyond India. It is not
 * owned by any one culture and is not gendered in a way that excludes.
 *
 * Everything about the persona flows from these constants, so renaming it in a
 * new market is a one-line change, and dropping the name entirely (falling back
 * to the role, "your mentor") costs nothing.
 */

export const MENTOR = {
  /** Proper name. Change this one value to rename the persona everywhere. */
  name: 'Mira',
  /** What she is, in the user's words. Used where the name alone is not enough. */
  role: 'your funding mentor',
  /** One line, for the first time a user meets her. */
  intro: 'I read the calls, the rubrics and 50,000 funded projects so you do not have to.',
  /** Monogram fallback for the avatar. */
  initial: 'M',
} as const

/**
 * Voice rules. These are the difference between a mentor and a chatbot mascot.
 *
 *  DO   — cite the evidence: "19 of the 24 funded DST awards named an industry
 *         partner. Yours names none."
 *  DO   — say the next action, and what it costs: "Name the test standard. Ten
 *         minutes, and it moves feasibility by a full point."
 *  DO   — stay level when the news is bad. A rejected draft is information.
 *
 *  DON'T — cheer, congratulate, or use exclamation marks.
 *  DON'T — apologise, hedge, or pad with "I'd be happy to".
 *  DON'T — appear on scoring and data surfaces. A rubric score is an
 *          instrument reading, not an opinion; putting a face beside it makes
 *          it look negotiable. She explains the score, she does not award it.
 *
 * Where she belongs: the funding assistant, onboarding and empty states, alert
 * sign-offs, and the hand-off into a live session with a human panel veteran.
 */
export const MENTOR_SURFACES = [
  'funding-assistant',
  'onboarding',
  'empty-states',
  'alert-signoff',
  'training-handoff',
] as const

export type MentorSurface = (typeof MENTOR_SURFACES)[number]
