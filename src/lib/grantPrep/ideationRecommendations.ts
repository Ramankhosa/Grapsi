import type {
  GrantPrepIdeationPublicationContext,
  GrantPrepIdeationResearchAreaContext,
} from './types';

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

export const GRANT_PREP_CALL_ONLY_IDEA_RECOMMENDATION_REQUEST = [
  'Please recommend exactly three agency-aligned grant idea options for this funding call.',
  'Use the funding call, selected priority areas, and agency requirements only.',
  'Do not personalize the ideas with my profile, saved research areas, or publications unless I explicitly add them later.',
  'Each option must be concrete and include a sentence beginning "Fits this call because".',
  'Use the same A/B/C card style as Grant Prep approval options.',
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

export function buildGrantPrepResearchAreaRecommendationMessage(area: GrantPrepIdeationResearchAreaContext) {
  const title = area.label || area.researchArea || 'Selected research area';
  const details = [
    area.researchArea ? `Focus: ${area.researchArea}` : null,
    area.taxonomyPath ? `Classification: ${area.taxonomyPath}` : null,
    area.keywords?.length ? `Keywords: ${area.keywords.slice(0, 8).join(', ')}` : null,
    area.disciplines?.length ? `Disciplines: ${area.disciplines.slice(0, 6).join(', ')}` : null,
  ].filter(Boolean);

  return [
    'Please recommend exactly three agency-aligned grant idea options for this funding call based on this saved research area.',
    'Use this research area as the primary researcher signal, alongside selected priority areas and funding agency requirements.',
    'Each option must be concrete and include a sentence beginning "Fits this call because".',
    'Use the same A/B/C card style as Grant Prep approval options.',
    '',
    `Selected research area: ${title}`,
    ...details,
  ].join('\n');
}

export function buildGrantPrepSavedPublicationRecommendationMessage(publication: GrantPrepIdeationPublicationContext) {
  const details = [
    publication.year ? `Year: ${publication.year}` : null,
    publication.venue ? `Venue: ${publication.venue}` : null,
    publication.doi ? `DOI: ${publication.doi}` : null,
    publication.abstractSnippet ? `Abstract: ${publication.abstractSnippet}` : null,
  ].filter(Boolean);

  return [
    'Please recommend exactly three agency-aligned grant idea options for this funding call based on this key publication.',
    'Use this publication as the primary researcher signal, alongside selected priority areas and funding agency requirements.',
    'Each option must be concrete and include a sentence beginning "Fits this call because".',
    'Use the same A/B/C card style as Grant Prep approval options.',
    '',
    `Key publication: ${publication.title}`,
    ...details,
  ].join('\n');
}
