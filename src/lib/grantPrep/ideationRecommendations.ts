export const GRANT_PREP_MAX_IDEATION_PUBLICATIONS = 5;

export const GRANT_PREP_IDEA_RECOMMENDATION_REQUEST = [
  'Please recommend exactly three agency-aligned grant idea options for this funding call.',
  'Use my researcher profile, saved research areas, tagged publications if available, selected priority areas, and the funding agency requirements.',
  'Each option must be concrete and include a sentence beginning "Fits this call because".',
  'Use the same A/B/C card style as Grant Prep approval options.',
].join(' ');

export const GRANT_PREP_MORE_IDEAS_REQUEST = [
  'Please show 3 more new grant idea options for this funding call.',
  'Do not repeat or lightly reword any idea already shown in this conversation.',
  'Keep each idea tightly aligned with the funding agency requirements and include "Fits this call because" in each card.',
  'Use exactly three A/B/C cards.',
].join(' ');

export function parseGrantPrepPublicationLines(value: string) {
  return (value || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

export function buildGrantPrepPublicationRecommendationMessage(publications: string[]) {
  const usablePublications = publications.slice(0, GRANT_PREP_MAX_IDEATION_PUBLICATIONS);
  return [
    'Please recommend exactly three agency-aligned grant idea options for this funding call based on these publications.',
    'Use no more than these five publication signals, selected priority areas, and funding agency requirements.',
    'Each option must be concrete and include a sentence beginning "Fits this call because".',
    'Use the same A/B/C card style as Grant Prep approval options.',
    '',
    'Publication base:',
    ...usablePublications.map((publication, index) => `${index + 1}. ${publication}`),
  ].join('\n');
}
