'use strict';
/**
 * Pages that need no reading: shared by the app's shortlist (src/lib/monitor/
 * relevance.ts) and the laptop broker's own sweep, so neither sends them to
 * the laptop. Every rule applies only to a page with no funding-like word in
 * its title or address; documents are always read.
 *
 * 29 Oct 2026: nearly every link was queued (a sitemap gave nsf.gov 4,000
 * pages of events and award-winner profiles). Same day, from the laptop's own
 * 1,647 verdicts: 570 of 793 GENERAL pages matched the folder and title rules
 * below, against 12 RELATED (conference listings and office orders, no calls).
 */
const FUNDING = /fund|grant|fellow|scholar|bursar|stipend|call|opportunit|programme|program|scheme|award|apply|applica|proposal|solicitation|nofo|rfp|foerder|forder|förder|ausschreib|bewerb|bourse|subvention|financ|finansi|beca|bidrag|anslag|utlys|ansøg|ansog|opslag|bevill|anudan|yojana|yojna|prize|competition|bekanntmachung|appel|candidatur|forskningsmedel|forskningsmidl|edital|bando|convocatori|stiftelse/i;
const NOISE_SEGMENTS = new Set([
  'event', 'events', 'webinar', 'webinars', 'news', 'nyheder', 'nyheter', 'nieuws', 'aktuelt', 'actualites', 'actualités',
  'press', 'press-releases', 'pressreleases', 'pressemitteilungen', 'media', 'blog', 'blogs', 'podcast', 'podcasts', 'video', 'videos', 'gallery',
  'people', 'staff', 'team', 'our-people', 'directory', 'recipients', 'awardees', 'laureates', 'honorary-awards', 'alumni',
  'forschungsradar', 'gepris', 'jobs', 'careers', 'vacancies', 'tag', 'tags', 'category', 'author',
  // From the laptop's GENERAL verdicts (29 Oct 2026).
  'news-article', 'people-profile', 'award-recipients', 'staff_corner', 'staf_corner',
]);
const NOISE_TITLES = [
  // Building and construction news.
  /\b(tops? out|nears? completion|completed|renderings?|breaks? ground|under construction)\b|\bproposed (above|for|in|at)\b/i,
  // Events, visits and ceremonies.
  /\b(kick ?off|ceremony|inauguration|webinar|office tour|site visit|tour series|meet ?up|happy hour)\b/i,
  // Internal paperwork.
  /\b(office order|office memorandum|sanction order|purchase requ\w*|booking form|reimbursement|leave application|tour programme|tour diary)\b/i,
];
const DOCUMENT = /\.(pdf|docx?|xlsx?|odt|rtf|zip)$/;
const REASONS = {
  SITEMAP_NOT_FUNDING: 'Sitemap entry outside the funding pages, with no funding word',
  NOT_FUNDING_SECTION: 'Event, news, people or archive page with no funding word',
  OLD_DATED_PAGE: 'Dated page from before last year, with no funding word',
  NOT_FUNDING_TITLE: 'Building news, event or internal paperwork with no funding word',
};

function decodedPath(url) {
  try { return decodeURIComponent(new URL(url).pathname).toLowerCase(); } catch { return null; }
}

/** Why the page needs no reading, or null. Callers decide whether a funding word elsewhere (context, keywords) overrides. */
function addressSkip(url, onlyInSitemaps, now) {
  const path = decodedPath(url);
  if (path === null || DOCUMENT.test(path)) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.some(s => NOISE_SEGMENTS.has(s))) return 'NOT_FUNDING_SECTION';
  const dated = path.match(/(?:^|\/|-)(20\d{2})[-/](0[1-9]|1[0-2])(?:[-/](0[1-9]|[12]\d|3[01]))?(?:\/|-|$)/);
  if (dated && Number(dated[1]) < (now || new Date()).getUTCFullYear() - 1) return 'OLD_DATED_PAGE';
  if (onlyInSitemaps && !FUNDING.test(path)) return 'SITEMAP_NOT_FUNDING';
  return null;
}

/**
 * Address and title together. A funding word in the title or in any part of
 * the address other than a noise folder keeps the page: "/news/new-call-opens"
 * is read, while "/honorary-awards/…/recipients/jane-doe" (whose folder names
 * merely contain "award") is not.
 */
function shortlistSkip(url, title, onlyInSitemaps, now) {
  const path = decodedPath(url);
  if (path === null || DOCUMENT.test(path)) return null;
  if (FUNDING.test(title || '') || path.split('/').some(s => s && !NOISE_SEGMENTS.has(s) && FUNDING.test(s))) return null;
  const byAddress = addressSkip(url, onlyInSitemaps, now);
  if (byAddress) return byAddress;
  return NOISE_TITLES.some(rx => rx.test(title || '')) ? 'NOT_FUNDING_TITLE' : null;
}

module.exports = { FUNDING, NOISE_SEGMENTS, NOISE_TITLES, REASONS, addressSkip, shortlistSkip };
